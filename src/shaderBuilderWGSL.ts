import { ShaderEffect, shaderEffects } from '@/utils';

// Uniform buffer layout — 32 × f32 = 128 bytes
// Indices: time=0, bpm=1, cropUMin=2, cropUMax=3, cropVMin=4, cropVMax=5,
//   intensities at 6–16, bpmSync flags at 17–28, pad at 29–31
export const UNIFORMS_FLOAT_COUNT = 32;

export const UNIFORM_IDX = {
  time: 0,
  bpm: 1,
  cropUMin: 2,
  cropUMax: 3,
  cropVMin: 4,
  cropVMax: 5,
  intensity: {
    INVERT: 6,
    REALITY_GLITCH: 7,
    DISPLACE: 8,
    CHROMA: 9,
    PIXELATE: 10,
    VORONOI: 11,
    RIPPLE: 12,
    FEEDBACK_ECHO: 13,
    PALETTE_CYCLING: 14,
    CONTOUR: 15,
    AURORA: 16
  },
  bpmSync: {
    REALITY_GLITCH: 17,
    KALEIDOSCOPE: 18,
    DISPLACE: 19,
    SWIRL: 20,
    CHROMA: 21,
    PIXELATE: 22,
    VORONOI: 23,
    RIPPLE: 24,
    FEEDBACK_ECHO: 25,
    PALETTE_CYCLING: 26,
    CONTOUR: 27,
    AURORA: 28
  }
} as const;

const UNIFORMS_STRUCT = /* wgsl */ `
struct Uniforms {
  time: f32, bpm: f32, cropUMin: f32, cropUMax: f32,
  cropVMin: f32, cropVMax: f32,
  intensity_INVERT: f32, intensity_REALITY_GLITCH: f32,
  intensity_DISPLACE: f32, intensity_CHROMA: f32,
  intensity_PIXELATE: f32, intensity_VORONOI: f32,
  intensity_RIPPLE: f32, intensity_FEEDBACK_ECHO: f32,
  intensity_PALETTE_CYCLING: f32, intensity_CONTOUR: f32, intensity_AURORA: f32,
  bpmSync_REALITY_GLITCH: f32, bpmSync_KALEIDOSCOPE: f32,
  bpmSync_DISPLACE: f32, bpmSync_SWIRL: f32, bpmSync_CHROMA: f32,
  bpmSync_PIXELATE: f32, bpmSync_VORONOI: f32, bpmSync_RIPPLE: f32,
  bpmSync_FEEDBACK_ECHO: f32, bpmSync_PALETTE_CYCLING: f32,
  bpmSync_CONTOUR: f32, bpmSync_AURORA: f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
}
`;

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

// Blit shader: samples the external video texture with aspect-ratio crop.
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

