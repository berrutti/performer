import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed } from 'vue';
import { withSetup } from '@/test/utils';
import { useWebGPURenderer, computeCrop } from './useWebGPURenderer';
import { buildEffectRecord } from '@/utils';

const allEffectsOff = buildEffectRecord(() => false);
const defaultIntensities = buildEffectRecord(() => 1.0);
const allBpmSyncOff = buildEffectRecord(() => false);

function makeOptions(overrides: Partial<Parameters<typeof useWebGPURenderer>[0]> = {}) {
  return {
    canvasRef: ref<HTMLCanvasElement | null>(document.createElement('canvas')),
    videoRef: ref<HTMLVideoElement | null>(null),
    activeEffects: computed(() => allEffectsOff),
    effectIntensities: computed(() => defaultIntensities),
    bpmSyncEnabled: computed(() => allBpmSyncOff),
    bpm: ref(138),
    ...overrides
  };
}

describe('useWebGPURenderer', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not throw when navigator.gpu is unavailable', () => {
    expect(() => {
      const [, cleanup] = withSetup(() => useWebGPURenderer(makeOptions()));
      cleanup();
    }).not.toThrow();
  });

  it('does not throw when canvasRef is null', () => {
    expect(() => {
      const [, cleanup] = withSetup(() => useWebGPURenderer(makeOptions({ canvasRef: ref(null) })));
      cleanup();
    }).not.toThrow();
  });

  it('calls onRendererUnavailable when WebGPU is not supported', async () => {
    const onRendererUnavailable = vi.fn();
    const [, cleanup] = withSetup(() => useWebGPURenderer(makeOptions({ onRendererUnavailable })));
    await new Promise((r) => setTimeout(r, 0));

    expect(onRendererUnavailable).toHaveBeenCalled();
    cleanup();
  });
});

describe('computeCrop', () => {
  it('returns the full UV range when video dimensions are zero', () => {
    expect(computeCrop(0, 0, 1920, 1080)).toEqual([0, 1, 0, 1]);
  });

  it('returns the full UV range when aspect ratios match', () => {
    expect(computeCrop(1920, 1080, 1920, 1080)).toEqual([0, 1, 0, 1]);
  });

  it('crops horizontally when the video is wider than the canvas', () => {
    expect(computeCrop(200, 100, 100, 100)).toEqual([0.25, 0.75, 0, 1]);
  });

  it('crops vertically when the video is taller than the canvas', () => {
    expect(computeCrop(100, 200, 100, 100)).toEqual([0, 1, 0.25, 0.75]);
  });
});
