(function () {
  const PARAM_COUNT = 36;
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

  function buildParams(lane, adjustments, workingSpace, hdrSurface) {
    const params = new Float32Array(PARAM_COUNT);
    const branch = adjustments[lane];
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    params[2] = branch.exposure || 0;
    params[3] = lane === "hdr" ? branch.highlight_rolloff || 0 : branch.highlight_recovery || 0;
    params[4] = lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0;
    params[5] = branch.lift || 0;
    params[6] = branch.gamma || 0;
    params[7] = branch.gain || 0;
    params[8] = branch.contrast || 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = branch.white_balance_kelvin || 6500;
    params[11] = branch.tint || 0;
    params[12] = branch.tone_mapper === "aces" ? 1 : branch.tone_mapper === "reinhard" ? 2 : 0;
    params[13] = branch.tone_contrast ?? 1;
    params[14] = branch.tone_skew || 0;
    params[15] = branch.curves_enabled ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The PQ preview/export transport tops out at 10,000 nits while the app's
    // scene-linear 0.18 reference maps to 100 nits.
    params[17] = 18;
    params[18] = lane === "hdr" && branch.tone_equalizer_enabled ? 1 : 0;
    params[19] = lane === "hdr" ? Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5)) : 0;
    const toneBands = normalizedToneEqualizerBands(branch.tone_equalizer_bands);
    toneBands.forEach((value, index) => {
      params[20 + index] = lane === "hdr" ? value : 0;
    });
    return params;
  }

  function normalizedToneEqualizerBands(values) {
    const corrections = Array.from({ length: 13 }, (_, index) => {
      const value = Number(Array.isArray(values) ? values[index] : 0);
      return Number.isFinite(value) ? Math.min(2, Math.max(-2, value)) : 0;
    });
    const targets = corrections.map((value, index) => (index - 6) + value);
    for (let index = 1; index < targets.length; index += 1) {
      targets[index] = Math.max(targets[index], targets[index - 1] + 0.001);
    }
    return targets.map((value, index) => value - (index - 6));
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
      let location = clamp(value, 0.0, 1.0) * 1023.0;
      let lower = u32(floor(location));
      let upper = min(lower + 1u, 1023u);
      let amount = fract(location);
      let base = channel * 1024u;
      return mix(curveLuts[base + lower], curveLuts[base + upper], amount);
    }
    fn curveEncode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return sign(rgb) * log2(vec3f(1.0) + abs(rgb)) / log2(11.0);
    }
    fn curveDecode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return sign(rgb) * (pow(vec3f(2.0), abs(rgb) * log2(11.0)) - vec3f(1.0));
    }
    fn applyCurves(input: vec3f, hdr: bool) -> vec3f {
      if (p[15] < 0.5) { return input; }
      var rgb = curveEncode(input, hdr);
      let sourceLuma = select(lumaSrgb(rgb), lumaAces(rgb), hdr);
      let mappedLuma = select(sourceLuma, curveValue(0u, sourceLuma), sourceLuma >= 0.0 && sourceLuma <= 1.0);
      if (abs(sourceLuma) > 0.00001) { rgb *= mappedLuma / sourceLuma; }
      for (var channel = 0u; channel < 3u; channel++) {
        let value = rgb[channel];
        if (value >= 0.0 && value <= 1.0) { rgb[channel] = curveValue(channel + 1u, value); }
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
    fn hdrBase(input: vec3f) -> vec3f {
      var rgb = input * exp2(p[2]);
      let y = max(lumaAces(rgb), 0.0);
      if (p[3] > 0.0 && y > 1.0) {
        let stops = log2(max(y, 1.0));
        let targetValue = exp2(stops / (1.0 + p[3] * stops / 40.0));
        rgb *= targetValue / max(y, 0.00000001);
      }
      if (p[4] != 0.0) {
        let lift = min(p[4] * (1.0 - clamp(lumaAces(rgb), 0.0, 1.0)), 1.0);
        rgb *= 1.0 + lift;
      }
      return whiteBalance(rgb);
    }
    fn hdrLuminanceControls(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0 && p[8] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      var targetStops = stops * exp2(p[8]);
      targetStops += 2.0 * p[5] * (1.0 - smoothRange(-4.0, 0.0, stops));
      targetStops += 2.0 * p[6] * exp2(-0.5 * pow(stops / 1.5, 2.0));
      targetStops += 2.0 * p[7] * smoothRange(0.0, 4.0, stops);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn toneEqualizerTarget(index: u32) -> f32 {
      return (f32(index) - 6.0) + p[20u + index];
    }
    fn toneEqualizerSlope(index: u32) -> f32 {
      if (index == 0u) { return toneEqualizerTarget(1u) - toneEqualizerTarget(0u); }
      if (index >= 12u) { return toneEqualizerTarget(12u) - toneEqualizerTarget(11u); }
      let previous = toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u);
      let following = toneEqualizerTarget(index + 1u) - toneEqualizerTarget(index);
      if (previous <= 0.0 || following <= 0.0) { return 0.0; }
      return 2.0 * previous * following / (previous + following);
    }
    fn hdrToneEqualizer(input: vec3f) -> vec3f {
      if (p[18] < 0.5) { return input; }
      let y = max(lumaAces(input), 0.0);
      if (y <= 0.00000001) { return input; }
      let inputEv = log2(max(y, 0.00000001) / 0.18);
      var targetEv = inputEv;
      if (inputEv < -6.0) {
        targetEv += p[20];
      } else if (inputEv > 6.0) {
        targetEv += p[32];
      } else {
        let segment = min(u32(floor(inputEv + 6.0)), 11u);
        let local = inputEv - (f32(segment) - 6.0);
        let y0 = toneEqualizerTarget(segment);
        let y1 = toneEqualizerTarget(segment + 1u);
        let m0 = toneEqualizerSlope(segment);
        let m1 = toneEqualizerSlope(segment + 1u);
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
    fn sdrLuminanceControls(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0 && p[8] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      var targetValue = encodedY;
      if (p[8] != 0.0) { targetValue = (targetValue - p[9]) * exp2(p[8] * 0.5) + p[9]; }
      let shadowMask = 1.0 - smoothRange(0.05, 0.65, encodedY);
      let highlightMask = smoothRange(0.35, 0.95, encodedY);
      let midtoneMask = pow(clamp(1.0 - abs(encodedY - 0.5) / 0.42, 0.0, 1.0), 2.0);
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
    fn toneMap(input: vec3f) -> vec3f {
      let rgb = max(input, vec3f(0.0));
      let y = lumaAces(rgb);
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
      mapped = clamp(mapped, 0.0, 1.0);
      let scaled = select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001);
      return compressSrgbGamut(acescgToSrgb(scaled));
    }
    fn renderHdr(source: vec3f) -> vec3f {
      var rgb = applyCurves(hdrLuminanceControls(hdrToneEqualizer(hdrBase(source))), true);
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
        rgb = applyCurves(sdrLuminanceControls(highlightRecovery(rgb)), false);
      } else {
        rgb = max(source * exp2(p[2]), vec3f(0.0));
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaAces(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        rgb = applyCurves(sdrLuminanceControls(highlightRecovery(toneMap(rgb))), false);
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
