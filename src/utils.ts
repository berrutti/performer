// utils.ts
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
  CONTOUR = 'CONTOUR'
}

export interface ShaderEffectDef {
  /** 'mapping' effects mutate uv, 'color' effects mutate color, 'feedback' effects read u_history */
  stage: 'mapping' | 'color' | 'feedback';
  glsl: string;
  intensity?: number;
  bpmSync?: boolean;
}

export const shaderEffects: Record<ShaderEffect, ShaderEffectDef> = {
  [ShaderEffect.INVERT]: {
    stage: 'color',
    intensity: 1.0,
    glsl: `color.rgb = mix(color.rgb, 1.0 - color.rgb, u_intensity_INVERT);`
  },

  [ShaderEffect.GRAYSCALE]: {
    stage: 'color',
    glsl: `
      {
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        color = vec4(vec3(luma), 1.0);
      }
    `
  },

  [ShaderEffect.REALITY_GLITCH]: {
    stage: 'mapping',
    intensity: 1.0,
    glsl: `
      {
        const float GOLDEN_RATIO = 1.618;
        const float TWO_PI = 6.28318530718;
        const float NOISE_BASE_SCALE = 2.0;
        const float NOISE_SCALE_RANGE = 5.0;
        const float WAVE_BASE_FREQ = 8.0;
        const float WAVE_FREQ_RANGE = 32.0;
        const float WAVE_DIAGONAL_SCALE = 0.7;
        const float SPIRAL_WANDER_AMP = 0.1;
        const float SPIRAL_BASE_ARMS = 3.0;
        const float SPIRAL_ARMS_RANGE = 8.0;
        const float SPIRAL_RADIUS_FREQ = 20.0;
        const float CORRUPT_BASE_RES = 20.0;
        const float CORRUPT_RES_RANGE = 80.0;
        const float CORRUPT_THRESH_BASE = 0.7;
        const float CORRUPT_THRESH_RANGE = 0.3;
        const float CORRUPT_SMOOTH_HALF = 0.1;
        const float TEAR_AMP = 0.3;
        const float TEAR_SPATIAL_X = 50.0;
        const float TEAR_SPATIAL_Y = 47.0;
        const float DISTORTION_SCALE = 0.08;
        const float JUMP_SCALE = 0.06;
        const float FEEDBACK_UV_SCALE = 0.5;
        const float FEEDBACK_NOISE_FREQ = 12.0;
        const float FEEDBACK_DISTORT_SCALE = 0.05;
        const float CHROMA_BASE_DENSITY = 5.0;
        const float CHROMA_DENSITY_RANGE = 15.0;
        const float CHROMA_PHASE_OFFSET = 2.1;
        const float CHROMA_DISTORT_SCALE = 0.03;
        const float STRIP_BASE_COUNT = 20.0;
        const float STRIP_COUNT_RANGE = 60.0;
        const float TIME_SNAP_RATE = 10.0;
        const float BAND_HASH_SALT = 5.1;
        const float BAND_THRESH_HIGH = 0.92;
        const float BAND_THRESH_LOW = 0.45;
        const float BAND_DISTORT_SCALE = 0.5;
        const float CHAOS_WRAP_LOW = 0.7;
        const float CHAOS_WRAP_HIGH = 0.9;
        const vec2 HASH_A = vec2(12.9898, 78.233);
        const vec2 HASH_B = vec2(93.9898, 67.345);
        const vec2 HASH_C = vec2(127.1, 311.7);
        const vec2 HASH_D = vec2(269.5, 183.3);
        const float HASH_SCALE_A = 43758.5453;
        const float HASH_SCALE_B = 24634.6345;

        float intensity = u_intensity_REALITY_GLITCH;
        vec2 workUv = uv;

        float noiseScale = NOISE_BASE_SCALE + intensity * NOISE_SCALE_RANGE;
        float noise1 = fract(sin(dot(workUv * noiseScale, HASH_A)) * HASH_SCALE_A);
        float noise2 = fract(sin(dot(workUv * noiseScale * GOLDEN_RATIO, HASH_B)) * HASH_SCALE_B);

        float waveFreq = WAVE_BASE_FREQ + intensity * WAVE_FREQ_RANGE;
        float wave1 = sin(workUv.x * waveFreq + u_time * 3.0 + noise1 * TWO_PI);
        float wave2 = cos(workUv.y * waveFreq + u_time * 2.7 + noise2 * TWO_PI);
        float wave3 = sin((workUv.x + workUv.y) * waveFreq * WAVE_DIAGONAL_SCALE + u_time * 4.1);

        vec2 spiralCenter = vec2(
          0.5 + sin(u_time * 0.3) * SPIRAL_WANDER_AMP,
          0.5 + cos(u_time * 0.23) * SPIRAL_WANDER_AMP
        );
        vec2 spiralCoord = workUv - spiralCenter;
        float spiralRadius = length(spiralCoord);
        float spiralAngle = atan(spiralCoord.y, spiralCoord.x);
        float spiralArms = SPIRAL_BASE_ARMS + intensity * SPIRAL_ARMS_RANGE;
        float spiralDistort = sin(spiralAngle * spiralArms + spiralRadius * SPIRAL_RADIUS_FREQ + u_time * 5.0) * spiralRadius;

        float corruptResolution = CORRUPT_BASE_RES + intensity * CORRUPT_RES_RANGE;
        vec2 corruptCell = floor(workUv * corruptResolution) / corruptResolution;
        float corruptHash = fract(sin(dot(corruptCell, HASH_C)) * HASH_SCALE_A);
        float corruptThresh = CORRUPT_THRESH_BASE - intensity * CORRUPT_THRESH_RANGE;
        float dataCorruption = smoothstep(corruptThresh - CORRUPT_SMOOTH_HALF, corruptThresh + CORRUPT_SMOOTH_HALF, corruptHash);

        float tearIntensity = intensity * intensity;
        vec2 tearOffset = vec2(
          sin(u_time * 6.0 + workUv.y * TEAR_SPATIAL_X) * tearIntensity * TEAR_AMP,
          cos(u_time * 7.3 + workUv.x * TEAR_SPATIAL_Y) * tearIntensity * TEAR_AMP
        );

        vec2 totalDistortion = vec2(
          (wave1 + spiralDistort + tearOffset.x) * intensity * DISTORTION_SCALE,
          (wave2 + wave3 + tearOffset.y) * intensity * DISTORTION_SCALE
        );
        totalDistortion += vec2(
          (noise1 - 0.5) * intensity * JUMP_SCALE * dataCorruption,
          (noise2 - 0.5) * intensity * JUMP_SCALE * dataCorruption
        );

        vec2 feedbackUv = workUv + totalDistortion * FEEDBACK_UV_SCALE;
        float feedbackNoise = fract(sin(dot(feedbackUv * FEEDBACK_NOISE_FREQ, HASH_A)) * HASH_SCALE_A);
        totalDistortion += vec2(
          sin(feedbackNoise * TWO_PI + u_time * 8.0) * intensity * FEEDBACK_DISTORT_SCALE,
          cos(feedbackNoise * TWO_PI + u_time * 9.2) * intensity * FEEDBACK_DISTORT_SCALE
        );

        float chromaDensity = CHROMA_BASE_DENSITY + intensity * CHROMA_DENSITY_RANGE;
        float chromaZone = floor(workUv.x * chromaDensity) + floor(workUv.y * chromaDensity);
        float chromaPhase = chromaZone * CHROMA_PHASE_OFFSET + u_time * 3.0;
        vec2 chromaDistort = vec2(
          sin(chromaPhase) * intensity * CHROMA_DISTORT_SCALE,
          cos(chromaPhase * 1.3) * intensity * CHROMA_DISTORT_SCALE
        );

        float stripCount = floor(STRIP_BASE_COUNT + intensity * STRIP_COUNT_RANGE);
        float stripId = floor(workUv.y * stripCount);
        float timeSnap = floor(u_time * TIME_SNAP_RATE);
        float bandHash = fract(sin(dot(vec2(stripId, timeSnap), HASH_C)) * HASH_SCALE_A);
        float bandAmt  = fract(sin(dot(vec2(stripId, timeSnap + BAND_HASH_SALT), HASH_D)) * HASH_SCALE_A);
        // timeSnap quantization makes strips snap rather than drift, giving a digital-corruption feel
        float bandActive = step(mix(BAND_THRESH_HIGH, BAND_THRESH_LOW, intensity), bandHash);
        totalDistortion.x += (bandAmt - 0.5) * intensity * BAND_DISTORT_SCALE * bandActive;

        vec2 finalUv = workUv + totalDistortion + chromaDistort;
        float chaosFactor = smoothstep(CHAOS_WRAP_LOW, CHAOS_WRAP_HIGH, intensity);
        uv = mix(fract(finalUv), finalUv, chaosFactor);
      }
    `
  },

  [ShaderEffect.KALEIDOSCOPE]: {
    stage: 'mapping',
    bpmSync: true,
    glsl: `
      {
        const float PI = 3.14159265;
        const float ZOOM = 1.5;
        const float ROTATION_SPEED = 0.1;
        const float BEAT_KICK_AMP = 0.15;
        const float BEAT_KICK_DECAY = 8.0;
        const float SLICE_COUNT = 10.0;
        const float COORD_SCALE = 0.8;
        const float SAMPLE_OFFSET_Y = 0.4;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float beatKick = exp(-beatPhase * BEAT_KICK_DECAY) * BEAT_KICK_AMP * u_bpm_sync_KALEIDOSCOPE;

        vec2 centered = (uv - 0.5) * ZOOM;
        float rotation = u_time * ROTATION_SPEED + beatKick;
        float cosR = cos(rotation);
        float sinR = sin(rotation);
        centered = vec2(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);

        float radius = length(centered);
        float fullAngle = atan(centered.y, centered.x);
        float sliceAngle = 2.0 * PI / SLICE_COUNT;
        float sliceIndex = floor(fullAngle / sliceAngle);
        float angle = mod(fullAngle, sliceAngle);
        if (mod(sliceIndex, 2.0) > 0.5) {
          angle = sliceAngle - angle;
        }

        uv = fract(vec2(cos(angle), sin(angle)) * radius * COORD_SCALE + vec2(0.5, SAMPLE_OFFSET_Y));
      }
    `
  },

  [ShaderEffect.DISPLACE]: {
    stage: 'mapping',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float TIME_SCALE = 0.2;
        const float MAX_DISPLACEMENT = 0.08;
        const float WAVE_FREQUENCY = 10.0;
        const float PULSE_BOOST = 0.5;
        const float PULSE_DECAY = 6.0;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * PULSE_DECAY) * PULSE_BOOST * u_bpm_sync_DISPLACE;
        float timeOffset = u_time * TIME_SCALE;
        float displaceAmount = u_intensity_DISPLACE * MAX_DISPLACEMENT * (1.0 + pulse);

        vec2 displacedUv = uv;
        displacedUv.x += (sin((uv.y + timeOffset) * WAVE_FREQUENCY) * 0.5 + 0.5) * displaceAmount;
        displacedUv.y += (sin((uv.x + timeOffset) * WAVE_FREQUENCY) * 0.5 + 0.5) * displaceAmount;

        uv = mix(uv, displacedUv, u_intensity_DISPLACE);
      }
    `
  },

  [ShaderEffect.SWIRL]: {
    stage: 'mapping',
    bpmSync: true,
    glsl: `
      {
        const float PI_OVER_4 = 0.78539816339;
        const float SWIRL_STRENGTH = 3.0;

        float beatPhase = (u_time * u_bpm) / 60.0 * u_bpm_sync_SWIRL;
        vec2 centered = uv * 2.0 - 1.0;
        float radius = length(centered);
        float angle = atan(centered.y, centered.x) + radius * SWIRL_STRENGTH * sin(beatPhase * PI_OVER_4);
        uv = (vec2(cos(angle), sin(angle)) * radius + 1.0) * 0.5;
      }
    `
  },

  [ShaderEffect.CHROMA]: {
    stage: 'color',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float BASE_OFFSET = 0.01;
        const float PULSE_BOOST = 3.0;
        const float PULSE_DECAY = 8.0;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * PULSE_DECAY) * PULSE_BOOST * u_bpm_sync_CHROMA;
        float offset = BASE_OFFSET * (1.0 + pulse) * u_intensity_CHROMA;

        vec3 chromaDiff = vec3(
          texture2D(u_image, uv + vec2(offset, 0.0)).r - color.r,
          0.0,
          texture2D(u_image, uv - vec2(offset, 0.0)).b - color.b
        );
        color.rgb += chromaDiff;
      }
    `
  },

  [ShaderEffect.PIXELATE]: {
    stage: 'mapping',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float MAX_PIXEL_SIZE = 200.0;
        const float MIN_PIXEL_SIZE = 10.0;
        const float PULSE_BOOST = 0.3;
        const float PULSE_DECAY = 6.0;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * PULSE_DECAY) * PULSE_BOOST * u_bpm_sync_PIXELATE;
        float effectiveIntensity = clamp(u_intensity_PIXELATE + pulse, 0.0, 1.0);
        float pixelSize = mix(MAX_PIXEL_SIZE, MIN_PIXEL_SIZE, effectiveIntensity);
        vec2 pixelatedUv = floor(uv * pixelSize) / pixelSize;
        uv = mix(uv, pixelatedUv, effectiveIntensity);
      }
    `
  },

  [ShaderEffect.VORONOI]: {
    stage: 'mapping',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float BASE_CELL_DENSITY = 5.0;
        const float CELL_DENSITY_RANGE = 15.0;
        const float PULSE_BOOST = 0.4;
        const float PULSE_DECAY = 5.0;
        const vec2 HASH_A = vec2(12.9898, 78.233);
        const vec2 HASH_B = vec2(93.9898, 67.345);
        const float HASH_SCALE_A = 43758.5453;
        const float HASH_SCALE_B = 24634.6345;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * PULSE_DECAY) * PULSE_BOOST * u_bpm_sync_VORONOI;
        float effectiveIntensity = clamp(u_intensity_VORONOI + pulse, 0.0, 1.0);
        float cellDensity = BASE_CELL_DENSITY + effectiveIntensity * CELL_DENSITY_RANGE;
        vec2 cellIndex = floor(uv * cellDensity);
        vec2 cellFract = fract(uv * cellDensity);
        float jitterX = fract(sin(dot(cellIndex, HASH_A)) * HASH_SCALE_A);
        float jitterY = fract(sin(dot(cellIndex, HASH_B)) * HASH_SCALE_B);
        vec2 voronoiUv = (cellIndex + vec2(jitterX, jitterY) + cellFract) / cellDensity;

        uv = mix(uv, voronoiUv, effectiveIntensity);
      }
    `
  },

  [ShaderEffect.RIPPLE]: {
    stage: 'mapping',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float RING_SHARPNESS = 25.0;
        const float RING_TRAVEL = 0.85;
        const float DISPLACEMENT_SCALE = 0.15;
        const float CENTER_EPSILON = 0.0001;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float distFromCenter = length(uv - 0.5);
        vec2 outwardDir = normalize(uv - 0.5 + CENTER_EPSILON);
        float ringStrength = exp(-abs(distFromCenter - beatPhase * RING_TRAVEL) * RING_SHARPNESS) * (1.0 - beatPhase) * u_bpm_sync_RIPPLE;
        uv += outwardDir * ringStrength * distFromCenter * DISPLACEMENT_SCALE * u_intensity_RIPPLE;
      }
    `
  },

  [ShaderEffect.FEEDBACK_ECHO]: {
    stage: 'feedback',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float ROTATION_PER_BEAT = 0.019635;
        const float ZOOM_PER_INTENSITY = 0.005;
        const float MIX_MIN = 0.5;
        const float MIX_MAX = 0.95;

        float beatPhase = (u_time * u_bpm) / 60.0;
        float rotationAngle = beatPhase * ROTATION_PER_BEAT * u_bpm_sync_FEEDBACK_ECHO;
        float cosR = cos(rotationAngle);
        float sinR = sin(rotationAngle);
        vec2 centered = uv - 0.5;
        centered = vec2(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);
        centered *= 1.0 + ZOOM_PER_INTENSITY * u_intensity_FEEDBACK_ECHO;
        vec4 historyColor = texture2D(u_history, clamp(centered + 0.5, 0.0, 1.0));
        color = mix(color, historyColor, mix(MIX_MIN, MIX_MAX, u_intensity_FEEDBACK_ECHO));
      }
    `
  },

  [ShaderEffect.PALETTE_CYCLING]: {
    stage: 'color',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float TWO_PI = 6.28318530718;
        const float BEATS_PER_CYCLE = 4.0;
        const float PHASE_GREEN = 0.333;
        const float PHASE_BLUE = 0.667;

        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float beatsElapsed = (u_time * u_bpm) / 60.0 * u_bpm_sync_PALETTE_CYCLING;
        float cyclePhase = luma + beatsElapsed / BEATS_PER_CYCLE;
        vec3 palette = vec3(0.5) + vec3(0.5) * cos(TWO_PI * (vec3(cyclePhase) + vec3(0.0, PHASE_GREEN, PHASE_BLUE)));
        color.rgb = mix(color.rgb, palette, u_intensity_PALETTE_CYCLING);
      }
    `
  },

  [ShaderEffect.CONTOUR]: {
    stage: 'color',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float PI = 3.14159265;
        const float TWO_PI_OVER_3 = 2.09439510239;
        const float FOUR_PI_OVER_3 = 4.18879020479;
        const float MIN_BAND_FREQ = 8.0;
        const float MAX_BAND_FREQ = 40.0;
        const float LINE_SOFTNESS = 0.15;
        const float HUE_SCALE = 4.0;
        const float BEATS_PER_HUE_CYCLE = 8.0;
        const float PULSE_BOOST = 0.4;
        const float PULSE_DECAY = 5.0;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * PULSE_DECAY) * PULSE_BOOST * u_bpm_sync_CONTOUR;

        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float bandFreq = mix(MIN_BAND_FREQ, MAX_BAND_FREQ, clamp(u_intensity_CONTOUR + pulse, 0.0, 1.0));
        float bandSample = sin(luma * bandFreq * PI);
        float lineStrength = 1.0 - smoothstep(0.0, LINE_SOFTNESS, abs(bandSample));
        float beatsElapsed = (u_time * u_bpm) / 60.0 * u_bpm_sync_CONTOUR;
        float hue = luma * HUE_SCALE + beatsElapsed / BEATS_PER_HUE_CYCLE;
        vec3 lineColor = vec3(
          0.5 + 0.5 * cos(hue),
          0.5 + 0.5 * cos(hue + TWO_PI_OVER_3),
          0.5 + 0.5 * cos(hue + FOUR_PI_OVER_3)
        );
        color.rgb = mix(color.rgb, lineColor, lineStrength);
      }
    `
  }
};

export function getTextureCoordinates(
  videoWidth: number,
  videoHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Float32Array {
  const videoAspect = videoWidth / videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  if (videoAspect < canvasAspect) {
    // Video is "shorter" than the canvas when filling width: crop vertically.
    const vCrop = (1 - videoAspect / canvasAspect) / 2;
    return new Float32Array([
      // Triangle 1
      0,
      vCrop, // bottom-left
      1,
      vCrop, // bottom-right
      0,
      1 - vCrop, // top-left
      // Triangle 2
      0,
      1 - vCrop, // top-left
      1,
      vCrop, // bottom-right
      1,
      1 - vCrop // top-right
    ]);
  } else {
    // Video is wider than (or equal to) canvas: crop horizontally.
    const uCrop = (1 - canvasAspect / videoAspect) / 2;
    return new Float32Array([
      // Triangle 1
      uCrop,
      0, // bottom-left
      1 - uCrop,
      0, // bottom-right
      uCrop,
      1, // top-left
      // Triangle 2
      uCrop,
      1, // top-left
      1 - uCrop,
      0, // bottom-right
      1 - uCrop,
      1 // top-right
    ]);
  }
}
