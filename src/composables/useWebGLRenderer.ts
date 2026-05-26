import { onMounted, onUnmounted, type Ref, type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects, getTextureCoordinates } from '../utils';
import {
  multiPassVertexShader,
  createPassthroughShader,
  createEffectShader,
  createVideoSamplingShader
} from '../shaderBuilder';

interface RenderTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface ShaderProgram {
  program: WebGLProgram;
  attribLocations: { position: number; texCoord: number };
  uniformLocations: Record<string, WebGLUniformLocation | null>;
}

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + msg);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vert: WebGLShader,
  frag: WebGLShader
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program.');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link error: ' + msg);
  }
  return program;
}

function createRenderTarget(
  gl: WebGLRenderingContext,
  width: number,
  height: number
): RenderTarget {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Failed to create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer incomplete');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { framebuffer, texture, width, height };
}

export interface UseWebGLRendererOptions {
  canvasRef: Ref<HTMLCanvasElement | null>;
  videoRef: Ref<HTMLVideoElement | null>;
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>;
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>;
  bpmSyncEnabled: ComputedRef<Record<ShaderEffect, boolean>>;
  inputSource: Ref<string>;
  bpm: Ref<number>;
  onRenderPerformance?: (fps: number, frameTime: number) => void;
}

export function useWebGLRenderer(options: UseWebGLRendererOptions) {
  let cleanup: (() => void) | null = null;

  onMounted(() => {
    const canvas = options.canvasRef.value;
    const video = options.videoRef.value;
    if (!canvas || !video) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported.');
      return;
    }

    const vertexShader = compileShader(gl, multiPassVertexShader, gl.VERTEX_SHADER);
    const programs: Record<string, ShaderProgram> = {};

    const videoSamplingFrag = compileShader(gl, createVideoSamplingShader(), gl.FRAGMENT_SHADER);
    const videoSamplingProg = createProgram(gl, vertexShader, videoSamplingFrag);
    programs['videoSampling'] = {
      program: videoSamplingProg,
      attribLocations: {
        position: gl.getAttribLocation(videoSamplingProg, 'a_position'),
        texCoord: gl.getAttribLocation(videoSamplingProg, 'a_texCoord')
      },
      uniformLocations: { image: gl.getUniformLocation(videoSamplingProg, 'u_image') }
    };

    Object.values(ShaderEffect).forEach((effect) => {
      const frag = compileShader(gl, createEffectShader(effect), gl.FRAGMENT_SHADER);
      const prog = createProgram(gl, vertexShader, frag);
      const uniformLocations: Record<string, WebGLUniformLocation | null> = {
        image: gl.getUniformLocation(prog, 'u_image'),
        time: gl.getUniformLocation(prog, 'u_time'),
        bpm: gl.getUniformLocation(prog, 'u_bpm')
      };
      if (shaderEffects[effect].intensity !== undefined) {
        uniformLocations[`intensity_${effect}`] = gl.getUniformLocation(
          prog,
          `u_intensity_${effect}`
        );
      }
      if (shaderEffects[effect].bpmSync) {
        uniformLocations[`bpmSync_${effect}`] = gl.getUniformLocation(prog, `u_bpm_sync_${effect}`);
      }
      if (shaderEffects[effect].stage === 'feedback') {
        uniformLocations['history'] = gl.getUniformLocation(prog, 'u_history');
      }
      programs[effect] = {
        program: prog,
        attribLocations: {
          position: gl.getAttribLocation(prog, 'a_position'),
          texCoord: gl.getAttribLocation(prog, 'a_texCoord')
        },
        uniformLocations
      };
    });

    const passthroughFrag = compileShader(gl, createPassthroughShader(), gl.FRAGMENT_SHADER);
    const passthroughProg = createProgram(gl, vertexShader, passthroughFrag);
    programs['passthrough'] = {
      program: passthroughProg,
      attribLocations: {
        position: gl.getAttribLocation(passthroughProg, 'a_position'),
        texCoord: gl.getAttribLocation(passthroughProg, 'a_texCoord')
      },
      uniformLocations: { image: gl.getUniformLocation(passthroughProg, 'u_image') }
    };

    const quadPositions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadPositions, gl.STATIC_DRAW);

    const standardTexCoords = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    const standardTexCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, standardTexCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, standardTexCoords, gl.STATIC_DRAW);

    const aspectRatioTexCoordBuffer = gl.createBuffer();

    const videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    let renderTargets: RenderTarget[] = [];
    let historyRT: RenderTarget | null = null;

    function updateBuffers() {
      if (!canvas || !gl || !video) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);

      const videoWidth = video.videoWidth || 640;
      const videoHeight = video.videoHeight || 480;
      const aspectCoords = getTextureCoordinates(
        videoWidth,
        videoHeight,
        canvas.width,
        canvas.height
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, aspectRatioTexCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, aspectCoords, gl.STATIC_DRAW);

      renderTargets.forEach((rt) => {
        gl.deleteFramebuffer(rt.framebuffer);
        gl.deleteTexture(rt.texture);
      });
      renderTargets = [
        createRenderTarget(gl, canvas.width, canvas.height),
        createRenderTarget(gl, canvas.width, canvas.height)
      ];

      if (historyRT) {
        gl.deleteFramebuffer(historyRT.framebuffer);
        gl.deleteTexture(historyRT.texture);
      }
      historyRT = createRenderTarget(gl, canvas.width, canvas.height);
    }

    updateBuffers();
    window.addEventListener('resize', updateBuffers);
    video.addEventListener('loadedmetadata', updateBuffers);

    function setupAttributes(
      shader: ShaderProgram,
      posBuf: WebGLBuffer | null,
      texBuf: WebGLBuffer | null
    ) {
      // gl is guaranteed non-null here — setupAttributes is only called after the null guard in onMounted
      const g = gl!;
      g.bindBuffer(g.ARRAY_BUFFER, posBuf);
      g.enableVertexAttribArray(shader.attribLocations.position);
      g.vertexAttribPointer(shader.attribLocations.position, 2, g.FLOAT, false, 0, 0);
      g.bindBuffer(g.ARRAY_BUFFER, texBuf);
      g.enableVertexAttribArray(shader.attribLocations.texCoord);
      g.vertexAttribPointer(shader.attribLocations.texCoord, 2, g.FLOAT, false, 0, 0);
    }

    const perfData = { frameStartTimes: [] as number[], lastReport: 0 };

    function renderFrame(now: DOMHighResTimeStamp) {
      if (!gl || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        videoFrameCallbackId = video?.requestVideoFrameCallback(renderFrame) ?? 0;
        return;
      }

      const frameStart = performance.now();

      // Read reactive refs directly - no need to restart on changes
      const currentActiveEffects = options.activeEffects.value;
      const currentIntensities = options.effectIntensities.value;
      const currentBpmSync = options.bpmSyncEnabled.value;
      const currentBpm = options.bpm.value;

      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

      const activeList = Object.values(ShaderEffect).filter((e) => currentActiveEffects[e]);

      let currentTexture = videoTexture;
      let currentRTIndex = 0;

      if (activeList.length > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderTargets[0].framebuffer);
        gl.viewport(0, 0, renderTargets[0].width, renderTargets[0].height);
        const vsShader = programs['videoSampling'];
        gl.useProgram(vsShader.program);
        setupAttributes(vsShader, positionBuffer, aspectRatioTexCoordBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.uniform1i(vsShader.uniformLocations.image, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        currentTexture = renderTargets[0].texture;
        currentRTIndex = 1;

        const t = now / 1000;
        activeList.forEach((effect) => {
          const targetRT = renderTargets[currentRTIndex];
          gl.bindFramebuffer(gl.FRAMEBUFFER, targetRT.framebuffer);
          gl.viewport(0, 0, targetRT.width, targetRT.height);

          const shader = programs[effect];
          gl.useProgram(shader.program);
          setupAttributes(shader, positionBuffer, standardTexCoordBuffer);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, currentTexture);
          gl.uniform1i(shader.uniformLocations.image, 0);

          if (shaderEffects[effect].stage === 'feedback' && historyRT) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, historyRT.texture);
            gl.uniform1i(shader.uniformLocations.history, 1);
            gl.activeTexture(gl.TEXTURE0);
          }

          gl.uniform1f(shader.uniformLocations.time, t);
          gl.uniform1f(shader.uniformLocations.bpm, currentBpm);

          const intensityLoc = shader.uniformLocations[`intensity_${effect}`];
          if (intensityLoc) gl.uniform1f(intensityLoc, currentIntensities[effect]);

          const bpmSyncLoc = shader.uniformLocations[`bpmSync_${effect}`];
          if (bpmSyncLoc) gl.uniform1f(bpmSyncLoc, currentBpmSync[effect] ? 1.0 : 0.0);

          gl.drawArrays(gl.TRIANGLES, 0, 6);
          currentTexture = targetRT.texture;
          currentRTIndex = (currentRTIndex + 1) % 2;
        });

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
        const ptShader = programs['passthrough'];
        gl.useProgram(ptShader.program);
        setupAttributes(ptShader, positionBuffer, standardTexCoordBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.uniform1i(ptShader.uniformLocations.image, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        if (currentActiveEffects[ShaderEffect.FEEDBACK_ECHO] && historyRT) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, historyRT.framebuffer);
          gl.viewport(0, 0, historyRT.width, historyRT.height);
          gl.useProgram(ptShader.program);
          setupAttributes(ptShader, positionBuffer, standardTexCoordBuffer);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, currentTexture);
          gl.uniform1i(ptShader.uniformLocations.image, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
        const vsShader = programs['videoSampling'];
        gl.useProgram(vsShader.program);
        setupAttributes(vsShader, positionBuffer, aspectRatioTexCoordBuffer);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, currentTexture);
        gl.uniform1i(vsShader.uniformLocations.image, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      const frameEnd = performance.now();
      const frameTime = frameEnd - frameStart;
      perfData.frameStartTimes.push(frameStart);
      perfData.frameStartTimes = perfData.frameStartTimes.filter((t) => t > frameStart - 1000);
      if (frameStart - perfData.lastReport > 200 && options.onRenderPerformance) {
        options.onRenderPerformance(perfData.frameStartTimes.length, frameTime);
        perfData.lastReport = frameStart;
      }

      videoFrameCallbackId = video.requestVideoFrameCallback(renderFrame);
    }

    let videoFrameCallbackId = video.requestVideoFrameCallback(renderFrame);

    cleanup = () => {
      video.cancelVideoFrameCallback(videoFrameCallbackId);
      window.removeEventListener('resize', updateBuffers);
      video.removeEventListener('loadedmetadata', updateBuffers);
      renderTargets.forEach((rt) => {
        gl.deleteFramebuffer(rt.framebuffer);
        gl.deleteTexture(rt.texture);
      });
      if (historyRT) {
        gl.deleteFramebuffer(historyRT.framebuffer);
        gl.deleteTexture(historyRT.texture);
      }
      Object.values(programs).forEach((s) => gl.deleteProgram(s.program));
      if (videoTexture) gl.deleteTexture(videoTexture);
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (standardTexCoordBuffer) gl.deleteBuffer(standardTexCoordBuffer);
      if (aspectRatioTexCoordBuffer) gl.deleteBuffer(aspectRatioTexCoordBuffer);
    };
  });

  onUnmounted(() => {
    cleanup?.();
  });
}
