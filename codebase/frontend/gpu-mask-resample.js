(function () {
  'use strict';
  const PASS_LAYOUTS = ((typeof window !== "undefined" && window.HDRGpuPassLayouts)
    || (typeof module !== "undefined" && module.exports && require("./gpu-param-layout.js").HDRGpuPassLayouts));
  const MASK_PARAMS = PASS_LAYOUTS.indices;
  // Export warps a finished source-space mask through straighten/perspective
  // with Pillow's bicubic. This reproduces that step for one output region:
  // byte levels in, the same four-by-four kernel, the same clip to the whole
  // mask's range, byte levels out.
  const SHADER = `
    fn resampleLevel(at: vec2i) -> f32 {
      let size = vec2i(textureDimensions(sourceTexture));
      return round(clamp(textureLoad(sourceTexture, clamp(at, vec2i(0), size - 1), 0).r, 0.0, 1.0) * 255.0);
    }
    fn pillowCubic(a: f32, b: f32, c: f32, d: f32, t: f32) -> f32 {
      return b + t * ((c - a) + t * ((2.0 * (a - b) + c - d) + t * (b - a - c + d)));
    }
    @fragment fn maskResampleFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let at = floor(input.position.xy) + .5;
      let divisor = p[${MASK_PARAMS.RESAMPLE.MATRIX_20}] * at.x + p[${MASK_PARAMS.RESAMPLE.MATRIX_21}] * at.y + p[${MASK_PARAMS.RESAMPLE.MATRIX_22}];
      let sx = (p[${MASK_PARAMS.RESAMPLE.MATRIX_00}] * at.x + p[${MASK_PARAMS.RESAMPLE.MATRIX_01}] * at.y + p[${MASK_PARAMS.RESAMPLE.MATRIX_02}]) / divisor - .5;
      let sy = (p[${MASK_PARAMS.RESAMPLE.MATRIX_10}] * at.x + p[${MASK_PARAMS.RESAMPLE.MATRIX_11}] * at.y + p[${MASK_PARAMS.RESAMPLE.MATRIX_12}]) / divisor - .5;
      let base = vec2i(i32(floor(sx)), i32(floor(sy)));
      let t = vec2f(sx - floor(sx), sy - floor(sy));
      var rows: array<f32, 4>;
      for (var j = 0; j < 4; j++) {
        let y = base.y + j - 1;
        rows[j] = pillowCubic(resampleLevel(vec2i(base.x - 1, y)), resampleLevel(vec2i(base.x, y)),
          resampleLevel(vec2i(base.x + 1, y)), resampleLevel(vec2i(base.x + 2, y)), t.x);
      }
      let value = clamp(pillowCubic(rows[0], rows[1], rows[2], rows[3], t.y), p[${MASK_PARAMS.RESAMPLE.MINIMUM}], p[${MASK_PARAMS.RESAMPLE.MAXIMUM}]);
      return vec4f(vec3f(round(clamp(value, 0.0, 255.0)) / 255.0), 1.0);
    }
    // One rectangle of a larger mask, texel for texel; p[${MASK_PARAMS.CROP.ORIGIN_X}], p[${MASK_PARAMS.CROP.ORIGIN_Y}] its origin.
    @fragment fn maskCropFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let size = vec2i(textureDimensions(sourceTexture));
      let at = clamp(vec2i(floor(input.position.xy)) + vec2i(i32(p[${MASK_PARAMS.CROP.ORIGIN_X}]), i32(p[${MASK_PARAMS.CROP.ORIGIN_Y}])), vec2i(0), size - 1);
      return vec4f(vec3f(textureLoad(sourceTexture, at, 0).r), 1.0);
    }`;

  function pipelines(renderer) {
    const d = renderer.device;
    if (renderer.maskResampleDevice !== d) {
      const module = d.createShaderModule({ code: window.HDRWebGPUShaders.LUMA_MASK_SHADER_SOURCE + SHADER });
      const make = entryPoint => d.createRenderPipeline({ layout: renderer.maskPipelineLayout,
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint, targets: [{ format: 'r16float' }] },
        primitive: { topology: 'triangle-list' } });
      renderer.maskResamplePipeline = make('maskResampleFragmentMain');
      renderer.maskCropPipeline = make('maskCropFragmentMain');
      renderer.maskResampleDevice = d;
    }
    return renderer;
  }
  const pipeline = renderer => pipelines(renderer).maskResamplePipeline;
  const cropPipeline = renderer => pipelines(renderer).maskCropPipeline;

  /** The oriented source rectangle one output rectangle samples, with the
   * kernel's reach, clipped to the frame. A projective image of a rectangle
   * is bounded by its corners.
   */
  function sourceRect(recipe, rect) {
    const sample = window.HDRGeometryResample.sample;
    const points = [[rect.x, rect.y], [rect.x + rect.width - 1, rect.y],
      [rect.x, rect.y + rect.height - 1], [rect.x + rect.width - 1, rect.y + rect.height - 1]]
      .map(([x, y]) => sample(recipe, x, y));
    if (points.some(point => !point.every(Number.isFinite))) return null;
    const x = Math.max(0, Math.floor(Math.min(...points.map(point => point[0]))) - 3);
    const y = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))) - 3);
    const right = Math.min(recipe.orientedWidth, Math.ceil(Math.max(...points.map(point => point[0]))) + 3);
    const bottom = Math.min(recipe.orientedHeight, Math.ceil(Math.max(...points.map(point => point[1]))) + 3);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  /** Coefficients re-origined in double precision to the output rectangle
   * and the source texture, so the shader's float32 terms stay small.
   */
  function parameters(recipe, rect, source, extent) {
    const k = recipe.coefficients, ox = rect.x + recipe.offsetX, oy = rect.y + recipe.offsetY;
    const divisor = k[6] * ox + k[7] * oy + 1;
    const axis = (a, b, c, origin) => [a - origin * k[6], b - origin * k[7], a * ox + b * oy + c - origin * divisor];
    const x = axis(k[0], k[1], k[2], source.x), y = axis(k[3], k[4], k[5], source.y);
    return new Float32Array(PASS_LAYOUTS.record("RESAMPLE", { MATRIX_00: x[0], MATRIX_01: x[1], MATRIX_02: x[2], MATRIX_10: y[0], MATRIX_11: y[1], MATRIX_12: y[2], MATRIX_20: k[6], MATRIX_21: k[7], MATRIX_22: divisor, MINIMUM: extent.min, MAXIMUM: extent.max }));
  }

  window.HDRGpuMaskResample = Object.freeze({ pipeline, cropPipeline, sourceRect, parameters });
})();
