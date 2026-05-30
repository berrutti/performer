// The TypeScript DOM lib includes WebGPU interfaces but not the runtime
// constant objects. Declare only what is missing.

declare const GPUBufferUsage: {
  VERTEX: number;
  UNIFORM: number;
  COPY_DST: number;
  COPY_SRC: number;
};

declare const GPUTextureUsage: {
  TEXTURE_BINDING: number;
  RENDER_ATTACHMENT: number;
  COPY_SRC: number;
  COPY_DST: number;
};

declare const GPUShaderStage: {
  VERTEX: number;
  FRAGMENT: number;
  COMPUTE: number;
};
