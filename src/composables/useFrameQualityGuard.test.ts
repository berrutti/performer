import { describe, it, expect, vi } from 'vitest';
import { computed, ref } from 'vue';
import { useFrameQualityGuard } from './useFrameQualityGuard';
import { ShaderEffect, buildEffectRecord } from '@/utils';

function setup(active: Partial<Record<ShaderEffect, number>>) {
  const activeEffects = computed(() => buildEffectRecord((e) => e in active));
  const intensities = computed(() => buildEffectRecord((e) => active[e] ?? 1));
  const onReduce = vi.fn();
  const onDisable = vi.fn();
  const { onQualityData } = useFrameQualityGuard(activeEffects, intensities, onReduce, onDisable);
  return { onQualityData, onReduce, onDisable };
}

function frame(mean: number, variance: number) {
  return { mean, variance, channels: [mean, mean, mean] as [number, number, number] };
}

const darkSource = frame(0.15, 0.01);
const blownOut = frame(0.9, 0.01);

describe('useFrameQualityGuard', () => {
  it('never picks a toggle-only effect, which has no intensity to step down', () => {
    const { onQualityData, onReduce } = setup({
      [ShaderEffect.KALEIDOSCOPE]: 1,
      [ShaderEffect.CHROMA]: 0.9
    });
    onQualityData({ source: darkSource, output: blownOut });
    expect(onReduce).toHaveBeenCalledWith(ShaderEffect.CHROMA, expect.closeTo(0.75, 5));
  });

  it('steps reaction-diffusion down first when the frame is blown out', () => {
    const { onQualityData, onReduce } = setup({
      [ShaderEffect.CHROMA]: 1,
      [ShaderEffect.REACTION_DIFFUSION]: 0.7
    });
    onQualityData({ source: darkSource, output: blownOut });
    expect(onReduce).toHaveBeenCalledWith(ShaderEffect.REACTION_DIFFUSION, expect.closeTo(0.55, 5));
  });

  it('switches INVERT off when it turns dark footage white', () => {
    const { onQualityData, onReduce, onDisable } = setup({
      [ShaderEffect.INVERT]: 1,
      [ShaderEffect.REACTION_DIFFUSION]: 0.7
    });
    onQualityData({ source: darkSource, output: blownOut });
    expect(onDisable).toHaveBeenCalledWith(ShaderEffect.INVERT);
    expect(onReduce).not.toHaveBeenCalled();
  });

  it('leaves footage that is bright on its own alone', () => {
    const { onQualityData, onReduce, onDisable } = setup({
      [ShaderEffect.REACTION_DIFFUSION]: 0.7
    });
    onQualityData({
      source: frame(0.82, 0.01),
      output: frame(0.86, 0.01)
    });
    expect(onReduce).not.toHaveBeenCalled();
    expect(onDisable).not.toHaveBeenCalled();
  });

  it('steps down the washing effects when they flatten a detailed frame', () => {
    const { onQualityData, onReduce } = setup({
      [ShaderEffect.PIXELATE]: 1,
      [ShaderEffect.PALETTE_CYCLING]: 0.8
    });
    onQualityData({
      source: frame(0.4, 0.03),
      output: frame(0.45, 0.0005)
    });
    expect(onReduce).toHaveBeenCalledWith(ShaderEffect.PALETTE_CYCLING, expect.closeTo(0.65, 5));
  });

  it('keeps stepping down on every probe until nothing is left to reduce', () => {
    const active = new Set([ShaderEffect.REACTION_DIFFUSION, ShaderEffect.CHROMA]);
    const intensities = ref(
      buildEffectRecord((e) => (e === ShaderEffect.REACTION_DIFFUSION ? 0.4 : 1))
    );
    const { onQualityData } = useFrameQualityGuard(
      computed(() => buildEffectRecord((e) => active.has(e))),
      computed(() => intensities.value),
      (effect, intensity) => {
        intensities.value = { ...intensities.value, [effect]: intensity };
      },
      vi.fn()
    );
    const probeBlownOut = (probes: number) => {
      for (let i = 0; i < probes; i++) onQualityData({ source: darkSource, output: blownOut });
    };

    probeBlownOut(3);
    expect(intensities.value[ShaderEffect.REACTION_DIFFUSION]).toBeCloseTo(0.1, 5);
    expect(intensities.value[ShaderEffect.CHROMA]).toBeCloseTo(0.85, 5);

    probeBlownOut(10);
    expect(intensities.value[ShaderEffect.CHROMA]).toBeCloseTo(0.1, 5);
  });

  it('ignores effects already at the minimum intensity', () => {
    const { onQualityData, onReduce } = setup({
      [ShaderEffect.REACTION_DIFFUSION]: 0.1,
      [ShaderEffect.CHROMA]: 0.5
    });
    onQualityData({ source: darkSource, output: blownOut });
    expect(onReduce).toHaveBeenCalledWith(ShaderEffect.CHROMA, expect.closeTo(0.35, 5));
  });
});
