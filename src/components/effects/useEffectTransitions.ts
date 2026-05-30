import { ref, computed, onUnmounted } from 'vue';
import { ShaderEffect, shaderEffects } from '../../utils';
import {
  createInitialTransitions,
  startTransition,
  updateTransitions,
  hasActiveTransitions,
  type EffectTransitions
} from '../../transitions';

const DEBOUNCE_DELAY_MS = 50;

export function useEffectTransitions(
  initialActiveEffects: Record<ShaderEffect, boolean>,
  initialIntensities: Record<ShaderEffect, number>
) {
  const activeEffects = ref<Record<ShaderEffect, boolean>>(initialActiveEffects);
  const effectIntensities = ref<Record<ShaderEffect, number>>({ ...initialIntensities });
  const effectTransitions = ref<EffectTransitions>(createInitialTransitions());
  const lastToggleTime: Record<string, number> = {};
  let animationFrameId = 0;

  const renderingEffects = computed(
    () =>
      Object.fromEntries(
        Object.values(ShaderEffect).map((effect) => [
          effect,
          effectTransitions.value[effect].isActive
        ])
      ) as Record<ShaderEffect, boolean>
  );

  const renderingIntensities = computed(
    () =>
      Object.fromEntries(
        Object.values(ShaderEffect).map((effect) => {
          const transition = effectTransitions.value[effect];
          const effectDef = shaderEffects[effect];
          const userIntensity =
            effectDef.intensity !== undefined
              ? (effectIntensities.value[effect] ?? effectDef.intensity)
              : 1;
          return [effect, transition.currentIntensity * userIntensity];
        })
      ) as Record<ShaderEffect, number>
  );

  function startAnimationLoop() {
    if (animationFrameId !== 0) return;
    function animate() {
      const now = performance.now();
      const next = updateTransitions(effectTransitions.value, now);
      effectTransitions.value = next;
      if (hasActiveTransitions(next)) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        animationFrameId = 0;
      }
    }
    animationFrameId = requestAnimationFrame(animate);
  }

  onUnmounted(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  });

  function handleToggleEffect(effect: ShaderEffect) {
    const now = performance.now();
    const lastTime = lastToggleTime[effect] ?? 0;
    if (now - lastTime < DEBOUNCE_DELAY_MS) return;
    lastToggleTime[effect] = now;

    const nextActive = !activeEffects.value[effect];
    activeEffects.value = { ...activeEffects.value, [effect]: nextActive };
    effectTransitions.value = startTransition(
      effectTransitions.value,
      effect,
      nextActive ? 1 : 0,
      now
    );
    startAnimationLoop();
  }

  function handleIntensityChange(effect: ShaderEffect, intensity: number) {
    effectIntensities.value = { ...effectIntensities.value, [effect]: intensity };
    const transition = effectTransitions.value[effect];
    if (transition.isActive && activeEffects.value[effect]) {
      effectTransitions.value = {
        ...effectTransitions.value,
        [effect]: { ...transition, targetIntensity: 1 }
      };
    }
  }

  function setEffectIntensities(intensities: Record<ShaderEffect, number>) {
    effectIntensities.value = intensities;
  }

  function setActiveEffects(effects: Record<ShaderEffect, boolean>) {
    const now = performance.now();
    let newTransitions = effectTransitions.value;
    Object.values(ShaderEffect).forEach((effect) => {
      newTransitions = startTransition(newTransitions, effect, effects[effect] ? 1 : 0, now);
    });
    activeEffects.value = effects;
    effectTransitions.value = newTransitions;
    startAnimationLoop();
  }

  return {
    activeEffects,
    effectIntensities,
    renderingEffects,
    renderingIntensities,
    handleToggleEffect,
    handleIntensityChange,
    setEffectIntensities,
    setActiveEffects
  };
}
