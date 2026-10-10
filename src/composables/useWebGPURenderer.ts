import { onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import {
  vertexShader,
  blitShader,
  passthroughShader,
  createEffectShaderWGSL,
  createMappingShaderWGSL,
  mappingMask,
  rdStepShader,
  rdCompositeShader,
  UNIFORMS_FLOAT_COUNT,
  UNIFORM_IDX
} from '@/shaderBuilderWGSL';

type Channels = [number, number, number];

export interface FrameStats {
  mean: number;
  variance: number;
  channels: Channels;
}

export interface FrameQuality {
  source: FrameStats;
  output: FrameStats;
}

export interface UseWebGPURendererOptions {
  canvasRef: Ref<HTMLCanvasElement | null>;
  videoRef: Ref<HTMLVideoElement | null>;
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>;
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>;
  bpmSyncEnabled: ComputedRef<Record<ShaderEffect, boolean>>;
  bpm: Ref<number>;
  getBeatClock?: (timeSec: number) => { time: number; bpm: number } | null;
  onRenderPerformance?: (fps: number, frameTime: number) => void;
  onVideoNotRenderable?: () => void;
  onFrameQuality?: (quality: FrameQuality) => void;
  onRendererUnavailable?: () => void;
}

export function useWebGPURenderer(options: UseWebGPURendererOptions) {
  let cleanup: (() => void) | null = null;
  let unmounted = false;

  async function start() {
    cleanup =
      (await initRenderer(options, () => {
        cleanup?.();
        cleanup = null;
        if (!unmounted) void start();
      })) ?? null;
  }

  onMounted(start);
  onUnmounted(() => {
    unmounted = true;
    cleanup?.();
  });
}

const TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
// Gray-Scott needs finer steps than 8 bits: at rgba8unorm the small reaction and diffusion
// updates round away, which stalls the pattern or makes it blocky.
const RD_TEXTURE_FORMAT: GPUTextureFormat = 'rgba16float';
export const RD_STEPS_PER_FRAME = 4;
const BLACK: GPUColor = { r: 0, g: 0, b: 0, a: 1 };

const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0
]);

const FRAME_RING_SIZE = 128;

const COPY_ROW_ALIGNMENT = 256;
const PROBE_W = 32;
const PROBE_H = 18;
const PROBE_ROW_BYTES = Math.ceil((PROBE_W * 4) / COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT;
const PROBE_BYTES = PROBE_ROW_BYTES * PROBE_H;
const QUALITY_PROBE_FRAMES = 15;
// WebKit garbles some videos on the way into WebGPU (10-bit HEVC) while decoding them fine
// for a 2D canvas, so the two are compared.
const GARBLED_CHANNEL_GAP = 0.2;
const GARBLED_PROBES = 3;

function frameStats(data: Uint8ClampedArray | Uint8Array, offset: number, rowBytes: number) {
  let sum = 0;
  let sumSq = 0;
  const channels: Channels = [0, 0, 0];
  for (let y = 0; y < PROBE_H; y++) {
    for (let x = 0; x < PROBE_W; x++) {
      const i = offset + y * rowBytes + x * 4;
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      sum += luma;
      sumSq += luma * luma;
      channels[0] += data[i];
      channels[1] += data[i + 1];
      channels[2] += data[i + 2];
    }
  }
  const n = PROBE_W * PROBE_H;
  const mean = sum / n;
  return {
    mean,
    variance: Math.max(0, sumSq / n - mean * mean),
    channels: channels.map((c) => c / n / 255) as Channels
  };
}

export function channelsDisagree(a: Channels, b: Channels): boolean {
  return a.some((value, i) => Math.abs(value - b[i]) > GARBLED_CHANNEL_GAP);
}

export function createGarbledDetector(onGarbled: () => void) {
  let streak = 0;
  let reported = false;
  return {
    reset() {
      streak = 0;
      reported = false;
    },
    check(received: Channels, reference: Channels) {
      streak = channelsDisagree(received, reference) ? streak + 1 : 0;
      if (streak >= GARBLED_PROBES && !reported) {
        reported = true;
        onGarbled();
      }
    }
  };
}

export function computeCrop(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number
): [number, number, number, number] {
  if (videoWidth === 0 || videoHeight === 0) return [0, 1, 0, 1];
  const vAspect = videoWidth / videoHeight;
  const cAspect = canvasWidth / canvasHeight;
  if (vAspect < cAspect) {
    const crop = (1 - vAspect / cAspect) / 2;
    return [0, 1, crop, 1 - crop];
  } else {
    const crop = (1 - cAspect / vAspect) / 2;
    return [crop, 1 - crop, 0, 1];
  }
}

async function acquireGPUContext(canvas: HTMLCanvasElement): Promise<{
  device: GPUDevice;
  context: GPUCanvasContext;
  canvasFormat: GPUTextureFormat;
} | null> {
  if (!navigator.gpu) {
    console.error('WebGPU not supported.');
    return null;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error('No WebGPU adapter found.');
    return null;
  }
  const device = await adapter.requestDevice();
  const rawContext = canvas.getContext('webgpu');
  if (!rawContext) {
    console.error('WebGPU context not available.');
    return null;
  }
  const context = rawContext as unknown as GPUCanvasContext;
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });
  return { device, context, canvasFormat };
}

