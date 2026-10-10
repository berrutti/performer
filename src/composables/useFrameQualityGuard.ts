import { type ComputedRef } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import type { FrameQuality } from '@/composables/useWebGPURenderer';

const STEP_DOWN = 0.15;
const MIN_INTENSITY = 0.1;
// Judged against the footage itself, so a bright video is never mistaken for a blown-out one.
const BRIGHT_MEAN = 0.68;
const BRIGHTER_THAN_SOURCE = 0.15;
// Only detail the effects wiped out counts as flattened, not footage that is flat or dark already.
const FLAT_VARIANCE = 0.002;
const DETAILED_SOURCE_VARIANCE = 0.006;
// INVERT turns dark footage into a mostly white frame and has no intensity to step down.
const DARK_SOURCE_MEAN = 0.4;

// The effects most likely to blow out or wash over the frame.
const WASHING_EFFECTS: ShaderEffect[] = [
  ShaderEffect.REACTION_DIFFUSION,
  ShaderEffect.PALETTE_CYCLING,
  ShaderEffect.CONTOUR,
  ShaderEffect.AURORA,
  ShaderEffect.FEEDBACK_ECHO,
  ShaderEffect.REALITY_GLITCH
];

// Changes go straight to the real effect state, with no hidden override layer and no
// restoration, so later probes keep stepping until the image clears or nothing is left.
export function useFrameQualityGuard(
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>,
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>,
  onReduceEffect: (effect: ShaderEffect, intensity: number) => void,
  onDisableEffect: (effect: ShaderEffect) => void
) {
  function onQualityData({ source, output }: FrameQuality) {
    const blownOut = output.mean > BRIGHT_MEAN && output.mean > source.mean + BRIGHTER_THAN_SOURCE;
    const flattened = output.variance < FLAT_VARIANCE && source.variance > DETAILED_SOURCE_VARIANCE;
    if (!blownOut && !flattened) return;

    const active = activeEffects.value;
    if (blownOut && active[ShaderEffect.INVERT] && source.mean < DARK_SOURCE_MEAN) {
      onDisableEffect(ShaderEffect.INVERT);
      return;
    }

    const intensities = effectIntensities.value;
    // Toggle-only effects report full intensity but have nothing to step down.
    const reducible = Object.values(ShaderEffect).filter(
      (e) =>
        active[e] &&
        shaderEffects[e].intensity !== undefined &&
        (intensities[e] ?? 0) > MIN_INTENSITY
    );
    if (reducible.length === 0) return;

    const target =
      WASHING_EFFECTS.find((e) => reducible.includes(e)) ??
      reducible.reduce((a, b) => ((intensities[a] ?? 0) >= (intensities[b] ?? 0) ? a : b));
    onReduceEffect(target, Math.max(MIN_INTENSITY, (intensities[target] ?? 0) - STEP_DOWN));
  }

  return { onQualityData };
}
