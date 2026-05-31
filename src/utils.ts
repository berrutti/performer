export function buildEffectRecord<T>(fn: (effect: ShaderEffect) => T): Record<ShaderEffect, T> {
  return Object.fromEntries(Object.values(ShaderEffect).map((e) => [e, fn(e)])) as Record<
    ShaderEffect,
    T
  >;
}

export enum ShaderEffect {
  INVERT = 'INVERT',
  GRAYSCALE = 'GRAYSCALE',
  REALITY_GLITCH = 'REALITY_GLITCH',
  KALEIDOSCOPE = 'KALEIDOSCOPE',
  DISPLACE = 'DISPLACE',
  SWIRL = 'SWIRL',
  CHROMA = 'CHROMA',
  PIXELATE = 'PIXELATE',
  VORONOI = 'VORONOI',
  RIPPLE = 'RIPPLE',
  FEEDBACK_ECHO = 'FEEDBACK_ECHO',
  PALETTE_CYCLING = 'PALETTE_CYCLING',
  CONTOUR = 'CONTOUR',
  AURORA = 'AURORA',
  REACTION_DIFFUSION = 'REACTION_DIFFUSION'
}

export interface ShaderEffectDef {
  /** 'mapping'/'color'/'feedback' are fragment pipeline stages; 'compute' uses GPU compute passes */
  stage: 'mapping' | 'color' | 'feedback' | 'compute';
  intensity?: number;
  bpmSync?: boolean;
}

export const shaderEffects: Record<ShaderEffect, ShaderEffectDef> = {
  [ShaderEffect.INVERT]: { stage: 'color', intensity: 1.0 },
  [ShaderEffect.GRAYSCALE]: { stage: 'color' },
  [ShaderEffect.REALITY_GLITCH]: { stage: 'feedback', intensity: 1.0, bpmSync: true },
  [ShaderEffect.KALEIDOSCOPE]: { stage: 'mapping', bpmSync: true },
  [ShaderEffect.DISPLACE]: { stage: 'mapping', intensity: 1.0, bpmSync: true },
  [ShaderEffect.SWIRL]: { stage: 'mapping', bpmSync: true },
  [ShaderEffect.CHROMA]: { stage: 'color', intensity: 1.0, bpmSync: true },
  [ShaderEffect.PIXELATE]: { stage: 'mapping', intensity: 1.0, bpmSync: true },
  [ShaderEffect.VORONOI]: { stage: 'mapping', intensity: 1.0, bpmSync: true },
  [ShaderEffect.RIPPLE]: { stage: 'mapping', intensity: 1.0, bpmSync: true },
  [ShaderEffect.FEEDBACK_ECHO]: { stage: 'feedback', intensity: 1.0, bpmSync: true },
  [ShaderEffect.PALETTE_CYCLING]: { stage: 'color', intensity: 1.0, bpmSync: true },
  [ShaderEffect.CONTOUR]: { stage: 'feedback', intensity: 1.0, bpmSync: true },
  [ShaderEffect.AURORA]: { stage: 'feedback', intensity: 1.0, bpmSync: true },
  [ShaderEffect.REACTION_DIFFUSION]: { stage: 'compute', intensity: 1.0, bpmSync: true }
};
