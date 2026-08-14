(function () {
  const PARAM_COUNT = 131;
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
      this.renderSerials = new WeakMap();
      this.paramBuffer = null;
      this.curveBuffer = null;
      this.curveSampleCache = new Map();
      this.surfaceKeys = new WeakMap();
      this.intermediates = new Map();
      this.localMasks = new Map();
      this.localParamBuffers = new Map();
      this.bindGroupLayout = null;
      this.pipelineLayout = null;
      this.instrumentationEnabled = false;
      this.performanceMetrics = { renders: [] };
      this.adapterInfo = null;
    }

    async initialize() {
      if (!navigator.gpu) {
        this.detail = "WebGPU is unavailable in this browser";
        return false;
      }
      try {
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!this.adapter) throw new Error("No WebGPU adapter was returned");
        const timestampQueries = this.adapter.features.has("timestamp-query");
        this.device = await this.adapter.requestDevice({
          requiredFeatures: timestampQueries ? ["timestamp-query"] : [],
        });
        const info = this.adapter.info || {};
        this.adapterInfo = {
          vendor: info.vendor || "unknown",
          architecture: info.architecture || "unknown",
          device: info.device || "unknown",
          description: info.description || "unknown",
          timestampQueries,
        };
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) throw new Error("The WebGPU canvas context is unavailable");
        this.module = this.device.createShaderModule({ code: SHADER_SOURCE });
        const compilation = await this.module.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
        this.bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          ],
        });
        this.spatialSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        });
        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        this.device.lost.then((info) => {
          this.available = false;
          this.detail = `WebGPU device lost: ${info.message || info.reason}`;
          window.dispatchEvent(new CustomEvent("hdrfinisher:webgpulost", { detail: { message: this.detail } }));
        });
        this.available = true;
        this.detail = "WebGPU settled authoring renderer ready";
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        return false;
      }
    }

    resetSession(sessionId = null) {
      this.sessionId = sessionId;
      this.renderSerials = new WeakMap();
      for (const proxy of this.proxies.values()) proxy.texture?.destroy();
      this.proxies.clear();
      for (const intermediate of this.intermediates.values()) {
        intermediate.baseTexture?.destroy();
        intermediate.filmTexture?.destroy();
        intermediate.spatialATexture?.destroy();
        intermediate.spatialBTexture?.destroy();
        intermediate.localTexture?.destroy();
      }
      this.intermediates.clear();
      for (const mask of this.localMasks.values()) mask.texture?.destroy();
      this.localMasks.clear();
      for (const buffer of this.localParamBuffers.values()) buffer.destroy();
      this.localParamBuffers.clear();
      this.curveSampleCache.clear();
    }

    async render(sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0) {
      return this.renderTo(this.canvas, sessionId, lane, adjustments, curveSampler, longEdge, localAdjustments, editRevision);
    }

    setInstrumentationEnabled(enabled = true) {
      this.instrumentationEnabled = Boolean(enabled);
      if (enabled) this.performanceMetrics = { renders: [] };
    }

    diagnosticsSnapshot() {
      return {
        adapter: this.adapterInfo,
        available: this.available,
        detail: this.detail,
        renders: this.performanceMetrics.renders.map((entry) => ({ ...entry })),
      };
    }

    async renderTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0) {
      if (!this.available || !sessionId) return false;
      const renderStartedAt = performance.now();
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      this.renderSerials.set(canvas, serial);
      const proxy = await this.loadProxy(sessionId, lane, longEdge);
      const proxyReadyAt = performance.now();
      if (serial !== this.renderSerials.get(canvas) || !proxy) return false;
      const activeLocals = localAdjustments.filter((local) => local.enabled !== false && local.opacity > 0 && local[`${lane}_grade`]?.enabled !== false);
      if (!activeLocals.every((local) => gpuLocalSupported(local[`${lane}_grade`]))) return false;
      const masks = await Promise.all(activeLocals.map((local) => this.loadLocalMask(sessionId, local, longEdge, editRevision)));
      const masksReadyAt = performance.now();
      if (serial !== this.renderSerials.get(canvas) || masks.some((mask) => !mask)) return false;

      if (canvas.width !== proxy.width) canvas.width = proxy.width;
      if (canvas.height !== proxy.height) canvas.height = proxy.height;
      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The comparison WebGPU canvas context is unavailable");
      const surface = this.configureSurface(canvas, context, lane === "hdr");
      const pipelines = this.pipelineFor(surface.format);
      const params = buildParams(lane, adjustments, proxy.workingSpace, surface.hdr);
      const curves = buildCurves(lane, adjustments, curveSampler, this.curveSampleCache);
      this.ensureStorageBuffers(params.byteLength, curves.byteLength);
      this.device.queue.writeBuffer(this.paramBuffer, 0, params);
      this.device.queue.writeBuffer(this.curveBuffer, 0, curves);
      const intermediate = this.ensureIntermediate(canvas, proxy.width, proxy.height);
      const makeBindGroup = (sourceView, spatialView, parameterBuffer = this.paramBuffer) => this.device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: sourceView },
            { binding: 1, resource: { buffer: parameterBuffer } },
            { binding: 2, resource: { buffer: this.curveBuffer } },
            { binding: 3, resource: spatialView },
            { binding: 4, resource: this.spatialSampler },
          ],
      });
      const baseBindGroup = makeBindGroup(proxy.texture.createView(), intermediate.spatialATexture.createView());
      const extractBindGroup = makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView());
      const horizontalBindGroup = makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialATexture.createView());
      const verticalBindGroup = makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView());
      const compositeBindGroup = makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialATexture.createView());
      const encoder = this.device.createCommandEncoder();
      const gpuTiming = this.instrumentationEnabled && this.device.features.has("timestamp-query")
        ? this.createGpuTimingResources()
        : null;
      const basePass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, beginningOfPassWriteIndex: 0 } } : {}),
        colorAttachments: [{
          view: intermediate.baseTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      basePass.setPipeline(pipelines.base);
      basePass.setBindGroup(0, baseBindGroup);
      basePass.draw(3);
      basePass.end();
      let localSource = intermediate.baseTexture;
      for (let index = 0; index < activeLocals.length; index += 1) {
        const local = activeLocals[index];
        const target = index % 2 === 0 ? intermediate.localTexture : intermediate.baseTexture;
        const localBuffer = this.localParamBuffer(local, lane);
        const localBindGroup = makeBindGroup(localSource.createView(), masks[index].texture.createView(), localBuffer);
        const localPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        localPass.setPipeline(pipelines.local);
        localPass.setBindGroup(0, localBindGroup);
        localPass.draw(3);
        localPass.end();
        localSource = target;
      }
      const responseBindGroup = makeBindGroup(localSource.createView(), intermediate.spatialATexture.createView());
      const responsePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate.filmTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      responsePass.setPipeline(pipelines.response);
      responsePass.setBindGroup(0, responseBindGroup);
      responsePass.draw(3);
      responsePass.end();
      const spatialActive = params[78] > 0.5 && params[79] > 0
        && (params[85] > 0.5 || (params[92] > 0.5 && params[93] > 0));
      if (spatialActive) {
        const extractPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        extractPass.setPipeline(pipelines.extract);
        extractPass.setBindGroup(0, extractBindGroup);
        extractPass.draw(3);
        extractPass.end();
        const horizontalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialBTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        horizontalPass.setPipeline(pipelines.blurHorizontal);
        horizontalPass.setBindGroup(0, horizontalBindGroup);
        horizontalPass.draw(3);
        horizontalPass.end();
        const verticalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        verticalPass.setPipeline(pipelines.blurVertical);
        verticalPass.setBindGroup(0, verticalBindGroup);
        verticalPass.draw(3);
        verticalPass.end();
      }
      const pass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, endingOfPassWriteIndex: 1 } } : {}),
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipelines.composite);
      pass.setBindGroup(0, compositeBindGroup);
      pass.draw(3);
      pass.end();
      if (gpuTiming) {
        encoder.resolveQuerySet(gpuTiming.querySet, 0, 2, gpuTiming.resolveBuffer, 0);
        encoder.copyBufferToBuffer(gpuTiming.resolveBuffer, 0, gpuTiming.readBuffer, 0, 16);
      }
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      if (this.instrumentationEnabled) {
        const metric = {
          serial,
          lane,
          longEdge,
          width: proxy.width,
          height: proxy.height,
          localCount: activeLocals.length,
          proxyAwaitMs: proxyReadyAt - renderStartedAt,
          maskAwaitMs: masksReadyAt - proxyReadyAt,
          encodeSubmitMs: submittedAt - masksReadyAt,
          submissionMs: submittedAt - renderStartedAt,
          queueCompleteMs: null,
          gpuMs: null,
        };
        this.performanceMetrics.renders.push(metric);
        if (this.performanceMetrics.renders.length > 240) this.performanceMetrics.renders.shift();
        void this.device.queue.onSubmittedWorkDone().then(() => {
          metric.queueCompleteMs = performance.now() - submittedAt;
        }).catch(() => null);
        if (gpuTiming) this.collectGpuTiming(gpuTiming, metric);
      } else {
        gpuTiming?.querySet.destroy();
        gpuTiming?.resolveBuffer.destroy();
        gpuTiming?.readBuffer.destroy();
      }
      return { width: proxy.width, height: proxy.height, hdr: surface.hdr, proxyFormat: proxy.pixelFormat };
    }

    createGpuTimingResources() {
      const querySet = this.device.createQuerySet({ type: "timestamp", count: 2 });
      const resolveBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      return { querySet, resolveBuffer, readBuffer };
    }

    collectGpuTiming(resources, metric) {
      void resources.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const timestamps = new BigUint64Array(resources.readBuffer.getMappedRange());
        metric.gpuMs = Number(timestamps[1] - timestamps[0]) / 1e6;
        resources.readBuffer.unmap();
      }).catch(() => null).finally(() => {
        resources.querySet.destroy();
        resources.resolveBuffer.destroy();
        resources.readBuffer.destroy();
      });
    }

    configureSurface(canvas, context, wantsHdr) {
      const hdrDisplay = Boolean(window.matchMedia?.("(dynamic-range: high)").matches);
      if (wantsHdr && hdrDisplay) {
        try {
          const format = "rgba16float";
          const key = `${format}:display-p3:extended:${canvas.width}x${canvas.height}`;
          if (this.surfaceKeys.get(canvas) !== key) {
            context.configure({
              device: this.device,
              format,
              colorSpace: "display-p3",
              toneMapping: { mode: "extended" },
              alphaMode: "opaque",
            });
            this.surfaceKeys.set(canvas, key);
          }
          return { format, hdr: true };
        } catch {
          // Older WebGPU implementations still provide a fast SDR draft.
        }
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      const key = `${format}:srgb:standard:${canvas.width}x${canvas.height}`;
      if (this.surfaceKeys.get(canvas) !== key) {
        context.configure({ device: this.device, format, colorSpace: "srgb", alphaMode: "opaque" });
        this.surfaceKeys.set(canvas, key);
      }
      return { format, hdr: false };
    }

    pipelineFor(format) {
      if (this.pipelines.has(format)) return this.pipelines.get(format);
      const base = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "baseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const response = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "filmResponseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const local = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localAdjustmentFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const extract = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialExtractFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const composite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const pipelines = { base, local, response, extract, blurHorizontal, blurVertical, composite };
      this.pipelines.set(format, pipelines);
      return pipelines;
    }

    ensureIntermediate(canvas, width, height) {
      const current = this.intermediates.get(canvas);
      if (current?.width === width && current?.height === height) return current;
      current?.baseTexture?.destroy();
      current?.filmTexture?.destroy();
      current?.spatialATexture?.destroy();
      current?.spatialBTexture?.destroy();
      current?.localTexture?.destroy();
      const createTexture = () => this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const spatialWidth = Math.max(1, Math.ceil(width / 4));
      const spatialHeight = Math.max(1, Math.ceil(height / 4));
      const createSpatialTexture = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const intermediate = {
        baseTexture: createTexture(),
        filmTexture: createTexture(),
        localTexture: createTexture(),
        spatialATexture: createSpatialTexture(),
        spatialBTexture: createSpatialTexture(),
        width,
        height,
      };
      this.intermediates.set(canvas, intermediate);
      return intermediate;
    }

    ensureStorageBuffers(paramBytes, curveBytes) {
      if (!this.paramBuffer) {
        this.paramBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(paramBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      if (!this.curveBuffer) {
        this.curveBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(curveBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
    }

    trimProxyLevels(sessionId, lane) {
      const prefix = `${sessionId}:${lane}:`;
      const keys = [...this.proxies.keys()].filter((key) => key.startsWith(prefix));
      while (keys.length > 2) {
        const key = keys.shift();
        this.proxies.get(key)?.texture?.destroy();
        this.proxies.delete(key);
      }
    }

    createStorageBuffer(values) {
      const size = Math.max(16, Math.ceil(values.byteLength / 4) * 4);
      return this.device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    async loadProxy(sessionId, lane, longEdge) {
      const key = `${sessionId}:${lane}:${longEdge}`;
      if (this.proxies.has(key)) return this.proxies.get(key);
      const response = await fetch(`/api/session/${sessionId}/proxy/${lane}?long_edge=${longEdge}&format=rgba16f`);
      if (!response.ok) throw new Error("WebGPU proxy could not be loaded");
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
      const workingSpace = response.headers.get("X-Working-Space") || "acescg";
      const pixelFormat = response.headers.get("X-Pixel-Format") || "rgba32float";
      const data = await response.arrayBuffer();
      const texture = this.device.createTexture({
        size: { width, height },
        format: pixelFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture },
        data,
        { offset: 0, bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const proxy = { texture, width, height, workingSpace, pixelFormat, bindGroups: new Map() };
      this.proxies.set(key, proxy);
      this.trimProxyLevels(sessionId, lane);
      return proxy;
    }

    async loadLocalMask(sessionId, local, longEdge, editRevision) {
      const spatialOnly = local.mask?.operator === "leaf" && Boolean(local.mask.leaf);
      const maskSignature = gpuMaskIdentity(local.mask);
      const key = `${sessionId}:${local.id}:${longEdge}:${maskSignature}`;
      const cached = this.localMasks.get(key);
      if (cached) {
        this.localMasks.delete(key);
        this.localMasks.set(key, cached);
        return cached;
      }
      const response = await fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${editRevision}&spatial_only=${spatialOnly}`);
      if (!response.ok) return null;
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const source = new Uint8Array(await response.arrayBuffer());
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? source : new Uint8Array(bytesPerRow * height);
      if (padded !== source) {
        for (let row = 0; row < height; row += 1) padded.set(source.subarray(row * width, (row + 1) * width), row * bytesPerRow);
      }
      const texture = this.device.createTexture({
        size: { width, height },
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture },
        padded,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const entry = { texture, width, height, byteSize: width * height };
      this.localMasks.set(key, entry);
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      return entry;
    }

    trimLocalMaskCache(budget) {
      let total = [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      while (this.localMasks.size && total > budget) {
        const [key, entry] = this.localMasks.entries().next().value;
        entry.texture.destroy();
        this.localMasks.delete(key);
        total -= entry.byteSize;
      }
    }

    localParamBuffer(local, lane) {
      const key = `${local.id}:${lane}`;
      let buffer = this.localParamBuffers.get(key);
      const values = buildLocalParams(local, lane);
      if (!buffer) {
        buffer = this.createStorageBuffer(values);
        this.localParamBuffers.set(key, buffer);
      }
      this.device.queue.writeBuffer(buffer, 0, values);
      return buffer;
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

  function curveSetNeutral(branch) {
    return ["luma_curve", "red_curve", "green_curve", "blue_curve"].every((name) => {
      const points = branch?.[name];
      return Array.isArray(points) && points.length >= 2
        && points.every((point) => Array.isArray(point) && Math.abs(Number(point[0]) - Number(point[1])) < 0.000001);
    });
  }

  function toneEqualizerNeutral(branch) {
    const nodes = branch?.tone_equalizer_nodes;
    return !Array.isArray(nodes) || nodes.every((node) => Math.abs(Number(node?.adjustment_ev) || 0) < 0.000001);
  }

  function toneAdjustedHighlightPeakLinear(branch, toneEnabled) {
    let peak = Math.max(1, Number(branch.highlight_compression_source_peak_nits) || 1000) * 0.18 / 100;
    if (!toneEnabled) return peak;
    peak *= Math.pow(2, Number(branch.exposure) || 0);
    const shadowLift = Number(branch.shadow_lift) || 0;
    if (shadowLift !== 0) {
      const liftFactor = Math.min(1, shadowLift * (1 - Math.min(1, Math.max(0, peak))));
      peak *= 1 + liftFactor;
    }
    const contrast = Number(branch.contrast) || 0;
    if (contrast !== 0 && peak > 0.00000001) {
      const pivot = Math.max(Number(branch.contrast_pivot) || 0.1845, 0.000001);
      const stops = Math.log2(Math.max(peak, 0.00000001) / pivot);
      peak = pivot * Math.pow(2, Math.min(32, Math.max(-32, stops * Math.pow(2, contrast))));
    }
    return Math.max(0.0018, peak);
  }

  function buildParams(lane, adjustments, workingSpace, hdrSurface) {
    const params = new Float32Array(PARAM_COUNT);
    const branch = adjustments[lane];
    const colorSource = branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const highlightEnabled = lane === "hdr" && branch.highlight_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false;
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    const baseEnabled = lane !== "sdr" || branch.base_section_enabled !== false;
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = lane === "hdr"
      ? (highlightEnabled ? branch.highlight_compression_softness || 0 : 0)
      : (toneEnabled ? branch.highlight_recovery || 0 : 0);
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
    params[15] = branch.curves_section_enabled !== false && !curveSetNeutral(branch) ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The PQ preview/export transport tops out at 10,000 nits while the app's
    // scene-linear 0.18 reference maps to 100 nits.
    params[17] = 18;
    params[18] = lane === "hdr" && branch.tone_equalizer_section_enabled !== false && !toneEqualizerNeutral(branch) ? 1 : 0;
    params[19] = lane === "hdr" ? Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5)) : 0;
    const toneNodes = normalizedToneEqualizerNodes(branch.tone_equalizer_nodes);
    params[20] = lane === "hdr" ? toneNodes.length : 0;
    toneNodes.forEach((node, index) => {
      params[21 + index] = lane === "hdr" ? node.input_ev : 0;
      params[37 + index] = lane === "hdr" ? node.adjustment_ev : 0;
    });
    params[53] = lane === "hdr" ? ((branch.highlight_compression_start_nits ?? 400) * 0.18 / 100) : 0;
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
    params[73] = lane === "hdr" ? ((branch.highlight_compression_target_nits ?? 1000) * 0.18 / 100) : 0;
    params[74] = highlightEnabled ? (branch.highlight_compression_mode === "peak_fit" ? 1 : branch.highlight_compression_mode === "soft_ceiling" ? 2 : 0) : 0;
    params[75] = lane === "hdr" ? toneAdjustedHighlightPeakLinear(branch, toneEnabled) : 0;
    params[76] = lane === "hdr" ? Math.min(1, Math.max(0, (branch.highlight_compression_peak_detail ?? 35) / 100)) : 0;
    params[77] = lane === "hdr" ? Math.min(1, Math.max(-1, (branch.highlight_compression_bias ?? 0) / 100)) * 0.6 : 0;
    const film = branch.film_look || {};
    const filmEnabled = branch.film_look_section_enabled !== false;
    params[78] = filmEnabled ? 1 : 0;
    params[79] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    params[80] = (film.print_strength || 0) / 100;
    params[81] = (film.print_contrast || 0) / 100;
    params[82] = (film.print_toe || 0) / 100;
    params[83] = (film.print_shoulder || 0) / 100;
    params[84] = (film.color_density || 0) / 100;
    params[85] = film.halation_enabled !== false && ((film.halation_amount || 0) > 0 || film.halation_view_map) ? 1 : 0;
    params[86] = (film.halation_amount || 0) / 100;
    params[87] = (film.halation_sensitivity ?? 75) / 100;
    params[88] = film.halation_radius ?? 0.2;
    params[89] = (film.halation_hue_offset || 0) / 100;
    params[90] = (film.halation_saturation ?? 75) / 100;
    params[91] = film.halation_view_map ? 1 : 0;
    params[92] = film.bloom_enabled !== false ? 1 : 0;
    params[93] = (film.bloom_amount || 0) / 100;
    params[94] = (film.bloom_sensitivity ?? 80) / 100;
    params[95] = film.bloom_radius ?? 0.5;
    params[96] = (film.bloom_highlight_detail ?? 75) / 100;
    params[97] = film.image_structure_enabled !== false ? 1 : 0;
    params[98] = (film.image_softness || 0) / 100;
    params[99] = (film.microcontrast || 0) / 100;
    params[100] = film.grain_enabled !== false ? 1 : 0;
    params[101] = (film.grain_amount || 0) / 100;
    params[102] = (film.grain_size ?? 50) / 100;
    params[103] = (film.grain_softness ?? 25) / 100;
    params[104] = (film.grain_chroma || 0) / 100;
    params[105] = (film.grain_shadow_response ?? 100) / 100;
    params[106] = (film.grain_midtone_response ?? 100) / 100;
    params[107] = (film.grain_highlight_response ?? 100) / 100;
    params[108] = (film.film_resolution ?? 100) / 100;
    params[109] = adjustments.shared?.film_grain_seed ?? 271828;
    params[110] = lane === "hdr" && branch.highlight_compression_color_handling === "path_to_white" ? 1 : 0;
    const grading = branch.color_grading || {};
    params[111] = branch.color_grading_section_enabled !== false ? 1 : 0;
    params[112] = 0.55 + 3.45 * (grading.blending ?? 50) / 100;
    params[113] = (grading.balance || 0) / 50;
    [grading.shadows || {}, grading.midtones || {}, grading.highlights || {}].forEach((wheel, index) => {
      params[114 + index * 3] = wheel.hue || 0;
      params[115 + index * 3] = (wheel.saturation || 0) / 400;
      params[116 + index * 3] = wheel.luminance_ev || 0;
    });
    const vignette = branch.vignette || {};
    params[123] = branch.vignette_section_enabled !== false ? 1 : 0;
    params[124] = 2 * (vignette.amount || 0) / 100;
    params[125] = 0.15 + 0.70 * (vignette.midpoint ?? 50) / 100;
    const roundness = (vignette.roundness || 0) / 100;
    params[126] = roundness >= 0 ? 2 + 6 * roundness : 2 + roundness;
    params[127] = 0.02 + 0.98 * (vignette.feather ?? 75) / 100;
    params[128] = (vignette.highlight_protection || 0) / 100;
    params[129] = vignette.center_x ?? 0.5;
    params[130] = vignette.center_y ?? 0.5;
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

  function buildCurves(lane, adjustments, curveSampler, sampleCache) {
    const branch = adjustments[lane];
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    ["luma_curve", "red_curve", "green_curve", "blue_curve"].forEach((name, channel) => {
      const signature = JSON.stringify(branch[name]);
      const cacheKey = `${lane}:${name}`;
      let cached = sampleCache.get(cacheKey);
      if (!cached || cached.signature !== signature) {
        cached = { signature, samples: curveSampler(branch[name], CURVE_SAMPLES) };
        sampleCache.set(cacheKey, cached);
      }
      const samples = cached.samples;
      for (let index = 0; index < CURVE_SAMPLES; index += 1) {
        const sample = samples[index];
        packed[channel * CURVE_SAMPLES + index] = Array.isArray(sample) ? sample[1] : sample;
      }
    });
    return packed;
  }

  function gpuLocalSupported(grade) {
    if (!grade || !curveSetNeutral(grade)) return false;
    const grading = grade.color_grading || {};
    if (Math.abs(Number(grading.balance) || 0) > 0.000001 || Math.abs((Number(grading.blending) || 50) - 50) > 0.000001) return false;
    return [grading.shadows, grading.midtones, grading.highlights].every((wheel) =>
      !wheel || [wheel.hue, wheel.saturation, wheel.luminance_ev].every((value) => Math.abs(Number(value) || 0) < 0.000001));
  }

  function buildLocalParams(local, lane) {
    const grade = local[`${lane}_grade`];
    const values = new Float32Array(16);
    values[0] = lane === "hdr" ? 1 : 0;
    values[1] = Number(local.opacity) || 0;
    values[2] = Number(grade.exposure) || 0;
    values[3] = Number(grade.highlights) || 0;
    values[4] = Number(grade.midtones) || 0;
    values[5] = Number(grade.shadows) || 0;
    values[6] = Number(grade.blacks) || 0;
    values[7] = Number(grade.contrast) || 0;
    values[8] = Math.max(0.001, Number(grade.contrast_pivot) || 0.18);
    values[9] = Number(grade.white_balance_kelvin) || 6500;
    values[10] = Number(grade.tint) || 0;
    values[11] = Number(grade.saturation) || 0;
    values[12] = Number(grade.vibrance) || 0;
    values[13] = gpuMaskInfluenceOpacity(local.mask);
    return values;
  }

  function gpuMaskInfluenceOpacity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return 1;
    return Math.min(1, Math.max(0, Number(expression.leaf.mask_opacity ?? 1)));
  }

  function gpuMaskIdentity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(expression);
    return JSON.stringify({
      ...expression,
      leaf: { ...expression.leaf, mask_opacity: 1 },
    });
  }

  window.HDRWebGPUPreview = HDRWebGPUPreview;

  const SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var<storage, read> curveLuts: array<f32>;
    @group(0) @binding(3) var spatialTexture: texture_2d<f32>;
    @group(0) @binding(4) var spatialSampler: sampler;

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
      if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }
      return 0.5 + 0.5 * log2(value / 0.18) / log2(100.0);
    }
    fn curveDecodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value * 0.36; }
      if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }
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
      var rgb = select(clamp(input, vec3f(0.0), vec3f(1.0)), input, hdr);
      let sourceLuma = select(lumaSrgb(rgb), lumaAces(rgb), hdr);
      let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr);
      let mappedCurveLuma = curveValue(0u, curveLuma);
      let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr);
      if (abs(sourceLuma) > 0.00001) { rgb *= mappedLuma / sourceLuma; }
      rgb = curveEncode(rgb, hdr);
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
    fn gradingVector(hue: f32, hdr: bool) -> vec3f {
      let angle = radians(hue);
      var tint = vec3f(cos(angle), cos(angle - 2.0943951), cos(angle + 2.0943951));
      let neutral = select(lumaSrgb(tint), lumaAces(tint), hdr);
      tint -= vec3f(neutral);
      return tint / max(max(abs(tint.r), abs(tint.g)), max(abs(tint.b), 0.000001));
    }
    fn applyColorGrading(input: vec3f, hdr: bool) -> vec3f {
      if (p[111] < 0.5) { return input; }
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.0);
      let signal = select(log2(max(srgbEncode(sourceY), 0.0000001) / 0.5), log2(max(sourceY, 0.0000001) / 0.18), hdr);
      let shadow = 1.0 - smoothRange(-1.0 + p[113] - p[112] * 0.5, -1.0 + p[113] + p[112] * 0.5, signal);
      let highlight = smoothRange(1.0 + p[113] - p[112] * 0.5, 1.0 + p[113] + p[112] * 0.5, signal);
      let midtone = max(0.0, 1.0 - shadow - highlight);
      let total = max(shadow + midtone + highlight, 0.000001);
      let masks = vec3f(shadow, midtone, highlight) / total;
      var tint = vec3f(0.0);
      var luminanceEv = 0.0;
      for (var index: u32 = 0u; index < 3u; index = index + 1u) {
        let offset = 114 + index * 3;
        tint += gradingVector(p[offset], hdr) * p[offset + 1] * masks[index];
        luminanceEv += p[offset + 2] * masks[index];
      }
      var result = input + tint * sourceY;
      let tintedY = max(select(lumaSrgb(result), lumaAces(result), hdr), 0.0000001);
      result *= sourceY / tintedY;
      return max(result * exp2(luminanceEv), vec3f(0.0));
    }
    fn hdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[74] != 2.0 || p[3] <= 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let start = max(p[53], 0.000001);
      if (y <= start) { return input; }
      let targetLevel = max(p[73], start + 0.0018);
      let span = targetLevel - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[3] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      if (compressed > 0.99999) { compressed = 1.0; }
      let activationPosition = clamp(p[3] / 10.0, 0.0, 1.0);
      let activation = activationPosition * activationPosition * (3.0 - 2.0 * activationPosition);
      var targetValue: f32;
      if (activation >= 1.0) {
        targetValue = start + span * compressed;
      } else {
        targetValue = start + mix(y - start, span * compressed, activation);
      }
      return input * (targetValue / max(y, 0.00000001));
    }
    fn hdrPeakFit(input: vec3f) -> vec3f {
      if (p[74] != 1.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let start = max(p[53], 0.000001);
      let targetLevel = max(p[73], start + 0.0018);
      let peakLevel = max(p[75], targetLevel);
      if (peakLevel <= targetLevel) { return input; }
      let startStop = log2(start);
      let targetStop = log2(targetLevel);
      let peakStop = log2(peakLevel);
      let curveBias = p[77];
      let requestedRatio = (targetStop - startStop) / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[76] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
      var effectiveStartStop = startStop;
      if (requestedRatio < requiredRatio) {
        effectiveStartStop = (targetStop - requiredRatio * peakStop) / (1.0 - requiredRatio);
      }
      let effectiveStart = exp2(effectiveStartStop);
      if (y <= effectiveStart) { return input; }
      let u = clamp((log2(y) - effectiveStartStop) / max(peakStop - effectiveStartStop, 0.000001), 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let stopSpan = targetStop - effectiveStartStop;
      let m0 = (peakStop - effectiveStartStop) / max(stopSpan * (1.0 + curveBias), 0.000001);
      let m1 = p[76] * (peakStop - effectiveStartStop) / max(stopSpan * (1.0 - curveBias), 0.000001);
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(y, 0.00000001));
      if (p[110] < 0.5) { return mappedRgb; }
      let progress = u * u * (3.0 - 2.0 * u);
      let pathScale = 1.0 - progress;
      let maximumChroma = max(mappedRgb.r, max(mappedRgb.g, mappedRgb.b)) - targetValue;
      var channelScale = 1.0;
      if (maximumChroma > 0.00000001) {
        channelScale = clamp((targetLevel - targetValue) / maximumChroma, 0.0, 1.0);
      }
      let chromaScale = min(pathScale, channelScale);
      return vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * chromaScale;
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
    fn renderHdrBase(source: vec3f) -> vec3f {
      return max(applyColorGrading(applyCurves(hdrPrimaries(hdrToneEqualizer(sceneColor(hdrPeakFit(hdrSoftCeiling(hdrContrast(hdrBase(source))))))), true), true), vec3f(0.0));
    }
    fn displayHdr(rgb: vec3f) -> vec3f {
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
    fn renderSdrBase(source: vec3f) -> vec3f {
      var rgb: vec3f;
      if (p[1] > 0.5) {
        rgb = clamp(source, vec3f(0.0), vec3f(1.0)) * exp2(p[2]);
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaSrgb(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        if (p[60] > 0.5) { rgb = retoneMapSdrReference(rgb); }
        rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrReferenceColor(sdrContrast(highlightRecovery(rgb)))), false), false);
      } else {
        rgb = max(source * exp2(p[2]), vec3f(0.0));
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaAces(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrContrast(highlightRecovery(toneMap(sceneColor(rgb))))), false), false);
      }
      return clamp(rgb, vec3f(0.0), vec3f(1.0));
    }

    fn filmLuma(rgb: vec3f) -> f32 {
      return select(lumaSrgb(rgb), lumaAces(rgb), p[0] > 0.5);
    }
    fn filmSignalFromLuma(value: f32) -> f32 {
      return select(srgbEncode(clamp(value, 0.0, 1.0)), curveEncodeChannel(max(value, 0.0)), p[0] > 0.5);
    }
    fn filmLumaFromSignal(value: f32) -> f32 {
      return select(srgbDecode(clamp(value, 0.0, 1.0)), curveDecodeChannel(value), p[0] > 0.5);
    }
    fn filmResponse(input: vec3f) -> vec3f {
      if (p[78] < 0.5 || p[79] <= 0.0) { return input; }
      let sourceY = max(filmLuma(input), 0.0);
      var rgb = input;
      if (p[80] > 0.0 && sourceY > 0.0000001) {
        let signal = filmSignalFromLuma(sourceY);
        var mapped = 0.5 + (signal - 0.5) * exp2(0.55 * p[81] * p[79]);
        mapped -= p[82] * p[79] * 0.10 * (1.0 - smoothRange(0.08, 0.58, signal));
        mapped -= p[83] * p[79] * 0.10 * smoothRange(0.42, 0.98, signal);
        if (p[0] < 0.5) { mapped = clamp(mapped, 0.0, 1.0); }
        let targetY = mix(sourceY, filmLumaFromSignal(mapped), p[80] * p[79]);
        rgb *= targetY / sourceY;
      }
      if (p[84] != 0.0) {
        let y = filmLuma(rgb);
        let neutral = vec3f(y);
        let maximum = max(rgb.r, max(rgb.g, rgb.b));
        let minimum = min(rgb.r, min(rgb.g, rgb.b));
        let relative = clamp((maximum - minimum) / max(abs(y), 0.00001), 0.0, 2.0);
        let density = p[84] * p[79];
        rgb = neutral + (rgb - neutral) * exp2(0.45 * density);
        rgb *= max(0.75, 1.0 - density * 0.045 * relative);
      }
      return max(rgb, vec3f(0.0));
    }
    fn boundedCoordinate(coordinate: vec2i) -> vec2i {
      let dimensions = textureDimensions(sourceTexture);
      return clamp(coordinate, vec2i(0), vec2i(dimensions) - vec2i(1));
    }
    fn sampleFilm(coordinate: vec2i) -> vec3f {
      return textureLoad(sourceTexture, boundedCoordinate(coordinate), 0).rgb;
    }
    fn spatialOffset(percentDiagonal: f32) -> i32 {
      let dimensions = vec2f(textureDimensions(sourceTexture));
      return max(1, i32(round(length(dimensions) * max(percentDiagonal, 0.0) / 100.0)));
    }
    fn filmBlur(coordinate: vec2i, percentDiagonal: f32) -> vec3f {
      let radius = spatialOffset(percentDiagonal);
      let halfRadius = max(1, radius / 2);
      var total = sampleFilm(coordinate) * 4.0;
      total += sampleFilm(coordinate + vec2i(radius, 0));
      total += sampleFilm(coordinate + vec2i(-radius, 0));
      total += sampleFilm(coordinate + vec2i(0, radius));
      total += sampleFilm(coordinate + vec2i(0, -radius));
      total += sampleFilm(coordinate + vec2i(halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(halfRadius, -halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, -halfRadius));
      return total / 12.0;
    }
    fn filmHighlightMask(rgb: vec3f, sensitivity: f32) -> f32 {
      let threshold = 0.92 - 0.50 * clamp(sensitivity, 0.0, 1.0);
      return smoothRange(threshold, threshold + 0.16, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
    }
    fn qualifiedSample(coordinate: vec2i, sensitivity: f32) -> vec3f {
      let rgb = sampleFilm(coordinate);
      return rgb * filmHighlightMask(rgb, sensitivity);
    }

    fn packedQualifiedSample(coordinate: vec2f) -> vec4f {
      let rgb = sampleFilm(vec2i(coordinate));
      let bloomMask = filmHighlightMask(rgb, p[94]);
      let halationMask = filmHighlightMask(rgb, p[87]);
      let bloom = rgb * bloomMask * select(0.0, 1.0, p[92] > 0.5 && p[93] > 0.0);
      let halation = max(filmLuma(rgb), 0.0) * halationMask * select(0.0, 1.0, p[85] > 0.5);
      return vec4f(bloom, halation);
    }
    fn sampleSpatial(uv: vec2f) -> vec4f {
      return textureSampleLevel(spatialTexture, spatialSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
    }
    fn spatialBlur(direction: vec2f, coordinate: vec2f) -> vec4f {
      let dimensions = vec2f(textureDimensions(spatialTexture));
      let uv = coordinate / dimensions;
      let bloomRadius = max(0.5, length(dimensions) * max(p[95], 0.0) / 100.0);
      let halationRadius = max(0.5, length(dimensions) * max(p[88], 0.0) / 100.0);
      var bloomTotal = vec3f(0.0);
      var halationTotal = 0.0;
      var weightTotal = 0.0;
      for (var index: i32 = -4; index <= 4; index = index + 1) {
        let normalized = f32(index) / 4.0;
        let weight = exp(-4.5 * normalized * normalized);
        let bloomUv = uv + direction * normalized * bloomRadius / dimensions;
        let halationUv = uv + direction * normalized * halationRadius / dimensions;
        bloomTotal += sampleSpatial(bloomUv).rgb * weight;
        halationTotal += sampleSpatial(halationUv).a * weight;
        weightTotal += weight;
      }
      return vec4f(bloomTotal / weightTotal, halationTotal / weightTotal);
    }
    fn grainHash(coordinate: vec2f, salt: f32) -> f32 {
      return fract(sin(dot(coordinate, vec2f(12.9898, 78.233)) + p[109] * 0.001 + salt) * 43758.5453) * 2.0 - 1.0;
    }
    fn applyFilmLook(coordinate: vec2i) -> vec3f {
      var rgb = sampleFilm(coordinate);
      if (p[78] < 0.5 || p[79] <= 0.0) { return applyVignette(rgb, coordinate); }
      let dimensions = vec2f(textureDimensions(sourceTexture));
      let spatial = sampleSpatial((vec2f(coordinate) + vec2f(0.5)) / dimensions);
      if (p[85] > 0.5) {
        let qualified = rgb * filmHighlightMask(rgb, p[87]);
        let haloY = max(spatial.a - max(filmLuma(qualified), 0.0) * 0.35, 0.0);
        let angle = radians(12.0 + 45.0 * p[89]);
        let warm = vec3f(1.0, 0.34 + 0.18 * sin(angle), 0.07 + 0.10 * max(cos(angle), 0.0));
        let warmY = lumaSrgb(warm);
        let tint = mix(vec3f(warmY), warm, clamp(p[90], 0.0, 1.0));
        if (p[91] > 0.5) { return vec3f(clamp(filmSignalFromLuma(haloY), 0.0, 1.0)); }
        rgb += haloY * tint * (0.28 * p[86] * p[79]);
      }
      if (p[92] > 0.5 && p[93] > 0.0) {
        let qualified = rgb * filmHighlightMask(rgb, p[94]);
        let amount = p[93] * p[79];
        let additive = spatial.rgb * (0.22 * amount);
        let diffusion = (spatial.rgb - qualified) * ((1.0 - p[96]) * 0.35 * amount);
        rgb = max(rgb + additive + diffusion, vec3f(0.0));
      }
      let structureBlur = filmBlur(coordinate, 0.06);
      if (p[97] > 0.5) {
        let structureSource = rgb;
        rgb = structureSource
          + (structureBlur - structureSource) * p[98] * p[79] * 0.65
          + (structureSource - structureBlur) * p[99] * p[79] * 0.5;
      }
      if (p[100] > 0.5 && p[108] < 1.0) {
        let resolutionLoss = (1.0 - p[108]) * p[79];
        rgb += (filmBlur(coordinate, 0.04 + 0.08 * resolutionLoss) - rgb) * resolutionLoss * 0.7;
      }
      rgb = applyVignette(rgb, coordinate);
      if (p[100] > 0.5 && p[101] > 0.0) {
        let dimensions = vec2f(textureDimensions(sourceTexture));
        let pitch = max(1.0, length(dimensions) / 2400.0 * (0.85 + 1.8 * p[102] + 1.2 * p[103]));
        let grainCoordinate = vec2f(coordinate) / pitch;
        let mono = mix(grainHash(grainCoordinate, 0.0), grainHash(grainCoordinate * 0.53, 17.0), p[103] * 0.55);
        let signal = clamp(filmSignalFromLuma(max(filmLuma(rgb), 0.0)), 0.0, 1.0);
        let shadowWeight = pow(1.0 - signal, 2.0);
        let highlightWeight = pow(signal, 2.0);
        let midWeight = max(0.0, 1.0 - shadowWeight - highlightWeight);
        let response = shadowWeight * p[105] + midWeight * p[106] + highlightWeight * p[107];
        let amount = 0.18 * p[101] * p[79] * response;
        rgb *= exp2(vec3f(mono * amount));
        if (p[104] > 0.0) {
          let chroma = vec3f(grainHash(grainCoordinate, 31.0), grainHash(grainCoordinate, 59.0), grainHash(grainCoordinate, 83.0));
          let chromaHighlightGuard = 1.0 - 0.8 * smoothRange(0.88, 1.0, signal);
          rgb *= exp2(chroma * amount * p[104] * chromaHighlightGuard * 0.45);
        }
      }
      return max(rgb, vec3f(0.0));
    }
    fn applyVignette(rgb: vec3f, coordinate: vec2i) -> vec3f {
      if (p[123] < 0.5 || abs(p[124]) < 0.000001) { return rgb; }
      let dimensions = vec2f(textureDimensions(sourceTexture));
      let center = vec2f(p[129], p[130]) * max(dimensions - vec2f(1.0), vec2f(1.0));
      let scale = max(1.0, 0.5 * min(dimensions.x, dimensions.y));
      let delta = abs((vec2f(coordinate) - center) / scale);
      let exponent = max(p[126], 1.0);
      let radius = pow(pow(delta.x, exponent) + pow(delta.y, exponent), 1.0 / exponent);
      var mask = smoothRange(p[125], p[125] + p[127], radius);
      if (p[124] < 0.0 && p[128] > 0.0) {
        let highlight = smoothRange(0.55, 0.95, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
        mask *= 1.0 - highlight * p[128];
      }
      return max(rgb * exp2(p[124] * mask), vec3f(0.0));
    }

    fn localSaturation(input: vec3f) -> vec3f {
      let y = lumaAces(input);
      let neutral = vec3f(y);
      let chroma = input - neutral;
      let maximum = max(input.r, max(input.g, input.b));
      let minimum = min(input.r, min(input.g, input.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      return neutral + chroma * max(0.0, 1.0 + p[12] * vibranceWeight) * max(0.0, 1.0 + p[11]);
    }

    fn applyLocalGrade(input: vec3f) -> vec3f {
      let hdr = p[0] > 0.5;
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.00000001);
      let pivot = max(p[8], 0.000001);
      let stops = log2(sourceY / pivot);
      let blacks = clamp((-stops - 3.0) / 3.0, 0.0, 1.0);
      let shadows = clamp(1.0 - abs(stops + 2.0) / 2.5, 0.0, 1.0);
      let midtones = clamp(1.0 - abs(stops) / 2.5, 0.0, 1.0);
      let highlights = clamp((stops - 0.5) / 3.0, 0.0, 1.0);
      let zoneEv = p[6] * blacks + p[5] * shadows + p[4] * midtones + p[3] * highlights;
      let targetStops = stops * exp2(p[7]) + zoneEv + p[2];
      var rgb = input * (pivot * exp2(clamp(targetStops, -32.0, 24.0)) / sourceY);
      if (hdr) {
        let offset = (p[9] - 6500.0) / 6500.0;
        rgb *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = localSaturation(rgb);
      } else {
        var aces = srgbToAcescg(rgb);
        let offset = (p[9] - 6500.0) / 6500.0;
        aces *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = acescgToSrgb(localSaturation(aces));
      }
      return max(rgb, vec3f(0.0));
    }

    @fragment fn baseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let output = select(renderSdrBase(source), renderHdrBase(source), p[0] > 0.5);
      return vec4f(output, 1.0);
    }

    @fragment fn localAdjustmentFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let maskDimensions = textureDimensions(spatialTexture);
      let maskCoordinate = clamp(coordinate, vec2i(0), vec2i(maskDimensions) - vec2i(1));
      let influence = clamp(textureLoad(spatialTexture, maskCoordinate, 0).r * p[1] * p[13], 0.0, 1.0);
      return vec4f(mix(source, applyLocalGrade(source), influence), 1.0);
    }

    @fragment fn filmResponseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return vec4f(filmResponse(textureLoad(sourceTexture, coordinate, 0).rgb), 1.0);
    }

    @fragment fn spatialExtractFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let sourceDimensions = vec2f(textureDimensions(sourceTexture));
      let targetDimensions = vec2f(textureDimensions(spatialTexture));
      let scale = sourceDimensions / targetDimensions;
      let center = input.position.xy * scale;
      let offset = scale * 0.25;
      return (
        packedQualifiedSample(center + vec2f(-offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(-offset.x, offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, offset.y))
      ) * 0.25;
    }

    @fragment fn spatialBlurHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(1.0, 0.0), input.position.xy);
    }

    @fragment fn spatialBlurVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(0.0, 1.0), input.position.xy);
    }

    @fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let filmOutput = applyFilmLook(coordinate);
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), displayHdr(filmOutput), p[0] > 0.5);
      return vec4f(displayEncode(output), 1.0);
    }
  `;
})();