// Per-effect WGSL logic snippets (inserted into the appropriate template).
const effectWGSL: Record<ShaderEffect, string> = {
  [ShaderEffect.INVERT]: `
    color = vec4f(mix(color.rgb, vec3f(1.0) - color.rgb, uniforms.intensity_INVERT), color.a);
  `,

  [ShaderEffect.GRAYSCALE]: `
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    color = vec4f(vec3f(luma), color.a);
  `,

  [ShaderEffect.REALITY_GLITCH]: `
    let t = uniforms.time;
    let intensity = uniforms.intensity_REALITY_GLITCH;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (t % beatPeriod) / beatPeriod;
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
    let PI = 3.14159265;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let beatKick = exp(-beatPhase * 8.0) * 0.15 * uniforms.bpmSync_KALEIDOSCOPE;
    var centered = (uv - vec2f(0.5)) * 1.5;
    let rotation = uniforms.time * 0.1 + beatKick;
    let cosR = cos(rotation);
    let sinR = sin(rotation);
    centered = vec2f(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);
    let radius = length(centered);
    let fullAngle = atan2(centered.y, centered.x);
    let sliceAngle = 2.0 * PI / 10.0;
    let sliceIndex = floor(fullAngle / sliceAngle);
    var angle = (fullAngle % sliceAngle);
    if ((sliceIndex % 2.0) > 0.5) { angle = sliceAngle - angle; }
    uv = fract(vec2f(cos(angle), sin(angle)) * radius * 0.8 + vec2f(0.5, 0.4));
  `,

  [ShaderEffect.DISPLACE]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let pulse = exp(-beatPhase * 6.0) * 0.5 * uniforms.bpmSync_DISPLACE;
    let timeOffset = uniforms.time * 0.2;
    let displaceAmount = uniforms.intensity_DISPLACE * 0.08 * (1.0 + pulse);
    var displacedUv = uv;
    displacedUv.x += (sin((uv.y + timeOffset) * 10.0) * 0.5 + 0.5) * displaceAmount;
    displacedUv.y += (sin((uv.x + timeOffset) * 10.0) * 0.5 + 0.5) * displaceAmount;
    uv = mix(uv, displacedUv, uniforms.intensity_DISPLACE);
  `,

  [ShaderEffect.SWIRL]: `
    let beatPhase = (uniforms.time * uniforms.bpm) / 60.0 * uniforms.bpmSync_SWIRL;
    var centered = uv * 2.0 - vec2f(1.0);
    let radius = length(centered);
    let angle = atan2(centered.y, centered.x) + radius * 3.0 * sin(beatPhase * 0.78539816339);
    uv = (vec2f(cos(angle), sin(angle)) * radius + vec2f(1.0)) * 0.5;
  `,

  [ShaderEffect.CHROMA]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
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
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let pulse = exp(-beatPhase * 6.0) * 0.3 * uniforms.bpmSync_PIXELATE;
    let effectiveIntensity = clamp(uniforms.intensity_PIXELATE + pulse, 0.0, 1.0);
    let pixelSize = mix(200.0, 10.0, effectiveIntensity);
    let pixelatedUv = floor(uv * pixelSize) / pixelSize;
    uv = mix(uv, pixelatedUv, effectiveIntensity);
  `,

  [ShaderEffect.VORONOI]: `
    let HASH_A = vec2f(127.1, 311.7);
    let HASH_B = vec2f(269.5, 183.3);
    let HASH_SCALE = 43758.5453;
    let ei = uniforms.intensity_VORONOI;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let beatPulse = exp(-beatPhase * 7.0) * uniforms.bpmSync_VORONOI;
    let cellDensity = mix(7.0, 3.0, ei) * (1.0 - beatPulse * 0.30);
    let globalDrift = vec2f(uniforms.time * 0.010, uniforms.time * 0.007);
    let scaled = (uv + globalDrift) * cellDensity;
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
    let pull = (ei * 0.45 + beatPulse * 0.35) * exp(-r * r * 5.0);
    let warped = (cellIdx + cellFrac + toCenter * pull) / cellDensity - globalDrift;
    uv = mix(uv, warped, clamp(ei + beatPulse * 0.25, 0.0, 1.0));
  `,

  [ShaderEffect.RIPPLE]: `
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let distFromCenter = length(uv - vec2f(0.5));
    let outwardDir = normalize(uv - vec2f(0.5) + vec2f(0.0001));
    let ringStrength = exp(-abs(distFromCenter - beatPhase * 0.85) * 25.0) * (1.0 - beatPhase) * uniforms.bpmSync_RIPPLE;
    uv += outwardDir * ringStrength * distFromCenter * 0.15 * uniforms.intensity_RIPPLE;
  `,

  [ShaderEffect.FEEDBACK_ECHO]: `
    let beatPhase = (uniforms.time * uniforms.bpm) / 60.0;
    let rotationAngle = mix(uniforms.time * 0.025, beatPhase * 0.019635, uniforms.bpmSync_FEEDBACK_ECHO);
    let cosR = cos(rotationAngle);
    let sinR = sin(rotationAngle);
    var centered = uv - vec2f(0.5);
    centered = vec2f(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);
    centered *= 1.0 + 0.005 * uniforms.intensity_FEEDBACK_ECHO;
    let historyColor = textureSample(u_history, u_sampler, clamp(centered + vec2f(0.5), vec2f(0.0), vec2f(1.0)));
    color = vec4f(mix(color.rgb, historyColor.rgb, mix(0.5, 0.95, uniforms.intensity_FEEDBACK_ECHO)), color.a);
  `,

  [ShaderEffect.PALETTE_CYCLING]: `
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    let beatsElapsed = (uniforms.time * uniforms.bpm) / 60.0 * uniforms.bpmSync_PALETTE_CYCLING;
    let cyclePhase = luma + beatsElapsed / 4.0;
    let palette = vec3f(0.5) + vec3f(0.5) * cos(6.28318530718 * (vec3f(cyclePhase) + vec3f(0.0, 0.333, 0.667)));
    color = vec4f(mix(color.rgb, palette, uniforms.intensity_PALETTE_CYCLING), color.a);
  `,

  [ShaderEffect.CONTOUR]: `
    let PI = 3.14159265;
    let intensity = uniforms.intensity_CONTOUR;
    let beatPeriod = 60.0 / uniforms.bpm;
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    let beatPulse = exp(-beatPhase * 6.0) * uniforms.bpmSync_CONTOUR;
    let breathe = sin(uniforms.time * 0.4) * 0.15;
    let bandFreq = mix(6.0, 32.0, intensity) * (1.0 + breathe) + beatPulse * 28.0;
    let luma = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
    let lineStrength = 1.0 - smoothstep(0.0, 0.18, abs(sin(luma * bandFreq * PI)));
    let hue = luma * 4.0 + (uniforms.time * uniforms.bpm) / 60.0 * uniforms.bpmSync_CONTOUR / 8.0;
    let lineColor = vec3f(0.5 + 0.5 * cos(hue), 0.5 + 0.5 * cos(hue + 2.09439510239), 0.5 + 0.5 * cos(hue + 4.18879020479));
    let contoured = mix(color.rgb, lineColor, lineStrength * intensity);
    let histDrift = vec2f(sin(uniforms.time * 0.11) * 0.0008, cos(uniforms.time * 0.09) * 0.0008);
    let hist = textureSample(u_history, u_sampler, clamp(uv + histDrift, vec2f(0.0), vec2f(1.0)));
    let accumulated = hist.rgb * mix(0.92, 0.97, intensity) + contoured * 0.06;
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
    let beatPhase = (uniforms.time % beatPeriod) / beatPeriod;
    flow *= uniforms.intensity_AURORA * (1.0 + exp(-beatPhase * 5.0) * uniforms.bpmSync_AURORA * 0.45);
    var hist = textureSample(u_history, u_sampler, clamp(uv + flow, vec2f(0.0), vec2f(1.0)));
    hist = vec4f(mix(hist.rgb, hist.brg, 0.018 * uniforms.intensity_AURORA), hist.a);
    color = vec4f(mix(color.rgb, hist.rgb, mix(0.70, 0.94, uniforms.intensity_AURORA)), color.a);
  `
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

export function createEffectShaderWGSL(effect: ShaderEffect): string {
  const def = shaderEffects[effect];
  const hasFeedback = def.stage === 'feedback';

  const body = effectWGSL[effect];

  if (def.stage === 'mapping') {
    return `
${effectTextureBindings}
${uniformBinding}
@fragment
fn fs_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  var uv = texCoord;
  ${body}
  return textureSample(u_image, u_sampler, uv);
}
    `;
  }

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
