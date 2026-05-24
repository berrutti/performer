import { ShaderEffect, shaderEffects } from './utils';

export const TRANSITION_DURATION = 100; // milliseconds

export type TransitionState = 'idle' | 'transitioning-in' | 'transitioning-out';

export interface EffectTransition {
  state: TransitionState;
  currentIntensity: number; // What we actually render with (0-1)
  targetIntensity: number; // What user set (0-1)
  startIntensity: number; // Intensity when transition started
  progress: number; // 0-1 animation progress
  startTime: number; // When transition started
  isActive: boolean; // True if effect should be rendered (currentIntensity > 0)
}

export type EffectTransitions = Record<ShaderEffect, EffectTransition>;

// Smooth easing function for natural animation feel
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Initialize transition state for all effects
export function createInitialTransitions(): EffectTransitions {
  const transitions: Partial<EffectTransitions> = {};

  Object.values(ShaderEffect).forEach((effect) => {
    transitions[effect] = {
      state: 'idle',
      currentIntensity: 0,
      targetIntensity: 0,
      startIntensity: 0,
      progress: 0,
      startTime: 0,
      isActive: false
    };
  });

  return transitions as EffectTransitions;
}

// Start a transition for an effect
export function startTransition(
  transitions: EffectTransitions,
  effect: ShaderEffect,
  targetIntensity: number,
  now: number
): EffectTransitions {
  const current = transitions[effect];
  const newTransitions = { ...transitions };

  // Only create smooth transitions for effects that have intensity controls
  const hasIntensityControl = shaderEffects[effect].intensity !== undefined;

  if (hasIntensityControl) {
    // Smooth transition for intensity-controlled effects
    newTransitions[effect] = {
      ...current,
      state: targetIntensity > 0 ? 'transitioning-in' : 'transitioning-out',
      targetIntensity,
      startIntensity: current.currentIntensity, // Remember where we started
      startTime: now,
      progress: 0,
      isActive: true // Keep active during transition
    };
  } else {
    // Immediate toggle for non-intensity effects (like GRAYSCALE, KALEIDOSCOPE)
    newTransitions[effect] = {
      ...current,
      state: 'idle',
      currentIntensity: targetIntensity,
      targetIntensity,
      startIntensity: targetIntensity,
      progress: 1,
      startTime: now,
      isActive: targetIntensity > 0
    };
  }

  return newTransitions;
}

// Update all transitions based on current time
export function updateTransitions(transitions: EffectTransitions, now: number): EffectTransitions {
  const newTransitions = { ...transitions };
  let hasChanges = false;

  Object.entries(newTransitions).forEach(([effectKey, transition]) => {
    const effect = effectKey as ShaderEffect;

    if (transition.state === 'idle') return;

    const elapsed = now - transition.startTime;
    const rawProgress = Math.min(elapsed / TRANSITION_DURATION, 1);
    const easedProgress = easeInOutCubic(rawProgress);

    let newIntensity: number;

    if (transition.state === 'transitioning-in') {
      // Fade in: interpolate from startIntensity to targetIntensity
      newIntensity =
        transition.startIntensity +
        easedProgress * (transition.targetIntensity - transition.startIntensity);
    } else {
      // transitioning-out
      // Fade out: interpolate from startIntensity to targetIntensity (which is 0)
      newIntensity =
        transition.startIntensity +
        easedProgress * (transition.targetIntensity - transition.startIntensity);
    }

    newTransitions[effect] = {
      ...transition,
      currentIntensity: newIntensity,
      progress: rawProgress
    };

    // Complete transition
    if (rawProgress >= 1) {
      newTransitions[effect] = {
        ...newTransitions[effect],
        state: 'idle',
        currentIntensity: transition.targetIntensity,
        isActive: transition.targetIntensity > 0
      };
    }

    hasChanges = true;
  });

  return hasChanges ? newTransitions : transitions;
}

// Check if any transitions are active (for animation loop)
export function hasActiveTransitions(transitions: EffectTransitions): boolean {
  return Object.values(transitions).some((t) => t.state !== 'idle');
}
