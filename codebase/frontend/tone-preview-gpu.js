(function () {
  function shader() {
    const indices = window.HDRGpuParamLayout.indices;
    return window.HDRWebGPUShaders.SHADER_SOURCE + `
      @group(1) @binding(0) var<storage, read> toneDiagnostic: array<f32>;
      @group(1) @binding(1) var baseline: texture_2d<f32>;
      fn diagnosticBefore(position: vec2f) -> vec3f {
        let dimensions = vec2i(textureDimensions(sourceTexture));
        let coordinate = clamp(vec2i(position / vec2f(toneDiagnostic[0], toneDiagnostic[1]) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
        return finishedAt(coordinate);
      }
      fn diagnosticDelivery(rgb: vec3f) -> vec3f {
        return select(rgb, acescgToBt2020(rgb), p[${indices.HDR_LANE}] > 0.5);
      }
      @fragment fn toneBaseline(input: VertexOut) -> @location(0) vec4f {
        return vec4f(diagnosticDelivery(applyOutputHighlights(diagnosticBefore(input.position.xy))), 1.0);
      }
      fn diagnosticColor(offset: u32) -> vec3f {
        return vec3f(toneDiagnostic[offset], toneDiagnostic[offset + 1u], toneDiagnostic[offset + 2u]);
      }
      @fragment fn toneClipping(input: VertexOut) -> @location(0) vec4f {
        let before = diagnosticDelivery(diagnosticBefore(input.position.xy));
        let after = diagnosticDelivery(applyOutputHighlights(diagnosticBefore(input.position.xy)));
        let black = toneDiagnostic[2] > 0.5;
        let hdr = p[${indices.HDR_LANE}] > 0.5;
        let peak = toneDiagnostic[4];
        let epsilon = max(peak * 0.001, 0.000001);
        let touch = select(abs(after - vec3f(peak)) <= vec3f(epsilon), abs(after) <= vec3f(0.000001), black);
        let lost = touch & select(before > vec3f(peak + epsilon), before < vec3f(-0.000001), black);
        let old = textureLoad(baseline, vec2i(input.position.xy), 0).rgb;
        let newly = touch & select((old < vec3f(peak - epsilon)), (old > vec3f(0.000001)), black) & vec3<bool>(toneDiagnostic[6] > 0.5);
        let marked = lost | newly;
        let phase = u32(input.position.x + input.position.y);
        let stripe = phase % 6u;
        var color = select(vec3f(0.0), vec3f(1.0), black);
        if (any(touch) && stripe == 0u) { color = diagnosticColor(28u); }
        if (any(marked)) {
          var channels: array<u32, 3>;
          var count = 0u;
          for (var channel = 0u; channel < 3u; channel++) {
            if (marked[channel]) { channels[count] = channel; count++; }
          }
          let channel = channels[(phase / 6u) % max(count, 1u)];
          color = diagnosticColor(16u + channel * 4u);
          if (!lost[channel] && stripe >= 2u) { color = select(vec3f(0.0), vec3f(1.0), black); }
        } else if (hdr && !black) {
          let maximum = max(after.r, max(after.g, after.b));
          if (maximum > toneDiagnostic[7] && stripe < 2u) { color = diagnosticColor(32u); }
          if (toneDiagnostic[5] > 0.0 && maximum > toneDiagnostic[5] && stripe >= 2u && stripe < 4u) { color = diagnosticColor(36u); }
          if (maximum >= peak - epsilon && stripe >= 4u) { color = diagnosticColor(28u); }
        }
        return vec4f(color, 1.0);
      }
    `;
  }

  class TonePreviewGpu {
    constructor(renderer, canvas) {
      this.renderer = renderer;
      this.canvas = canvas;
      const device = renderer.device;
      this.layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      ] });
      this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderer.bindGroupLayout, this.layout] });
      this.module = device.createShaderModule({ code: shader() });
      this.params = device.createBuffer({ size: renderer.paramBuffer.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.config = device.createBuffer({ size: 160, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.allocation = renderer.gpuAllocator?.register({ kind: "tone-diagnostic", bytes: this.params.size + this.config.size, pinned: true });
      this.context = canvas.getContext("webgpu");
      this.context.configure({ device, format: "bgra8unorm", alphaMode: "opaque" });
      this.ready = Promise.all([["toneBaseline", "rgba16float"], ["toneClipping", "bgra8unorm"]].map(([entryPoint, format]) => device.createRenderPipelineAsync({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint, targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      }))).then(([baseline, clipping]) => { this.baselinePipeline = baseline; this.clippingPipeline = clipping; });
    }

    draw(source, { black, displayPeak = 0, referenceWhite = 203, baseline = false, colors }) {
      const renderer = this.renderer;
      const device = renderer.device;
      const scale = Math.min(1, 640 / Math.max(source.width, source.height));
      const boundedHeight = Math.max(1, Math.round(source.height * scale));
      const boundedWidth = Math.max(1, Math.round(source.width * scale));
      if (!this.texture || this.canvas.width !== boundedWidth || this.canvas.height !== boundedHeight) {
        this.texture?.destroy();
        this.canvas.width = boundedWidth;
        this.canvas.height = boundedHeight;
        this.texture = device.createTexture({ size: [boundedWidth, boundedHeight], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        renderer.gpuAllocator?.resize(this.allocation, boundedWidth * boundedHeight * 12 + this.params.size + this.config.size);
        this.hasBaseline = false;
      }
      const indices = window.HDRGpuParamLayout.indices;
      const params = new Float32Array(source.params);
      const hdr = source.lane === "hdr";
      const config = new Float32Array(40);
      config.set([boundedWidth, boundedHeight, Number(black), Number(hdr), params[indices.TONE_PEAK], displayPeak, Number(this.hasBaseline), hdr ? 100 * 0.18 / referenceWhite : 1]);
      colors.forEach((color, index) => config.set(color, 16 + index * 4));
      device.queue.writeBuffer(this.params, 0, params);
      device.queue.writeBuffer(this.config, 0, config);
      const group = renderer.bindGraphResources(source.filmTexture.createView(), source.spatialTexture.createView(), { buffer: this.params }, source.spatialTexture.createView());
      const diagnosticGroup = device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.config } },
        { binding: 1, resource: (baseline ? source.filmTexture : this.texture).createView() },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: baseline ? this.texture.createView() : this.context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }] });
      pass.setPipeline(baseline ? this.baselinePipeline : this.clippingPipeline);
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, diagnosticGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      if (baseline) this.hasBaseline = true;
      return { width: boundedWidth, height: boundedHeight, bytes: boundedWidth * boundedHeight * 8 };
    }

    destroy() {
      this.texture?.destroy();
      this.params.destroy();
      this.config.destroy();
      this.context.unconfigure();
      this.renderer.gpuAllocator?.unregister(this.allocation);
    }
  }
  window.HDRTonePreviewGpu = TonePreviewGpu;
})();
