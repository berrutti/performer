import { ref, computed, type ComputedRef } from 'vue';
import { ShaderEffect, buildEffectRecord } from '@/utils';

const STEP_DOWN = 0.12;
const STEP_UP = 0.04;
const MIN_OVERRIDE = 0.2;
const BRIGHT_THRESHOLD = 0.88;
const UNIFORM_VARIANCE_THRESHOLD = 0.002;

// Receives quality data from the renderer (GPU readback) and applies per-effect
// intensity overrides: when a bad frame is detected the loudest active effect is
// stepped down first, so the image recovers one effect at a time rather than all
// at once. Good frames slowly restore each override toward 1.0.
export function useFrameQualityGuard(
  activeEffects: ComputedRef<Record<ShaderEffect, boolean>>,
  effectIntensities: ComputedRef<Record<ShaderEffect, number>>
) {
  const overrides = ref<Record<ShaderEffect, number>>(buildEffectRecord(() => 1.0));

  function onQualityData(lumaAvg: number, variance: number) {
    const isBad = lumaAvg > BRIGHT_THRESHOLD || variance < UNIFORM_VARIANCE_THRESHOLD;
    const next = { ...overrides.value };

    if (isBad) {
      const active = (Object.values(ShaderEffect) as ShaderEffect[]).filter(
        (e) => activeEffects.value[e] && (effectIntensities.value[e] ?? 0) > 0
      );
      if (active.length > 0) {
        const loudest = active.reduce((a, b) =>
          (effectIntensities.value[a] ?? 0) * next[a] >= (effectIntensities.value[b] ?? 0) * next[b]
            ? a
            : b
        );
        next[loudest] = Math.max(MIN_OVERRIDE, next[loudest] - STEP_DOWN);
      }
    } else {
      for (const e of Object.values(ShaderEffect) as ShaderEffect[]) {
        if (next[e] < 1.0) next[e] = Math.min(1.0, next[e] + STEP_UP);
      }
    }

    overrides.value = next;
  }

  const scaledIntensities = computed<Record<ShaderEffect, number>>(() => {
    const ov = overrides.value;
    const raw = effectIntensities.value;
    if ((Object.values(ov) as number[]).every((v) => v >= 1.0)) return raw;
    return Object.fromEntries(
      (Object.entries(raw) as [ShaderEffect, number][]).map(([e, v]) => [e, v * ov[e]])
    ) as Record<ShaderEffect, number>;
  });

  return { scaledIntensities, onQualityData };
}
