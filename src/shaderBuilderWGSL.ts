import { ShaderEffect, shaderEffects } from '@/utils';

const FIXED_UNIFORMS = [
  'time',
  'bpm',
  'cropUMin',
  'cropUMax',
  'cropVMin',
  'cropVMax',
  'mappingMask'
] as const;
const INTENSITY_EFFECTS = Object.values(ShaderEffect).filter(
  (e) => shaderEffects[e].intensity !== undefined
);
const BPM_SYNC_EFFECTS = Object.values(ShaderEffect).filter((e) => shaderEffects[e].bpmSync);
const UNIFORM_FIELDS = [
  ...FIXED_UNIFORMS,
  ...INTENSITY_EFFECTS.map((e) => `intensity_${e}`),
  ...BPM_SYNC_EFFECTS.map((e) => `bpmSync_${e}`)
];

function slotsFrom<K extends string>(names: readonly K[], first: number): Record<K, number> {
  return Object.fromEntries(names.map((name, i) => [name, first + i])) as Record<K, number>;
}

const intensitySlots: Partial<Record<ShaderEffect, number>> = slotsFrom(
  INTENSITY_EFFECTS,
  FIXED_UNIFORMS.length
);
const bpmSyncSlots: Partial<Record<ShaderEffect, number>> = slotsFrom(
  BPM_SYNC_EFFECTS,
  FIXED_UNIFORMS.length + INTENSITY_EFFECTS.length
);

export const UNIFORMS_FLOAT_COUNT = UNIFORM_FIELDS.length;

export const UNIFORM_IDX = {
  ...slotsFrom(FIXED_UNIFORMS, 0),
  intensity: intensitySlots,
  bpmSync: bpmSyncSlots
};

const UNIFORMS_STRUCT = /* wgsl */ `
struct Uniforms {
${UNIFORM_FIELDS.map((field) => `  ${field}: f32,`).join('\n')}
}`;

