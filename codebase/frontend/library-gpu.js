/* Independent picture transport; Grade's renderer and pinned shaders are reused unchanged. */
window.clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
class HDRLibraryGPU extends HDRWebGPUPreview {
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
  pipelineFor(format) {
    const started = performance.now();
    const result = super.pipelineFor(format);
    HDRLibraryStopwatch("pipeline", { duration_ms: performance.now() - started });
    return result;
  }
  async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", revision = 0, sourceIdentity = "source", options = {}) {
    const key = `${sessionId}:${lane}`;
    if (this.proxies.has(key)) return this.proxies.get(key);
    const started = performance.now();
    const response = await fetch(`/api/library/pixels/${sessionId}?lane=${lane}`, { signal: this.librarySignal });
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
  let renderer, ready, queue = Promise.resolve(), draws = 0;
  async function initialize() {
    if (!ready) ready = (async () => {
      const started = performance.now();
      renderer = new HDRLibraryGPU(surface);
      if (!await renderer.initialize()) throw new Error("Library pictures need WebGPU on this computer.");
      HDRLibraryStopwatch("renderer_setup", { duration_ms: performance.now() - started });
      return renderer;
    })();
    return ready;
  }
  function show(meta, canvas, signal, isCurrent, hdr = false) {
    const queued = performance.now();
    const pending = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      HDRLibraryStopwatch("draw_dispatched", { key: meta.key, queue_ms: performance.now() - queued });
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return;
      if (canvas.width !== meta.width) canvas.width = meta.width;
      if (canvas.height !== meta.height) canvas.height = meta.height;
      gpu.librarySignal = signal;
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
      return result;
    });
    queue = pending;
    return pending;
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
  return Object.freeze({ show: (meta, ...args) => meta.kept ? showKept(meta, ...args) : show(meta, ...args), initialize });
})();
