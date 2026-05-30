import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed } from 'vue';
import { withSetup } from '@/test/utils';
import { useWebGPURenderer } from './useWebGPURenderer';
import { buildEffectRecord } from '@/utils';

const allEffectsOff = buildEffectRecord(() => false);
const defaultIntensities = buildEffectRecord(() => 1.0);
const allBpmSyncOff = buildEffectRecord(() => false);

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
      const [, cleanup] = withSetup(() =>
        useWebGPURenderer({
          canvasRef: ref(document.createElement('canvas')),
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

  it('does not throw when canvasRef is null', () => {
    expect(() => {
      const [, cleanup] = withSetup(() =>
        useWebGPURenderer({
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

  it('exposes the same options interface as the old WebGL renderer', () => {
    const options = {
      canvasRef: ref<HTMLCanvasElement | null>(null),
      videoRef: ref<HTMLVideoElement | null>(null),
      activeEffects: computed(() => allEffectsOff),
      effectIntensities: computed(() => defaultIntensities),
      bpmSyncEnabled: computed(() => allBpmSyncOff),
      inputSource: ref<'webcam' | 'video'>('video'),
      bpm: ref(138),
      onRenderPerformance: () => {}
    };
    expect(() => {
      const [, cleanup] = withSetup(() => useWebGPURenderer(options));
      cleanup();
    }).not.toThrow();
  });
});