function createGPUResources(device: GPUDevice, canvasFormat: GPUTextureFormat) {
  const vertexBuffer = device.createBuffer({
    size: QUAD_VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, QUAD_VERTICES);

  const vertexLayout: GPUVertexBufferLayout = {
    arrayStride: 16,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x2' }
    ]
  };

  const uniformBuffer = device.createBuffer({
    size: UNIFORMS_FLOAT_COUNT * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const uniformData = new Float32Array(UNIFORMS_FLOAT_COUNT);

  const sampler = device.createSampler({
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'mirror-repeat',
    addressModeV: 'mirror-repeat'
  });

  const probeBuffer = device.createBuffer({
    size: PROBE_BYTES * 2,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  });
  const makeProbeTexture = () =>
    device.createTexture({
      size: [PROBE_W, PROBE_H],
      format: TEXTURE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });
  const probeTextures = { source: makeProbeTexture(), output: makeProbeTexture() };

  const externalTextureBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
    ]
  });
  const textureBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
    ]
  });
  const feedbackTextureBGL = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
    ]
  });
  const uniformBGL = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }
      }
    ]
  });
  const uniformBindGroup = device.createBindGroup({
    layout: uniformBGL,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  const vsModule = device.createShaderModule({ code: vertexShader });
  function makePipeline(
    fragCode: string,
    bgl: GPUBindGroupLayout,
    format: GPUTextureFormat
  ): GPURenderPipeline {
    return device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl, uniformBGL] }),
      vertex: { module: vsModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
      fragment: {
        module: device.createShaderModule({ code: fragCode }),
        entryPoint: 'fs_main',
        targets: [{ format }]
      },
      primitive: { topology: 'triangle-list' }
    });
  }

  const effectPipelines = new Map<ShaderEffect, GPURenderPipeline>();
  for (const effect of Object.values(ShaderEffect)) {
    const wgsl = createEffectShaderWGSL(effect);
    if (wgsl === null) continue;
    effectPipelines.set(
      effect,
      makePipeline(
        wgsl,
        shaderEffects[effect].stage === 'feedback' ? feedbackTextureBGL : textureBGL,
        TEXTURE_FORMAT
      )
    );
  }

  return {
    vertexBuffer,
    uniformBuffer,
    uniformData,
    sampler,
    probeBuffer,
    probeTextures,
    bgls: { externalTextureBGL, textureBGL, feedbackTextureBGL, uniformBGL },
    uniformBindGroup,
    pipelines: {
      blit: makePipeline(blitShader, externalTextureBGL, TEXTURE_FORMAT),
      effects: effectPipelines,
      passthrough: makePipeline(passthroughShader, textureBGL, canvasFormat),
      mapping: makePipeline(createMappingShaderWGSL(), textureBGL, TEXTURE_FORMAT),
      probe: makePipeline(passthroughShader, textureBGL, TEXTURE_FORMAT),
      rdStep: makePipeline(rdStepShader, feedbackTextureBGL, RD_TEXTURE_FORMAT),
      rdComposite: makePipeline(rdCompositeShader, feedbackTextureBGL, TEXTURE_FORMAT)
    }
  };
}

