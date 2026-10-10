import { describe, it, expect } from 'vitest';
import { ShaderEffect, shaderEffects } from '@/utils';
import {
  MAPPING_EFFECTS,
  UNIFORM_IDX,
  UNIFORMS_FLOAT_COUNT,
  blitShader,
  passthroughShader,
  rdCompositeShader,
  rdStepShader,
  vertexShader,
  createEffectShaderWGSL,
  createMappingShaderWGSL
} from './shaderBuilderWGSL';

const fixedSlots = new Map<string, number>();
for (const [name, slot] of Object.entries(UNIFORM_IDX)) {
  if (typeof slot === 'number') fixedSlots.set(name, slot);
}

function uniformSlot(field: string): number | undefined {
  const perEffect = /^(intensity|bpmSync)_(.+)$/.exec(field);
  if (!perEffect) return fixedSlots.get(field);
  const slots = perEffect[1] === 'intensity' ? UNIFORM_IDX.intensity : UNIFORM_IDX.bpmSync;
  return slots[perEffect[2] as ShaderEffect];
}

function uniformStructFields(): string[] {
  const body = /struct Uniforms \{([^}]*)\}/.exec(blitShader)?.[1] ?? '';
  return body
    .split(',')
    .map((field) => field.split(':')[0].trim())
    .filter(Boolean);
}

describe('shaderBuilderWGSL', () => {
  it('gives mapping effects no pass of their own, since they run fused', () => {
    expect(MAPPING_EFFECTS.length).toBeGreaterThan(0);
    for (const effect of MAPPING_EFFECTS) expect(createEffectShaderWGSL(effect)).toBeNull();
  });

  it('applies the fused mapping effects last-to-first, as chained passes would', () => {
    const shader = createMappingShaderWGSL();
    const positions = MAPPING_EFFECTS.map((_, bit) => shader.indexOf(`(mask & ${1 << bit}u)`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => b - a)).toEqual(positions);
  });

  it('lays the uniform struct out in slot order, with a slot for every intensity and BPM sync', () => {
    const fields = uniformStructFields();
    expect(fields.map(uniformSlot)).toEqual(fields.map((_, slot) => slot));
    expect(fields).toHaveLength(UNIFORMS_FLOAT_COUNT);
    for (const effect of Object.values(ShaderEffect)) {
      expect(fields.includes(`intensity_${effect}`)).toBe(
        shaderEffects[effect].intensity !== undefined
      );
      expect(fields.includes(`bpmSync_${effect}`)).toBe(!!shaderEffects[effect].bpmSync);
    }
  });

  it("derives beat phases with fract(), never WGSL's sign-keeping %", () => {
    const shaders = [
      vertexShader,
      blitShader,
      passthroughShader,
      rdStepShader,
      rdCompositeShader,
      createMappingShaderWGSL(),
      ...Object.values(ShaderEffect).map((effect) => createEffectShaderWGSL(effect) ?? '')
    ];
    for (const shader of shaders) expect(shader).not.toContain('%');
  });
});
