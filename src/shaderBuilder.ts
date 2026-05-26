import { ShaderEffect, shaderEffects } from './utils';

// Vertex shader used for all passes
export const multiPassVertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

// Passthrough shader for copying textures between passes
export function createPassthroughShader(): string {
  return `
    precision mediump float;
    uniform sampler2D u_image;
    varying vec2 v_texCoord;
    
    void main() {
      gl_FragColor = texture2D(u_image, v_texCoord);
    }
  `;
}

// Create individual effect shader for multi-pass rendering
export function createEffectShader(effect: ShaderEffect): string {
  const effectDef = shaderEffects[effect];
  const hasIntensity = effectDef.intensity !== undefined;

  const intensityUniform = hasIntensity ? `uniform float u_intensity_${effect};` : '';
  const bpmSyncUniform = effectDef.bpmSync ? `uniform float u_bpm_sync_${effect};` : '';

  if (effectDef.stage === 'feedback') {
    return `
      precision mediump float;
      uniform sampler2D u_image;
      uniform sampler2D u_history;
      uniform float u_time;
      uniform float u_bpm;
      ${intensityUniform}
      ${bpmSyncUniform}
      varying vec2 v_texCoord;

      void main() {
        vec2 uv = v_texCoord;
        vec4 color = texture2D(u_image, uv);

        ${effectDef.glsl}

        gl_FragColor = color;
      }
    `;
  }

  if (effectDef.stage === 'mapping') {
    return `
      precision mediump float;
      uniform sampler2D u_image;
      uniform float u_time;
      uniform float u_bpm;
      ${intensityUniform}
      ${bpmSyncUniform}
      varying vec2 v_texCoord;

      void main() {
        vec2 uv = v_texCoord;

        ${effectDef.glsl}

        gl_FragColor = texture2D(u_image, uv);
      }
    `;
  } else {
    return `
      precision mediump float;
      uniform sampler2D u_image;
      uniform float u_time;
      uniform float u_bpm;
      ${intensityUniform}
      ${bpmSyncUniform}
      varying vec2 v_texCoord;

      void main() {
        vec2 uv = v_texCoord;
        vec4 color = texture2D(u_image, uv);

        ${effectDef.glsl}

        gl_FragColor = color;
      }
    `;
  }
}

// Create shader for the initial video sampling pass (preserves aspect ratio)
export function createVideoSamplingShader(): string {
  return `
    precision mediump float;
    uniform sampler2D u_image;
    varying vec2 v_texCoord;
    
    void main() {
      // v_texCoord here uses the aspect-ratio-corrected coordinates
      // from getTextureCoordinates(), ensuring no warping
      gl_FragColor = texture2D(u_image, v_texCoord);
    }
  `;
}
