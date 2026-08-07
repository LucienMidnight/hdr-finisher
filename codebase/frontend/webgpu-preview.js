(function () {
  const PARAM_COUNT = 73;
  const CURVE_SAMPLES = 1024;

  class HDRWebGPUPreview {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = null;
      this.adapter = null;
      this.device = null;
      this.module = null;
      this.pipelines = new Map();
      this.proxies = new Map();
      this.sessionId = null;
      this.available = false;
      this.detail = "WebGPU has not been initialized";
      this.renderSerial = 0;
    }

    async initialize() {
      if (!navigator.gpu) {
        this.detail = "WebGPU is unavailable in this browser";
        return false;
      }
      try {
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!this.adapter) throw new Error("No WebGPU adapter was returned");
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) throw new Error("The WebGPU canvas context is unavailable");
        this.module = this.device.createShaderModule({ code: SHADER_SOURCE });
        const compilation = await this.module.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
        this.device.lost.then((info) => {
          this.available = false;
          this.detail = `WebGPU device lost: ${info.message || info.reason}`;
        });
        this.available = true;
        this.detail = "WebGPU draft renderer ready";
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        return false;
      }
    }

    resetSession(sessionId = null) {
      this.sessionId = sessionId;
      for (const proxy of this.proxies.values()) proxy.texture?.destroy();
      this.proxies.clear();
    }

    async render(sessionId, lane, adjustments, curveSampler, longEdge = 1600) {
      if (!this.available || !sessionId) return false;
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      const serial = ++this.renderSerial;
      const proxy = await this.loadProxy(sessionId, lane, longEdge);
      if (serial !== this.renderSerial || !proxy) return false;

      this.canvas.width = proxy.width;
      this.canvas.height = proxy.height;
      const surface = this.configureSurface(lane === "hdr");
      const pipeline = this.pipelineFor(surface.format);
      const params = buildParams(lane, adjustments, proxy.workingSpace, surface.hdr);
      const curves = buildCurves(lane, adjustments, curveSampler);
      const paramBuffer = this.createStorageBuffer(params);
      const curveBuffer = this.createStorageBuffer(curves);
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: proxy.texture.createView() },
          { binding: 1, resource: { buffer: paramBuffer } },
          { binding: 2, resource: { buffer: curveBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.device.queue.onSubmittedWorkDone().finally(() => {
        paramBuffer.destroy();
        curveBuffer.destroy();
      });
      return { width: proxy.width, height: proxy.height, hdr: surface.hdr };
    }

    configureSurface(wantsHdr) {
      const hdrDisplay = Boolean(window.matchMedia?.("(dynamic-range: high)").matches);
      if (wantsHdr && hdrDisplay) {
        try {
          const format = "rgba16float";
          this.context.configure({
            device: this.device,
            format,
            colorSpace: "display-p3",
            toneMapping: { mode: "extended" },
            alphaMode: "opaque",
          });
          return { format, hdr: true };
        } catch {
          // Older WebGPU implementations still provide a fast SDR draft.
        }
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format, colorSpace: "srgb", alphaMode: "opaque" });
      return { format, hdr: false };
    }

    pipelineFor(format) {
      if (this.pipelines.has(format)) return this.pipelines.get(format);
      const pipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      this.pipelines.set(format, pipeline);
      return pipeline;
    }

    createStorageBuffer(values) {
      const size = Math.max(16, Math.ceil(values.byteLength / 4) * 4);
      const buffer = this.device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buffer, 0, values);
      return buffer;
    }

    async loadProxy(sessionId, lane, longEdge) {
      const key = `${sessionId}:${lane}:${longEdge}`;
      if (this.proxies.has(key)) return this.proxies.get(key);
      const response = await fetch(`/api/session/${sessionId}/proxy/${lane}?long_edge=${longEdge}`);
      if (!response.ok) throw new Error("WebGPU proxy could not be loaded");
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
      const workingSpace = response.headers.get("X-Working-Space") || "acescg";
      const data = await response.arrayBuffer();
      const texture = this.device.createTexture({
        size: { width, height },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture },
        data,
        { offset: 0, bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const proxy = { texture, width, height, workingSpace };
      this.proxies.set(key, proxy);
      return proxy;
    }
  }

  const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ACESCG_PRIMARIES = [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]];
  const ACESCG_WHITE = [0.32168, 0.33767];

  function multiply3x3(left, right) {
    const output = new Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let inner = 0; inner < 3; inner += 1) output[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
    return output;
  }

  function invert3x3(matrix) {
    const [a, b, c, d, e, f, g, h, i] = matrix;
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) return null;
    return [
      e * i - f * h, c * h - b * i, b * f - c * e,
      f * g - d * i, a * i - c * g, c * d - a * f,
      d * h - e * g, b * g - a * h, a * e - b * d,
    ].map((value) => value / determinant);
  }

  function rgbToXyzMatrix(primaries, white) {
    const unscaled = [
      primaries[0][0] / primaries[0][1], primaries[1][0] / primaries[1][1], primaries[2][0] / primaries[2][1],
      1, 1, 1,
      (1 - primaries[0][0] - primaries[0][1]) / primaries[0][1],
      (1 - primaries[1][0] - primaries[1][1]) / primaries[1][1],
      (1 - primaries[2][0] - primaries[2][1]) / primaries[2][1],
    ];
    const inverse = invert3x3(unscaled);
    if (!inverse) return null;
    const whiteXyz = [white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]];
    const scales = [0, 1, 2].map((row) => inverse[row * 3] * whiteXyz[0] + inverse[row * 3 + 1] * whiteXyz[1] + inverse[row * 3 + 2] * whiteXyz[2]);
    return unscaled.map((value, index) => value * scales[index % 3]);
  }

  function rayTriangleDistance(origin, direction, triangle) {
    let nearest = Infinity;
    for (let index = 0; index < 3; index += 1) {
      const start = triangle[index];
      const end = triangle[(index + 1) % 3];
      const edge = [end[0] - start[0], end[1] - start[1]];
      const determinant = direction[1] * edge[0] - direction[0] * edge[1];
      if (Math.abs(determinant) < 1e-12) continue;
      const delta = [start[0] - origin[0], start[1] - origin[1]];
      const distance = (edge[0] * delta[1] - edge[1] * delta[0]) / determinant;
      const edgePosition = (direction[0] * delta[1] - direction[1] * delta[0]) / determinant;
      if (distance >= -1e-9 && edgePosition >= -1e-9 && edgePosition <= 1 + 1e-9) nearest = Math.min(nearest, Math.max(0, distance));
    }
    return Number.isFinite(nearest) ? nearest : Math.hypot(triangle[0][0] - origin[0], triangle[0][1] - origin[1]);
  }

  function rotateScalePrimary(reference, hueDegrees, purityScale) {
    const baseAngle = Math.atan2(reference[1] - ACESCG_WHITE[1], reference[0] - ACESCG_WHITE[0]);
    const angle = baseAngle + hueDegrees * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const distance = rayTriangleDistance(ACESCG_WHITE, direction, ACESCG_PRIMARIES);
    return [ACESCG_WHITE[0] + direction[0] * distance * purityScale, ACESCG_WHITE[1] + direction[1] * distance * purityScale];
  }

  function rgbPrimariesAdjustmentMatrix(branch) {
    const customPrimaries = ACESCG_PRIMARIES.map((primary, index) => {
      const channel = ["red", "green", "blue"][index];
      const hue = Number(branch?.[`${channel}_hue`]) || 0;
      const purity = Math.max(0.01, 1 + (Number(branch?.[`${channel}_purity`]) || 0) / 100);
      return rotateScalePrimary(primary, hue, purity);
    });
    const tintHue = Number(branch?.tint_hue) || 0;
    const tintPurity = Math.min(0.99, Math.max(0, (Number(branch?.tint_purity) || 0) / 100));
    const customWhite = rotateScalePrimary(ACESCG_PRIMARIES[0], tintHue, tintPurity);
    const base = rgbToXyzMatrix(ACESCG_PRIMARIES, ACESCG_WHITE);
    const custom = rgbToXyzMatrix(customPrimaries, customWhite);
    const inverseBase = base && invert3x3(base);
    if (!custom || !inverseBase) return IDENTITY_3X3;
    const adjustment = multiply3x3(inverseBase, custom);
    return adjustment.every((value) => Number.isFinite(value) && Math.abs(value) <= 64) ? adjustment : IDENTITY_3X3;
  }

  function colorSettingsNeutral(branch) {
    if ((Number(branch?.white_balance_kelvin) || 6500) !== 6500) return false;
    return [
      "tint", "saturation", "vibrance",
      "red_hue", "red_purity", "green_hue", "green_purity",
      "blue_hue", "blue_purity", "tint_hue", "tint_purity",
    ].every((name) => Math.abs(Number(branch?.[name]) || 0) < 0.000001);
  }

  function buildParams(lane, adjustments, workingSpace, hdrSurface) {
    const params = new Float32Array(PARAM_COUNT);
    const branch = adjustments[lane];
    const followsHdrColor = lane === "sdr" && branch.match_hdr_color !== false;
    const colorSource = followsHdrColor ? adjustments.hdr : branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false && (!followsHdrColor || adjustments.hdr.color_section_enabled !== false);
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    const baseEnabled = lane !== "sdr" || branch.base_section_enabled !== false;
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = toneEnabled ? (lane === "hdr" ? branch.highlight_rolloff || 0 : branch.highlight_recovery || 0) : 0;
    params[4] = toneEnabled ? (lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0) : 0;
    params[5] = primariesEnabled ? branch.lift || 0 : 0;
    params[6] = primariesEnabled ? branch.gamma || 0 : 0;
    params[7] = primariesEnabled ? branch.gain || 0 : 0;
    params[8] = toneEnabled ? branch.contrast || 0 : 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = colorActive ? colorSource.white_balance_kelvin || 6500 : 6500;
    params[11] = colorActive ? colorSource.tint || 0 : 0;
    params[12] = baseEnabled ? (branch.tone_mapper === "aces" ? 1 : branch.tone_mapper === "reinhard" ? 2 : 0) : 0;
    params[13] = baseEnabled ? branch.tone_contrast ?? 1 : 1;
    params[14] = baseEnabled ? branch.tone_skew || 0 : 0;
    params[15] = branch.curves_enabled && branch.curves_section_enabled !== false ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The PQ preview/export transport tops out at 10,000 nits while the app's
    // scene-linear 0.18 reference maps to 100 nits.
    params[17] = 18;
    params[18] = lane === "hdr" && branch.tone_equalizer_enabled && branch.tone_equalizer_section_enabled !== false ? 1 : 0;
    params[19] = lane === "hdr" ? Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5)) : 0;
    const toneNodes = normalizedToneEqualizerNodes(branch.tone_equalizer_nodes);
    params[20] = lane === "hdr" ? toneNodes.length : 0;
    toneNodes.forEach((node, index) => {
      params[21 + index] = lane === "hdr" ? node.input_ev : 0;
      params[37 + index] = lane === "hdr" ? node.adjustment_ev : 0;
    });
    params[53] = lane === "hdr" ? ((branch.highlight_rolloff_start_nits ?? 400) * 0.18 / 100) : 0;
    params[54] = branch.lift_pivot ?? -2;
    params[55] = branch.lift_range ?? 4;
    params[56] = branch.gamma_pivot ?? 0;
    params[57] = branch.gamma_range ?? 4.25;
    params[58] = branch.gain_pivot ?? 2;
    params[59] = branch.gain_range ?? 4;
    params[60] = baseEnabled ? 1 : 0;
    const colorMatrix = colorActive ? rgbPrimariesAdjustmentMatrix(colorSource) : IDENTITY_3X3;
    colorMatrix.forEach((value, index) => { params[61 + index] = value; });
    params[70] = colorActive ? colorSource.saturation || 0 : 0;
    params[71] = colorActive ? colorSource.vibrance || 0 : 0;
    params[72] = colorActive ? 1 : 0;
    return params;
  }

  function normalizedToneEqualizerNodes(values) {
    const source = Array.isArray(values) && values.length >= 2
      ? values.slice(0, 16)
      : [-6, -3, 0, 3, 6].map((inputEv) => ({ input_ev: inputEv, adjustment_ev: 0 }));
    const nodes = source.map((node) => ({
      input_ev: Math.min(6, Math.max(-6, Number(node?.input_ev) || 0)),
      adjustment_ev: Math.min(2, Math.max(-2, Number(node?.adjustment_ev) || 0)),
    })).sort((left, right) => left.input_ev - right.input_ev);
    nodes[0].input_ev = -6;
    nodes[nodes.length - 1].input_ev = 6;
    const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
    for (let index = 1; index < targets.length; index += 1) {
      targets[index] = Math.max(targets[index], targets[index - 1] + 0.001);
    }
    nodes.forEach((node, index) => { node.adjustment_ev = Math.min(2, Math.max(-2, targets[index] - node.input_ev)); });
    return nodes;
  }

  function buildCurves(lane, adjustments, curveSampler) {
    const branch = adjustments[lane];
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    ["luma_curve", "red_curve", "green_curve", "blue_curve"].forEach((name, channel) => {
      const samples = curveSampler(branch[name], CURVE_SAMPLES);
      for (let index = 0; index < CURVE_SAMPLES; index += 1) {
        const sample = samples[index];
        packed[channel * CURVE_SAMPLES + index] = Array.isArray(sample) ? sample[1] : sample;
      }
    });
    return packed;
  }

  window.HDRWebGPUPreview = HDRWebGPUPreview;

  const SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var<storage, read> curveLuts: array<f32>;

    struct VertexOut { @builtin(position) position: vec4f }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      return output;
    }

    fn lumaAces(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895)); }
    fn lumaSrgb(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    fn smoothRange(a: f32, b: f32, v: f32) -> f32 {
      let t = clamp((v - a) / max(b - a, 0.000001), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }
    fn curveValue(channel: u32, value: f32) -> f32 {
      let base = channel * 1024u;
      if (value < 0.0) {
        let slope = (curveLuts[base + 1u] - curveLuts[base]) * 1023.0;
        return curveLuts[base] + value * slope;
      }
      if (value > 1.0) {
        let slope = (curveLuts[base + 1023u] - curveLuts[base + 1022u]) * 1023.0;
        return curveLuts[base + 1023u] + (value - 1.0) * slope;
      }
      let location = clamp(value, 0.0, 1.0) * 1023.0;
      let lower = u32(floor(location));
      let upper = min(lower + 1u, 1023u);
      let amount = fract(location);
      return mix(curveLuts[base + lower], curveLuts[base + upper], amount);
    }
    fn curveEncodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value / 0.36; }
      if (value <= 0.18) { return 0.5 * value / 0.18; }
      return 0.5 + 0.5 * log2(value / 0.18) / log2(100.0);
    }
    fn curveDecodeChannel(value: f32) -> f32 {
      if (value <= 0.5) { return value * 0.36; }
      return 0.18 * exp2((value - 0.5) * 2.0 * log2(100.0));
    }
    fn curveEncode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveEncodeChannel(rgb.r), curveEncodeChannel(rgb.g), curveEncodeChannel(rgb.b));
    }
    fn curveDecode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveDecodeChannel(rgb.r), curveDecodeChannel(rgb.g), curveDecodeChannel(rgb.b));
    }
    fn applyCurves(input: vec3f, hdr: bool) -> vec3f {
      if (p[15] < 0.5) { return input; }
      var rgb = curveEncode(input, hdr);
      let sourceLuma = select(lumaSrgb(rgb), lumaAces(rgb), hdr);
      let mappedLuma = curveValue(0u, sourceLuma);
      if (abs(sourceLuma) > 0.00001) { rgb *= mappedLuma / sourceLuma; }
      for (var channel = 0u; channel < 3u; channel++) {
        let value = rgb[channel];
        rgb[channel] = curveValue(channel + 1u, value);
      }
      return curveDecode(rgb, hdr);
    }
    fn acescgToSrgb(rgb: vec3f) -> vec3f {
      return vec3f(
        1.7048873310 * rgb.r - 0.6241572745 * rgb.g - 0.0808867739 * rgb.b,
       -0.1295209353 * rgb.r + 1.1383993260 * rgb.g - 0.0087792418 * rgb.b,
       -0.0241270599 * rgb.r - 0.1246206123 * rgb.g + 1.1488221099 * rgb.b
      );
    }
    fn srgbToAcescg(rgb: vec3f) -> vec3f {
      return vec3f(
        0.6130974024 * rgb.r + 0.3395231366 * rgb.g + 0.0473794610 * rgb.b,
        0.0701937225 * rgb.r + 0.9163538791 * rgb.g + 0.0134523985 * rgb.b,
        0.0206155922 * rgb.r + 0.1095697729 * rgb.g + 0.8698146349 * rgb.b
      );
    }
    fn acescgToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3793363837 * rgb.r - 0.3112868172 * rgb.g - 0.0680495665 * rgb.b,
       -0.0687964722 * rgb.r + 1.0799570656 * rgb.g - 0.0111605934 * rgb.b,
       -0.0022666792 * rgb.r - 0.0417050150 * rgb.g + 1.0439716942 * rgb.b
      );
    }
    fn acescgToBt2020(rgb: vec3f) -> vec3f {
      return vec3f(
        1.0260187082 * rgb.r - 0.0221655448 * rgb.g - 0.0038531634 * rgb.b,
       -0.0017230808 * rgb.r + 1.0023190716 * rgb.g - 0.0005959908 * rgb.b,
       -0.0051099278 * rgb.r - 0.0216355504 * rgb.g + 1.0267454781 * rgb.b
      );
    }
    fn bt2020ToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3435782526 * rgb.r - 0.2821796705 * rgb.g - 0.0613985821 * rgb.b,
       -0.0652974528 * rgb.r + 1.0757879158 * rgb.g - 0.0104904631 * rgb.b,
        0.0028217873 * rgb.r - 0.0195984945 * rgb.g + 1.0167767073 * rgb.b
      );
    }
    fn compressSrgbGamut(input: vec3f) -> vec3f {
      let y = clamp(lumaSrgb(input), 0.0, 1.0);
      let minimum = min(input.r, min(input.g, input.b));
      let maximum = max(input.r, max(input.g, input.b));
      var scale = 1.0;
      if (minimum < 0.0) { scale = min(scale, y / max(y - minimum, 0.00000001)); }
      if (maximum > 1.0) { scale = min(scale, (1.0 - y) / max(maximum - y, 0.00000001)); }
      return clamp(vec3f(y) + (input - vec3f(y)) * clamp(scale, 0.0, 1.0), vec3f(0.0), vec3f(1.0));
    }
    fn whiteBalance(input: vec3f) -> vec3f {
      let offset = (p[10] - 6500.0) / 6500.0;
      return input * vec3f(1.0 + offset * 0.15, 1.0 + p[11] * 0.08, 1.0 - offset * 0.15);
    }
    fn hdrColor(input: vec3f) -> vec3f {
      let rgb = vec3f(
        p[61] * input.r + p[62] * input.g + p[63] * input.b,
        p[64] * input.r + p[65] * input.g + p[66] * input.b,
        p[67] * input.r + p[68] * input.g + p[69] * input.b
      );
      let y = lumaAces(rgb);
      let neutral = vec3f(y);
      let chroma = rgb - neutral;
      let maximum = max(rgb.r, max(rgb.g, rgb.b));
      let minimum = min(rgb.r, min(rgb.g, rgb.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      let vibranceFactor = max(0.0, 1.0 + p[71] * vibranceWeight);
      let saturationFactor = max(0.0, 1.0 + p[70]);
      return neutral + chroma * vibranceFactor * saturationFactor;
    }
    fn hdrBase(input: vec3f) -> vec3f {
      var rgb = input * exp2(p[2]);
      let y = max(lumaAces(rgb), 0.0);
      let start = max(p[53], 0.000001);
      if (p[3] > 0.0 && y > start) {
        let amount = p[3] / 50.0;
        let targetValue = start + log(1.0 + amount * (y - start)) / amount;
        rgb *= targetValue / max(y, 0.00000001);
      }
      if (p[4] != 0.0) {
        let lift = min(p[4] * (1.0 - clamp(lumaAces(rgb), 0.0, 1.0)), 1.0);
        rgb *= 1.0 + lift;
      }
      return rgb;
    }
    fn hdrContrast(input: vec3f) -> vec3f {
      if (p[8] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      let targetStops = stops * exp2(p[8]);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn hdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      var targetStops = stops;
      targetStops += 2.0 * p[5] * (1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, stops));
      let gammaSigma = max(p[57] / 2.355, 0.1);
      targetStops += 2.0 * p[6] * exp(-0.5 * pow((stops - p[56]) / gammaSigma, 2.0));
      targetStops += 2.0 * p[7] * smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, stops);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn toneEqualizerNodeEv(index: u32) -> f32 { return p[21u + index]; }
    fn toneEqualizerTarget(index: u32) -> f32 {
      return toneEqualizerNodeEv(index) + p[37u + index];
    }
    fn toneEqualizerSlope(index: u32) -> f32 {
      let count = u32(p[20]);
      if (index == 0u) { return (toneEqualizerTarget(1u) - toneEqualizerTarget(0u)) / max(toneEqualizerNodeEv(1u) - toneEqualizerNodeEv(0u), 0.0001); }
      if (index + 1u >= count) { return (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001); }
      let previous = (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001);
      let following = (toneEqualizerTarget(index + 1u) - toneEqualizerTarget(index)) / max(toneEqualizerNodeEv(index + 1u) - toneEqualizerNodeEv(index), 0.0001);
      if (previous <= 0.0 || following <= 0.0) { return 0.0; }
      return 2.0 * previous * following / (previous + following);
    }
    fn hdrToneEqualizer(input: vec3f) -> vec3f {
      if (p[18] < 0.5) { return input; }
      let y = max(lumaAces(input), 0.0);
      if (y <= 0.00000001) { return input; }
      let inputEv = log2(max(y, 0.00000001) / 0.18);
      var targetEv = inputEv;
      let count = u32(p[20]);
      if (inputEv < -6.0) {
        targetEv += p[37];
      } else if (inputEv > 6.0) {
        targetEv += p[37u + count - 1u];
      } else {
        var segment = 0u;
        for (var index = 0u; index < 15u; index++) {
          if (index + 1u < count && inputEv >= toneEqualizerNodeEv(index + 1u)) { segment = index + 1u; }
        }
        segment = min(segment, count - 2u);
        let width = max(toneEqualizerNodeEv(segment + 1u) - toneEqualizerNodeEv(segment), 0.0001);
        let local = (inputEv - toneEqualizerNodeEv(segment)) / width;
        let y0 = toneEqualizerTarget(segment);
        let y1 = toneEqualizerTarget(segment + 1u);
        let m0 = toneEqualizerSlope(segment) * width;
        let m1 = toneEqualizerSlope(segment + 1u) * width;
        let local2 = local * local;
        let local3 = local2 * local;
        let cubic = (2.0 * local3 - 3.0 * local2 + 1.0) * y0
          + (local3 - 2.0 * local2 + local) * m0
          + (-2.0 * local3 + 3.0 * local2) * y1
          + (local3 - local2) * m1;
        let linear = mix(y0, y1, local);
        targetEv = mix(linear, cubic, clamp(p[19], 0.0, 1.0));
      }
      return input * (0.18 * exp2(clamp(targetEv, -32.0, 32.0)) / y);
    }
    fn srgbEncode(value: f32) -> f32 {
      return select(1.055 * pow(clamp(value, 0.0, 1.0), 1.0 / 2.4) - 0.055, value * 12.92, value <= 0.0031308);
    }
    fn srgbDecode(value: f32) -> f32 {
      return select(pow((clamp(value, 0.0, 1.0) + 0.055) / 1.055, 2.4), value / 12.92, value <= 0.04045);
    }
    fn displayEncodeChannel(value: f32) -> f32 {
      // Canvas colorSpace values use the nonlinear sRGB/Display-P3 transfer
      // function even when the swap-chain texture itself is floating point.
      let magnitude = abs(value);
      let encoded = select(1.055 * pow(magnitude, 1.0 / 2.4) - 0.055, magnitude * 12.92, magnitude <= 0.0031308);
      return sign(value) * encoded;
    }
    fn displayEncode(rgb: vec3f) -> vec3f {
      return vec3f(displayEncodeChannel(rgb.r), displayEncodeChannel(rgb.g), displayEncodeChannel(rgb.b));
    }
    fn sdrContrast(input: vec3f) -> vec3f {
      if (p[8] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      let targetValue = (encodedY - p[9]) * exp2(p[8] * 0.5) + p[9];
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn sdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      var targetValue = encodedY;
      let zoneStops = log2(max(encodedY, 0.000001) / 0.5);
      let shadowMask = 1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, zoneStops);
      let highlightMask = smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, zoneStops);
      let gammaSigma = max(p[57] / 2.355, 0.1);
      let midtoneMask = exp(-0.5 * pow((zoneStops - p[56]) / gammaSigma, 2.0));
      targetValue += p[5] * 0.25 * shadowMask;
      if (p[6] != 0.0) { targetValue = mix(targetValue, pow(clamp(targetValue, 0.0, 1.0), exp2(-p[6])), midtoneMask); }
      if (p[7] > 0.0) { targetValue += p[7] * highlightMask * (1.0 - targetValue); }
      if (p[7] < 0.0) { targetValue += p[7] * highlightMask * targetValue; }
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn highlightRecovery(input: vec3f) -> vec3f {
      if (p[3] <= 0.0) { return input; }
      let rgb = max(input, vec3f(0.0));
      let y = lumaSrgb(rgb);
      let amount = 0.4 * p[3];
      let targetValue = y * (1.0 + amount * 0.18) / (1.0 + amount * y);
      return select(vec3f(0.0), rgb * (targetValue / max(y, 0.00000001)), y > 0.00000001);
    }
    fn toneCurveLuma(y: f32) -> f32 {
      var mapped = 0.0;
      if (p[12] > 1.5) {
        mapped = y / (1.0 + y);
      } else if (p[12] > 0.5) {
        mapped = ((y * (2.51 * y + 0.03)) / (y * (2.43 * y + 0.59) + 0.14)) / (2.51 / 2.43);
      } else {
        let basePower = 1.1 * clamp(p[13], 0.5, 1.5);
        let shadowPower = basePower * exp2(-0.75 * clamp(p[14], -1.0, 1.0));
        let highlightPower = basePower * exp2(0.75 * clamp(p[14], -1.0, 1.0));
        let logExposure = log(max(y, 0.00000001) / 0.18);
        let localPower = mix(shadowPower, highlightPower, smoothRange(-0.5, 0.5, logExposure));
        let middleOdds = log(0.18 / 0.82);
        mapped = select(0.0, 1.0 / (1.0 + exp(-clamp(middleOdds + localPower * logExposure, -32.0, 32.0))), y > 0.0);
      }
      return clamp(mapped, 0.0, 1.0);
    }
    fn toneMap(input: vec3f) -> vec3f {
      let rgb = max(input, vec3f(0.0));
      let y = lumaAces(rgb);
      let mapped = toneCurveLuma(y);
      let scaled = select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001);
      return compressSrgbGamut(acescgToSrgb(scaled));
    }
    fn retoneMapSdrReference(input: vec3f) -> vec3f {
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      if (p[12] < 0.5 && abs(p[13] - 1.0) < 0.000001 && abs(p[14]) < 0.000001) { return rgb; }
      let y = lumaSrgb(rgb);
      let boundedY = clamp(y, 0.0000001, 0.9999999);
      let middleGray = 0.18;
      let middleOdds = log(middleGray / (1.0 - middleGray));
      let referenceOdds = log(boundedY / (1.0 - boundedY));
      let sceneY = select(0.0, middleGray * exp(clamp((referenceOdds - middleOdds) / 1.1, -32.0, 32.0)), y > 0.0);
      let mapped = toneCurveLuma(sceneY);
      return clamp(select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001), vec3f(0.0), vec3f(1.0));
    }
    fn sceneColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return hdrColor(whiteBalance(input));
    }
    fn sdrReferenceColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return compressSrgbGamut(acescgToSrgb(sceneColor(srgbToAcescg(input))));
    }
    fn renderHdr(source: vec3f) -> vec3f {
      var rgb = applyCurves(hdrPrimaries(hdrToneEqualizer(sceneColor(hdrContrast(hdrBase(source))))), true);
      if (p[16] > 0.5) {
        // Extended canvas values are relative to nominal display white. Keep the
        // app's 0.18 scene-linear reference near 100 nits on a 203-nit canvas.
        // Clamp in BT.2020 before converting to P3, exactly as the PQ encoder
        // does, so exposed highlights do not change at the settled handoff.
        let transportRgb = clamp(acescgToBt2020(rgb), vec3f(0.0), vec3f(p[17]));
        return bt2020ToP3(transportRgb) * (100.0 / 203.0) / 0.18;
      }
      let display = max(acescgToSrgb(rgb), vec3f(0.0));
      return display / (vec3f(1.0) + display);
    }
    fn renderSdr(source: vec3f) -> vec3f {
      var rgb: vec3f;
      if (p[1] > 0.5) {
        rgb = clamp(source, vec3f(0.0), vec3f(1.0)) * exp2(p[2]);
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaSrgb(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        if (p[60] > 0.5) { rgb = retoneMapSdrReference(rgb); }
        rgb = applyCurves(sdrPrimaries(sdrReferenceColor(sdrContrast(highlightRecovery(rgb)))), false);
      } else {
        rgb = max(source * exp2(p[2]), vec3f(0.0));
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaAces(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        rgb = applyCurves(sdrPrimaries(sdrContrast(highlightRecovery(toneMap(sceneColor(rgb))))), false);
      }
      return clamp(rgb, vec3f(0.0), vec3f(1.0));
    }

    @fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let output = select(renderSdr(source), renderHdr(source), p[0] > 0.5);
      return vec4f(displayEncode(output), 1.0);
    }
  `;
})();
