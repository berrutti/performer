import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed } from 'vue';
import { withSetup } from '../test/utils';
import { useWebGLRenderer } from './useWebGLRenderer';
import { ShaderEffect } from '../utils';

function createMockWebGLContext(): WebGLRenderingContext {
  const FRAMEBUFFER_COMPLETE = 36053;
  const ctx = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    TEXTURE_2D: 3553,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    CLAMP_TO_EDGE: 33071,
    LINEAR: 9729,
    UNPACK_FLIP_Y_WEBGL: 37440,
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    FALSE: 0,
    TRIANGLES: 4,
    RGB: 6407,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    COLOR_ATTACHMENT0: 36064,
    FRAMEBUFFER: 36160,
    FRAMEBUFFER_COMPLETE,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    createShader: vi.fn().mockReturnValue({}),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(''),
    deleteShader: vi.fn(),
    createProgram: vi.fn().mockReturnValue({}),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn().mockReturnValue(true),
    getProgramInfoLog: vi.fn().mockReturnValue(''),
    deleteProgram: vi.fn(),
    getAttribLocation: vi.fn().mockReturnValue(0),
    getUniformLocation: vi.fn().mockReturnValue({}),
    createBuffer: vi.fn().mockReturnValue({}),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createTexture: vi.fn().mockReturnValue({}),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    viewport: vi.fn(),
    createFramebuffer: vi.fn().mockReturnValue({}),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn().mockReturnValue(FRAMEBUFFER_COMPLETE),
    deleteFramebuffer: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    drawArrays: vi.fn()
  };
  return ctx as unknown as WebGLRenderingContext;
}

const allEffectsOff = Object.values(ShaderEffect).reduce(
  (acc, e) => ({ ...acc, [e]: false }),
  {} as Record<ShaderEffect, boolean>
);

const defaultIntensities = Object.values(ShaderEffect).reduce(
  (acc, e) => ({ ...acc, [e]: 1.0 }),
  {} as Record<ShaderEffect, number>
);

const allBpmSyncOff = Object.values(ShaderEffect).reduce(
  (acc, e) => ({ ...acc, [e]: false }),
  {} as Record<ShaderEffect, boolean>
);

describe('useWebGLRenderer', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts animation frame loop even when videoRef is null at mount', () => {
    // Regression: previously returned early when videoRef was null, causing a permanent black screen.
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(createMockWebGLContext());

    const [, cleanup] = withSetup(() =>
      useWebGLRenderer({
        canvasRef: ref(canvas),
        videoRef: ref(null),
        activeEffects: computed(() => allEffectsOff),
        effectIntensities: computed(() => defaultIntensities),
        bpmSyncEnabled: computed(() => allBpmSyncOff),
        inputSource: ref('video'),
        bpm: ref(138)
      })
    );

    expect(window.requestAnimationFrame).toHaveBeenCalled();
    cleanup();
  });

  it('does not throw when canvasRef is null at mount', () => {
    expect(() => {
      const [, cleanup] = withSetup(() =>
        useWebGLRenderer({
          canvasRef: ref(null),
          videoRef: ref(null),
          activeEffects: computed(() => allEffectsOff),
          effectIntensities: computed(() => defaultIntensities),
          bpmSyncEnabled: computed(() => allBpmSyncOff),
          inputSource: ref('video'),
          bpm: ref(138)
        })
      );
      cleanup();
    }).not.toThrow();
  });
});