function writeUniforms(
  data: Float32Array,
  options: UseWebGPURendererOptions,
  timeSec: number
): void {
  const { bpm: bpmRef, effectIntensities, bpmSyncEnabled, getBeatClock } = options;
  const intensities = effectIntensities.value;
  const sync = bpmSyncEnabled.value;
  const beatClock = getBeatClock?.(timeSec);

  data[UNIFORM_IDX.time] = beatClock?.time ?? timeSec;
  data[UNIFORM_IDX.bpm] = beatClock?.bpm ?? bpmRef.value;

  data[UNIFORM_IDX.mappingMask] = mappingMask(options.activeEffects.value);

  for (const effect of Object.values(ShaderEffect)) {
    const iIdx = UNIFORM_IDX.intensity[effect];
    if (iIdx !== undefined) data[iIdx] = intensities[effect] ?? 1;
    const sIdx = UNIFORM_IDX.bpmSync[effect];
    if (sIdx !== undefined) data[sIdx] = sync[effect] ? 1 : 0;
  }
}

async function initRenderer(
  options: UseWebGPURendererOptions,
  onDeviceLost: () => void
): Promise<(() => void) | undefined> {
  const canvas = options.canvasRef.value;
  if (!canvas) return;

  const gpu = await acquireGPUContext(canvas);
  if (!gpu) {
    options.onRendererUnavailable?.();
    return;
  }
  const { device, context, canvasFormat } = gpu;
  void device.lost.then((info) => {
    if (info.reason !== 'destroyed') onDeviceLost();
  });

  const res = createGPUResources(device, canvasFormat);
  const { vertexBuffer, uniformBuffer, uniformData, sampler, probeBuffer, probeTextures } = res;
  const probeViews = {
    source: probeTextures.source.createView(),
    output: probeTextures.output.createView()
  };
  const { externalTextureBGL, textureBGL, feedbackTextureBGL } = res.bgls;
  const { uniformBindGroup, pipelines } = res;

  let renderTargets: [GPUTexture, GPUTexture, GPUTexture] | null = null;
  let rtViews: [GPUTextureView, GPUTextureView, GPUTextureView] | null = null;
  let rtBindGroups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] | null = null;
  let historyBindGroups: (GPUBindGroup | null)[][] | null = null;
  let rdTextures: [GPUTexture, GPUTexture] | null = null;
  let rdViews: [GPUTextureView, GPUTextureView] | null = null;
  let rdStepBGs: GPUBindGroup[][] | null = null;
  let rdCompBGs: GPUBindGroup[] | null = null;
  let histIdx = 2;

  function makeTexture(w: number, h: number, extraUsage = 0): GPUTexture {
    return device.createTexture({
      size: [w, h],
      format: TEXTURE_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        extraUsage
    });
  }

  function updateTargets() {
    if (!canvas) return;
    const newW = window.innerWidth;
    const newH = window.innerHeight;
    const sizeChanged = canvas.width !== newW || canvas.height !== newH;
    canvas.width = newW;
    canvas.height = newH;

    const video = options.videoRef.value;
    const [uMin, uMax, vMin, vMax] = computeCrop(
      video?.videoWidth ?? 0,
      video?.videoHeight ?? 0,
      newW,
      newH
    );
    uniformData[UNIFORM_IDX.cropUMin] = uMin;
    uniformData[UNIFORM_IDX.cropUMax] = uMax;
    uniformData[UNIFORM_IDX.cropVMin] = vMin;
    uniformData[UNIFORM_IDX.cropVMax] = vMax;

    if (renderTargets && !sizeChanged) return;

    renderTargets?.forEach((t) => t.destroy());
    rdTextures?.forEach((t) => t.destroy());

    const [rt0, rt1, rt2] = [
      makeTexture(newW, newH),
      makeTexture(newW, newH),
      makeTexture(newW, newH)
    ];
    const [rdA, rdB] = [
      device.createTexture({
        size: [newW, newH],
        format: RD_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      }),
      device.createTexture({
        size: [newW, newH],
        format: RD_TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      })
    ];

    const [rtView0, rtView1, rtView2] = [rt0.createView(), rt1.createView(), rt2.createView()];
    const [rdViewA, rdViewB] = [rdA.createView(), rdB.createView()];

    renderTargets = [rt0, rt1, rt2];
    rtViews = [rtView0, rtView1, rtView2];
    rdTextures = [rdA, rdB];
    rdViews = [rdViewA, rdViewB];
    histIdx = 2;

    rtBindGroups = [rtView0, rtView1, rtView2].map((rtView) =>
      device.createBindGroup({
        layout: textureBGL,
        entries: [
          { binding: 0, resource: rtView },
          { binding: 1, resource: sampler }
        ]
      })
    ) as [GPUBindGroup, GPUBindGroup, GPUBindGroup];

    historyBindGroups = [rtView0, rtView1, rtView2].map((srcView, src) =>
      [rtView0, rtView1, rtView2].map((histView, hist) =>
        src === hist
          ? null
          : device.createBindGroup({
              layout: feedbackTextureBGL,
              entries: [
                { binding: 0, resource: srcView },
                { binding: 1, resource: sampler },
                { binding: 2, resource: histView }
              ]
            })
      )
    );

    rdStepBGs = [rdViewA, rdViewB].map((rdView) =>
      [rtView0, rtView1, rtView2].map((rtView) =>
        device.createBindGroup({
          layout: feedbackTextureBGL,
          entries: [
            { binding: 0, resource: rdView },
            { binding: 1, resource: sampler },
            { binding: 2, resource: rtView }
          ]
        })
      )
    );

    rdCompBGs = [rtView0, rtView1, rtView2].map((rtView) =>
      device.createBindGroup({
        layout: feedbackTextureBGL,
        entries: [
          { binding: 0, resource: rtView },
          { binding: 1, resource: sampler },
          { binding: 2, resource: rdViewA }
        ]
      })
    );

    const initEnc = device.createCommandEncoder();
    encodeReactionDiffusionReset(initEnc);
    device.queue.submit([initEnc.finish()]);
  }

  function encodeReactionDiffusionReset(encoder: GPUCommandEncoder) {
    for (const view of rdViews ?? []) {
      encoder
        .beginRenderPass({
          colorAttachments: [
            { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 0, b: 0, a: 1 } }
          ]
        })
        .end();
    }
  }

  function encodeFullscreenPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
    target: GPUTextureView
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: BLACK }]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setBindGroup(1, uniformBindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6);
    pass.end();
  }

  function clearCanvas() {
    const encoder = device.createCommandEncoder();
    encoder
      .beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: BLACK
          }
        ]
      })
      .end();
    device.queue.submit([encoder.finish()]);
  }

  updateTargets();
  window.addEventListener('resize', updateTargets);
  const stopVideoWatch = watch(
    options.videoRef,
    (newVideo, oldVideo) => {
      if (oldVideo) oldVideo.removeEventListener('loadedmetadata', updateTargets);
      if (newVideo) newVideo.addEventListener('loadedmetadata', updateTargets);
    },
    { immediate: true }
  );

  const perfData = {
    frameRing: new Float64Array(FRAME_RING_SIZE),
    frameHead: 0,
    lastReport: 0
  };
  let lastVideo: HTMLVideoElement | null = null;
  let videoWasReady = false;
  let notifiedNotRenderable = false;
  let qualityFrameCount = 0;
  let qualityReadbackPending = false;
  let rdWasActive = false;
  let rafId = 0;
  const garbled = createGarbledDetector(() => options.onVideoNotRenderable?.());

  const referenceCanvas = document.createElement('canvas');
  referenceCanvas.width = PROBE_W;
  referenceCanvas.height = PROBE_H;
  const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true });

  function sampleReference(video: HTMLVideoElement): Channels | null {
    if (!referenceContext || video.videoWidth === 0) return null;
    try {
      const uMin = uniformData[UNIFORM_IDX.cropUMin];
      const vMin = uniformData[UNIFORM_IDX.cropVMin];
      referenceContext.drawImage(
        video,
        uMin * video.videoWidth,
        vMin * video.videoHeight,
        (uniformData[UNIFORM_IDX.cropUMax] - uMin) * video.videoWidth,
        (uniformData[UNIFORM_IDX.cropVMax] - vMin) * video.videoHeight,
        0,
        0,
        PROBE_W,
        PROBE_H
      );
      const pixels = referenceContext.getImageData(0, 0, PROBE_W, PROBE_H).data;
      return frameStats(pixels, 0, PROBE_W * 4).channels;
    } catch {
      return null;
    }
  }

  function readProbe(reference: Channels | null) {
    qualityReadbackPending = true;
    probeBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const data = new Uint8Array(probeBuffer.getMappedRange());
        const quality = {
          source: frameStats(data, 0, PROBE_ROW_BYTES),
          output: frameStats(data, PROBE_BYTES, PROBE_ROW_BYTES)
        };
        probeBuffer.unmap();
        qualityReadbackPending = false;
        if (reference) garbled.check(quality.source.channels, reference);
        options.onFrameQuality?.(quality);
      })
      .catch(() => {
        qualityReadbackPending = false;
      });
  }

  function renderFrame(now: number) {
    const video = options.videoRef.value;

    if (video !== lastVideo) {
      lastVideo = video;
      videoWasReady = false;
      notifiedNotRenderable = false;
      garbled.reset();
      updateTargets();
      clearCanvas();
    }

    const videoReady = !!video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (!videoReady) {
      if (videoWasReady) clearCanvas();
      videoWasReady = false;
      rafId = requestAnimationFrame(renderFrame);
      return;
    }
    videoWasReady = true;

    if (video.videoWidth === 0 && !notifiedNotRenderable) {
      notifiedNotRenderable = true;
      options.onVideoNotRenderable?.();
    } else if (video.videoWidth > 0) {
      notifiedNotRenderable = false;
    }

    if (!renderTargets || !rtViews || !rtBindGroups || !historyBindGroups) {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }

    let externalTexture: GPUExternalTexture;
    try {
      externalTexture = device.importExternalTexture({ source: video });
    } catch {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }

    const frameStart = performance.now();
    writeUniforms(uniformData, options, now / 1000);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const activeList = Object.values(ShaderEffect).filter((e) => options.activeEffects.value[e]);
    const enc = device.createCommandEncoder();

    const rdActive = options.activeEffects.value[ShaderEffect.REACTION_DIFFUSION];
    if (rdActive && !rdWasActive) encodeReactionDiffusionReset(enc);
    rdWasActive = rdActive;

    const probing =
      !!options.onFrameQuality &&
      !qualityReadbackPending &&
      ++qualityFrameCount >= QUALITY_PROBE_FRAMES;
    if (probing) qualityFrameCount = 0;

    const pingPong = [0, 1, 2].filter((i) => i !== histIdx);
    const ppA = pingPong[0];
    const ppB = pingPong[1];

    const blitBG = device.createBindGroup({
      layout: externalTextureBGL,
      entries: [
        { binding: 0, resource: externalTexture },
        { binding: 1, resource: sampler }
      ]
    });
    encodeFullscreenPass(enc, pipelines.blit, blitBG, rtViews[ppA]);
    if (probing) encodeFullscreenPass(enc, pipelines.probe, rtBindGroups[ppA], probeViews.source);

    let srcIdx = ppA;
    let rdSrcIdx = 0;
    // Next frame's feedback effects read this as history, so with RD on it is the image
    // before the RD glow. They would otherwise keep re-adding the glow until the screen is white.
    let historyIdx = -1;
    let mappingDone = false;

    for (const effect of activeList) {
      const stage = shaderEffects[effect].stage;
      if (stage === 'mapping') {
        if (mappingDone) continue;
        mappingDone = true;
      }
      const dstIdx = srcIdx === ppA ? ppB : ppA;

      if (effect === ShaderEffect.REACTION_DIFFUSION && rdViews) {
        for (let iter = 0; iter < RD_STEPS_PER_FRAME; iter++) {
          const rdDst = (1 - rdSrcIdx) as 0 | 1;
          encodeFullscreenPass(enc, pipelines.rdStep, rdStepBGs![rdSrcIdx][srcIdx], rdViews[rdDst]);
          rdSrcIdx = rdDst;
        }
        historyIdx = srcIdx;
        encodeFullscreenPass(enc, pipelines.rdComposite, rdCompBGs![srcIdx], rtViews[dstIdx]);
      } else {
        const pipeline = stage === 'mapping' ? pipelines.mapping : pipelines.effects.get(effect)!;
        const bg =
          stage === 'feedback' ? historyBindGroups![srcIdx][histIdx]! : rtBindGroups![srcIdx];
        encodeFullscreenPass(enc, pipeline, bg, rtViews[dstIdx]);
      }
      srcIdx = dstIdx;
    }

    encodeFullscreenPass(
      enc,
      pipelines.passthrough,
      rtBindGroups[srcIdx],
      context.getCurrentTexture().createView()
    );

    if (probing) {
      encodeFullscreenPass(enc, pipelines.probe, rtBindGroups[srcIdx], probeViews.output);
      const layout = { buffer: probeBuffer, bytesPerRow: PROBE_ROW_BYTES, rowsPerImage: PROBE_H };
      enc.copyTextureToBuffer({ texture: probeTextures.source }, layout, [PROBE_W, PROBE_H]);
      enc.copyTextureToBuffer(
        { texture: probeTextures.output },
        { ...layout, offset: PROBE_BYTES },
        [PROBE_W, PROBE_H]
      );
    }

    device.queue.submit([enc.finish()]);

    histIdx = historyIdx >= 0 ? historyIdx : srcIdx;

    if (probing) readProbe(sampleReference(video));

    const frameEnd = performance.now();
    const frameTime = frameEnd - frameStart;
    perfData.frameRing[perfData.frameHead & (FRAME_RING_SIZE - 1)] = frameStart;
    perfData.frameHead++;
    if (frameStart - perfData.lastReport > 200 && options.onRenderPerformance) {
      const cutoff = frameStart - 1000;
      let fps = 0;
      for (let i = 0; i < FRAME_RING_SIZE; i++) {
        if (perfData.frameRing[i] > cutoff) fps++;
      }
      options.onRenderPerformance(fps, frameTime);
      perfData.lastReport = frameStart;
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  rafId = requestAnimationFrame(renderFrame);

  return () => {
    stopVideoWatch();
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', updateTargets);
    renderTargets?.forEach((t) => t.destroy());
    rdTextures?.forEach((t) => t.destroy());
    probeTextures.source.destroy();
    probeTextures.output.destroy();
    probeBuffer.destroy();
    vertexBuffer.destroy();
    uniformBuffer.destroy();
    device.destroy();
  };
}