export const vertexShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}
@vertex
fn vs_main(@location(0) position: vec2f, @location(1) texCoord: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(position, 0.0, 1.0);
  out.texCoord = texCoord;
  return out;
}
`;

export const blitShader = /* wgsl */ `
${UNIFORMS_STRUCT}
@group(0) @binding(0) var videoFrame: texture_external;
@group(0) @binding(1) var u_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let uv = vec2f(
    uniforms.cropUMin + texCoord.x * (uniforms.cropUMax - uniforms.cropUMin),
    uniforms.cropVMin + texCoord.y * (uniforms.cropVMax - uniforms.cropVMin)
  );
  return textureSampleBaseClampToEdge(videoFrame, u_sampler, uv);
}
`;

export const passthroughShader = /* wgsl */ `
@group(0) @binding(0) var u_image: texture_2d<f32>;
@group(0) @binding(1) var u_sampler: sampler;
@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  return textureSample(u_image, u_sampler, texCoord);
}
`;

const effectWGSL: Record<ShaderEffect, string> = {
  [ShaderEffect.INVERT]: `
    color = vec4f(vec3f(1.0) - color.rgb, color.a);
  `,

  [ShaderEffect.GRAYSCALE]: `
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    color = vec4f(vec3f(luma), color.a);
  `,

  [ShaderEffect.REALITY_GLITCH]: `
    let t = uniforms.time;
    let intensity = uniforms.intensity_REALITY_GLITCH;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(t / beatPeriod);
    let pulse = exp(-beatPhase * 5.0) * uniforms.bpmSync_REALITY_GLITCH * 1.5;
    let driven = intensity * (1.0 + pulse);
    var warp = vec2f(
      sin(uv.y * 3.1 + t * 0.70) * cos(uv.x * 2.8 + t * 0.50),
      cos(uv.x * 3.3 + t * 0.60) * sin(uv.y * 2.9 + t * 0.80)
    ) * 0.040;
    warp += vec2f(
      sin(uv.y * 7.2 + t * 1.40 + uv.x * 2.1) * cos(uv.x * 6.8 + t * 1.10),
      cos(uv.x * 7.5 + t * 1.70 + uv.y * 2.4) * sin(uv.y * 6.9 + t * 1.30)
    ) * 0.018;
    warp *= driven;
    let hist = textureSample(u_history, u_sampler, clamp(uv + warp, vec2f(0.0), vec2f(1.0)));
    let selfDisplace = (hist.rg - vec2f(0.5)) * intensity * 0.10;
    let split = intensity * 0.018 * (1.0 + pulse * 0.6);
    let uvW = uv + warp * 0.4 + selfDisplace;
    let rr = textureSample(u_image, u_sampler, clamp(uvW + vec2f(split, 0.0), vec2f(0.0), vec2f(1.0))).r;
    let gg = textureSample(u_image, u_sampler, clamp(uvW, vec2f(0.0), vec2f(1.0))).g;
    let bb = textureSample(u_image, u_sampler, clamp(uvW + vec2f(-split, 0.0), vec2f(0.0), vec2f(1.0))).b;
    color = vec4f(mix(vec3f(rr, gg, bb), hist.rgb, intensity * 0.62), color.a);
  `,

  [ShaderEffect.KALEIDOSCOPE]: `
    let t = uniforms.time;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPulse = exp(-fract(t / beatPeriod) * 8.0) * uniforms.bpmSync_KALEIDOSCOPE;
    let dims = vec2f(textureDimensions(u_image));
    let aspect = vec2f(dims.x / dims.y, 1.0);

    let size = 0.42 + 0.06 * sin(t * 0.11) - beatPulse * 0.05;
    let spin = t * 0.05 + beatPulse * 0.15;
    var p = (uv - vec2f(0.5)) * aspect;
    p = vec2f(p.x * cos(spin) - p.y * sin(spin), p.x * sin(spin) + p.y * cos(spin));
    let mirror2 = vec2f(0.8660254, -0.5);
    let mirror3 = vec2f(-0.8660254, -0.5);
    let corner = vec2f(size, 0.0);
    for (var i = 0; i < 8; i++) {
      p.y = abs(p.y);
      p -= 2.0 * min(dot(p, mirror2), 0.0) * mirror2;
      p -= 2.0 * min(dot(p - corner, mirror3), 0.0) * mirror3;
    }

    var q = p - vec2f(size * 0.5, size * 0.2886751);
    let turn = -t * 0.07;
    q = vec2f(q.x * cos(turn) - q.y * sin(turn), q.x * sin(turn) + q.y * cos(turn));
    let zoom = 1.6 + 0.3 * sin(t * 0.09);
    let drift = vec2f(sin(t * 0.07), cos(t * 0.05)) * 0.25;
    q = q * zoom / aspect + vec2f(0.5) + drift;
    uv = 1.0 - abs(1.0 - fract(q * 0.5) * 2.0);
  `,

  [ShaderEffect.DISPLACE]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    let pulse = exp(-beatPhase * 6.0) * 0.5 * uniforms.bpmSync_DISPLACE;
    let timeOffset = uniforms.time * 0.2;
    let displaceAmount = uniforms.intensity_DISPLACE * 0.04 * (1.0 + pulse);
    uv += vec2f(sin((uv.y + timeOffset) * 10.0), sin((uv.x + timeOffset) * 10.0)) * displaceAmount;
  `,

  [ShaderEffect.SWIRL]: `
    let beats = (uniforms.time * uniforms.bpm) / 60.0;
    let phase = mix(uniforms.time * 0.8, beats * 0.78539816339, uniforms.bpmSync_SWIRL);
    let dims = vec2f(textureDimensions(u_image));
    let aspect = vec2f(dims.x / dims.y, 1.0);
    var p = (uv - vec2f(0.5)) * aspect;
    let falloff = 1.0 - smoothstep(0.0, 0.5 * length(aspect), length(p));
    let twist = 2.5 * sin(phase) * falloff * falloff;
    p = vec2f(p.x * cos(twist) - p.y * sin(twist), p.x * sin(twist) + p.y * cos(twist));
    uv = p / aspect + vec2f(0.5);
  `,

  [ShaderEffect.CHROMA]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    let pulse = exp(-beatPhase * 8.0) * 3.0 * uniforms.bpmSync_CHROMA;
    let offset = 0.01 * (1.0 + pulse) * uniforms.intensity_CHROMA;
    let chromaDiff = vec3f(
      textureSample(u_image, u_sampler, uv + vec2f(offset, 0.0)).r - color.r,
      0.0,
      textureSample(u_image, u_sampler, uv - vec2f(offset, 0.0)).b - color.b
    );
    color = vec4f(color.rgb + chromaDiff, color.a);
  `,

  [ShaderEffect.PIXELATE]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    let pulse = exp(-beatPhase * 6.0) * 0.3 * uniforms.bpmSync_PIXELATE;
    let effectiveIntensity = clamp(uniforms.intensity_PIXELATE + pulse, 0.0, 1.0);
    let dims = vec2f(textureDimensions(u_image));
    let rows = 400.0 * pow(0.025, effectiveIntensity);
    let cells = vec2f(rows * dims.x / dims.y, rows);
    uv = (floor(uv * cells) + vec2f(0.5)) / cells;
  `,

  [ShaderEffect.VORONOI]: `
    let HASH_A = vec2f(127.1, 311.7);
    let HASH_B = vec2f(269.5, 183.3);
    let HASH_SCALE = 43758.5453;
    let ei = uniforms.intensity_VORONOI;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    let beatPulse = exp(-beatPhase * 7.0) * uniforms.bpmSync_VORONOI;
    let dims = vec2f(textureDimensions(u_image));
    let aspect = vec2f(dims.x / dims.y, 1.0);
    let cellDensity = mix(7.0, 3.0, ei) * (1.0 - beatPulse * 0.30);
    let globalDrift = vec2f(uniforms.time * 0.010, uniforms.time * 0.007);
    let scaled = (uv * aspect + globalDrift) * cellDensity;
    let cellIdx = floor(scaled);
    let cellFrac = fract(scaled);
    var minDist = 9.9;
    var nearest = vec2f(0.5);
    for (var dy: i32 = -1; dy <= 1; dy++) {
      for (var dx: i32 = -1; dx <= 1; dx++) {
        let nb = vec2f(f32(dx), f32(dy));
        let nbIdx = cellIdx + nb;
        let jx = fract(sin(dot(nbIdx, HASH_A)) * HASH_SCALE);
        let jy = fract(sin(dot(nbIdx, HASH_B)) * HASH_SCALE);
        let center = nb + vec2f(jx, jy) + vec2f(
          sin(uniforms.time * 0.22 + jx * 6.28318) * 0.12,
          cos(uniforms.time * 0.18 + jy * 6.28318) * 0.12
        );
        let d = length(cellFrac - center);
        if (d < minDist) { minDist = d; nearest = center; }
      }
    }
    let toCenter = nearest - cellFrac;
    let r = length(toCenter);
    let pull = ei * (0.45 + beatPulse * 0.35) * exp(-r * r * 5.0);
    uv = ((cellIdx + cellFrac + toCenter * pull) / cellDensity - globalDrift) / aspect;
  `,

  [ShaderEffect.RIPPLE]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let ringPhase = mix(fract(uniforms.time * 0.5), fract(uniforms.time / beatPeriod), uniforms.bpmSync_RIPPLE);
    let dims = vec2f(textureDimensions(u_image));
    let aspect = vec2f(dims.x / dims.y, 1.0);
    let p = (uv - vec2f(0.5)) * aspect;
    let distFromCenter = length(p);
    let ringRadius = ringPhase * 0.6 * length(aspect);
    let ringStrength = exp(-abs(distFromCenter - ringRadius) * 25.0) * (1.0 - ringPhase);
    let push = normalize(p + vec2f(0.0001)) * ringStrength * distFromCenter * 0.15 * uniforms.intensity_RIPPLE;
    uv += push / aspect;
  `,

  [ShaderEffect.FEEDBACK_ECHO]: `
    let intensity = uniforms.intensity_FEEDBACK_ECHO;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPulse = exp(-fract(uniforms.time / beatPeriod) * 6.0) * uniforms.bpmSync_FEEDBACK_ECHO;
    // The history is re-sampled every frame, so this angle is applied per frame and must stay
    // a small step. An angle growing with time compounds every frame into a spin that depends
    // on how long the app has been open.
    let rotationStep = sin(uniforms.time * 0.1) * 0.004 + beatPulse * intensity * 0.008;
    let cosR = cos(rotationStep);
    let sinR = sin(rotationStep);
    let dims = vec2f(textureDimensions(u_image));
    let aspect = vec2f(dims.x / dims.y, 1.0);
    var centered = (uv - vec2f(0.5)) * aspect;
    centered = vec2f(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);
    centered *= 1.0 + 0.005 * intensity;
    let historyColor = textureSample(u_history, u_sampler, clamp(centered / aspect + vec2f(0.5), vec2f(0.0), vec2f(1.0)));
    color = vec4f(mix(color.rgb, historyColor.rgb, mix(0.5, 0.95, intensity)), color.a);
  `,

  [ShaderEffect.PALETTE_CYCLING]: `
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    let beats = (uniforms.time * uniforms.bpm) / 60.0;
    let cyclePhase = luma + mix(uniforms.time * 0.1, beats / 4.0, uniforms.bpmSync_PALETTE_CYCLING);
    let palette = vec3f(0.5) + vec3f(0.5) * cos(6.28318530718 * (vec3f(cyclePhase) + vec3f(0.0, 0.333, 0.667)));
    color = vec4f(mix(color.rgb, palette, uniforms.intensity_PALETTE_CYCLING), color.a);
  `,

  [ShaderEffect.CONTOUR]: `
    let PI = 3.14159265;
    let intensity = uniforms.intensity_CONTOUR;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    let beatPulse = exp(-beatPhase * 6.0) * uniforms.bpmSync_CONTOUR * intensity;
    let breathe = sin(uniforms.time * 0.4) * 0.15;
    let bandFreq = mix(6.0, 32.0, intensity) * (1.0 + breathe) + beatPulse * 14.0;
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    let lineStrength = 1.0 - smoothstep(0.0, 0.18, abs(sin(luma * bandFreq * PI)));
    let hue = luma * 4.0 + (uniforms.time * uniforms.bpm) / 60.0 * uniforms.bpmSync_CONTOUR / 8.0;
    let lineColor = vec3f(0.5 + 0.5 * cos(hue), 0.5 + 0.5 * cos(hue + 2.09439510239), 0.5 + 0.5 * cos(hue + 4.18879020479));
    let contoured = mix(color.rgb, lineColor, lineStrength * intensity);
    let histDrift = vec2f(sin(uniforms.time * 0.11) * 0.0008, cos(uniforms.time * 0.09) * 0.0008);
    let hist = textureSample(u_history, u_sampler, clamp(uv + histDrift, vec2f(0.0), vec2f(1.0)));
    // decay + weight stays at or below 1: any more brightens the history a little every
    // frame, and with other feedback effects stacked that clips to white.
    let decay = mix(0.92, 0.97, intensity);
    let accumulated = hist.rgb * decay + contoured * min(0.06, 1.0 - decay);
    color = vec4f(mix(contoured, accumulated, mix(0.3, 0.82, intensity)), color.a);
  `,

  [ShaderEffect.AURORA]: `
    let t = uniforms.time * 0.28;
    var flow = vec2f(
      sin(uv.y * 2.4 + t + cos(uv.x * 1.8 + t * 0.90)) * 0.011,
      cos(uv.x * 2.1 + t * 0.85 + sin(uv.y * 2.9 + t * 0.65)) * 0.011
    );
    flow += vec2f(
      sin(uv.y * 5.2 - t * 1.50 + uv.x * 3.7) * 0.005,
      cos(uv.x * 4.7 + t * 1.30 + uv.y * 3.4) * 0.005
    );
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = fract(uniforms.time / beatPeriod);
    flow *= uniforms.intensity_AURORA * (1.0 + exp(-beatPhase * 5.0) * uniforms.bpmSync_AURORA * 0.45);
    var hist = textureSample(u_history, u_sampler, clamp(uv + flow, vec2f(0.0), vec2f(1.0)));
    hist = vec4f(mix(hist.rgb, hist.brg, 0.018 * uniforms.intensity_AURORA), hist.a);
    color = vec4f(mix(color.rgb, hist.rgb, mix(0.70, 0.94, uniforms.intensity_AURORA)), color.a);
  `,

  [ShaderEffect.REACTION_DIFFUSION]: ''
};

const effectTextureBindings = /* wgsl */ `
@group(0) @binding(0) var u_image: texture_2d<f32>;
@group(0) @binding(1) var u_sampler: sampler;
`;

const historyTextureBinding = /* wgsl */ `
@group(0) @binding(2) var u_history: texture_2d<f32>;
`;

const uniformBinding = /* wgsl */ `
${UNIFORMS_STRUCT}
@group(1) @binding(0) var<uniform> uniforms: Uniforms;
`;

export const MAPPING_EFFECTS = Object.values(ShaderEffect).filter(
  (effect) => shaderEffects[effect].stage === 'mapping'
);

export function mappingMask(active: Record<ShaderEffect, boolean>): number {
  return MAPPING_EFFECTS.reduce(
    (mask, effect, bit) => (active[effect] ? mask | (1 << bit) : mask),
    0
  );
}

export function createMappingShaderWGSL(): string {
  const blocks = MAPPING_EFFECTS.map((effect, bit) => ({ effect, bit }))
    .reverse()
    .map(({ effect, bit }) => `  if ((mask & ${1 << bit}u) != 0u) {${effectWGSL[effect]}}`)
    .join('\n');
  return `
