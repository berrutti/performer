import { type ComputedRef } from 'vue';
import { ShaderEffect } from '@/utils';

const STEP_DOWN = 0.1;
const MIN_INTENSITY = 0.1;
const BRIGHT_THRESHOLD = 0.88;
const UNIFORM_VARIANCE_THRESHOLD = 0.002;

// Probes the rendered image via GPU readback (see useWebGPURenderer onFrameQuality).
// When the frame looks blown-out or uniformly grey, the loudest active effect is stepped
// down by STEP_DOWN. The change is made directly to the real intensity state — no hidden
// override layer, no restoration. Subsequent probes will keep stepping until the image
// clears or all effects are at floor.
export function useFrameQualityGuard(
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>,
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>,
  onReduceEffect: (effect: ShaderEffect, intensity: number) => void
) {
  function onQualityData(lumaAvg: number, variance: number) {
    const isBad = lumaAvg > BRIGHT_THRESHOLD || variance < UNIFORM_VARIANCE_THRESHOLD;
    if (!isBad) return;

    const active = (Object.values(ShaderEffect) as ShaderEffect[]).filter(
      (e) => activeEffects.value[e] && (effectIntensities.value[e] ?? 0) > MIN_INTENSITY
    );
    if (active.length === 0) return;

    const loudest = active.reduce((a, b) =>
      (effectIntensities.value[a] ?? 0) >= (effectIntensities.value[b] ?? 0) ? a : b
    );

    onReduceEffect(
      loudest,
      Math.max(MIN_INTENSITY, (effectIntensities.value[loudest] ?? 0) - STEP_DOWN)
    );
  }

  return { onQualityData };
}
