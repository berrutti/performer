import { type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import type { FrameQuality } from '@/composables/useWebGPURenderer';

const STEP_DOWN = 0.15;
const MIN_INTENSITY = 0.1;
const BRIGHT_MEAN = 0.68;
const BRIGHTER_THAN_SOURCE = 0.15;
const FLAT_VARIANCE = 0.002;
const DETAILED_SOURCE_VARIANCE = 0.006;
const DARK_SOURCE_MEAN = 0.4;

const WASHING_EFFECTS: ShaderEffect[] = [
  ShaderEffect.REACTION_DIFFUSION,
  ShaderEffect.PALETTE_CYCLING,
  ShaderEffect.CONTOUR,
  ShaderEffect.AURORA,
  ShaderEffect.FEEDBACK_ECHO,
  ShaderEffect.REALITY_GLITCH
];

export type QualityCorrection =
  | { kind: 'disable'; effect: ShaderEffect }
  | { kind: 'reduce'; effect: ShaderEffect; intensity: number };

export function chooseCorrection(
  { source, output }: FrameQuality,
  active: Record<ShaderEffect, boolean>,
  intensities: Record<ShaderEffect, number>
): QualityCorrection | null {
  const blownOut = output.mean > BRIGHT_MEAN && output.mean > source.mean + BRIGHTER_THAN_SOURCE;
  const flattened = output.variance < FLAT_VARIANCE && source.variance > DETAILED_SOURCE_VARIANCE;
  if (!blownOut && !flattened) return null;

  if (blownOut && active[ShaderEffect.INVERT] && source.mean < DARK_SOURCE_MEAN) {
    return { kind: 'disable', effect: ShaderEffect.INVERT };
  }

  const reducible = Object.values(ShaderEffect).filter(
    (e) =>
      active[e] && shaderEffects[e].intensity !== undefined && (intensities[e] ?? 0) > MIN_INTENSITY
  );
  if (reducible.length === 0) return null;

  const effect =
    WASHING_EFFECTS.find((e) => reducible.includes(e)) ??
    reducible.reduce((a, b) => ((intensities[a] ?? 0) >= (intensities[b] ?? 0) ? a : b));
  return {
    kind: 'reduce',
    effect,
    intensity: Math.max(MIN_INTENSITY, (intensities[effect] ?? 0) - STEP_DOWN)
  };
}

export function useFrameQualityGuard(
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>,
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>,
  onReduceEffect: (effect: ShaderEffect, intensity: number) => void,
  onDisableEffect: (effect: ShaderEffect) => void
) {
  function onQualityData(quality: FrameQuality) {
    const correction = chooseCorrection(quality, activeEffects.value, effectIntensities.value);
    if (correction?.kind === 'disable') onDisableEffect(correction.effect);
    else if (correction?.kind === 'reduce') onReduceEffect(correction.effect, correction.intensity);
  }

  return { onQualityData };
}
