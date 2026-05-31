import { onMounted, onUnmounted, watch, type Ref, type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import type { InputSource } from '@/broadcast';
import {
  vertexShader,
  blitShader,
  passthroughShader,
  createEffectShaderWGSL,
  rdStepShader,
  rdCompositeShader,
  UNIFORMS_FLOAT_COUNT,
  UNIFORM_IDX
} from '@/shaderBuilderWGSL';

// Same external interface as useWebGLRenderer — drop-in replacement.
export interface UseWebGPURendererOptions {
  canvasRef: Ref<HTMLCanvasElement | null>;
  videoRef: Ref<HTMLVideoElement | null>;
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>;
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>;
  bpmSyncEnabled: ComputedRef<Record<ShaderEffect, boolean>>;
  inputSource: Ref<InputSource>;
  bpm: Ref<number>;
  onRenderPerformance?: (fps: number, frameTime: number) => void;
  onVideoNotRenderable?: () => void;
  onFrameQuality?: (lumaAvg: number, variance: number) => void;
}

const TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';

// Fullscreen quad: position (xy) + texCoord (uv), 6 vertices.
// V is flipped: in WebGPU texture (0,0) = top-left, so top of screen gets UV (0,0).
const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0
]);

function computeCrop(
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

export function useWebGPURenderer(options: UseWebGPURendererOptions) {
  let cleanup: (() => void) | null = null;

  onMounted(async () => {
    const canvas = options.canvasRef.value;
    if (!canvas) return;

    if (!navigator.gpu) {
      console.error('WebGPU not supported.');
      return;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error('No WebGPU adapter found.');
      return;
    }
    const device = await adapter.requestDevice();
    const rawContext = canvas.getContext('webgpu');
    if (!rawContext) {
      console.error('WebGPU context not available.');
      return;
    }
    const context = rawContext as unknown as GPUCanvasContext;
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat, alphaMode: 'opaque' });

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

    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

    // 64 pixels × 4 bytes = 256 bytes — exactly one WebGPU-aligned row.
    // Used to sample a horizontal strip from the center of the final render target.
    const qualityReadbackBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    let qualityFrameCount = 0;
    let qualityReadbackPending = false;

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
      textureGroupLayout: GPUBindGroupLayout,
      targetFormat: GPUTextureFormat
    ): GPURenderPipeline {
      const fragModule = device.createShaderModule({ code: fragCode });
      const layout = device.createPipelineLayout({
        bindGroupLayouts: [textureGroupLayout, uniformBGL]
      });
      return device.createRenderPipeline({
        layout,
        vertex: { module: vsModule, entryPoint: 'vs_main', buffers: [vertexLayout] },
        fragment: {
          module: fragModule,
          entryPoint: 'fs_main',
          targets: [{ format: targetFormat }]
        },
        primitive: { topology: 'triangle-list' }
      });
    }

    const blitPipeline = makePipeline(blitShader, externalTextureBGL, TEXTURE_FORMAT);

    const effectPipelines = new Map<ShaderEffect, GPURenderPipeline>();
    for (const effect of Object.values(ShaderEffect)) {
      const wgsl = createEffectShaderWGSL(effect);
      if (wgsl === null) continue;
      const bgl = shaderEffects[effect].stage === 'feedback' ? feedbackTextureBGL : textureBGL;
      effectPipelines.set(effect, makePipeline(wgsl, bgl, TEXTURE_FORMAT));
    }

    const passthroughPipeline = makePipeline(passthroughShader, textureBGL, canvasFormat);

    // RD uses regular render pipelines — no compute, no special texture formats.
    // Both step and composite use feedbackTextureBGL (image + sampler + second texture).
    const rdStepPipeline = makePipeline(rdStepShader, feedbackTextureBGL, TEXTURE_FORMAT);
    const rdCompositePipeline = makePipeline(rdCompositeShader, feedbackTextureBGL, TEXTURE_FORMAT);

    let renderTargets: [GPUTexture, GPUTexture] | null = null;
    let historyTexture: GPUTexture | null = null;
    let rtBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
    let historyBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
    let rdTextures: [GPUTexture, GPUTexture] | null = null;

    function createTexture(w: number, h: number): GPUTexture {
      return device.createTexture({
        size: [w, h],
        format: TEXTURE_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC |
          GPUTextureUsage.COPY_DST
      });
    }

    function createRDTexture(w: number, h: number): GPUTexture {
      return device.createTexture({
        size: [w, h],
        format: TEXTURE_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
      });
    }

    function updateTargets() {
      if (!canvas) return;
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      const sizeChanged = canvas.width !== newW || canvas.height !== newH;
      canvas.width = newW;
      canvas.height = newH;

      if (renderTargets && !sizeChanged) {
        // Only update the crop uniforms — no need to recreate GPU textures.
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
        return;
      }

      renderTargets?.[0].destroy();
      renderTargets?.[1].destroy();
      historyTexture?.destroy();
      rdTextures?.[0].destroy();
      rdTextures?.[1].destroy();

      const w = canvas.width;
      const h = canvas.height;
      const rt0 = createTexture(w, h);
      const rt1 = createTexture(w, h);
      const hist = createTexture(w, h);
      const rdA = createRDTexture(w, h);
      const rdB = createRDTexture(w, h);

      renderTargets = [rt0, rt1];
      historyTexture = hist;
      rdTextures = [rdA, rdB];

      rtBindGroups = [
        device.createBindGroup({
          layout: textureBGL,
          entries: [
            { binding: 0, resource: rt0.createView() },
            { binding: 1, resource: sampler }
          ]
        }),
        device.createBindGroup({
          layout: textureBGL,
          entries: [
            { binding: 0, resource: rt1.createView() },
            { binding: 1, resource: sampler }
          ]
        })
      ];

      historyBindGroups = [
        device.createBindGroup({
          layout: feedbackTextureBGL,
          entries: [
            { binding: 0, resource: rt0.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: hist.createView() }
          ]
        }),
        device.createBindGroup({
          layout: feedbackTextureBGL,
          entries: [
            { binding: 0, resource: rt1.createView() },
            { binding: 1, resource: sampler },
            { binding: 2, resource: hist.createView() }
          ]
        })
      ];

      // Clear both RD textures to A=1, B=0 (R=1, G=0 — stable rest state).
      // Patterns seed in naturally from video luminance within a few seconds.
      const initEnc = device.createCommandEncoder();
      for (const rdTex of [rdA, rdB]) {
        const clearPass = initEnc.beginRenderPass({
          colorAttachments: [
            {
              view: rdTex.createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 1, g: 0, b: 0, a: 1 }
            }
          ]
        });
        clearPass.end();
      }
      device.queue.submit([initEnc.finish()]);

      // Update aspect ratio crop for the new canvas size
      const video = options.videoRef.value;
      const [uMin, uMax, vMin, vMax] = computeCrop(
        video?.videoWidth ?? 0,
        video?.videoHeight ?? 0,
        w,
        h
      );
      uniformData[UNIFORM_IDX.cropUMin] = uMin;
      uniformData[UNIFORM_IDX.cropUMax] = uMax;
      uniformData[UNIFORM_IDX.cropVMin] = vMin;
      uniformData[UNIFORM_IDX.cropVMax] = vMax;
    }

    updateTargets();
    window.addEventListener('resize', updateTargets);

    watch(
      options.videoRef,
      (newVideo, oldVideo) => {
        if (oldVideo) oldVideo.removeEventListener('loadedmetadata', updateTargets);
        if (newVideo) newVideo.addEventListener('loadedmetadata', updateTargets);
      },
      { immediate: true }
    );

    const perfData = { frameTimes: [] as number[], lastReport: 0 };
    let lastVideo: HTMLVideoElement | null = null;
    let videoWasReady = false;
    let notifiedNotRenderable = false;
    let rafId = 0;

    function renderFrame(now: number) {
      const video = options.videoRef.value;

      if (video !== lastVideo) {
        lastVideo = video;
        videoWasReady = false;
        notifiedNotRenderable = false;
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

      // videoWidth===0 with readyState>=2: hardware decoder isn't exposing frames.
      if (video.videoWidth === 0 && !notifiedNotRenderable) {
        notifiedNotRenderable = true;
        options.onVideoNotRenderable?.();
      } else if (video.videoWidth > 0) {
        notifiedNotRenderable = false;
      }

      if (!renderTargets || !rtBindGroups || !historyBindGroups || !historyTexture) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      // Import the current video frame as an external texture.
      // Works with hardware-decoded video (VideoToolbox etc.) unlike texImage2D.

      let externalTexture: GPUExternalTexture;
      try {
        externalTexture = device.importExternalTexture({ source: video });
      } catch {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const frameStart = performance.now();

      // Update uniforms
      const timeSec = now / 1000;
      const bpm = options.bpm.value;
      const activeEffects = options.activeEffects.value;
      const intensities = options.effectIntensities.value;
      const bpmSync = options.bpmSyncEnabled.value;

      uniformData[UNIFORM_IDX.time] = timeSec;
      uniformData[UNIFORM_IDX.bpm] = bpm;

      uniformData[UNIFORM_IDX.intensity.INVERT] = intensities[ShaderEffect.INVERT] ?? 1;
      uniformData[UNIFORM_IDX.intensity.REALITY_GLITCH] =
        intensities[ShaderEffect.REALITY_GLITCH] ?? 1;
      uniformData[UNIFORM_IDX.intensity.DISPLACE] = intensities[ShaderEffect.DISPLACE] ?? 1;
      uniformData[UNIFORM_IDX.intensity.CHROMA] = intensities[ShaderEffect.CHROMA] ?? 1;
      uniformData[UNIFORM_IDX.intensity.PIXELATE] = intensities[ShaderEffect.PIXELATE] ?? 1;
      uniformData[UNIFORM_IDX.intensity.VORONOI] = intensities[ShaderEffect.VORONOI] ?? 1;
      uniformData[UNIFORM_IDX.intensity.RIPPLE] = intensities[ShaderEffect.RIPPLE] ?? 1;
      uniformData[UNIFORM_IDX.intensity.FEEDBACK_ECHO] =
        intensities[ShaderEffect.FEEDBACK_ECHO] ?? 1;
      uniformData[UNIFORM_IDX.intensity.PALETTE_CYCLING] =
        intensities[ShaderEffect.PALETTE_CYCLING] ?? 1;
      uniformData[UNIFORM_IDX.intensity.CONTOUR] = intensities[ShaderEffect.CONTOUR] ?? 1;
      uniformData[UNIFORM_IDX.intensity.AURORA] = intensities[ShaderEffect.AURORA] ?? 1;
      uniformData[UNIFORM_IDX.intensity.REACTION_DIFFUSION] =
        intensities[ShaderEffect.REACTION_DIFFUSION] ?? 1;

      uniformData[UNIFORM_IDX.bpmSync.REALITY_GLITCH] = bpmSync[ShaderEffect.REALITY_GLITCH]
        ? 1
        : 0;
      uniformData[UNIFORM_IDX.bpmSync.KALEIDOSCOPE] = bpmSync[ShaderEffect.KALEIDOSCOPE] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.DISPLACE] = bpmSync[ShaderEffect.DISPLACE] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.SWIRL] = bpmSync[ShaderEffect.SWIRL] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.CHROMA] = bpmSync[ShaderEffect.CHROMA] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.PIXELATE] = bpmSync[ShaderEffect.PIXELATE] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.VORONOI] = bpmSync[ShaderEffect.VORONOI] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.RIPPLE] = bpmSync[ShaderEffect.RIPPLE] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.FEEDBACK_ECHO] = bpmSync[ShaderEffect.FEEDBACK_ECHO] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.PALETTE_CYCLING] = bpmSync[ShaderEffect.PALETTE_CYCLING]
        ? 1
        : 0;
      uniformData[UNIFORM_IDX.bpmSync.CONTOUR] = bpmSync[ShaderEffect.CONTOUR] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.AURORA] = bpmSync[ShaderEffect.AURORA] ? 1 : 0;
      uniformData[UNIFORM_IDX.bpmSync.REACTION_DIFFUSION] = bpmSync[ShaderEffect.REACTION_DIFFUSION]
        ? 1
        : 0;

      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const activeList = Object.values(ShaderEffect).filter((e) => activeEffects[e]);
      const anyFeedback = activeList.some((e) => shaderEffects[e].stage === 'feedback');
      const enc = device.createCommandEncoder();

      // Always blit external texture → RT[0] (with aspect-ratio crop applied).
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
              view: renderTargets[0].createView(),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }
          ]
        });
        blitPass.setPipeline(blitPipeline);
        blitPass.setBindGroup(0, blitBG);
        blitPass.setBindGroup(1, uniformBindGroup);
        blitPass.setVertexBuffer(0, vertexBuffer);
        blitPass.draw(6);
        blitPass.end();
      }

      // Effect passes — ping-pong between RT[0] and RT[1].
      // After the blit, RT[0] holds the video frame. srcIdx tracks which is current.
      let srcIdx = 0;
      let rdSrcIdx = 0; // which rdTexture holds the latest RD state this frame

      for (const effect of activeList) {
        const dstIdx = (1 - srcIdx) as 0 | 1;

        if (effect === ShaderEffect.REACTION_DIFFUSION && rdTextures) {
          // 4 render-pass RD steps per frame (even count — rdSrcIdx ends at 0 every frame).
          for (let iter = 0; iter < 4; iter++) {
            const rdDstIdx = (1 - rdSrcIdx) as 0 | 1;
            const stepBG = device.createBindGroup({
              layout: feedbackTextureBGL,
              entries: [
                { binding: 0, resource: rdTextures[rdSrcIdx].createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: renderTargets[srcIdx].createView() }
              ]
            });
            const stepPass = enc.beginRenderPass({
              colorAttachments: [
                {
                  view: rdTextures[rdDstIdx].createView(),
                  loadOp: 'load',
                  storeOp: 'store'
                }
              ]
            });
            stepPass.setPipeline(rdStepPipeline);
            stepPass.setBindGroup(0, stepBG);
            stepPass.setBindGroup(1, uniformBindGroup);
            stepPass.setVertexBuffer(0, vertexBuffer);
            stepPass.draw(6);
            stepPass.end();
            rdSrcIdx = rdDstIdx;
          }

          // Composite rdTextures[0] (always the result after 4 even steps) + RT[src] → RT[dst].
          const rdCompBG = device.createBindGroup({
            layout: feedbackTextureBGL,
            entries: [
              { binding: 0, resource: renderTargets[srcIdx].createView() },
              { binding: 1, resource: sampler },
              { binding: 2, resource: rdTextures[rdSrcIdx].createView() }
            ]
          });
          const rdCompPass = enc.beginRenderPass({
            colorAttachments: [
              {
                view: renderTargets[dstIdx].createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 }
              }
            ]
          });
          rdCompPass.setPipeline(rdCompositePipeline);
          rdCompPass.setBindGroup(0, rdCompBG);
          rdCompPass.setBindGroup(1, uniformBindGroup);
          rdCompPass.setVertexBuffer(0, vertexBuffer);
          rdCompPass.draw(6);
          rdCompPass.end();
          srcIdx = dstIdx;
        } else {
          const pipeline = effectPipelines.get(effect)!;
          const bg =
            shaderEffects[effect].stage === 'feedback'
              ? historyBindGroups[srcIdx]
              : rtBindGroups[srcIdx];
          const effectPass = enc.beginRenderPass({
            colorAttachments: [
              {
                view: renderTargets[dstIdx].createView(),
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

      // Passthrough final RT → canvas
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
      finalPass.setPipeline(passthroughPipeline);
      finalPass.setBindGroup(0, rtBindGroups[srcIdx]);
      finalPass.setBindGroup(1, uniformBindGroup);
      finalPass.setVertexBuffer(0, vertexBuffer);
      finalPass.draw(6);
      finalPass.end();

      // Copy final RT to history for next frame's feedback effects
      if (anyFeedback) {
        enc.copyTextureToTexture(
          { texture: renderTargets[srcIdx] },
          { texture: historyTexture },
          { width: canvas?.width ?? 1, height: canvas?.height ?? 1 }
        );
      }

      device.queue.submit([enc.finish()]);

      // Every 90 frames, sample 64 pixels from the horizontal center strip of the
      // final RT and report luma average + variance to onFrameQuality.
      if (options.onFrameQuality && renderTargets && canvas && !qualityReadbackPending) {
        qualityFrameCount++;
        if (qualityFrameCount >= 90) {
          qualityFrameCount = 0;
          qualityReadbackPending = true;
          const stripY = Math.floor(canvas.height / 2);
          const stripX = Math.max(0, Math.floor(canvas.width / 2) - 32);
          const copyEnc = device.createCommandEncoder();
          copyEnc.copyTextureToBuffer(
            { texture: renderTargets[srcIdx], origin: { x: stripX, y: stripY } },
            { buffer: qualityReadbackBuffer, bytesPerRow: 256 },
            { width: 64, height: 1 }
          );
          device.queue.submit([copyEnc.finish()]);
          qualityReadbackBuffer
            .mapAsync(GPUMapMode.READ)
            .then(() => {
              const data = new Uint8Array(qualityReadbackBuffer.getMappedRange(0, 256));
              let lumaSum = 0;
              for (let i = 0; i < 256; i += 4) {
                lumaSum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
              }
              const lumaAvg = lumaSum / 64;
              let varSum = 0;
              for (let i = 0; i < 256; i += 4) {
                const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
                varSum += (luma - lumaAvg) ** 2;
              }
              qualityReadbackBuffer.unmap();
              qualityReadbackPending = false;
              options.onFrameQuality!(lumaAvg, varSum / 64);
            })
            .catch(() => {
              qualityReadbackPending = false;
            });
        }
      }

      const frameEnd = performance.now();
      const frameTime = frameEnd - frameStart;
      perfData.frameTimes.push(frameStart);
      perfData.frameTimes = perfData.frameTimes.filter((t) => t > frameStart - 1000);
      if (frameStart - perfData.lastReport > 200 && options.onRenderPerformance) {
        options.onRenderPerformance(perfData.frameTimes.length, frameTime);
        perfData.lastReport = frameStart;
      }

      rafId = requestAnimationFrame(renderFrame);
    }

    rafId = requestAnimationFrame(renderFrame);

    cleanup = () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateTargets);
      options.videoRef.value?.removeEventListener('loadedmetadata', updateTargets);
      renderTargets?.[0].destroy();
      renderTargets?.[1].destroy();
      historyTexture?.destroy();
      rdTextures?.[0].destroy();
      rdTextures?.[1].destroy();
      qualityReadbackBuffer.destroy();
      vertexBuffer.destroy();
      uniformBuffer.destroy();
      device.destroy();
    };
  });

  onUnmounted(() => cleanup?.());
}
