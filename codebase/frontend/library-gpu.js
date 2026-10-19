/* Independent picture transport; Grade's renderer and pinned shaders are reused unchanged. */
window.clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
class HDRLibraryGPU extends HDRWebGPUPreview {
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
    const key = `${sessionId}:${lane}`;
    if (this.proxies.has(key)) return this.proxies.get(key);
    if (this.libraryMeta?.route === "camera-raw-gpu") {
      this.rawPictures ||= HDRLibraryRawGPU.create(this);
      this.rawPictures.configure(this.libraryLimits);
      const entry = await this.rawPictures.convert(this.libraryMeta, this.librarySignal);
      const proxy = this.rawPictures.proxy(this.libraryMeta, lane, entry, geometrySignature, sourceIdentity);
      this.proxies.set(key, proxy);
      return proxy;
    }
    const started = performance.now();
    const url = this.libraryMeta?.route === "camera-raw-scene" ? `/api/library/raw-thumbnail/${sessionId}` : `/api/library/pixels/${sessionId}?lane=${lane}`;
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
  let cacheQueue = Promise.resolve(), configuredLimits;
  const finished = new WeakMap();
  let initializationDemand = false;
  async function initialize(warm = false, beforeNext = async () => {}) {
    if (!warm) initializationDemand = true;
    if (!ready) ready = (async () => {
      const started = performance.now();
      renderer = new HDRLibraryGPU(surface);
      renderer.libraryLimits = configuredLimits;
      if (!await renderer.initialize(() => beforeNext(() => initializationDemand))) throw new Error("Library pictures need WebGPU on this computer.");
      HDRLibraryStopwatch("renderer_setup", { duration_ms: performance.now() - started });
      return renderer;
    })();
    return ready;
  }
  function show(meta, canvas, signal, isCurrent, hdr = false) {
    const queued = performance.now();
    foreground++;
    const pending = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      HDRLibraryStopwatch("draw_dispatched", { key: meta.key, queue_ms: performance.now() - queued });
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return;
      // Keep the accepted frame at its own shape while conversion and pixels load.
      // renderTo resizes through its presentation gate when the new frame is ready.
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
      const result = await gpu.renderTo(canvas, meta.key, hdr ? "hdr" : "sdr", adjustments,
        sampleCurvePoints, meta.edge, [], 0, null, meta.white,
        { width: meta.width, height: meta.height }, { scopeAnalysis: true, isCurrent });
      await gpu.waitForSubmittedWork();
      if (signal.aborted || !isCurrent()) return;
      if (!result?.rendered && result?.execution !== "direct") throw new Error("The library picture could not be drawn.");
      HDRLibraryStopwatch("picture_drawn", { key: meta.key, duration_ms: performance.now() - started, first: draws++ === 0, kept: false });
      canvas.dataset.rendition = hdr ? "hdr" : "sdr";
      canvas.dataset.surface = gpu.surfaceKeys.get(canvas);
      canvas.dataset.peakNits = hdr ? "1000" : "203";
      if (meta.edge <= 640 && !meta.route?.endsWith("-placeholder") && canvas.closest(".library-cell")) {
        const pixels = await gpu.analyzeScope(canvas, {width:meta.width,height:meta.height,tier:"picture",raw:true});
        if (pixels) finished.set(meta, {lane:hdr ? "hdr" : "sdr", pixels});
      }
      return result;
    }).finally(() => { foreground--; });
    queue = pending;
    return pending;
  }
  function saveThumbnail(meta, path, key, signal, isCurrent) {
    const captured = finished.get(meta); finished.delete(meta);
    if (!captured) return Promise.resolve();
    const task = cacheQueue.catch(() => {}).then(async () => {
      // Do not put cache rendering ahead of visible work. At most one small
      // rendition is in flight, and Grade/scroll cancellation stops the rest.
      while (foreground && !signal.aborted && isCurrent()) await new Promise(resolve => setTimeout(resolve,20));
      if (signal.aborted || !isCurrent()) return;
      const permission = await fetch("/api/library/thumbnail-work", {signal});
      if (!permission.ok || (await permission.json()).paused) return;
      const pending = queue.catch(() => {}).then(async () => {
        if (signal.aborted || !isCurrent()) return;
        const gpu = await initialize(), canvas = document.createElement("canvas");
        gpu.librarySignal = signal; gpu.libraryMeta = meta;
        const lane = captured.lane === "hdr" ? "sdr" : "hdr";
        const adjustments = structuredClone(meta.adjustments);
        adjustments.hdr.highlight_compression_target_nits = 1000;
        const result = await gpu.renderTo(canvas,meta.key,lane,adjustments,sampleCurvePoints,meta.edge,[],0,null,meta.white,
          {width:meta.width,height:meta.height},{scopeAnalysis:true,isCurrent,measureOnly:true});
        if (result?.execution !== "direct" || signal.aborted || !isCurrent()) return;
        const other = await gpu.analyzeScope(canvas,{width:meta.width,height:meta.height,tier:"picture",raw:true});
        gpu.scopeSources.delete(canvas);
        if (!other) return;
        const hdr = captured.lane === "hdr" ? captured.pixels : other;
        const sdr = captured.lane === "sdr" ? captured.pixels : other;
        const body = new Uint16Array(hdr.halves.length + sdr.halves.length);
        body.set(hdr.halves); body.set(sdr.halves,hdr.halves.length);
        return body;
      });
      queue = pending;
      const body = await pending;
      if (!body || signal.aborted || !isCurrent()) return;
      const query = new URLSearchParams({path,width:meta.width,height:meta.height});
      const response = await fetch(`/api/library/thumbnail/${key}?${query}`,{method:"POST",body,signal});
      if (!response.ok && response.status !== 409) throw Error("Thumbnail could not be saved.");
    }).catch(error => { if (error.name !== "AbortError") console.debug("Library thumbnail:",error.message); });
    cacheQueue = task; return task;
  }
  // Both renditions drawn off screen and saved as the cell's thumbnail, so the
  // grid's next picture is the saved file a later visit shows too.
  function makeThumbnail(meta, path, key, signal, isCurrent) {
    window.HDRIdleWarmup?.touch();
    const pending = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return null;
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return null;
      gpu.librarySignal = signal; gpu.libraryMeta = meta;
      const adjustments = structuredClone(meta.adjustments);
      adjustments.hdr.highlight_compression_target_nits = 1000;
      const lanes = {};
      for (const lane of ["hdr", "sdr"]) {
        const canvas = document.createElement("canvas");
        const result = await gpu.renderTo(canvas,meta.key,lane,adjustments,sampleCurvePoints,meta.edge,[],0,null,meta.white,
          {width:meta.width,height:meta.height},{scopeAnalysis:true,isCurrent,measureOnly:true});
        if (result?.execution !== "direct" || signal.aborted || !isCurrent()) return null;
        lanes[lane] = await gpu.analyzeScope(canvas,{width:meta.width,height:meta.height,tier:"picture",raw:true});
        gpu.scopeSources.delete(canvas);
        if (!lanes[lane]) return null;
      }
      const body = new Uint16Array(lanes.hdr.halves.length + lanes.sdr.halves.length);
      body.set(lanes.hdr.halves); body.set(lanes.sdr.halves,lanes.hdr.halves.length);
      return body;
    });
    queue = pending;
    return pending.then(async body => {
      if (!body || signal.aborted || !isCurrent()) return false;
      const query = new URLSearchParams({path,width:meta.width,height:meta.height});
      const response = await fetch(`/api/library/thumbnail/${key}?${query}`,{method:"POST",body,signal});
      return response.ok;
    });
  }
  async function showKept(meta, canvas, signal, isCurrent, hdr = false) {
    const queued = performance.now();
    const task = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      HDRLibraryStopwatch("draw_dispatched", { key: meta.key, kept: true, queue_ms: performance.now() - queued });
      const gpu = await initialize();
      const started = performance.now();
      const response = await fetch(`/api/library/kept-pixels/${meta.key}?lane=${hdr ? "hdr" : "sdr"}`, { signal });
      if (!response.ok) throw new Error("The saved Library picture is unavailable; the Library will try making it again.");
      const body = await response.arrayBuffer();
      HDRLibraryStopwatch("pixels_fetched", { key: meta.key, kept: true, duration_ms: performance.now() - started });
      const drawStarted = performance.now();
      if (signal.aborted || !isCurrent()) return;
      const width = Number(response.headers.get("X-Image-Width")), height = Number(response.headers.get("X-Image-Height"));
      canvas.width = width; canvas.height = height;
      const texture = gpu.device.createTexture({ size: [width, height], format: "rgba16float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      try {
        gpu.device.queue.writeTexture({ texture }, body, { bytesPerRow: Number(response.headers.get("X-Bytes-Per-Row")) }, [width, height]);
        const context = canvas.getContext("webgpu"), surface = gpu.configureSurface(canvas, context, hdr);
        const layout = window.HDRGpuParamLayout, P = layout.indices, params = new Float32Array(layout.count);
        params[P.HDR_LANE] = hdr ? 1 : 0; params[P.HDR_SURFACE] = surface.hdr ? 1 : 0;
        params[P.PROJECT_REFERENCE_WHITE_NITS] = 203; params[P.FILM_REFERENCE_WHITE_NITS] = 203;
        params[P.HDR_DISPLAY_HEADROOM] = 1000 * .18 / 203;
        params[P.FRAME_WIDTH] = width; params[P.FRAME_HEIGHT] = height;
        gpu.ensureStorageBuffers(params.byteLength, 4096); gpu.device.queue.writeBuffer(gpu.paramBuffer, 0, params);
        const binding = gpu.bindGraphResources(texture.createView(), texture.createView());
        const encoder = gpu.device.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r:0,g:0,b:0,a:1 } }] });
        pass.setPipeline(gpu.pipelineFor(surface.format).composite); pass.setBindGroup(0, binding); pass.draw(3); pass.end();
        gpu.device.queue.submit([encoder.finish()]); await gpu.waitForSubmittedWork();
        HDRLibraryStopwatch("picture_drawn", { key: meta.key, kept: true, first: draws++ === 0, duration_ms: performance.now() - drawStarted });
        canvas.dataset.rendition = hdr ? "hdr" : "sdr"; canvas.dataset.peakNits = hdr ? "1000" : "203"; canvas.dataset.kept = "true";
      } finally { texture.destroy(); }
    }); queue = task; return task;
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
  return Object.freeze({ show: (meta, ...args) => meta.kept ? showKept(meta, ...args) : show(meta, ...args), initialize, prepare, saveThumbnail, makeThumbnail,
    configure: async limits => { configuredLimits = limits; if (renderer) renderer.libraryLimits = limits; },
    resident: key => !!renderer?.rawPictures?.get(key),
    snapshot: () => renderer?.rawPictures?.snapshot() || {pictures:0,bytes:0} });
})();
