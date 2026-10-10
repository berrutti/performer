import { onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import {
  vertexShader,
  blitShader,
  passthroughShader,
  createEffectShaderWGSL,
  createMappingShaderWGSL,
  MAPPING_EFFECTS,
  rdStepShader,
  rdCompositeShader,
  UNIFORMS_FLOAT_COUNT,
  UNIFORM_IDX
} from '@/shaderBuilderWGSL';

export interface FrameStats {
  mean: number;
  variance: number;
  channels: [number, number, number];
}

// The source is the video right after the blit, so effects can be judged against how bright
// the footage itself is.
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
  // A returned time/bpm pair replaces the free-running clock and manual bpm, so the
  // shader's beatPeriod/beatPhase math phase-locks to another clock (Beatmatcher, or the
  // randomize beat grid).
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
        // The GPU process can reset (driver fault, memory pressure); rebuilding beats a canvas
        // that stays frozen until the app is restarted.
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

const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0
]);

const FRAME_RING_SIZE = 128;

// Sampled over the whole frame so a blowout anywhere is caught, not just at the center. Rows
// are padded to the 256 bytes that copyTextureToBuffer requires.
const PROBE_W = 32;
const PROBE_H = 18;
const PROBE_ROW_BYTES = 256;
const PROBE_BYTES = PROBE_ROW_BYTES * PROBE_H;
// Frequent enough for the quality guard to react within a beat, sparse enough for feedback
// effects to show the result of its previous step.
const QUALITY_PROBE_FRAMES = 15;
// WebKit garbles some videos on the way into WebGPU (10-bit HEVC shows wrong colors and
// blocks) while decoding them fine for a 2D canvas, so the two are compared. The gap must be
// far beyond normal color-conversion differences, and hold for several probes in a row so a
// frame change between the two reads can't trigger it.
const GARBLED_CHANNEL_GAP = 0.2;
const GARBLED_PROBES = 3;

function frameStats(data: Uint8ClampedArray | Uint8Array, offset: number, rowBytes: number) {
  let sum = 0;
  let sumSq = 0;
  const channels: [number, number, number] = [0, 0, 0];
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
    channels: channels.map((c) => c / n / 255) as [number, number, number]
  };
}

