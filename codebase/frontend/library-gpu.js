/* Independent picture transport; Grade's renderer and pinned shaders are reused unchanged. */
window.clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
class HDRLibraryGPU extends HDRWebGPUPreview {
  async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", revision = 0, sourceIdentity = "source", options = {}) {
    const key = `${sessionId}:${lane}`;
    if (this.proxies.has(key)) return this.proxies.get(key);
    const response = await fetch(`/api/library/pixels/${sessionId}?lane=${lane}`, { signal: this.librarySignal });
    if (!response.ok) throw new Error("The cached picture is unavailable; revisit this photo.");
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const stride = Number(response.headers.get("X-Bytes-Per-Row"));
    const body = await response.arrayBuffer();
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
  let renderer, ready, queue = Promise.resolve();
  async function initialize() {
    if (!ready) ready = (async () => {
      renderer = new HDRLibraryGPU(surface);
      if (!await renderer.initialize()) throw new Error("Library pictures need WebGPU on this computer.");
      return renderer;
    })();
    return ready;
  }
  function show(meta, canvas, signal, isCurrent, hdr = false) {
    const pending = queue.catch(() => {}).then(async () => {
      if (signal.aborted || !isCurrent()) return;
      const gpu = await initialize();
      if (signal.aborted || !isCurrent()) return;
      if (canvas.width !== meta.width) canvas.width = meta.width;
      if (canvas.height !== meta.height) canvas.height = meta.height;
      gpu.librarySignal = signal;
      const adjustments = structuredClone(meta.adjustments);
      adjustments.hdr.highlight_compression_target_nits = 1000;
      const result = await gpu.renderTo(canvas, meta.key, hdr ? "hdr" : "sdr", adjustments,
        sampleCurvePoints, meta.edge, [], 0, null, meta.white,
        { width: meta.width, height: meta.height }, { scopeAnalysis: true, isCurrent });
      await gpu.waitForSubmittedWork();
      if (signal.aborted || !isCurrent()) return;
      if (!result?.rendered && result?.execution !== "direct") throw new Error("The library picture could not be drawn.");
      canvas.dataset.rendition = hdr ? "hdr" : "sdr";
      canvas.dataset.surface = gpu.surfaceKeys.get(canvas);
      canvas.dataset.peakNits = hdr ? "1000" : "203";
      return result;
    });
    queue = pending;
    return pending;
  }
  return Object.freeze({ show, initialize });
})();
