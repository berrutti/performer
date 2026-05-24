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
  intensity?: number; // Optional - if present, effect has intensity control
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
      float l = dot(color.rgb, vec3(0.299,0.587,0.114));
      color = vec4(vec3(l),1.0);
    `
  },

  [ShaderEffect.REALITY_GLITCH]: {
    stage: 'mapping',
    intensity: 1.0,
    glsl: `
      {
        // REALITY_GLITCH: The ultimate trippy effect with SMOOTH intensity transitions
        float intensity = u_intensity_REALITY_GLITCH;
        float time = u_time;
        
        // Multi-layer chaos noise function
        vec2 chaos_uv = uv;
        
        // Layer 1: Fractal noise distortion - gets more chaotic with intensity
        float noise_scale = 5.0 + intensity * 25.0;
        float noise1 = fract(sin(dot(chaos_uv * noise_scale, vec2(12.9898, 78.233))) * 43758.5453);
        float noise2 = fract(sin(dot(chaos_uv * noise_scale * 1.618, vec2(93.9898, 67.345))) * 24634.6345);
        
        // Layer 2: Time-evolving distortion waves - smooth frequency scaling
        float wave_freq = 8.0 + intensity * 32.0;
        float wave1 = sin(chaos_uv.x * wave_freq + time * 3.0 + noise1 * 6.28);
        float wave2 = cos(chaos_uv.y * wave_freq + time * 2.7 + noise2 * 6.28);
        float wave3 = sin((chaos_uv.x + chaos_uv.y) * wave_freq * 0.7 + time * 4.1);
        
        // Layer 3: Spiral chaos - smooth spiral arm scaling
        vec2 center = vec2(0.5 + sin(time * 0.3) * 0.1, 0.5 + cos(time * 0.23) * 0.1);
        vec2 spiral_coord = chaos_uv - center;
        float spiral_r = length(spiral_coord);
        float spiral_angle = atan(spiral_coord.y, spiral_coord.x);
        float spiral_arms = 3.0 + intensity * 8.0;
        float spiral_distort = sin(spiral_angle * spiral_arms + spiral_r * 20.0 + time * 5.0) * spiral_r;
        
        // Layer 4: Digital corruption patterns - SMOOTH corruption instead of hard steps
        vec2 corrupt_uv = floor(chaos_uv * (20.0 + intensity * 80.0)) / (20.0 + intensity * 80.0);
        float corrupt_hash = fract(sin(dot(corrupt_uv, vec2(127.1, 311.7))) * 43758.5453);
        // Use smoothstep for gradual corruption instead of hard step
        float corruption_threshold = 0.7 - intensity * 0.3;
        float data_corruption = smoothstep(corruption_threshold - 0.1, corruption_threshold + 0.1, corrupt_hash);
        
        // Layer 5: Reality tearing - smooth quadratic scaling
        float tear_intensity = intensity * intensity;
        vec2 tear_offset = vec2(
          sin(time * 6.0 + chaos_uv.y * 50.0) * tear_intensity * 0.3,
          cos(time * 7.3 + chaos_uv.x * 47.0) * tear_intensity * 0.3
        );
        
        // Combine all chaos layers with smooth scaling
        vec2 total_distortion = vec2(
          (wave1 + spiral_distort + tear_offset.x) * intensity * 0.08,
          (wave2 + wave3 + tear_offset.y) * intensity * 0.08
        );
        
        // Add SMOOTH corruption jumps - no more hard if statements
        float jump_x = (noise1 - 0.5) * intensity * 0.4 * data_corruption;
        float jump_y = (noise2 - 0.5) * intensity * 0.4 * data_corruption;
        total_distortion += vec2(jump_x, jump_y);
        
        // Layer 6: Recursive feedback-like distortion - smooth scaling
        vec2 feedback_uv = chaos_uv + total_distortion * 0.5;
        float feedback_noise = fract(sin(dot(feedback_uv * 43.0, vec2(12.9898, 78.233))) * 43758.5453);
        total_distortion += vec2(
          sin(feedback_noise * 6.28 + time * 8.0) * intensity * 0.05,
          cos(feedback_noise * 6.28 + time * 9.2) * intensity * 0.05
        );
        
        // Layer 7: Chromatic separation zones - smooth zone scaling
        float chroma_zone = floor(chaos_uv.x * (5.0 + intensity * 15.0)) + floor(chaos_uv.y * (5.0 + intensity * 15.0));
        float chroma_phase = chroma_zone * 2.1 + time * 3.0;
        vec2 chroma_distort = vec2(
          sin(chroma_phase) * intensity * 0.03,
          cos(chroma_phase * 1.3) * intensity * 0.03
        );

        // Layer 8: Scanline banding — horizontal strips shifted independently
        // Time is quantized so strips snap rather than drift, giving a digital-corruption feel
        float strip_count = floor(20.0 + intensity * 60.0);
        float strip_id = floor(chaos_uv.y * strip_count);
        float t_snap = floor(time * 10.0);
        float band_hash = fract(sin(dot(vec2(strip_id, t_snap),       vec2(127.1, 311.7))) * 43758.5453);
        float band_amt  = fract(sin(dot(vec2(strip_id, t_snap + 5.1), vec2(269.5, 183.3))) * 43758.5453);
        // At low intensity few strips fire; at high intensity most do
        float band_active = step(mix(0.92, 0.45, intensity), band_hash);
        total_distortion.x += (band_amt - 0.5) * intensity * 0.5 * band_active;

        // Final UV with all distortions applied
        vec2 final_distorted_uv = chaos_uv + total_distortion + chroma_distort;
        
        // SMOOTH transition between wrapped and unwrapped UV coordinates
        // Instead of hard cut at 0.8, use smooth mix from 0.7 to 0.9 intensity
        vec2 wrapped_uv = fract(final_distorted_uv);
        vec2 unwrapped_uv = final_distorted_uv;
        
        // Smooth transition factor: 0.0 at intensity 0.7, 1.0 at intensity 0.9
        float chaos_factor = smoothstep(0.7, 0.9, intensity);
        uv = mix(wrapped_uv, unwrapped_uv, chaos_factor);
      }
    `
  },

  [ShaderEffect.KALEIDOSCOPE]: {
    stage: 'mapping',
    glsl: `
      {
        // Center the coordinates and add time-based rotation
        vec2 center = vec2(0.5, 0.5);
        vec2 c = (uv - center) * 1.5; // 1.5x zoom to see more of the image
        
        // Add gentle rotation over time
        float rotation = u_time * 0.1;
        float cosR = cos(rotation);
        float sinR = sin(rotation);
        c = vec2(c.x * cosR - c.y * sinR, c.x * sinR + c.y * cosR);
        
        // More slices for complexity and beauty
        float slices = 10.0;
        float r = length(c);
        float a = atan(c.y, c.x);
        
        // Create the kaleidoscope mirroring
        float slice = 2.0 * 3.14159265 / slices;
        a = mod(a, slice);
        
        // Mirror every other slice for more interesting patterns
        if (mod(floor(atan(c.y, c.x) / slice), 2.0) > 0.5) {
          a = slice - a;
        }
        
        // Reconstruct coordinates with better scaling
        vec2 kaleidoCoord = vec2(cos(a), sin(a)) * r * 0.8; // 0.8 scale for better fit
        
        // Offset the sampling area to get more interesting parts of the image
        // Sample from upper area where face usually is, not dead center
        uv = kaleidoCoord + vec2(0.5, 0.4);
        
        // Keep UV in bounds with wrapping for seamless effect
        uv = fract(uv);
      }
    `
  },

  [ShaderEffect.DISPLACE]: {
    stage: 'mapping',
    intensity: 1.0,
    glsl: `
      {
        // Map intensity (0-1) to displacement strength: higher intensity = more displacement
        float t = u_time * 0.2;
        float displaceAmount = u_intensity_DISPLACE * 0.08; // 0->0, 1->0.08
        
        vec2 displaced_uv = uv;
        displaced_uv.x += (sin((uv.y+t)*10.0)*0.5+0.5)*displaceAmount;
        displaced_uv.y += (sin((uv.x+t)*10.0)*0.5+0.5)*displaceAmount;
        
        uv = mix(uv, displaced_uv, u_intensity_DISPLACE);
      }
    `
  },

  [ShaderEffect.SWIRL]: {
    stage: 'mapping',
    glsl: `
      {
        // Convert time to beats and make the cycle last exactly 8 beats
        float beatTime = (u_time * u_bpm) / 60.0;
        
        vec2 c = uv*2.0-1.0;
        float r = length(c);
        float a = atan(c.y,c.x) + r*3.0*sin(beatTime * 0.78539816339); // 0.78539816339 = PI/4
        uv = (vec2(cos(a),sin(a)) * r + 1.0) * 0.5;
      }
    `
  },

  [ShaderEffect.CHROMA]: {
    stage: 'color',
    intensity: 1.0,
    glsl: `
      {
        float off = 0.01;
        vec3 chromaDiff = vec3(
          texture2D(u_image, uv+vec2(off,0)).r - color.r,
          0.0,
          texture2D(u_image, uv-vec2(off,0)).b - color.b
        );
        color.rgb += chromaDiff * u_intensity_CHROMA;
      }
    `
  },

  [ShaderEffect.PIXELATE]: {
    stage: 'mapping',
    intensity: 1.0,
    glsl: `
      {
        // Map intensity (0-1) to pixel size: higher intensity = bigger pixels (more pixelation)
        float px = 200.0 - (u_intensity_PIXELATE * 190.0); // 0->200, 1->10
        vec2 pixelated_uv = floor(uv * px) / px;
        uv = mix(uv, pixelated_uv, u_intensity_PIXELATE);
      }
    `
  },

  [ShaderEffect.VORONOI]: {
    stage: 'mapping',
    intensity: 1.0,
    glsl: `
      {
        // Map intensity (0-1) to cell density: higher intensity = more cells (more distortion)
        float cellDensity = 5.0 + (u_intensity_VORONOI * 15.0); // 0->5, 1->20
        
        vec2 cell = floor(uv * cellDensity);
        vec2 f    = fract(uv * cellDensity);
        float jx = fract(sin(dot(cell,vec2(12.9898,78.233)))*43758.5453);
        float jy = fract(sin(dot(cell,vec2(93.9898,67.345)))*24634.6345);
        vec2 voronoi_uv = (cell + vec2(jx,jy) + f) / cellDensity;
        
        uv = mix(uv, voronoi_uv, u_intensity_VORONOI);
      }
    `
  },

  [ShaderEffect.RIPPLE]: {
    stage: 'color',
    intensity: 1.0,
    glsl: `
      {
        float d = length(uv - 0.5);
        float wave = sin((d - u_time*0.5)*30.0);
        color.rgb += wave * 0.2 * u_intensity_RIPPLE;
      }
    `
  },

  [ShaderEffect.FEEDBACK_ECHO]: {
    stage: 'feedback',
    intensity: 1.0,
    glsl: `
      {
        vec2 c = uv - 0.5;
        float beatTime = (u_time * u_bpm) / 60.0;
        float rot = beatTime * 0.019635;
        float cosR = cos(rot);
        float sinR = sin(rot);
        c = vec2(c.x * cosR - c.y * sinR, c.x * sinR + c.y * cosR);
        c *= 1.0 + 0.005 * u_intensity_FEEDBACK_ECHO;
        vec4 history = texture2D(u_history, clamp(c + 0.5, 0.0, 1.0));
        color = mix(color, history, mix(0.5, 0.95, u_intensity_FEEDBACK_ECHO));
      }
    `
  },

  [ShaderEffect.PALETTE_CYCLING]: {
    stage: 'color',
    intensity: 1.0,
    glsl: `
      {
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float t = luma + u_time * 0.2;
        vec3 pal = vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
        color.rgb = mix(color.rgb, pal, u_intensity_PALETTE_CYCLING);
      }
    `
  },

  [ShaderEffect.CONTOUR]: {
    stage: 'color',
    intensity: 1.0,
    glsl: `
      {
        float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float freq = mix(8.0, 40.0, u_intensity_CONTOUR);
        float bands = sin(luma * freq * 3.14159);
        float line = 1.0 - smoothstep(0.0, 0.15, abs(bands));
        float hue = luma * 4.0 + u_time * 0.3;
        vec3 lineColor = vec3(
          0.5 + 0.5 * cos(hue),
          0.5 + 0.5 * cos(hue + 2.094),
          0.5 + 0.5 * cos(hue + 4.189)
        );
        color.rgb = mix(color.rgb, lineColor, line);
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
