import { ShaderEffect, shaderEffects, buildEffectRecord } from './utils';

export const TRANSITION_DURATION_MS = 100;

export interface EffectTransition {
  animating: boolean;
  currentIntensity: number;
  targetIntensity: number;
  startIntensity: number;
  startTime: number;
  /** True while the effect must be rendered, including during a fade-out. */
  isActive: boolean;
}

export type EffectTransitions = Record<ShaderEffect, EffectTransition>;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createInitialTransitions(): EffectTransitions {
  return buildEffectRecord(() => ({
    animating: false,
    currentIntensity: 0,
    targetIntensity: 0,
    startIntensity: 0,
    startTime: 0,
    isActive: false
  }));
}

export function startTransition(
  transitions: EffectTransitions,
  effect: ShaderEffect,
  targetIntensity: number,
  now: number
): EffectTransitions {
  const current = transitions[effect];

  // Effects without an intensity uniform can't render at partial strength,
  // so they switch hard instead of fading.
  if (shaderEffects[effect].intensity === undefined) {
    return {
      ...transitions,
      [effect]: {
        ...current,
        animating: false,
        currentIntensity: targetIntensity,
        targetIntensity,
        startIntensity: targetIntensity,
        startTime: now,
        isActive: targetIntensity > 0
      }
    };
  }

  return {
    ...transitions,
    [effect]: {
      ...current,
      animating: true,
      targetIntensity,
      startIntensity: current.currentIntensity,
      startTime: now,
      isActive: true
    }
  };
}

export function updateTransitions(transitions: EffectTransitions, now: number): EffectTransitions {
  let changed = false;
  const next = { ...transitions };

  for (const effect of Object.values(ShaderEffect)) {
    const transition = next[effect];
    if (!transition.animating) continue;

    const progress = Math.min((now - transition.startTime) / TRANSITION_DURATION_MS, 1);
    const eased = easeInOutCubic(progress);
    const currentIntensity =
      transition.startIntensity + eased * (transition.targetIntensity - transition.startIntensity);

    next[effect] =
      progress >= 1
        ? {
            ...transition,
            animating: false,
            currentIntensity: transition.targetIntensity,
            isActive: transition.targetIntensity > 0
          }
        : { ...transition, currentIntensity };
    changed = true;
  }

  return changed ? next : transitions;
}

export function hasActiveTransitions(transitions: EffectTransitions): boolean {
  return Object.values(transitions).some((t) => t.animating);
}
