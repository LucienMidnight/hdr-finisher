(function () {
  function shader() {
    const indices = window.HDRGpuParamLayout.indices;
    return window.HDRWebGPUShaders.SHADER_SOURCE + `
      @group(1) @binding(0) var<storage, read> toneDiagnostic: array<f32>;
      fn diagnosticBefore(position: vec2f) -> vec3f {
        let dimensions = vec2i(textureDimensions(sourceTexture));
        let coordinate = clamp(vec2i(position / vec2f(toneDiagnostic[0], toneDiagnostic[1]) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
        return finishedAt(coordinate);
      }
      fn diagnosticDelivery(rgb: vec3f) -> vec3f {
        return select(rgb, acescgToBt2020(rgb), p[${indices.HDR_LANE}] > 0.5);
      }
      @fragment fn toneClipping(input: VertexOut) -> @location(0) vec4f {
        let after = diagnosticDelivery(applyOutputHighlights(diagnosticBefore(input.position.xy)));
        let black = toneDiagnostic[2] > 0.5;
        let peak = toneDiagnostic[3];
        let epsilon = toneDiagnostic[4];
        let touch = select(after >= vec3f(peak - epsilon), after <= vec3f(epsilon), black);
        var color = select(vec3f(0.0), vec3f(1.0), black);
        if (any(touch)) {
          color = select(vec3f(0.0), vec3f(1.0), touch);
          if (black && all(touch)) { color = vec3f(0.0); }
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
      ] });
      this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderer.bindGroupLayout, this.layout] });
      this.module = device.createShaderModule({ code: shader() });
      this.params = device.createBuffer({ size: renderer.paramBuffer.size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.config = device.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.allocation = renderer.gpuAllocator?.register({ kind: "tone-diagnostic", bytes: this.params.size + this.config.size, pinned: true });
      this.context = canvas.getContext("webgpu");
      this.context.configure({ device, format: "bgra8unorm", alphaMode: "opaque" });
      this.ready = device.createRenderPipelineAsync({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "toneClipping", targets: [{ format: "bgra8unorm" }] },
        primitive: { topology: "triangle-list" },
      }).then(pipeline => { this.clippingPipeline = pipeline; });
    }

    draw(source, { black }) {
      const renderer = this.renderer;
      const device = renderer.device;
      const scale = Math.min(1, 640 / Math.max(source.width, source.height));
      const boundedHeight = Math.max(1, Math.round(source.height * scale));
      const boundedWidth = Math.max(1, Math.round(source.width * scale));
      if (this.canvas.width !== boundedWidth || this.canvas.height !== boundedHeight) {
        this.canvas.width = boundedWidth;
        this.canvas.height = boundedHeight;
        renderer.gpuAllocator?.resize(this.allocation, boundedWidth * boundedHeight * 4 + this.params.size + this.config.size);
      }
      const indices = window.HDRGpuParamLayout.indices;
      const params = new Float32Array(source.params);
      const peak = params[indices.TONE_PEAK];
      const config = new Float32Array(8);
      config.set([boundedWidth, boundedHeight, Number(black), peak, window.HDRTonePreviewModel.endpointTolerance(peak, black)]);
      device.queue.writeBuffer(this.params, 0, params);
      device.queue.writeBuffer(this.config, 0, config);
      const group = renderer.bindGraphResources(source.filmTexture.createView(), source.spatialTexture.createView(), { buffer: this.params }, source.spatialTexture.createView());
      const diagnosticGroup = device.createBindGroup({ layout: this.layout, entries: [
        { binding: 0, resource: { buffer: this.config } },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }] });
      pass.setPipeline(this.clippingPipeline);
      pass.setBindGroup(0, group);
      pass.setBindGroup(1, diagnosticGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return { width: boundedWidth, height: boundedHeight, bytes: boundedWidth * boundedHeight * 4 };
    }

    destroy() {
      this.params.destroy();
      this.config.destroy();
      this.context.unconfigure();
      this.renderer.gpuAllocator?.unregister(this.allocation);
    }
  }
  window.HDRTonePreviewGpu = TonePreviewGpu;
})();
