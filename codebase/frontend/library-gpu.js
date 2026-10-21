/* Independent picture transport; Grade's renderer and pinned shaders are reused unchanged. */
window.clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
class HDRLibraryGPU extends HDRWebGPUPreview {
  async reportDeliveryActivity(active) {
    // A live draw owns a background lease. It must never announce Grade activity.
    if (this.liveMode) return {reserved:0};
    return super.reportDeliveryActivity(active);
  }
  resourceMemorySnapshot() {
    const value = super.resourceMemorySnapshot();
    const referenced = new Map([...this.proxies.values()].filter(p => this.rawPictures?.owns(p.texture))
      .map(p => [p.texture, p.byteSize || 0]));
    const extra = Math.max(0, (this.rawPictures?.snapshot().bytes || 0) -
      [...referenced.values()].reduce((a, b) => a + b, 0));
    for (const category of [value.resident, value.cached]) {
      category.categories.libraryRetainedBytes = extra;
      category.totalBytes += extra;
    }
    value.peakLogicalBytes += extra;
    value.totals.residentBytes += extra;
    value.totals.cachedBytes += extra;
    value.totals.peakLogicalBytes += extra;
    return value;
  }
  evictGpuCacheEntry(kind, key) {
    const proxy = kind === "source-proxy" ? this.proxies.get(key) : null;
    if (proxy && this.rawPictures?.owns(proxy.texture)) { this.rawPictures.release(proxy.texture); return; }
    super.evictGpuCacheEntry(kind,key);
  }
  resetSession(sessionId = null) {
    // Retained Library scenes have their own bounded owner. Detach references
    // before Grade's unchanged reset clears its per-picture working resources.
    for (const [key, proxy] of this.proxies) if (this.rawPictures?.owns(proxy.texture)) this.proxies.delete(key);
    super.resetSession(sessionId);
  }
  async waitForSubmittedWork(...args) {
    const started = performance.now();
    const result = await super.waitForSubmittedWork(...args);
    HDRLibraryStopwatch("gpu_wait", { duration_ms: performance.now() - started });
    return result;
  }
  async measureToneAdjustedPeak(...args) {
    const started = performance.now();
    const result = await super.measureToneAdjustedPeak(...args);
    HDRLibraryStopwatch("peak_analysis", { duration_ms: performance.now() - started });
    return result;
  }
  async resolveHighlightAnchor(...args) {
    const started = performance.now();
    const result = await super.resolveHighlightAnchor(...args);
    HDRLibraryStopwatch("highlight_analysis", { duration_ms: performance.now() - started });
    return result;
  }
  pipelineFor(format, factory = null) {
    const started = performance.now();
    const result = super.pipelineFor(format, factory);
    HDRLibraryStopwatch("pipeline", { duration_ms: performance.now() - started });
    return result;
  }
  async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", revision = 0, sourceIdentity = "source", options = {}) {
    if (this.libraryMeta?.edge === 100000 && this.liveMode)
      return super.loadProxy(sessionId,lane,longEdge,geometrySignature,revision,sourceIdentity,options);
    const key = this.libraryMeta?.route === "library-live" ? `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}` : `${sessionId}:${lane}`;
    if (this.proxies.has(key)) return this.proxies.get(key);
    if (["camera-raw-gpu", "gpu-raw-thumbnail"].includes(this.libraryMeta?.route)) {
      this.rawPictures ||= HDRLibraryRawGPU.create(this);
      this.rawPictures.configure(this.libraryLimits);
      const entry = await this.rawPictures.convert(this.libraryMeta, this.librarySignal);
      const proxy = this.rawPictures.proxy(this.libraryMeta, lane, entry, geometrySignature, sourceIdentity);
      this.proxies.set(key, proxy);
      return proxy;
    }
    const started = performance.now();
    const url = this.libraryMeta?.route === "library-live" ? `/api/library/live-pixels/${sessionId}?lane=${lane}` : this.libraryMeta?.route === "camera-raw-scene" ? `/api/library/raw-thumbnail/${sessionId}` : `/api/library/pixels/${sessionId}?lane=${lane}`;
    const response = await fetch(url, { signal: this.librarySignal });
    if (!response.ok) throw new Error("The cached picture is unavailable; revisit this photo.");
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const stride = Number(response.headers.get("X-Bytes-Per-Row"));
    const body = await response.arrayBuffer();
    HDRLibraryStopwatch("pixels_fetched", { key: sessionId, duration_ms: performance.now() - started });
    if (options.isCurrent?.() === false) return null;
    const texture = this.device.createTexture({ size: [width, height], format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    this.device.queue.writeTexture({ texture }, body, { bytesPerRow: stride, rowsPerImage: height }, [width, height]);
    const proxy = { texture, width, height, sessionId, lane, longEdge,
      workingSpace: response.headers.get("X-Working-Space"), pixelFormat: "rgba16float",
      geometrySignature, sourceIdentity, identity: key, byteSize: body.byteLength, bindGroups: new Map() };
    this.proxies.set(key, proxy);
    return proxy;
  }
}
window.HDRLibraryPictures = (() => {
  const surface = document.createElement("canvas");
  let renderer, ready, queue = Promise.resolve(), draws = 0, foreground = 0;
  let configuredLimits;
  let initializationDemand = false;
  async function initialize(warm = false, beforeNext = async () => {}) {
    if (!warm) initializationDemand = true;
    if (renderer && !renderer.available && renderer.deviceLost) {
      clearInterval(renderer.deliveryActivityTimer); ready = null; renderer = null;
    }
    if (!ready) ready = (async () => {
      const started = performance.now();
      renderer = new HDRLibraryGPU(surface);
      renderer.libraryLimits = configuredLimits;
      if (!await renderer.initialize(() => beforeNext(() => initializationDemand))) throw new Error("Library pictures need WebGPU on this computer.");
      if (renderer.adapterInfo?.fallback) {
        clearInterval(renderer.deliveryActivityTimer);
        const device = renderer.device; renderer.device = null; device?.destroy();
        throw Error("Library live drawing requires a hardware GPU.");
      }
      HDRLibraryStopwatch("renderer_setup", { duration_ms: performance.now() - started });
      return renderer;
    })();
    try { return await ready; } catch (error) { ready = null; throw error; }
  }
  function show(meta, canvas, signal, isCurrent, hdr = false) {
    const queued = performance.now();
    foreground++;
    const render = async () => {
      if (signal.aborted || !isCurrent()) return;
      HDRLibraryStopwatch("draw_dispatched", { key: meta.key, queue_ms: performance.now() - queued });
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return;
      // Keep the accepted frame at its own shape while conversion and pixels load.
      // renderTo resizes through its presentation gate when the new frame is ready.
      gpu.liveMode = meta.route === "library-live";
      if (gpu.liveMode && gpu.adapterInfo?.fallback) throw Error("Library live drawing requires a hardware GPU.");
      if (!gpu.liveMode && !gpu.deliveryActivityTimer) {
        gpu.deliveryActivityTimer = setInterval(()=>gpu.reportDeliveryActivity().catch(()=>{}),100);
      }
      gpu.librarySignal = signal;
      gpu.libraryMeta = meta;
      if (meta.route === "camera-raw-gpu" && !gpu.rawPictures?.get(meta.key)) {
        gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
        gpu.rawPictures.configure(gpu.libraryLimits);
        await gpu.rawPictures.convert(meta, signal);
        if (signal.aborted || !isCurrent()) return;
      }
      const adjustments = structuredClone(meta.adjustments);
      adjustments.hdr.highlight_compression_target_nits = 1000;
      const started = performance.now();
      const native = meta.edge === 100000 && gpu.liveMode;
      const lease = meta.route === "library-live" ? await HDRLibraryScenes.lease(meta, signal, native) : null;
      if (lease) { clearInterval(gpu.deliveryActivityTimer); gpu.deliveryActivityTimer = null; }
      let result, refusal;
      const previousBudget = gpu.deliveryBudgetBytes;
      try {
      if (gpu.liveMode && gpu.sessionId !== meta.key) gpu.resetSession(meta.key);
      const lane = hdr ? "hdr" : "sdr", denoise = meta.denoise?.[lane];
      if (native) {
        gpu.deliveryBudgetBytes = Math.min(gpu.memoryBudgetBytes(),lease.bytes);
        gpu.gpuAllocator?.setBudget(gpu.memoryBudgetBytes());
        // Establish this scene's working space at Fit before Grade requests a
        // native region. The offscreen canvas is swapped only after detail is ready.
        await gpu.renderTo(canvas,meta.key,lane,adjustments,sampleCurvePoints,2560,meta.locals || [],0,null,meta.white,
          {width:meta.width,height:meta.height},{isCurrent,beforeDeliverySubmit:lease.check});
      }
      const edge = native ? Math.max(meta.scene_width,meta.scene_height,meta.width,meta.height) : Math.max(256,meta.edge);
      if (denoise?.enabled) {
        if (!await gpu.analyzeDenoiseProxy(meta.key,lane,adjustments,edge,0,"source",denoise.controls)) throw Error("Library Denoise analysis failed.");
      } else if (gpu.denoiseSourceSelector) gpu.denoiseSourceSelector.selected = "original";
      result = await gpu.renderTo(canvas, meta.key, lane, adjustments,
        sampleCurvePoints, edge, meta.locals || [], 0, null, meta.white,
        { width: meta.width, height: meta.height }, { scopeAnalysis: !native, isCurrent,
          ...(native ? {viewport:meta.viewport,frameSize:{width:meta.width,height:meta.height}} : {}),
          ...(lease ? {beforeDeliverySubmit:lease.check} : {}) });
      if (native && result?.rendered && isCurrent() && !signal.aborted) {
        // Retain only the visible crop after Grade finishes its frame-anchored
        // viewport graph. The full presentation target is released below.
        const r = meta.viewport, context = canvas.getContext("webgpu");
        await lease.check();
        canvas.width = r.width; canvas.height = r.height;
        gpu.configureSurface(canvas,context,hdr);
        const encoder = gpu.device.createCommandEncoder();
        encoder.copyTextureToTexture({texture:gpu.presentationTarget.texture,origin:{x:r.x,y:r.y}},
          {texture:context.getCurrentTexture()},[r.width,r.height]);
        gpu.device.queue.submit([encoder.finish()]);
      }
      await gpu.waitForSubmittedWork();
      refusal = gpu.lastRenderRefusal?.reason;
      } finally {
        if (native) { gpu.deliveryBudgetBytes = previousBudget; gpu.gpuAllocator?.setBudget(gpu.memoryBudgetBytes()); }
        if (lease) { gpu.resetSession(null); await lease.release(); }
      }
      if (signal.aborted || !isCurrent()) return;
      if (!result?.rendered && result?.execution !== "direct") throw new Error("The library picture could not be drawn: " + (result?.reason || refusal || "render refused"));
      HDRLibraryStopwatch("picture_drawn", { key: meta.key, duration_ms: performance.now() - started, first: draws++ === 0, kept: false });
      canvas.dataset.rendition = hdr ? "hdr" : "sdr";
      canvas.dataset.surface = gpu.surfaceKeys.get(canvas);
      canvas.dataset.peakNits = hdr ? "1000" : "203";
      return result;
    };
    const pending = (meta.route === "library-live" ? HDRLibraryScenes.draw(render,signal,meta.draw_priority ?? 10,meta.path)
      : queue.catch(()=>{}).then(render)).finally(() => { foreground--; });
    queue = pending;
    return pending;
  }
  function prepare(meta, signal, isCurrent = () => true) {
    window.HDRIdleWarmup?.touch();
    const task = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      const gpu = await initialize();
      gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
      gpu.rawPictures.configure(gpu.libraryLimits);
      return gpu.rawPictures.convert(meta, signal);
    }); queue = task; return task;
  }
  window.HDRIdleWarmup?.run("library", async beforeNext => {
    await beforeNext();
    const gpu = await initialize(true, beforeNext);
    if (gpu.adapterInfo?.fallback) return;
    await gpu.warmPipelines("rgba16float", beforeNext);
    await gpu.warmPipelines(navigator.gpu.getPreferredCanvasFormat(), beforeNext);
    await beforeNext();
    gpu.rawPictures ||= HDRLibraryRawGPU.create(gpu);
    await gpu.rawPictures.initialize();
    await beforeNext();
    await HDRLibraryGpuRaw.warmup(beforeNext);
  }, () => foreground > 0);
  return Object.freeze({ show, initialize, prepare,
    configure: async limits => { configuredLimits = limits; if (renderer) renderer.libraryLimits = limits; },
    usable: () => !!renderer?.available && !renderer.deviceLost && !renderer.adapterInfo?.fallback,
    resident: key => !!renderer?.rawPictures?.get(key),
    snapshot: () => renderer?.rawPictures?.snapshot() || {pictures:0,bytes:0} });
})();
