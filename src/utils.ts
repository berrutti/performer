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
  AURORA = 'AURORA'
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
    stage: 'feedback',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        float t = u_time;
        float intensity = u_intensity_REALITY_GLITCH;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(t, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * 5.0) * u_bpm_sync_REALITY_GLITCH * 1.5;
        float driven = intensity * (1.0 + pulse);

        // Three octaves of sine-product waves for organic, non-repeating displacement.
        vec2 warp;
        warp  = vec2(sin(uv.y * 3.1 + t * 0.70) * cos(uv.x * 2.8 + t * 0.50),
                     cos(uv.x * 3.3 + t * 0.60) * sin(uv.y * 2.9 + t * 0.80)) * 0.040;
        warp += vec2(sin(uv.y * 7.2 + t * 1.40 + uv.x * 2.1) * cos(uv.x * 6.8 + t * 1.10),
                     cos(uv.x * 7.5 + t * 1.70 + uv.y * 2.4) * sin(uv.y * 6.9 + t * 1.30)) * 0.018;
        warp *= driven;

        // Sample history at wave-warped position to create flowing trails.
        vec4 hist = texture2D(u_history, clamp(uv + warp, 0.0, 1.0));

        // Self-referential: history color channels drive additional displacement.
        // This makes the distortion recursive — trails warp their own future shape.
        vec2 selfDisplace = (hist.rg - 0.5) * intensity * 0.10;

        // Chromatic separation on the current frame: R/G/B sampled at offsets.
        float split = intensity * 0.018 * (1.0 + pulse * 0.6);
        vec2 uvW = uv + warp * 0.4 + selfDisplace;
        float rr = texture2D(u_image, clamp(uvW + vec2( split,  0.0), 0.0, 1.0)).r;
        float gg = texture2D(u_image, clamp(uvW,                      0.0, 1.0)).g;
        float bb = texture2D(u_image, clamp(uvW + vec2(-split,  0.0), 0.0, 1.0)).b;
        vec4 chromatic = vec4(rr, gg, bb, 1.0);

        // Blend chromatic current frame with history trails.
        // History contribution grows with intensity but current frame always visible.
        color.rgb = mix(vec3(rr, gg, bb), hist.rgb, intensity * 0.62);
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
        const vec2 HASH_A = vec2(127.1, 311.7);
        const vec2 HASH_B = vec2(269.5, 183.3);
        const float HASH_SCALE = 43758.5453;

        float ei = u_intensity_VORONOI;

        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        // Beat pulse is independent of intensity so it fires at full strength at 100%
        float beatPulse = exp(-beatPhase * 7.0) * u_bpm_sync_VORONOI;

        // Cells briefly expand on beat — clearly visible even at full intensity
        float cellDensity = mix(7.0, 3.0, ei) * (1.0 - beatPulse * 0.30);
        // Linear drift: the whole field slowly travels so the distribution
        // is in a completely different position after a few minutes.
        vec2 globalDrift = vec2(u_time * 0.010, u_time * 0.007);
        vec2 scaled = (uv + globalDrift) * cellDensity;
        vec2 cellIdx = floor(scaled);
        vec2 cellFrac = fract(scaled);

        float minDist = 9.9;
        vec2 nearest = vec2(0.5);
        for (int dy = -1; dy <= 1; dy++) {
          for (int dx = -1; dx <= 1; dx++) {
            vec2 nb = vec2(float(dx), float(dy));
            vec2 nbIdx = cellIdx + nb;
            float jx = fract(sin(dot(nbIdx, HASH_A)) * HASH_SCALE);
            float jy = fract(sin(dot(nbIdx, HASH_B)) * HASH_SCALE);
            vec2 center = nb + vec2(jx, jy) + vec2(
              sin(u_time * 0.22 + jx * 6.28318) * 0.12,
              cos(u_time * 0.18 + jy * 6.28318) * 0.12
            );
            float d = length(cellFrac - center);
            if (d < minDist) { minDist = d; nearest = center; }
          }
        }

        // Pull capped at 0.45 base so the image stays visible at 100% intensity.
        // Beat adds a separate surge that makes cells briefly act as strong lenses.
        vec2 toCenter = nearest - cellFrac;
        float r = length(toCenter);
        float pull = (ei * 0.45 + beatPulse * 0.35) * exp(-r * r * 5.0);
        // Subtract globalDrift to bring the warped UV back into [0,1] video space.
        vec2 warped = (cellIdx + cellFrac + toCenter * pull) / cellDensity - globalDrift;

        uv = mix(uv, warped, clamp(ei + beatPulse * 0.25, 0.0, 1.0));
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
        // When BPM sync is off, use a slow constant rotation so the visual
        // stays close to the synced look — just not beat-locked.
        float constantAngle = u_time * 0.025;
        float syncedAngle = beatPhase * ROTATION_PER_BEAT;
        float rotationAngle = mix(constantAngle, syncedAngle, u_bpm_sync_FEEDBACK_ECHO);
        float cosR = cos(rotationAngle);
        float sinR = sin(rotationAngle);
        vec2 centered = uv - 0.5;
        centered = vec2(centered.x * cosR - centered.y * sinR, centered.x * sinR + centered.y * cosR);
        centered *= 1.0 + ZOOM_PER_INTENSITY * u_intensity_FEEDBACK_ECHO;
        vec4 historyColor = texture2D(u_history, clamp(centered + 0.5, 0.0, 1.0));
        color.rgb = mix(color.rgb, historyColor.rgb, mix(MIX_MIN, MIX_MAX, u_intensity_FEEDBACK_ECHO));
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
    stage: 'feedback',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        const float PI = 3.14159265;
        const float TWO_PI_OVER_3 = 2.09439510239;
        const float FOUR_PI_OVER_3 = 4.18879020479;
        const float HUE_SCALE = 4.0;
        const float BEATS_PER_HUE_CYCLE = 8.0;

        float intensity = u_intensity_CONTOUR;
        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float beatPulse = exp(-beatPhase * 6.0) * u_bpm_sync_CONTOUR;

        // Band frequency breathes slowly so the contour map tightens and loosens.
        float breathe = sin(u_time * 0.4) * 0.15;
        float baseFreq = mix(6.0, 32.0, intensity);
        // On beat: briefly compress to very high frequency (flash of tight contours),
        // then relax back.
        float bandFreq = baseFreq * (1.0 + breathe) + beatPulse * 28.0;

        // Draw contour lines on the current frame.
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float bandSample = sin(luma * bandFreq * PI);
        float lineStrength = 1.0 - smoothstep(0.0, 0.18, abs(bandSample));

        float beatsElapsed = (u_time * u_bpm) / 60.0 * u_bpm_sync_CONTOUR;
        float hue = luma * HUE_SCALE + beatsElapsed / BEATS_PER_HUE_CYCLE;
        vec3 lineColor = vec3(
          0.5 + 0.5 * cos(hue),
          0.5 + 0.5 * cos(hue + TWO_PI_OVER_3),
          0.5 + 0.5 * cos(hue + FOUR_PI_OVER_3)
        );
        // Current frame with contour lines drawn on top.
        vec3 contoured = mix(color.rgb, lineColor, lineStrength * intensity);

        // Accumulate contour lines into history — traces where structure has been.
        // A slow drift in the history sample creates ghostly smearing of past contours.
        vec2 histDrift = vec2(sin(u_time * 0.11) * 0.0008, cos(u_time * 0.09) * 0.0008);
        vec4 hist = texture2D(u_history, clamp(uv + histDrift, 0.0, 1.0));

        // Decay history slowly so old contours fade as new ones accumulate.
        vec3 accumulated = hist.rgb * mix(0.92, 0.97, intensity) + contoured * 0.06;

        // Blend: live contoured frame underneath, accumulated drawing on top.
        color.rgb = mix(contoured, accumulated, mix(0.3, 0.82, intensity));
      }
    `
  },

  [ShaderEffect.AURORA]: {
    stage: 'feedback',
    intensity: 1.0,
    bpmSync: true,
    glsl: `
      {
        // Two-layer organic flow field: large slow currents + fine fast ripples.
        float t = u_time * 0.28;
        vec2 flow = vec2(
          sin(uv.y * 2.4 + t + cos(uv.x * 1.8 + t * 0.90)) * 0.011,
          cos(uv.x * 2.1 + t * 0.85 + sin(uv.y * 2.9 + t * 0.65)) * 0.011
        );
        flow += vec2(
          sin(uv.y * 5.2 - t * 1.50 + uv.x * 3.7) * 0.005,
          cos(uv.x * 4.7 + t * 1.30 + uv.y * 3.4) * 0.005
        );

        // BPM: briefly surge the flow on each beat
        float beatPeriod = 60.0 / u_bpm;
        float beatPhase = mod(u_time, beatPeriod) / beatPeriod;
        float pulse = exp(-beatPhase * 5.0) * u_bpm_sync_AURORA * 0.45;
        flow *= u_intensity_AURORA * (1.0 + pulse);

        // Sample history at flow-displaced position
        vec4 hist = texture2D(u_history, clamp(uv + flow, 0.0, 1.0));

        // Rotate RGB channels very slightly each frame — creates slow aurora hue drift
        hist.rgb = mix(hist.rgb, hist.brg, 0.018 * u_intensity_AURORA);

        // Blend: live frame vs persistent trail — more persistent at higher intensity
        color.rgb = mix(color.rgb, hist.rgb, mix(0.70, 0.94, u_intensity_AURORA));
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
