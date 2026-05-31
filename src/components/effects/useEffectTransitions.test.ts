import { describe, it, expect, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { withSetup } from '@/test/utils';
import { useEffectTransitions } from './useEffectTransitions';
import { ShaderEffect } from '@/utils';

describe('useEffectTransitions', () => {
  const initialActiveEffects: Record<ShaderEffect, boolean> = {
    [ShaderEffect.INVERT]: false,
    [ShaderEffect.GRAYSCALE]: false,
    [ShaderEffect.REALITY_GLITCH]: false,
    [ShaderEffect.KALEIDOSCOPE]: false,
    [ShaderEffect.DISPLACE]: false,
    [ShaderEffect.SWIRL]: false,
    [ShaderEffect.CHROMA]: false,
    [ShaderEffect.PIXELATE]: false,
    [ShaderEffect.VORONOI]: false,
    [ShaderEffect.RIPPLE]: false,
    [ShaderEffect.FEEDBACK_ECHO]: false,
    [ShaderEffect.PALETTE_CYCLING]: false,
    [ShaderEffect.CONTOUR]: false,
    [ShaderEffect.AURORA]: false,
    [ShaderEffect.REACTION_DIFFUSION]: false
  };

  const initialIntensities: Record<ShaderEffect, number> = {
    [ShaderEffect.INVERT]: 1,
    [ShaderEffect.GRAYSCALE]: 1,
    [ShaderEffect.REALITY_GLITCH]: 1,
    [ShaderEffect.KALEIDOSCOPE]: 1,
    [ShaderEffect.DISPLACE]: 1,
    [ShaderEffect.SWIRL]: 1,
    [ShaderEffect.CHROMA]: 1,
    [ShaderEffect.PIXELATE]: 1,
    [ShaderEffect.VORONOI]: 1,
    [ShaderEffect.RIPPLE]: 1,
    [ShaderEffect.FEEDBACK_ECHO]: 1,
    [ShaderEffect.PALETTE_CYCLING]: 1,
    [ShaderEffect.CONTOUR]: 1,
    [ShaderEffect.AURORA]: 1,
    [ShaderEffect.REACTION_DIFFUSION]: 1
  };

  afterEach(() => {});

  it('should initialize with provided active effects and intensities', () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    expect(result.activeEffects.value).toEqual(initialActiveEffects);
    expect(result.effectIntensities.value).toEqual(initialIntensities);
    cleanup();
  });

  it('should always start with all effects off regardless of any external state', () => {
    const allOff = { ...initialActiveEffects };
    const [result, cleanup] = withSetup(() => useEffectTransitions(allOff, initialIntensities));
    Object.values(ShaderEffect).forEach((effect) => {
      expect(result.activeEffects.value[effect]).toBe(false);
    });
    cleanup();
  });

  it('should toggle effect on', async () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(false);

    result.handleToggleEffect(ShaderEffect.INVERT);
    await nextTick();

    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(true);
    cleanup();
  });

  it('should toggle effect off', async () => {
    const startWithInvertOn = { ...initialActiveEffects, [ShaderEffect.INVERT]: true };
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(startWithInvertOn, initialIntensities)
    );
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(true);

    result.handleToggleEffect(ShaderEffect.INVERT);
    await nextTick();

    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(false);
    cleanup();
  });

  it('should debounce rapid toggle calls', async () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(false);

    result.handleToggleEffect(ShaderEffect.INVERT);
    await nextTick();
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(true);

    // Immediate second call should be debounced
    result.handleToggleEffect(ShaderEffect.INVERT);
    await nextTick();
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(true);

    // After debounce delay, toggle works again
    await new Promise((r) => setTimeout(r, 100));
    result.handleToggleEffect(ShaderEffect.INVERT);
    await nextTick();
    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(false);
    cleanup();
  });

  it('should update intensity for an effect', async () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    expect(result.effectIntensities.value[ShaderEffect.PIXELATE]).toBe(1);

    result.handleIntensityChange(ShaderEffect.PIXELATE, 0.5);
    await nextTick();

    expect(result.effectIntensities.value[ShaderEffect.PIXELATE]).toBe(0.5);
    cleanup();
  });

  it('should provide rendering effects based on transition state', () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    expect(result.renderingEffects.value[ShaderEffect.INVERT]).toBe(false);
    expect(result.renderingIntensities.value).toBeDefined();
    expect(typeof result.renderingIntensities.value[ShaderEffect.INVERT]).toBe('number');
    cleanup();
  });

  it('should allow setting effect intensities directly', async () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );
    const newIntensities = { ...initialIntensities, [ShaderEffect.RIPPLE]: 0.7 };

    result.setEffectIntensities(newIntensities);
    await nextTick();

    expect(result.effectIntensities.value[ShaderEffect.RIPPLE]).toBe(0.7);
    cleanup();
  });

  it('setActiveEffects atomically replaces all effect states', async () => {
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(initialActiveEffects, initialIntensities)
    );

    const allOn = Object.values(ShaderEffect).reduce(
      (acc, e) => ({ ...acc, [e]: true }),
      {} as Record<ShaderEffect, boolean>
    );

    result.setActiveEffects(allOn);
    await nextTick();

    Object.values(ShaderEffect).forEach((effect) => {
      expect(result.activeEffects.value[effect]).toBe(true);
    });
    cleanup();
  });

  it('setActiveEffects turns off effects that were previously on', async () => {
    const startWithSomeOn = {
      ...initialActiveEffects,
      [ShaderEffect.INVERT]: true,
      [ShaderEffect.CHROMA]: true
    };
    const [result, cleanup] = withSetup(() =>
      useEffectTransitions(startWithSomeOn, initialIntensities)
    );

    const allOff = { ...initialActiveEffects };
    result.setActiveEffects(allOff);
    await nextTick();

    expect(result.activeEffects.value[ShaderEffect.INVERT]).toBe(false);
    expect(result.activeEffects.value[ShaderEffect.CHROMA]).toBe(false);
    cleanup();
  });
});