export function channelsDisagree(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  return a.some((value, i) => Math.abs(value - b[i]) > GARBLED_CHANNEL_GAP);
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

// Built once at init, so nothing here may depend on canvas size (that lives in updateTargets).
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

  // Mirror-repeat so effects that sample past the frame edge reflect the picture instead of
  // smearing the outermost pixels.
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

  const active = options.activeEffects.value;
  let mappingMask = 0;
  MAPPING_EFFECTS.forEach((effect, bit) => {
    if (active[effect]) mappingMask |= 1 << bit;
  });
  data[UNIFORM_IDX.mappingMask] = mappingMask;

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

  // Three render targets rotate each frame so the previous frame's output (the history
  // texture for feedback effects) never has to be copied: one holds it while the other
  // two ping-pong for the current frame's effect chain.
  let renderTargets: [GPUTexture, GPUTexture, GPUTexture] | null = null;
  // Views are created once per resize; creating them per pass would allocate
  // GPU objects every frame.
  let rtViews: [GPUTextureView, GPUTextureView, GPUTextureView] | null = null;
  let rtBindGroups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] | null = null;
  // null where src === hist, since the history texture is never in the ping-pong pair.
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

  function encodeProbe(encoder: GPUCommandEncoder, source: GPUBindGroup, target: GPUTextureView) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }]
    });
    pass.setPipeline(pipelines.probe);
    pass.setBindGroup(0, source);
    pass.setBindGroup(1, uniformBindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(6);
    pass.end();
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
  let garbledStreak = 0;
  let garbledReported = false;
  let rafId = 0;

  const referenceCanvas = document.createElement('canvas');
  referenceCanvas.width = PROBE_W;
  referenceCanvas.height = PROBE_H;
  const referenceContext = referenceCanvas.getContext('2d', { willReadFrequently: true });

  // The same crop as the blit, read through the 2D canvas path, which decodes correctly.
  function sampleReference(video: HTMLVideoElement): [number, number, number] | null {
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

  function checkGarbled(received: [number, number, number], reference: [number, number, number]) {
    garbledStreak = channelsDisagree(received, reference) ? garbledStreak + 1 : 0;
    if (garbledStreak >= GARBLED_PROBES && !garbledReported) {
      garbledReported = true;
      options.onVideoNotRenderable?.();
    }
  }

  function readProbe(reference: [number, number, number] | null) {
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
        if (reference) checkGarbled(quality.source.channels, reference);
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
      garbledStreak = 0;
      garbledReported = false;
      updateTargets();
      if (canvas && context) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        pass.end();
        device.queue.submit([enc.finish()]);
      }
    }

    const videoReady = !!video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (!videoReady) {
      if (videoWasReady && canvas && context) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        pass.end();
        device.queue.submit([enc.finish()]);
      }
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

    // A fresh pattern each time RD switches on; the old one would come back already covering
    // the whole screen.
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

    {
      const blitBG = device.createBindGroup({
        layout: externalTextureBGL,
        entries: [
          { binding: 0, resource: externalTexture },
          { binding: 1, resource: sampler }
        ]
      });
      const blitPass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: rtViews[ppA],
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
          }
        ]
      });
      blitPass.setPipeline(pipelines.blit);
      blitPass.setBindGroup(0, blitBG);
      blitPass.setBindGroup(1, uniformBindGroup);
      blitPass.setVertexBuffer(0, vertexBuffer);
      blitPass.draw(6);
      blitPass.end();
      if (probing) encodeProbe(enc, rtBindGroups[ppA], probeViews.source);
    }

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
          const stepBG = rdStepBGs![rdSrcIdx][srcIdx];
          const stepPass = enc.beginRenderPass({
            // Every pixel is overwritten, so 'clear' instead of 'load' spares tile-based
            // (Apple) GPUs from reading the whole texture back from memory on every step.
            colorAttachments: [{ view: rdViews[rdDst], loadOp: 'clear', storeOp: 'store' }]
          });
          stepPass.setPipeline(pipelines.rdStep);
          stepPass.setBindGroup(0, stepBG);
          stepPass.setBindGroup(1, uniformBindGroup);
          stepPass.setVertexBuffer(0, vertexBuffer);
          stepPass.draw(6);
          stepPass.end();
          rdSrcIdx = rdDst;
        }
        historyIdx = srcIdx;
        const rdCompBG = rdCompBGs![srcIdx];
        const rdCompPass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: rtViews[dstIdx],
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        rdCompPass.setPipeline(pipelines.rdComposite);
        rdCompPass.setBindGroup(0, rdCompBG);
        rdCompPass.setBindGroup(1, uniformBindGroup);
        rdCompPass.setVertexBuffer(0, vertexBuffer);
        rdCompPass.draw(6);
        rdCompPass.end();
        srcIdx = dstIdx;
      } else {
        const pipeline = stage === 'mapping' ? pipelines.mapping : pipelines.effects.get(effect)!;
        const bg =
          stage === 'feedback' ? historyBindGroups![srcIdx][histIdx]! : rtBindGroups![srcIdx];
        const effectPass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: rtViews[dstIdx],
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        effectPass.setPipeline(pipeline);
        effectPass.setBindGroup(0, bg);
        effectPass.setBindGroup(1, uniformBindGroup);
        effectPass.setVertexBuffer(0, vertexBuffer);
        effectPass.draw(6);
        effectPass.end();
        srcIdx = dstIdx;
      }
    }

    const finalPass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 }
        }
      ]
    });
    finalPass.setPipeline(pipelines.passthrough);
    finalPass.setBindGroup(0, rtBindGroups![srcIdx]);
    finalPass.setBindGroup(1, uniformBindGroup);
    finalPass.setVertexBuffer(0, vertexBuffer);
    finalPass.draw(6);
    finalPass.end();

    if (probing) {
      encodeProbe(enc, rtBindGroups[srcIdx], probeViews.output);
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