${effectTextureBindings}
${uniformBinding}
@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  var uv = texCoord;
  let mask = u32(uniforms.mappingMask);
${blocks}
  return textureSample(u_image, u_sampler, uv);
}
`;
}

export function createEffectShaderWGSL(effect: ShaderEffect): string | null {
  const def = shaderEffects[effect];
  if (def.stage === 'compute' || def.stage === 'mapping') return null;

  const hasFeedback = def.stage === 'feedback';
  const body = effectWGSL[effect];

  return `
${effectTextureBindings}
${hasFeedback ? historyTextureBinding : ''}
${uniformBinding}
@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  var uv = texCoord;
  var color = textureSample(u_image, u_sampler, uv);
  ${body}
  return color;
}
  `;
}

export const rdStepShader = /* wgsl */ `
${UNIFORMS_STRUCT}
@group(0) @binding(0) var rd_state: texture_2d<f32>;
@group(0) @binding(1) var u_sampler: sampler;
@group(0) @binding(2) var video_frame: texture_2d<f32>;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let dims = textureDimensions(rd_state);
  let dx = 1.0 / f32(dims.x);
  let dy = 1.0 / f32(dims.y);

  let center = textureSample(rd_state, u_sampler, texCoord);
  let left   = textureSample(rd_state, u_sampler, clamp(texCoord + vec2f(-dx, 0.0), vec2f(0.0), vec2f(1.0)));
  let right  = textureSample(rd_state, u_sampler, clamp(texCoord + vec2f( dx, 0.0), vec2f(0.0), vec2f(1.0)));
  let above  = textureSample(rd_state, u_sampler, clamp(texCoord + vec2f(0.0, -dy), vec2f(0.0), vec2f(1.0)));
  let below  = textureSample(rd_state, u_sampler, clamp(texCoord + vec2f(0.0,  dy), vec2f(0.0), vec2f(1.0)));

  let chemA = center.r;
  let chemB = center.g;
  let lapA = left.r + right.r + above.r + below.r - 4.0 * chemA;
  let lapB = left.g + right.g + above.g + below.g - 4.0 * chemB;
  let rxn = chemA * chemB * chemB;
  var newA = clamp(chemA + 0.2097 * lapA - rxn + 0.055 * (1.0 - chemA), 0.0, 1.0);
  var newB = clamp(chemB + 0.105  * lapB + rxn - 0.117 * chemB,         0.0, 1.0);

  let videoColor = textureSample(video_frame, u_sampler, texCoord);
  let luma = dot(videoColor.rgb, vec3f(0.299, 0.587, 0.114));
  let intensity = uniforms.intensity_REACTION_DIFFUSION;
  let beatPeriod = 60.0 / uniforms.bpm;
  let beatPhase = fract(uniforms.time / beatPeriod);
  let pulse = exp(-beatPhase * 6.0) * uniforms.bpmSync_REACTION_DIFFUSION;

  let stableHash = fract(sin(texCoord.x * 13579.1 + texCoord.y * 37211.7) * 43758.5453);
  if (luma > 0.35 && stableHash < intensity * intensity * 0.0015) {
    newB = min(newB + 0.25, 1.0);
    newA = max(newA - 0.15, 0.0);
  }

  let burstHash = fract(sin(texCoord.x * 7919.1 + texCoord.y * 4211.7 + uniforms.time * 3.1) * 43758.5453);
  if (luma > 0.30 && burstHash < pulse * 0.06 * intensity) {
    newB = min(newB + 0.5, 1.0);
    newA = max(newA - 0.3, 0.0);
  }

  return vec4f(newA, newB, 0.0, 1.0);
}
`;

export const rdCompositeShader = /* wgsl */ `
${UNIFORMS_STRUCT}
@group(0) @binding(0) var u_image: texture_2d<f32>;
@group(0) @binding(1) var u_sampler: sampler;
@group(0) @binding(2) var u_rd: texture_2d<f32>;
@group(1) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let color = textureSample(u_image, u_sampler, texCoord);
  let rd = textureSample(u_rd, u_sampler, texCoord);
  let chemB = rd.g;
  let hue = chemB * 6.0 + uniforms.time * 0.2;
  let rdCol = vec3f(
    0.5 + 0.5 * cos(hue),
    0.5 + 0.5 * cos(hue + 2.094),
    0.5 + 0.5 * cos(hue + 4.189)
  );
  let beatPeriod = 60.0 / uniforms.bpm;
  let beatPhase = fract(uniforms.time / beatPeriod);
  let beatFlash = exp(-beatPhase * 7.0) * uniforms.bpmSync_REACTION_DIFFUSION;
  let glowStrength = uniforms.intensity_REACTION_DIFFUSION * (1.8 + beatFlash * 2.0);
  let glow = rdCol * chemB * glowStrength;
  return vec4f(clamp(color.rgb + glow, vec3f(0.0), vec3f(1.0)), color.a);
}
`;
