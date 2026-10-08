(function () {
  class HDRWebGPUPreview {
    static directPreviewMemoryModel(width, height, options = {}) {
      return directPreviewMemoryModel(width, height, options);
    }

    static staticPreviewMemoryModels(options = {}) {
      return STATIC_PREVIEW_MEMORY_CASES.map((entry) => ({
        id: entry.id,
        ...directPreviewMemoryModel(entry.width, entry.height, options),
      }));
    }

    static buildRenderPlan(options = {}) {
      return buildRenderPlan(options);
    }

    static buildTiledPlan(options = {}) {
      return buildTiledPlan(options);
    }

    static detailTileHalo(width, height, params, localAdjustments = [], lane = "hdr") {
      return detailTileHalo(width, height, params, localAdjustments, lane);
    }

    static detailBandIdentity(params, inputIdentity, scope = "global") {
      return detailBandIdentity(params, inputIdentity, scope);
    }

    /**
     * The declared per-module scale contract, for diagnostics and tests.
     *
     * `HDRGraphScale.MODULE_SCALE_CONTRACT` names each scale-sensitive module,
     * about, its authored unit, its radius conversion, its halo and its cache
     * identity. Exposing it here keeps the renderer's diagnostics able to state
     * which contract the running build implements.
     */
    static graphScaleContract() {
      return graphScaleContract().MODULE_SCALE_CONTRACT;
    }

    static processingScaleFor(sourceSize, frame) {
      return graphScaleContract().processingScaleFor(sourceSize, frame);
    }

    static normalizeGpuBudgetBytes(value) {
      return normalizeGpuBudgetBytes(value);
    }

    constructor(canvas) {
      this.canvas = canvas;
      this.context = null;
      this.adapter = null;
      this.device = null;
      this.module = null;
      this.maskModule = null;
      this.pipelines = new Map();
      this.proxies = new Map();
      this.proxyInflight = new Map();
      this.sceneLuminance = new Map();
      this.sceneLuminanceInflight = new Map();
      this.orientedLuminance = new Map();
      this.orientedLuminanceInflight = new Map();
      this.sessionId = null;
      this.available = false;
      this.detail = "WebGPU has not been initialized";
      this.renderSerials = new WeakMap();
      const PresentationGate = typeof window !== "undefined" ? window.HDRPresentationGate : null;
      this.presentationGate = PresentationGate ? new PresentationGate() : null;
      // Session-scoped abort for source transport. Replacing the session aborts
      // every in-flight source fetch; generation checks between chunks stop a
      // superseded stream without waiting for the whole image.
      this.sourceAbort = null;
      // What the canvas is currently showing, so an ROI pass can keep it and
      // composite only the foreground tiles into it.
      this.lastPresentedFrame = null;
      this.presentationTarget = null;
      // Bounded submission log for the supersession stop-gate measurement.
      this.submissionLog = [];
      this.paramBuffer = null;
      this.curveBuffer = null;
      this.curveSampleCache = new Map();
      this.lastCurveSamples = null;
      this.surfaceKeys = new WeakMap();
      this.intermediates = new Map();
      this.localMasks = new Map();
      this.localMaskInflight = new Map();
      this.localParamBuffers = new Map();
      this.localParamValues = new Map();
      this.scopeSources = new WeakMap();
      this.scopeResources = new Map();
      this.scopePeakTargets = [];
      this.peakReductionPipeline = null;
      this.peakReductionCache = new Map();
      // The last real highlight measurement per lane, with the estimate it was
      // taken against, so a drag frame can carry it instead of the estimate.
      this.lastHighlightMeasurement = { hdr: null, sdr: null };
      this.pendingHighlightMeasurement = null;
      // In-flight measurements by cache key, so a settled frame reuses the one
      // a drag frame deferred instead of running the same reduction twice.
      this.pendingHighlightKeys = new Map();
      // Canonical anchor requests are keyed without preview resolution.  Keep
      // one notification outstanding until the app's native tiled reduction
      // publishes the value.
      this.requestedCanonicalHighlightKeys = new Set();
      // Deferred measurements are an optional refinement, so their failure
      // must not replace the accepted frame. Keep a bounded diagnostic trail
      // instead of making those failures disappear.
      this.highlightMeasurementFailures = [];
      this.denoiseResolveVersion = 0;
      this.bindGroupLayout = null;
      this.clarityMaps = null;
      this.clarityFrameMap = null;
      this.pipelineLayout = null;
      this.maskBindGroupLayout = null;
      this.maskPipelineLayout = null;
      this.maskPipelines = null;
      // Mask radii are fractions of the uncropped source's long edge (as in
      // the backend, which builds masks in source space and then crops). A
      // mask here is drawn in the cropped, straightened frame, so the app
      // supplies source long edge / frame long edge for a geometry signature.
      this.featherReferenceScale = null;
      // Masks a render uses are never trimmed from the cache by that render:
      // at native size one feathered luma mask exceeds the cache budget on its
      // own, and trimming it would rebuild the mask on every drag frame.
      this.maskUseSerial = 0;
      this.frameMaskRecord = null;
      this.maskProbePipeline = null;
      // The small bitmap last loaded for each mask, by spatial identity.
      this.softMasks = new Map();
      this.softMaskMaxEdge = SOFT_MASK_MAX_EDGE;
      this.gpuAnalyticMasksEnabled = true;
      this.instrumentationEnabled = false;
      this.performanceMetrics = { renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [] };
      // Denoise seam. This remains null until the explicit selector
      // benchmark asks for it, so the established never-used path owns no
      // denoise resources and performs no denoise dispatches.
      this.denoiseSourceSelector = null;
      this.denoiseSelectorGeneration = 0;
      this.denoiseCounters = this.emptyDenoiseCounters();
      this.adapterInfo = null;
      this.resourceGeneration = 0;
      this.activeRenderCount = 0;
      this.activeScopeCount = 0;
      this.deferredDestroy = [];
      // Planner state. The budget is an application allocation budget
      // chosen by the user, never a physical VRAM measurement.
      this.memoryBudget = "auto";
      this.lastRenderPlan = null;
      // Set when a real allocation fails. It forces subsequent admission to
      // Tiled and is cleared only by an explicit reset, so a transient OOM can
      // never be mistaken for continuing headroom. It never changes the tier.
      this.allocationBackoff = null;
      // Largest source response the browser is ever asked to buffer. Direct
      // execution still allocates one full texture, but fills it from chunks
      // no larger than this.
      this.maxSourceChunkBytes = 16 * 1024 * 1024;
      this.sourceTransportMetrics = null;
      // Which route carries an above-budget source frame.
      // "stream" reads one chunked row-strip response through the staging ring,
      // "single" reads one prebuilt whole-frame response the same way, and
      // "strips" is the per-strip request route the ring first landed with.
      // The streaming route is the measured default; the others stay for the
      // A/B driver and as an in-field fallback.
      this.sourceTransportMode = "stream";
      // The calibrated Auto budget, once a device exists.
      this.gpuBudget = null;
      // One allocator owns the budget, the LRU order and the
      // reservations for everything the renderer caches. Cache entries are
      // evicted through it by global least-recent use, not by per-cache caps.
      const GpuAllocator = typeof window !== "undefined" ? window.HDRGpuAllocator : null;
      this.gpuAllocator = GpuAllocator
        ? new GpuAllocator({ budgetBytes: this.memoryBudgetBytes() })
        : null;
      // A lane keeps its source levels until the central budget asks for them
      // back; this cap only stops pathological key growth.
      this.proxyLevelCapPerLane = 6;
      // Tiled execution. The admission planner uses it when Direct
      // does not fit; the diagnostic hook can still invoke it explicitly.
      this.tileGraph = null;
      this.tileScheduler = null;
      this.tileCompositeParamBuffer = null;
      this.tiledExecutionMetrics = null;
      this.pendingCacheTrim = null;
      this.detailBandTiles = new Map();
      this.maskTiles = new Map();
      this.denoiseTiles = new Map();
      // Every cache map is registered through the allocator, so
      // a set, delete or clear *is* an allocation event and no call site can
      // forget to report one. Reads touch the global LRU order.
      this.proxies = this.trackGpuCache("source-proxy", this.proxies);
      this.sceneLuminance = this.trackGpuCache("scene-luminance", this.sceneLuminance);
      this.orientedLuminance = this.trackGpuCache("oriented-luminance", this.orientedLuminance);
      this.localMasks = this.trackGpuCache("local-mask", this.localMasks);
      this.detailBandTiles = this.trackGpuCache("detail-band-tile", this.detailBandTiles);
      this.maskTiles = this.trackGpuCache("mask-tile", this.maskTiles);
      // Adaptive Denoise's reconstruction of a tile, before any grading. A
      // grade-only edit copies it back instead of reconstructing the tile.
      this.denoiseTiles = this.trackGpuCache("denoise-tile", this.denoiseTiles);
      this.denoiseTileIdentity = null;
      this.denoiseTileCounters = { hits: 0, misses: 0, evictions: 0 };
      const MaskRequestCoordinator = typeof window !== "undefined"
        ? window.HDRMaskRequestCoordinator
        : null;
      this.maskRequestCoordinator = MaskRequestCoordinator
        ? new MaskRequestCoordinator(6)
        : null;
      // Explicit analysis is background work. Its smaller independent queue
      // cannot cancel or consume all request slots from a foreground render.
      this.backgroundMaskRequestCoordinator = MaskRequestCoordinator
        ? new MaskRequestCoordinator(2)
        : null;
      this.maskTileBatch = typeof window !== "undefined" ? window.HDRMaskTileBatch : null;
      this.detailCacheCounters = {
        hits: 0, misses: 0, analysisPasses: 0, evictions: 0,
        globalHits: 0, globalMisses: 0, localHits: 0, localMisses: 0,
      };
    }

    setMemoryBudget(value) {
      this.memoryBudget = value === "auto" ? "auto" : value;
      this.gpuAllocator?.setBudget(this.memoryBudgetBytes());
      return this.memoryBudgetBytes();
    }

    memoryBudgetBytes() {
      const normalized = normalizeGpuBudgetBytes(this.memoryBudget);
      // An explicit setting is the user's number and stands, higher or lower
      // than Auto. Auto is the calibrated budget: half of the detected
      // dedicated video memory, or the stated fallback, lowered by verified
      // adapter facts and the allocation probe.
      if (this.memoryBudget === "auto" && this.gpuBudget?.budgetBytes > 0) {
        return this.gpuBudget.budgetBytes;
      }
      return normalized;
    }

    /**
     * The desktop shell's reading of the active adapter's dedicated video
     * memory, or null when it could not tell. Auto recalibrates from it.
     */
    setDetectedVideoMemory(info) {
      this.detectedVideoMemory = Number(info?.bytes) > 0
        ? { bytes: Number(info.bytes), device: info.device || null, source: info.source || null }
        : null;
      if (this.device || this.adapterInfo) this.calibrateGpuBudget();
      return this.detectedVideoMemory;
    }

    /**
     * Calibrate Auto from verified device information and a
     * bounded allocation probe. The probe is a real device allocation of the
     * candidate's probe size, created and destroyed immediately; a failure is
     * evidence, not an exception, and it downgrades the budget.
     */
    calibrateGpuBudget() {
      const Budget = typeof window !== "undefined" ? window.HDRGpuBudget : null;
      if (!Budget) return null;
      this.gpuBudget = Budget.calibrate({
        policyBytes: GPU_BUDGET_AUTO_BYTES,
        detectedVideoMemory: this.detectedVideoMemory || null,
        adapterInfo: this.adapterInfo,
        limits: this.adapterInfo?.limits || snapshotDeviceLimits(this.device?.limits),
        probe: (bytes) => this.probeGpuAllocation(bytes),
      });
      this.gpuAllocator?.setBudget(this.memoryBudgetBytes());
      return this.gpuBudget;
    }

    probeGpuAllocation(bytes) {
      if (!this.device || !(bytes > 0)) return false;
      try {
        const buffer = this.device.createBuffer({
          size: bytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        buffer.destroy();
        return true;
      } catch (error) {
        this.recordStage("gpu-budget-probe", { bytes, passed: false, reason: error?.message || String(error) });
        return false;
      }
    }

    clearAllocationBackoff() {
      this.allocationBackoff = null;
    }

    recordAllocationFailure(kind, error, detail = {}) {
      const reason = `${kind}: ${error?.message || String(error || "allocation failed")}`;
      this.allocationBackoff = { kind, reason, at: performance.now(), ...detail };
      this.recordStage("allocation-failure", { kind, reason, ...detail });
      return this.allocationBackoff;
    }

    /**
     * Central registry hooks. Every cache entry the renderer
     * holds must pass through `gpuCacheEntry` so the allocator sees its bytes
     * and can release the *texture*, not just the map key, when it evicts.
     * Registration is the allocation: there is no second place to forget.
     */
    trackGpuCache(kind, map) {
      if (!this.gpuAllocator) return map;
      const renderer = this;
      return new Proxy(map, {
        get(target, property) {
          if (property === "set") {
            return (key, value) => {
              const previous = target.get(key);
              if (previous && previous !== value) {
                // A same-key replacement is still an allocation: the old
                // texture must be released, or it becomes unreferenced live
                // memory the registry no longer knows about.
                renderer.gpuCacheRelease(previous);
                renderer.releaseGpuCacheValue(kind, previous);
              }
              target.set(key, renderer.gpuCacheEntry(kind, key, value));
              return this;
            };
          }
          if (property === "delete") {
            return (key) => {
              const previous = target.get(key);
              if (previous) renderer.gpuCacheRelease(previous);
              return target.delete(key);
            };
          }
          if (property === "clear") {
            return () => {
              for (const value of target.values()) renderer.gpuCacheRelease(value);
              return target.clear();
            };
          }
          if (property === "get") {
            return (key) => {
              const value = target.get(key);
              if (value) renderer.touchGpuCache(value);
              return value;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }

    gpuCacheEntry(kind, key, entry) {
      if (!this.gpuAllocator || !entry) return entry;
      if (entry.allocatorEntry) this.gpuAllocator.unregister(entry.allocatorEntry);
      entry.allocatorEntry = this.gpuAllocator.register({
        kind,
        key,
        bytes: entry.byteSize || 0,
        evict: () => this.evictGpuCacheEntry(kind, key),
      });
      return entry;
    }

    gpuCacheRelease(entry) {
      if (!this.gpuAllocator || !entry) return entry;
      if (entry.allocatorEntry) {
        this.gpuAllocator.unregister(entry.allocatorEntry);
        entry.allocatorEntry = null;
      }
      return entry;
    }

    /** Destroy one cache value by kind, without touching its map key. */
    releaseGpuCacheValue(kind, entry) {
      if (!entry) return;
      if (kind === "source-proxy" || kind === "scene-luminance") {
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      } else if (kind === "local-mask") {
        this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
      } else {
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      }
    }

    touchGpuCache(entry) {
      if (this.gpuAllocator && entry?.allocatorEntry) this.gpuAllocator.touch(entry.allocatorEntry);
      return entry;
    }

    /** Release one registered cache entry by kind and key, through its owner. */
    evictGpuCacheEntry(kind, key) {
      if (kind === "source-proxy") {
        const proxy = this.proxies.get(key);
        if (!proxy) return;
        this.proxies.delete(key);
        this.destroyAfterActiveRenders(() => proxy.texture?.destroy());
      } else if (kind === "detail-band-tile") {
        const entry = this.detailBandTiles.get(key);
        if (!entry) return;
        this.detailBandTiles.delete(key);
        this.detailCacheCounters.evictions += 1;
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      } else if (kind === "mask-tile") {
        const entry = this.maskTiles.get(key);
        if (!entry) return;
        this.maskTiles.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      } else if (kind === "denoise-tile") {
        const entry = this.denoiseTiles.get(key);
        if (!entry) return;
        this.denoiseTiles.delete(key);
        this.denoiseTileCounters.evictions += 1;
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      } else if (kind === "scene-luminance") {
        const entry = this.sceneLuminance.get(key);
        if (!entry) return;
        this.sceneLuminance.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      } else if (kind === "local-mask") {
        const entry = this.localMasks.get(key);
        if (!entry) return;
        this.localMasks.delete(key);
        this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
      } else if (kind === "oriented-luminance") {
        const entry = this.orientedLuminance.get(key);
        if (!entry) return;
        this.orientedLuminance.delete(key);
        entry.destroyed = true;
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      }
    }

    /**
     * Merge live renderer state into a render plan for the given output size.
     * Cache multiplicities, mask residency, scope pools, and parameter buffers
     * come from what the renderer is actually holding, so the plan describes
     * this session rather than a generic graph.
     */
    planRender(width, height, options = {}) {
      const denoiseLevels = this.denoiseSourceSelector?.cache?.levels?.length || 0;
      const scopeBytes = [...this.scopeResources.values()].reduce(
        (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
        0,
      );
      const parameterBufferBytes = (this.paramBuffer?.size || 0) + (this.curveBuffer?.size || 0)
        + [...this.localParamBuffers.values()].reduce((sum, buffer) => sum + (buffer.size || 0), 0);
      // Resident source levels at their real size, plus a whole-frame source
      // this render is about to load (a region proxy that Direct replaces).
      const residentProxyBytes = [...this.proxies.values()].reduce((sum, proxy) => sum + (proxy.byteSize || 0), 0);
      const pendingSourceBytes = Math.max(0, Number(options.pendingSourceBytes) || 0);
      const plan = buildRenderPlan({
        width,
        height,
        denoiseLevels,
        cachedProxyLevels: Math.max(1, this.proxies.size),
        sourceProxyBytes: residentProxyBytes + pendingSourceBytes,
        maskCount: [...this.localMasks.values()].filter((mask) => mask.kind !== "gpu-mask-graph").length,
        booleanMaskPasses: [...this.localMasks.values()].filter((mask) => mask.kind === "gpu-mask-graph").length,
        sceneLuminanceEntries: this.sceneLuminance.size,
        scopeBytes,
        parameterBufferBytes,
        // In GiB, the unit the planner takes: the calibrated Auto or the
        // user's limit, never the bare "auto" fallback.
        budget: this.memoryBudgetBytes() / (1024 * 1024 * 1024),
        // Bounded transport means staging is one chunk, not one image.
        stagingBytes: this.maxSourceChunkBytes,
        limits: this.adapterInfo?.limits || snapshotDeviceLimits(this.device?.limits),
        allocationBackoff: this.allocationBackoff?.reason || null,
        ...options,
      });
      this.lastRenderPlan = plan;
      return plan;
    }

    /**
     * Drop source levels this lane can no longer use -- another session, an
     * earlier geometry or source identity, or a region fetched for an earlier
     * viewport -- so admission charges only what is worth keeping. Levels at
     * other long edges of the current source stay: a zoom back reuses them,
     * and the allocator's LRU owns their eviction under pressure.
     */
    evictStaleProxies({ sessionId, lane, geometrySignature, sourceIdentity, keep = null } = {}) {
      let evicted = 0;
      const protectedProxy = this.denoiseSourceSelector?.original || null;
      for (const [key, proxy] of [...this.proxies.entries()]) {
        if (key === keep || proxy === protectedProxy) continue;
        const otherSession = proxy.sessionId !== sessionId;
        const sameLane = proxy.lane === lane;
        const outdated = sameLane && (proxy.geometrySignature !== geometrySignature
          || proxy.sourceIdentity !== sourceIdentity);
        // A region source is replaced by the next region, not by a whole-frame
        // render at another size: zooming back in then needs no fetch.
        const oldRegion = sameLane && String(keep || "").includes(":region:")
          && String(proxy.identity || key).includes(":region:");
        if (!otherSession && !outdated && !oldRegion) continue;
        this.evictGpuCacheEntry("source-proxy", key);
        evicted += 1;
      }
      return evicted;
    }

    /**
     * The execution override a render carries into admission. Only the
     * diagnostic Execution setting forces a route. A region (viewport) request
     * used to be forced to Tiled even when Direct was admitted; it now goes
     * through ordinary admission, Direct when it fits and Tiled only when
     * refused.
     */
    executionOverrideFor(sourceOptions = null) {
      if (this.executionOverride) return this.executionOverride;
      // A magnified view is drawn for the visible region only, whatever the
      // image's size: the tiled route. That includes a drag frame, which is a
      // region pass like any other and costs what is on screen. The catch-up
      // that follows a region pass stays on the same route, so it completes
      // the frame the region pass started instead of replacing it.
      return sourceOptions?.viewport || sourceOptions?.roiCatchUp ? "tiled" : null;
    }

    /**
     * Whether even the smallest graph at these exact dimensions must tile.
     *
     * This is intentionally a lower bound, not a prediction of the current
     * graph.  If it says tiled, no edit can make a Direct interactive draft
     * fit; if it says direct, the caller must dispatch and let the real plan
     * decide.  That one-sided contract avoids suppressing a useful frame.
     */
    minimumExecutionDecision(width, height, tier = null) {
      return buildRenderPlan({
        width,
        height,
        sourceBytesPerPixel: 8,
        detailActive: false,
        spatialActive: false,
        denoiseLevels: 0,
        cachedProxyLevels: 1,
        maskCount: 0,
        booleanMaskPasses: 0,
        sceneLuminanceEntries: 0,
        comparisonLanes: 0,
        scopeBytes: 0,
        parameterBufferBytes: 0,
        stagingBytes: this.maxSourceChunkBytes,
        retainedPresentation: true,
        // In GiB, the unit the planner takes: the calibrated Auto or the
        // user's limit, never the bare "auto" fallback.
        budget: this.memoryBudgetBytes() / (1024 * 1024 * 1024),
        limits: this.adapterInfo?.limits || snapshotDeviceLimits(this.device?.limits),
        allocationBackoff: this.allocationBackoff?.reason || null,
        tier,
      }).decision;
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
        // The default WebGPU maxBufferSize is 256 MiB even when the adapter can
        // support more. An 8192Â² RGBA16F Full surface is 512 MiB, and Chromium's
        // compositor/readback path may require one buffer of that size. Request
        // only the bounded surface maximum, capped to the adapter's capability;
        // this raises a limit but does not allocate the buffer.
        const fullSurfaceBufferLimit = Math.min(
          Number(this.adapter.limits.maxBufferSize) || (256 * 1024 * 1024),
          512 * 1024 * 1024,
        );
        this.device = await this.adapter.requestDevice({
          requiredFeatures: timestampQueries ? ["timestamp-query"] : [],
          requiredLimits: { maxBufferSize: fullSurfaceBufferLimit },
        });
        const info = this.adapter.info || {};
        const adapterDescription = [info.vendor, info.architecture, info.device, info.description]
          .filter(Boolean)
          .join(" ");
        this.adapterInfo = {
          vendor: info.vendor || "unknown",
          architecture: info.architecture || "unknown",
          device: info.device || "unknown",
          description: info.description || "unknown",
          fallback: Boolean(this.adapter.isFallbackAdapter)
            || /swiftshader|llvmpipe|lavapipe|software rasterizer/i.test(adapterDescription),
          timestampQueries,
          limits: snapshotDeviceLimits(this.device.limits),
        };
        // Auto is calibrated once the device exists, and the
        // allocator adopts the calibrated number.
        this.calibrateGpuBudget();
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) throw new Error("The WebGPU canvas context is unavailable");
        this.module = this.device.createShaderModule({ code: SHADER_SOURCE });
        this.maskModule = this.device.createShaderModule({ code: LUMA_MASK_SHADER_SOURCE });
        const [compilation, maskCompilation] = await Promise.all([
          this.module.getCompilationInfo(),
          this.maskModule.getCompilationInfo(),
        ]);
        const errors = [...compilation.messages, ...maskCompilation.messages].filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => (
          `${message.lineNum || "?"}:${message.linePos || "?"} ${message.message}`
        )).join("; "));
        this.bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          ],
        });
        this.spatialSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        });
        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        this.scopePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "scopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.settledScopePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "settledScopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.outputPicturePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "outputPictureFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.maskBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
          ],
        });
        this.maskPipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.maskBindGroupLayout] });
        this.maskPipelines = {
          sceneLuminance: this.createMaskPipeline("sceneLuminanceFragmentMain"),
          qualify: this.createMaskPipeline("lumaQualificationFragmentMain"),
          refine: this.createMaskPipeline("maskRefinementFragmentMain"),
          downsample: this.createMaskPipeline("maskDownsampleFragmentMain"),
          upsample: this.createMaskPipeline("maskUpsampleFragmentMain"),
          combine: this.createMaskPipeline("maskCombineFragmentMain"),
          linearGradient: this.createMaskPipeline("linearGradientFragmentMain"),
          shapeRaster: this.createMaskPipeline("shapeRasterFragmentMain"),
          brushRegionalErase: this.createMaskPipeline("brushRegionalEraseFragmentMain"),
        };
        const lostDevice = this.device;
        this.device.lost.then((info) => {
          // A rebuild replaces the device; the old loss must not clear the new
          // one's availability.
          if (this.device !== lostDevice) return;
          this.deviceLost = true;
          this.available = false;
          this.detail = `WebGPU device lost: ${info.message || info.reason}`;
          window.dispatchEvent(new CustomEvent("hdrfinisher:webgpulost", {
            detail: { message: this.detail, reason: info.reason || null },
          }));
        });
        this.available = true;
        this.detail = this.adapterInfo.fallback
          ? "WebGPU software adapter active; HDR presentation is not authoritative"
          : `WebGPU settled authoring renderer ready (${this.adapterInfo.description})`;
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        return false;
      }
    }

    /**
     * Rebuild the device after device loss (Section 5.8).
     *
     * Device loss is recoverable: the device and every resource created from it
     * are replaced and the caller re-renders. Nothing here disables WebGPU for
     * the session; only repeated initialization failure does, and that decision
     * belongs to the failure policy the caller records into.
     */
    async rebuild() {
      const sessionId = this.sessionId;
      this.available = false;
      // Destroy session caches while the old device reference is still valid,
      // then replace everything the device owned.
      this.resetSession(sessionId);
      this.device = null;
      this.adapter = null;
      this.adapterInfo = null;
      this.gpuBudget = null;
      this.context = null;
      this.module = null;
      this.maskModule = null;
      this.pipelines = new Map();
      this.surfaceKeys = new WeakMap();
      this.bindGroupLayout = null;
      this.clarityMaps = null;
      this.clarityFrameMap = null;
      this.pipelineLayout = null;
      this.maskBindGroupLayout = null;
      this.maskPipelineLayout = null;
      this.maskPipelines = null;
      this.scopePipeline = null;
      this.settledScopePipeline = null;
      this.outputPicturePipeline = null;
      this.spatialSampler = null;
      this.paramBuffer = null;
      this.curveBuffer = null;
      this.peakReductionPipeline = null;
      this.maskProbePipeline = null;
      this.frameMaskRecord = null;
      this.deviceLost = false;
      return this.initialize();
    }

    resetSession(sessionId = null) {
      this.resourceGeneration += 1;
      this.denoiseModelWarm = null;
      this.editingCandidateCache?.clear();
      this.editingAnalysisCanvas = null;
      this.analysisClarityFrameMap = null;
      this.releaseClaritySurround(this.claritySurround);
      this.claritySurround = null;
      // Source fetches for the session being replaced have nowhere to land.
      this.sourceAbort?.abort();
      this.sourceAbort = null;
      this.maskRequestCoordinator?.cancel();
      this.backgroundMaskRequestCoordinator?.cancel();
      this.localMaskInflight.clear();
      // A different session has no accepted frame to retain.
      this.lastPresentedFrame = null;
      this.frameMaskRecord = null;
      this.softMasks.clear();
      this.placeholderSource = null;
      this.presentedMaskKeys = null;
      if (this.presentationTarget) {
        const target = this.presentationTarget;
        if (target.allocatorEntry) {
          this.gpuAllocator?.unregister(target.allocatorEntry);
          target.allocatorEntry = null;
        }
        this.destroyAfterActiveRenders(() => target.texture?.destroy());
        this.presentationTarget = null;
      }
      this.disposeDenoiseSelectorSeam();
      this.destroyTileGraph();
      this.destroyTileGraph("analysisTileGraph");
      for (const entry of this.detailBandTiles.values()) this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      this.detailBandTiles.clear();
      for (const entry of this.maskTiles.values()) this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      this.maskTiles.clear();
      this.dropDenoiseTiles();
      this.denoiseTileIdentity = null;
      this.denoiseTileCounters = { hits: 0, misses: 0, evictions: 0 };
      this.releaseClarityMaps();
      this.detailCacheCounters = {
        hits: 0, misses: 0, analysisPasses: 0, evictions: 0,
        globalHits: 0, globalMisses: 0, localHits: 0, localMisses: 0,
      };
      this.tileScheduler = null;
      this.tiledExecutionMetrics = null;
      this.pendingCacheTrim = null;
      this.sessionId = sessionId;
      this.renderSerials = new WeakMap();
      for (const proxy of this.proxies.values()) this.destroyAfterActiveRenders(() => proxy.texture?.destroy());
      this.proxies.clear();
      this.proxyInflight.clear();
      for (const scene of this.sceneLuminance.values()) this.destroyAfterActiveRenders(() => scene.texture?.destroy());
      this.sceneLuminance.clear();
      this.sceneLuminanceInflight.clear();
      for (const tile of this.orientedLuminance.values()) {
        tile.destroyed = true;
        this.destroyAfterActiveRenders(() => tile.texture?.destroy());
      }
      this.orientedLuminance.clear();
      this.orientedLuminanceInflight.clear();
      this.maskExtents?.clear();
      for (const intermediate of this.intermediates.values()) {
        this.destroyAfterActiveRenders(() => {
          intermediate.baseTexture?.destroy();
          intermediate.filmTexture?.destroy();
          intermediate.spatialATexture?.destroy();
          intermediate.spatialBTexture?.destroy();
          intermediate.localTexture?.destroy();
          intermediate.detailATexture?.destroy();
          intermediate.detailBTexture?.destroy();
        });
      }
      this.intermediates.clear();
      for (const mask of this.localMasks.values()) this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(mask));
      this.localMasks.clear();
      for (const buffer of this.localParamBuffers.values()) buffer.destroy();
      this.localParamBuffers.clear();
      this.localParamValues.clear();
      this.curveSampleCache.clear();
      this.lastCurveSamples = null;
      this.scopeSources = new WeakMap();
      for (const pool of this.scopeResources.values()) {
        for (const resource of pool) {
          this.destroyAfterActiveRenders(() => {
            resource.texture.destroy();
            resource.readBuffer.destroy();
            resource.paramBuffer.destroy();
          });
        }
      }
      this.scopeResources.clear();
      this.peakReductionCache.clear();
      this.requestedCanonicalHighlightKeys.clear();
    }

    invalidateSurfaces() {
      this.surfaceKeys = new WeakMap();
    }

    destroyAfterActiveRenders(callback) {
      if (this.activeRenderCount > 0 || this.activeScopeCount > 0) this.deferredDestroy.push(callback);
      else callback();
    }

    flushDeferredDestroy() {
      if (this.activeRenderCount > 0 || this.activeScopeCount > 0 || !this.deferredDestroy.length) return;
      const callbacks = this.deferredDestroy.splice(0);
      callbacks.forEach((callback) => callback());
    }

    finishActiveRender() {
      this.activeRenderCount = Math.max(0, this.activeRenderCount - 1);
      this.flushDeferredDestroy();
    }

    sourceLoadIsCurrent(canvas, serial, resourceGeneration, options) {
      if (resourceGeneration !== this.resourceGeneration) return false;
      if (typeof options?.isSourceCurrent === "function") return options.isSourceCurrent() !== false;
      return serial === this.renderSerials.get(canvas) && options?.isCurrent?.() !== false;
    }

    async render(sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      return this.renderTo(this.canvas, sessionId, lane, adjustments, curveSampler, longEdge, localAdjustments, editRevision, maskOverlay, referenceWhiteNits, sourceSize, sourceOptions);
    }

    supportsLiveGradientMask(expression, geometrySignature) {
      if (!this.available || !this.gpuAnalyticMasksEnabled) return false;
      let geometry;
      try { geometry = JSON.parse(geometrySignature); } catch { return false; }
      return isGpuLinearGradientMask(expression, JSON.stringify({...geometry,crop:{x:0,y:0,width:1,height:1}}));
    }

    syncGpuCacheBytes(entry) {
      this.gpuAllocator?.resize(entry?.allocatorEntry, entry?.byteSize || 0);
    }

    supportsLocalAdjustments(lane, localAdjustments = []) {
      return activeGpuLocals(lane, localAdjustments).every((local) =>
        gpuLocalSupported(local[`${lane}_grade`]));
    }

    setInstrumentationEnabled(enabled = true) {
      this.instrumentationEnabled = Boolean(enabled);
      if (enabled) {
        this.performanceMetrics = {
          renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [],
        };
      }
    }

    async waitForSubmittedWork() {
      if (!this.available || !this.device) return false;
      try {
        await this.device.queue.onSubmittedWorkDone();
        return this.available;
      } catch {
        // Device-loss handling owns fallback and resource reset. Backpressure
        // must not turn that asynchronous transition into an unhandled error.
        return false;
      }
    }

    emptyDenoiseCounters() {
      return {
        analysisCalls: 0,
        resolveCalls: 0,
        allocations: 0,
        allocatedBytes: 0,
        atomicSwaps: 0,
        toggles: 0,
        // `analysisDispatches` is the number that makes the live-control
        // contract checkable: a drag of Amount, Luminance, Color Noise or
        // Detail Recovery must leave it untouched.
        analysisDispatches: 0,
        resolveDispatches: 0,
        analysisTiles: 0,
        resolveTiles: 0,
        evidenceBytes: 0,
        analysisScratchBytes: 0,
        resolveScratchBytes: 0,
      };
    }

    recordStage(stage, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.stages;
      entries.push({ stage, at: performance.now(), ...detail });
      if (entries.length > 720) entries.shift();
    }

    recordAllocation(kind, bytes, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.allocations;
      entries.push({ kind, bytes, at: performance.now(), ...detail });
      if (entries.length > 480) entries.shift();
    }

    recordPresentation(detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.presentations;
      entries.push({ at: performance.now(), ...detail });
      if (entries.length > 240) entries.shift();
      this.recordStage("presentation", detail);
    }

    resourceMemorySnapshot() {
      const proxyBytes = [...this.proxies.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const sceneLuminanceBytes = [...this.sceneLuminance.values(), ...this.orientedLuminance.values()]
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const localMaskBytes = [...this.localMasks.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      // The two LRU caches and the tiled working graph are real
      // device textures with the same lifetime as any other cache here, so
      // leaving them out made a tiled render's reported peak smaller than a
      // Direct one's while it actually held more.
      const detailBandCacheBytes = [...this.detailBandTiles.values()]
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const maskTileBytes = [...this.maskTiles.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const denoiseTileBytes = [...this.denoiseTiles.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const tileGraphBytes = (this.tileGraph?.byteSize || 0) + (this.analysisTileGraph?.byteSize || 0);
      const scopeBytes = [...this.scopeResources.values()].reduce(
        (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
        0,
      );
      const intermediateEntries = [...this.intermediates.values()];
      const gradingCoreBytes = intermediateEntries.reduce(
        (sum, entry) => sum + entry.width * entry.height * 8 * 4,
        0,
      );
      const gradingSpatialBytes = intermediateEntries.reduce((sum, entry) => {
        if (!entry.spatialATexture || !entry.spatialBTexture) return sum;
        const grid = spatialGridScale(entry.width, entry.height);
        return sum + Math.ceil(entry.width / grid) * Math.ceil(entry.height / grid) * 8 * 2;
      }, 0);
      const gradingDetailBytes = intermediateEntries.reduce((sum, entry) => (
        sum + (entry.detailATexture && entry.detailBTexture ? entry.width * entry.height * 8 * 2 : 0)
      ), 0);
      const gradingIntermediateBytes = gradingCoreBytes + gradingSpatialBytes + gradingDetailBytes;
      const denoiseCache = this.denoiseSourceSelector?.cache;
      const hasMeasuredDenoiseEvidence = denoiseCache?.levels?.some((level) => Array.isArray(level.evidence));
      const measuredDenoiseEvidenceBytes = hasMeasuredDenoiseEvidence
        ? denoiseCache.levels.reduce((sum, level) => (
          sum + (level.evidence || []).reduce((levelSum, entry) => levelSum + (entry.byteSize || 0), 0)
        ), 0)
        : undefined;
      const denoiseReconstructionScratchBytes = (denoiseCache?.resolveScratch || [])
        .reduce((sum, entry) => sum + (entry.byteSize || 0), 0);
      const denoiseParameterBufferBytes = (denoiseCache?.resolveParamBuffers || [])
        .reduce((sum, buffer) => sum + (buffer.size || 0), 0);
      const denoiseEvidenceBytes = measuredDenoiseEvidenceBytes === undefined
        ? (denoiseCache?.byteSize || 0)
        : measuredDenoiseEvidenceBytes;
      const denoiseResolvedBytes = this.denoiseSourceSelector?.resolved?.byteSize || 0;
      const parameterBufferBytes = (this.paramBuffer?.size || 0) + (this.curveBuffer?.size || 0)
        + [...this.localParamBuffers.values()].reduce((sum, buffer) => sum + (buffer.size || 0), 0)
        + intermediateEntries.reduce((sum, entry) => sum + (entry.compositeParamBuffer?.size || 0), 0)
        + denoiseParameterBufferBytes;
      // The retained presentation target is live device memory
      // (and a pinned allocator reservation). It used to be missing from the
      // resident categories while the peak-agreement driver counted it, which
      // is exactly the drift the exit gate measures.
      const presentationSurfaceBytes = this.presentationTarget?.byteSize || 0;
      const residentCategories = {
        sourceProxyBytes: proxyBytes,
        gradingCoreBytes,
        gradingSpatialBytes,
        gradingDetailBytes,
        sceneLuminanceBytes,
        localMaskBytes,
        detailBandCacheBytes,
        maskTileBytes,
        denoiseTileBytes,
        tileGraphBytes,
        scopeBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
        denoiseResolvedBytes,
        parameterBufferBytes,
        presentationSurfaceBytes,
      };
      const residentBytes = Object.values(residentCategories).reduce((sum, value) => sum + value, 0);
      const cachedCategories = {
        sourceProxyBytes: proxyBytes,
        sceneLuminanceBytes,
        localMaskBytes,
        detailBandCacheBytes,
        maskTileBytes,
        denoiseTileBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
      };
      const cachedBytes = Object.values(cachedCategories).reduce((sum, value) => sum + value, 0);
      // Submitted GPU work may still reference resources queued for destruction.
      // These bytes are not part of the current cache, but remain logically live
      // until queue completion. Destruction callbacks do not expose resource size,
      // so this starts at zero and is explicitly marked as untracked below.
      const transientBytes = 0;
      const largestPresentationBytes = intermediateEntries.reduce(
        (largest, entry) => Math.max(largest, entry.width * entry.height * 8),
        0,
      );
      // One extra retained frame is reserved while a scale change replaces the
      // target: the old texture is destroyed only after submitted work that may
      // still read it. The current target's own bytes are resident above.
      const retainedPresentationOverlapBytes = this.performanceMetrics.presentations?.length
        ? (this.presentationTarget?.byteSize || largestPresentationBytes)
        : 0;
      const planningEntry = intermediateEntries.reduce((largest, entry) => (
        !largest || entry.width * entry.height > largest.width * largest.height ? entry : largest
      ), null);
      const planned = planningEntry
        ? directPreviewMemoryModel(planningEntry.width, planningEntry.height, {
          detailActive: Boolean(planningEntry.detailATexture && planningEntry.detailBTexture),
          spatialActive: Boolean(planningEntry.spatialATexture && planningEntry.spatialBTexture),
          denoiseLevels: this.denoiseSourceSelector?.cache?.levels?.length || 0,
          retainedPresentationOverlapBytes,
        })
        : null;
      return {
        planned,
        // The central allocator's view. `usedBytes` is every
        // registered cache entry plus every reservation; `overBudgetBytes` is
        // what eviction could not fund. Peak agreement is measured against the
        // driver/browser overhead separately by the peak-agreement driver.
        allocator: this.gpuAllocator?.snapshot() || null,
        resident: { totalBytes: residentBytes, categories: residentCategories },
        transient: {
          totalBytes: transientBytes,
          categories: { submittedWorkPendingDestructionBytes: 0 },
          complete: this.deferredDestroy.length === 0,
        },
        cached: { totalBytes: cachedBytes, categories: cachedCategories },
        retainedPresentationOverlapBytes,
        peakLogicalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
        totals: {
          plannedBytes: planned?.plannedBytes || 0,
          residentBytes,
          transientBytes,
          cachedBytes,
          retainedPresentationOverlapBytes,
          peakLogicalBytes: residentBytes + transientBytes + retainedPresentationOverlapBytes,
        },
        staticModels: HDRWebGPUPreview.staticPreviewMemoryModels(),
      };
    }

    diagnosticsSnapshot() {
      const memory = this.resourceMemorySnapshot();
      return {
        adapter: this.adapterInfo,
        available: this.available,
        detail: this.detail,
        renders: this.performanceMetrics.renders.map((entry) => ({ ...entry })),
        scopes: (this.performanceMetrics.scopes || []).map((entry) => ({ ...entry })),
        maskEvents: (this.performanceMetrics.maskEvents || []).map((entry) => ({ ...entry })),
        stages: (this.performanceMetrics.stages || []).map((entry) => ({ ...entry })),
        allocations: (this.performanceMetrics.allocations || []).map((entry) => ({ ...entry })),
        presentations: (this.performanceMetrics.presentations || []).map((entry) => ({ ...entry })),
        highlightMeasurementFailures: this.highlightMeasurementFailures.map((entry) => ({ ...entry })),
        denoise: {
          ...this.denoiseCounters,
          selectorCreated: Boolean(this.denoiseSourceSelector),
          selectedSource: this.denoiseSourceSelector?.selected || "original",
          identity: this.denoiseSourceSelector?.identity || null,
          resolvedResident: Boolean(this.denoiseSourceSelector?.resolved),
          cacheReady: Boolean(this.denoiseSourceSelector?.cache),
          algorithmVersion: this.denoiseSourceSelector?.cache?.algorithmVersion || null,
          controls: this.denoiseSourceSelector?.controls
            ? { ...this.denoiseSourceSelector.controls }
            : null,
        },
        resources: {
          proxies: this.proxies.size,
          proxyBytes: [...this.proxies.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0),
          sceneLuminanceTextures: this.sceneLuminance.size,
          localMasks: this.localMasks.size,
          localMaskBytes: [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0),
          maskGraphs: [...this.localMasks.values()].filter((entry) => entry.kind === "gpu-mask-graph").length,
          scopePools: this.scopeResources.size,
          scopeBuffers: [...this.scopeResources.values()].reduce((sum, pool) => sum + pool.length, 0),
          scopeBytes: [...this.scopeResources.values()].reduce(
            (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
            0,
          ),
          gradingIntermediateBytes: [...this.intermediates.values()].reduce((sum, entry) => {
            const grid = spatialGridScale(entry.width, entry.height);
            const spatialWidth = Math.max(1, Math.ceil(entry.width / grid));
            const spatialHeight = Math.max(1, Math.ceil(entry.height / grid));
            const spatialBytes = entry.spatialATexture && entry.spatialBTexture
              ? spatialWidth * spatialHeight * 8 * 2
              : 0;
            const detailBytes = entry.detailATexture && entry.detailBTexture
              ? entry.width * entry.height * 8 * 2
              : 0;
            return sum + entry.width * entry.height * 8 * 4 + spatialBytes + detailBytes;
          }, 0),
          denoiseTextures: (this.denoiseSourceSelector?.resolved ? 1 : 0)
            + (this.denoiseSourceSelector?.cache?.textureCount || 0),
          denoiseBytes: (this.denoiseSourceSelector?.resolved?.byteSize || 0)
            + (this.denoiseSourceSelector?.cache?.byteSize || 0),
          memory,
          // Planner surface: the budget in force, the last plan and its
          // admission decision, and any recorded allocation backoff.
          budget: {
            setting: this.memoryBudget,
            bytes: this.memoryBudgetBytes(),
            // Where Auto's number came from, and the probe
            // evidence behind it. Never a claim about physical VRAM.
            calibration: this.gpuBudget,
          },
          plan: this.lastRenderPlan,
          allocationBackoff: this.allocationBackoff,
          sourceTransport: this.sourceTransportMetrics,
          sourceTransportMode: this.sourceTransportMode,
          maxSourceChunkBytes: this.maxSourceChunkBytes,
          tiledExecution: this.tiledExecutionMetrics,
          tileScheduler: this.tileScheduler?.snapshot?.() || null,
        },
      };
    }

    /**
     * Why a node keeps a graph off the tiled path.
     *
     * Haloed Detail, mask tiles, overlays and the sequential local stack are
     * supported. Any refusal must name a module whose absolute-coordinate or
     * multiscale contract is not supported by the tiled path.
     */
    tiledExecutionRefusals({ activeLocals = [], detailActive, spatialActive, overlayMask, params, surface }) {
      const reasons = [];
      return reasons;
    }

    /**
     * How far past its rectangle a tile has to be correct, for this whole graph.
     *
     * Detail runs before the film stage and the film stage reads a
     * neighbourhood of Detail's output, so the two reaches compose rather than
     * compete. The sum is rounded up to a multiple of four whenever the film
     * stage is involved, because that is what keeps a tile's halo rectangle on
     * a frame quarter-texel boundary and its spatial grid aligned with the
     * frame's.
     *
     * The planner and the encoder both call this. If they disagreed, the
     * planner would admit a tiled execution against a working set the encoder
     * does not build -- which is the same class of defect as a memory ledger
     * that does not count a cache.
     */
    composedTileHalo(width, height, params, activeLocals = [], lane = "hdr") {
      return graphScaleContract().composedReach(width, height, params, activeLocals, lane);
    }

    /**
     * The proxy-to-source scale every parameter build needs.
     *
     * Direct and Tiled must derive this identically or the same grade would
     * read as two different pictures depending on which route ran. The
     * derivation itself is the declared contract (`HDRGraphScale`), shared with
     * the backend's `source_pixel_scale`.
     */
    sourcePixelScaleFor(proxy, sourceSize) {
      return graphScaleContract().processingScaleFor(sourceSize, proxy);
    }

    /** Which optional stages this parameter set actually switches on. */
    graphActivity(params) {
      return graphScaleContract().graphActivity(params);
    }

    /**
     * Rank real source candidates on the GPU without spatial-neighbourhood
     * operations. The returned bounded native patches evaluate those stages
     * on real neighbours; the candidate atlas never invents their input.
     */
    async rankEditingPeakCandidates(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, isCurrent) {
      const signature = JSON.stringify(adjustments.shared?.geometry || {});
      this.editingCandidateCache ||= new Map();
      const evidenceKey = `${sessionId}:${lane}:${signature}:${adjustments.sdr?.use_authored_base}`;
      let evidence = this.editingCandidateCache.get(evidenceKey);
      if (!evidence) {
        const response = await fetch(`/api/session/${sessionId}/peak-candidates/${lane}?edit_revision=${revision}`, { signal: this.sourceAbortSignal() });
        if (!response.ok) throw new Error(`Peak candidate evidence: ${response.status}`);
        evidence = await response.json();
        if (!isCurrent()) return null;
        if (!evidence.samples?.length || evidence.samples.length > 16384) throw new Error("Bounded peak evidence is unavailable");
        this.editingCandidateCache.set(evidenceKey, evidence);
        while (this.editingCandidateCache.size > 4) this.editingCandidateCache.delete(this.editingCandidateCache.keys().next().value);
      }
      const side = 128;
      const rgb = new Float32Array(side * side * 4);
      const position = new Float32Array(rgb.length);
      evidence.samples.forEach(([x, y, r, g, b], i) => {
        rgb.set([r, g, b, 1], i * 4);
        position.set([(x + .5) / evidence.width, (y + .5) / evidence.height, 0, 1], i * 4);
      });
      const textures = [], buffers = [];
      const texture = (format, usage) => {
        const result = this.device.createTexture({ size: [side, side], format, usage });
        textures.push(result); return result;
      };
      try {
        const source = texture("rgba32float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
        const positions = texture("rgba16float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
        this.device.queue.writeTexture({ texture: source }, rgb, { bytesPerRow: side * 16 }, [side, side]);
        const positionHalf = new Uint16Array(position.length);
        for (let i = 0; i < position.length; i++) {
          const value = position[i];
          if (!(value > 0)) continue;
          const exponent = Math.floor(Math.log2(value));
          positionHalf[i] = exponent < -14 ? Math.round(value / 2**-24) : ((exponent + 15) << 10) + Math.round((value / 2**exponent - 1)*1024);
        }
        this.device.queue.writeTexture({ texture: positions }, positionHalf, { bytesPerRow: side * 8 }, [side, side]);
        const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
        const a = texture("rgba16float", usage), b = texture("rgba16float", usage);
        const params = buildParams(lane, adjustments, evidence.working_space, lane === "hdr", white, 1);
        const anchor = this.highlightAnchorRequest(lane, adjustments, { sessionId, geometrySignature: signature, sourceIdentity: "source", identity: evidenceKey }, params, locals);
        // Rank upstream of the shoulder; native patches evaluate all later
        // neighbourhood stages. Unrelated atlas neighbours never feed Detail.
        params[74] = 0;
        this.uploadParamsAndCurves(lane, adjustments, curveSampler, params, locals);
        const pipelines = this.pipelineFor("rgba16float");
        const masks = [];
        if (lane === "hdr") this.markResidentMaskFrame(sessionId, locals, 1600, signature);
        if (lane === "hdr") for (const local of activeGpuLocals(lane, locals)) {
          const entry = await this.loadEditingMask(sessionId, local, revision, signature, evidence, sourceSize, isCurrent, this.sourceAbortSignal());
          if (!entry || !isCurrent()) return null;
          masks.push({ local, entry });
        }
        const encoder = this.device.createCommandEncoder();
        const pass = (target, pipeline, src, mask = src, parameter = this.paramBuffer, overlay = src) => {
          const render = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
          render.setPipeline(pipeline);
          render.setBindGroup(0, this.bindGraphResources(src.createView(), mask.createView(), { buffer: parameter }, overlay.createView()));
          render.draw(3); render.end();
        };
        pass(a, pipelines.base, source, b, this.paramBuffer, b);
        let current = a;
        for (const {local, entry} of masks) {
          const values = buildLocalParams(local, lane, 1,this.localCurveOffsets?.get(local.id) || 0);
          values[14] = values[15] = values[17] = 0;
          const buffer = this.createStorageBuffer(values); buffers.push(buffer);
          this.device.queue.writeBuffer(buffer, 0, values);
          const target = current === a ? b : a;
          pass(target, pipelines.peakCandidateLocal, current, entry.texture, buffer, positions);
          current = target;
        }
        const read = this.device.createBuffer({ size: side * side * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); buffers.push(read);
        encoder.copyTextureToBuffer({ texture: current }, { buffer: read, bytesPerRow: side * 8 }, [side, side]);
        this.device.queue.submit([encoder.finish()]);
        // SDR's automatic anchor is an early, mask-free signal. The pinned
        // prefix reduction evaluates exactly that stage on these real pixels.
        let sdrAnchor = null;
        if (lane === "sdr" && anchor?.measurement === "maximum") {
          params[74] = 1;
          sdrAnchor = await this.measureToneAdjustedPeak({texture: source, width: side, height: side}, params, "maximum", anchor.key);
        }
        await read.mapAsync(GPUMapMode.READ);
        const values = new Uint16Array(read.getMappedRange());
        const ranked = evidence.samples.map((sample, i) => ({
          x: Math.floor(sample[0]), y: Math.floor(sample[1]),
          score: halfToFloat(values[i*4]) * .2722287 + halfToFloat(values[i*4+1]) * .6740818 + halfToFloat(values[i*4+2]) * .0536895,
        })).sort((left, right) => right.score - left.score);
        read.unmap();
        const seen = new Set(), patches = [];
        for (const item of ranked) {
          const x = Math.floor(item.x / 128) * 128, y = Math.floor(item.y / 128) * 128;
          const key = `${x},${y}`;
          if (seen.has(key)) continue;
          seen.add(key); patches.push({x, y, width: Math.min(128, evidence.width - x), height: Math.min(128, evidence.height - y)});
          if (patches.length === 16) break;
        }
        return { ...evidence, samples: undefined, patches, anchor, sdrAnchor };
      } finally {
        textures.forEach(item => item.destroy()); buffers.forEach(item => item.destroy());
      }
    }

    async measureEditingPeak(canvas, sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, options = {}) {
      const isCurrent = options.isCurrent || (() => true);
      if (options.highlightAnchorOnly && adjustments[lane]?.highlight_compression_peak_measurement === "robust") {
        const signature = JSON.stringify(adjustments.shared?.geometry || {});
        const proxy = await this.loadProxy(sessionId, lane, 1600, signature, revision, options.identity || "source", {isCurrent});
        if (!proxy || !isCurrent()) return null;
        const params = buildParams(lane, adjustments, proxy.workingSpace, lane === "hdr", white, this.sourcePixelScaleFor(proxy, sourceSize));
        const anchor = this.highlightAnchorRequest(lane, adjustments, proxy, params, locals);
        if (!anchor) return null;
        let value;
        if (lane === "sdr") {
          value = await this.measureToneAdjustedPeak(proxy, params, "robust", anchor.key);
        } else {
          this.editingAnalysisCanvas ||= document.createElement("canvas");
          const uncompressed = structuredClone(adjustments);
          uncompressed.hdr.highlight_section_enabled = false;
          const rendered = await this.renderTo(this.editingAnalysisCanvas, sessionId, lane, uncompressed, curveSampler, 1600, locals, revision, null, white, sourceSize, {isCurrent, measureOnly:true});
          const finished = this.scopeSources.get(this.editingAnalysisCanvas);
          if (!rendered?.width || !finished || !isCurrent()) return null;
          const pipeline = await this.ensurePeakReductionPipeline("finishedPeakReductionMain");
          value = await this.runPeakReduction(pipeline, finished.filmTexture, finished.width, finished.height, params, "robust", anchor.key);
        }
        return {highlightAnchor:{key:anchor.key, value}};
      }
      const ranked = await this.rankEditingPeakCandidates(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, isCurrent);
      if (!ranked || !isCurrent()) return null;
      if (options.highlightAnchorOnly && lane === "sdr") return { highlightAnchor: ranked.anchor ? {key: ranked.anchor.key, value: ranked.sdrAnchor} : null };
      const signature = JSON.stringify(adjustments.shared?.geometry || {});
      const frame = {width: ranked.width, height: ranked.height,
        longEdge: Math.max(sourceSize.width, sourceSize.height), workingSpace: ranked.working_space};
      const activeLocals = activeGpuLocals(lane, locals);
      const budget = 4*1024*1024;
      // What a patch makes for itself rather than reading at reduced size: its
      // plain luminance masks, and Clarity's maps while their reach fits.
      let analysis = {analysisNativeLuma: true, claritySurround: null};
      let halo, processedBound;
      const bound = () => {
        halo = this.roiSourceHalo(lane, adjustments, frame, sourceSize, {hdr: lane === "hdr"}, white,
          {...options, analysisMasks: true, ...analysis}, activeLocals);
        const surround = analysis.claritySurround;
        processedBound = ranked.patches.reduce((sum, patch) => sum + (patch.width + 2*halo)*(patch.height + 2*halo),
          surround ? surround.frameWidth * surround.frameHeight : 0);
        return processedBound <= budget;
      };
      if (!bound()) {
        const clarity = graphScaleContract().clarityActive(buildParams(lane, adjustments, frame.workingSpace, lane === "hdr", white, 1))
          || activeLocals.some(local => gpuLocalDetailActive(local[`${lane}_grade`]) && graphScaleContract().localClarityActive(local[`${lane}_grade`]));
        const surround = clarity
          ? await this.measurementClaritySurround(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, options)
          : null;
        if (!isCurrent()) return null;
        if (surround) analysis = {...analysis, claritySurround: surround};
        if (!bound()) {
          analysis = {...analysis, analysisNativeLuma: false};
          if (!bound()) return {rendered:false, refusals:["editing peak patch budget exceeded"]};
        }
      }
      let peak = 0, rendered = 0;
      for (const patch of ranked.patches) {
        if (!isCurrent()) return null;
        const x = Math.max(0, patch.x - halo), y = Math.max(0, patch.y - halo);
        const region = {x, y, width: Math.min(frame.width, patch.x + patch.width + halo)-x, height: Math.min(frame.height, patch.y + patch.height + halo)-y};
        let result;
        try {
          result = await this.renderTiledTo(canvas, sessionId, lane, adjustments, curveSampler, Math.max(sourceSize.width,sourceSize.height), locals, revision, null, white, sourceSize, {
            ...options, measureOnly: true, tileSize: 128, analysisPatch: patch, analysisRegion: region, analysisMasks: true,
            ...analysis,
          });
        } finally {
          const key = `${sessionId}:${lane}:${Math.max(sourceSize.width,sourceSize.height)}:${signature}:${options.identity || "source"}:analysis:${JSON.stringify(region)}`;
          this.evictGpuCacheEntry("source-proxy", key);
        }
        if (!result?.rendered || !Number.isFinite(result.metrics?.exactPeak)) return result;
        peak = Math.max(peak, result.metrics.exactPeak); rendered++;
      }
      const result = {rendered:true, metrics:{exactPeak:peak, exactPeakLongEdge:Math.max(frame.width,frame.height), tileCount:rendered, processedBound, bounded:true,
        claritySurround: Boolean(analysis.claritySurround), nativeLumaMasks: analysis.analysisNativeLuma}};
      if (options.highlightAnchorOnly && ranked.anchor) {
        this.peakReductionCache.set(ranked.anchor.key,peak);
        result.highlightAnchor = {key:ranked.anchor.key, value:peak};
      }
      return result;
    }

    highlightAnchorRequest(lane, adjustments, proxy, params, locals = []) {
      const measurement = adjustments[lane]?.highlight_compression_peak_measurement || "maximum";
      const measures = params[74] === 1 && measurement !== "manual";
      if (!measures) return null;
      // A denoise reconstruction carries no session or source identity of its
      // own. Name it by the source it was made from, or its key never matches
      // the editing measurement's and the render asks for the anchor forever.
      const selector = this.denoiseSourceSelector;
      const origin = selector?.original && proxy === selector.resolved ? selector.original : proxy;
      const key = JSON.stringify([
        [origin.sessionId, origin.geometrySignature, origin.sourceIdentity],
        this.highlightSourceToken(proxy), lane, measurement,
        params[2], params[4], params[8], params[9], params[110],
        ...params.slice(10, 12), ...params.slice(61, 73),
        ...params.slice(BLACK_AND_WHITE_PARAM, BLACK_AND_WHITE_PARAM + 9),
        lane === "hdr" ? [adjustments.hdr, locals] : null,
      ]);
      return { measurement, key, cached: this.peakReductionCache.get(key) };
    }

    requestCanonicalHighlightAnchor(anchor, lane, used) {
      if (this.requestedCanonicalHighlightKeys.has(anchor.key)) return;
      this.requestedCanonicalHighlightKeys.add(anchor.key);
      if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
        window.dispatchEvent(new CustomEvent("hdrfinisher:highlight-anchor-needed", {
          detail: { lane, key: anchor.key, used },
        }));
      }
    }

    /**
     * Which pixels a highlight measurement was taken on. The original source
     * and each denoise reconstruction share the proxy identity, so without this
     * a measurement taken with Denoise off was reused with it on, and one taken
     * on an earlier reconstruction was reused for the next.
     */
    highlightSourceToken(proxy) {
      const selector = this.denoiseSourceSelector;
      if (selector?.selected === "resolved") return `denoise:${selector.identity}:${selector.resolvedVersion ?? 0}:${JSON.stringify(selector.controls || {})}`;
      if (selector?.resolved && proxy === selector.resolved) return `denoise:${selector.resolvedVersion ?? 0}`;
      return "original";
    }

    /**
     * The Peak fit shoulder anchor for one render (params[75] arrives holding
     * the rough estimate from the authored source peak).
     *
     * This anchor only shapes the shoulder. The delivery ceiling is a separate
     * per-channel clip at the target in the same shader, which never reads it,
     * so no value here can let output exceed the target. What a bad value can
     * do is change the picture: far too high and the shoulder squeezes the
     * image into SDR range (the 2026-09-25 owner report).
     *
     *   cached     a real measurement for exactly this source and grade.
     *   settled    measure now; a result far above anything plausible is
     *              measured once more and the second result is used as is.
     *   drag       never wait for a whole-image reduction. Carry the last real
     *              measurement, scaled by how the estimate moved, so the
     *              shoulder does not jump between frames; then run the skipped
     *              measurement and ask for a re-render if it differs.
     */
    async resolveHighlightAnchor(anchor, sourceProxy, params, { interactive = false, lane = "hdr" } = {}) {
      const estimate = params[75];
      // The native reduction can land between request construction and this
      // call, so consult the live cache as well as the request snapshot.
      const cached = this.peakReductionCache.has(anchor.key)
        ? this.peakReductionCache.get(anchor.key)
        : anchor.cached;
      if (cached !== undefined) {
        this.noteHighlightMeasurement(lane, sourceProxy, params, cached);
        return cached;
      }
      const carried = this.carriedHighlightAnchor(lane, sourceProxy, params);
      const used = carried ?? estimate;
      // Percentile mode uses a bounded proxy histogram; maximum mode uses
      // ranked native patches. Both run after presentation and remain estimates.
      if (anchor.measurement !== "maximum") {
        this.requestCanonicalHighlightAnchor(anchor, lane, used);
        return used;
      }
      // A display proxy is never allowed to define the canonical cache entry:
      // its mip changes with zoom.  Present immediately with the best carried
      // estimate and ask the scheduler for bounded editing measurement.
      this.requestCanonicalHighlightAnchor(anchor, lane, used);
      return used;
    }

    noteHighlightMeasurement(lane, sourceProxy, params, value) {
      if (!(value > 0)) return;
      this.lastHighlightMeasurement[lane] = {
        identity: sourceProxy.identity,
        tone: highlightToneSettings(params),
        value,
      };
    }

    recordHighlightMeasurementFailure(error, { lane, key, used }) {
      const classify = typeof window !== "undefined" ? window.HDRRenderFailure?.classify : null;
      const failure = classify
        ? classify(error)
        : { kind: error?.name === "AbortError" ? "superseded" : "transport", detail: error?.message || String(error) };
      const record = {
        lane,
        key,
        used,
        kind: failure.kind,
        detail: failure.detail,
        at: performance.now(),
      };
      this.highlightMeasurementFailures.push(record);
      if (this.highlightMeasurementFailures.length > 40) this.highlightMeasurementFailures.shift();
      this.recordStage("highlight-anchor-measurement-failed", record);
      if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
        window.dispatchEvent(new CustomEvent("hdrfinisher:highlight-anchor-measurement-failed", {
          detail: { ...record },
        }));
      }
      return record;
    }

    /**
     * The last real measurement for this lane, carried through the change in
     * the tone stages the measurement applies (exposure, shadow lift,
     * contrast): the measured value is taken back through the settings it was
     * measured with and forward through the current ones, with the same maths
     * as the reduction shader. The authored source peak never enters, so a
     * change to it cannot move the carried anchor. A measurement at another
     * source size is used when none exists at this one: a small mip reads its
     * highlights slightly lower, which is still far closer than the estimate.
     */
    carriedHighlightAnchor(lane, sourceProxy, params) {
      const last = this.lastHighlightMeasurement[lane];
      if (!last) return null;
      const session = (identity) => String(identity || "").split(":")[0];
      if (session(last.identity) !== session(sourceProxy.identity)) return null;
      const now = highlightToneSettings(params);
      const source = invertHighlightTone(last.value, last.tone);
      const carried = applyHighlightTone(source, now);
      return Number.isFinite(carried) && carried > 0 ? carried : null;
    }

    /** Run a measurement a drag frame skipped; re-render if it moves the anchor. */
    scheduleHighlightMeasurement(anchor, sourceProxy, params, lane, used) {
      if (this.pendingHighlightKeys.has(anchor.key)) return this.pendingHighlightKeys.get(anchor.key);
      const snapshot = new Float32Array(params);
      const estimate = params[75];
      const resourceGeneration = this.resourceGeneration;
      const run = (this.pendingHighlightMeasurement || Promise.resolve()).then(async () => {
        if (resourceGeneration !== this.resourceGeneration || !sourceProxy.texture) return;
        const value = await this.measureToneAdjustedPeak(sourceProxy, snapshot, anchor.measurement, anchor.key, {
          reference: Math.max(estimate, used || 0),
        });
        this.noteHighlightMeasurement(lane, sourceProxy, snapshot, value);
        if (Math.abs(value / Math.max(used, 1e-9) - 1) > 0.005
          && typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
          window.dispatchEvent(new CustomEvent("hdrfinisher:highlight-anchor-measured", {
            detail: { lane, key: anchor.key, used, measured: value },
          }));
        }
      }).catch((error) => {
        this.recordHighlightMeasurementFailure(error, { lane, key: anchor.key, used });
        return null;
      }).finally(() => {
        if (this.pendingHighlightKeys.get(anchor.key) === run) this.pendingHighlightKeys.delete(anchor.key);
      });
      this.pendingHighlightKeys.set(anchor.key, run);
      this.pendingHighlightMeasurement = run;
      return run;
    }

    /** Upload the parameter and curve storage both routes read from. */
    uploadParamsAndCurves(lane, adjustments, curveSampler, params, locals = []) {
      const global = buildCurves(lane, adjustments, curveSampler, this.curveSampleCache);
      const curved = activeGpuLocals(lane,locals).filter(local=>!curveSetNeutral(local[`${lane}_grade`]));
      this.localCurveOffsets = new Map();
      const curves = curved.length ? new Float32Array(global.length*(curved.length+1)) : global;
      if (curved.length) {
        curves.set(global);
        curved.forEach((local,index)=>{
          const offset = global.length*(index+1);
          this.localCurveOffsets.set(local.id,offset);
          curves.set(buildCurves(lane,{[lane]:local[`${lane}_grade`]},curveSampler,this.curveSampleCache,
            `${lane}:local:${local.id}`),offset);
        });
      }
      this.ensureStorageBuffers(params.byteLength, curves.byteLength);
      this.device.queue.writeBuffer(this.paramBuffer, 0, params);
      if (curves !== this.lastCurveSamples) {
        this.device.queue.writeBuffer(this.curveBuffer, 0, curves);
        this.lastCurveSamples = curves;
      }
      return curves;
    }

    /** The one bind-group shape every pass on either route uses. */
    bindGraphResources(sourceView, spatialView, parameterBinding = { buffer: this.paramBuffer }, overlayView = spatialView) {
      return this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: parameterBinding },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: spatialView },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: overlayView },
        ],
      });
    }

    /**
     * The grid every tile max-blends its peak into, and the buffer it reads
     * back through. A bounded pair covers presentation/measurement overlap;
     * each target is 64x64 whatever the image is, so it never follows the
     * picture.
     */
    ensureScopePeakTarget() {
      const available = this.scopePeakTargets.find((target) => (
        !target.busy && target.readBuffer.mapState === "unmapped"
      ));
      if (available) {
        available.busy = true;
        return available;
      }
      // One presentation and one background exact-peak measurement may
      // legitimately overlap. Beyond that, omit this optional measurement for
      // the generation instead of reusing a buffer while it is mapped.
      if (this.scopePeakTargets.length >= 2) return null;
      const size = SCOPE_PEAK_GRID;
      // rgba16float is 8 bytes a texel, and copyTextureToBuffer wants rows
      // aligned to 256 bytes. 64 texels is 512 bytes, so the pitch is already
      // aligned and the readback needs no row padding arithmetic.
      const bytesPerRow = size * 8;
      try {
        const target = {
          size,
          bytesPerRow,
          busy: true,
          texture: this.device.createTexture({
            size: { width: size, height: size },
            format: "rgba16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
              | GPUTextureUsage.COPY_SRC,
          }),
          readBuffer: this.device.createBuffer({
            size: bytesPerRow * size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }),
        };
        this.scopePeakTargets.push(target);
        this.recordAllocation("scope-peak", bytesPerRow * size * 2, { width: size, height: size });
        return target;
      } catch (error) {
        this.recordAllocationFailure("scope-peak", error, { width: size, height: size });
        return null;
      }
    }

    /**
     * The exact maximum of a finished generation, from the accumulated grid.
     *
     * Returns null rather than a guess when the readback cannot be taken, so a
     * caller can say the peak is unmeasured instead of reporting a wrong one.
     */
    async readScopePeak(target) {
      return scopeReadback().readPeak(target, halfToFloat);
    }

    /**
     * One reusable tile-sized working set.
     *
     * This is the whole point of tiled execution: the graph's intermediates
     * stop following the image and follow the tile instead, so peak residency
     * stays flat as the selected tier grows.
     */
    ensureTileGraph(width, height, outputFormat, sourceFormat, spatialActive = false, denoiseActive = false, spatialGrid = 4, analysis = false) {
      const graphKey = analysis ? "analysisTileGraph" : "tileGraph";
      const current = this[graphKey];
      if (current && current.width === width && current.height === height
        && current.outputFormat === outputFormat && current.sourceFormat === sourceFormat
        && current.spatialActive === spatialActive && current.denoiseActive === denoiseActive
        && current.spatialGrid === spatialGrid) {
        return current;
      }
      this.destroyTileGraph(graphKey);
      const make = (format, usage) => this.device.createTexture({
        size: { width, height }, format, usage,
      });
      const attachment = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      // The spatial pair is the work tile over the frame's spatial grid in
      // each axis, the same ratio the Direct graph uses.
      const spatialWidth = Math.max(1, Math.ceil(width / spatialGrid));
      const spatialHeight = Math.max(1, Math.ceil(height / spatialGrid));
      const makeSpatial = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight }, format: "rgba16float", usage: attachment,
      });
      try {
        this[graphKey] = {
          width,
          height,
          outputFormat,
          sourceFormat,
          spatialActive,
          sourceTexture: make(sourceFormat, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST),
          baseTexture: make("rgba16float", attachment),
          localTexture: make("rgba16float", attachment),
          detailScratchTexture: make("rgba16float", attachment),
          detailResultTexture: make("rgba16float", attachment | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST),
          filmTexture: make("rgba16float", attachment),
          // A measurement copies its patch out of the finished tile.
          finishTexture: make("rgba16float", analysis ? attachment | GPUTextureUsage.COPY_SRC : attachment),
          spatialATexture: spatialActive ? makeSpatial() : null,
          spatialBTexture: spatialActive ? makeSpatial() : null,
          spatialWidth,
          spatialHeight,
          spatialGrid,
          denoiseActive,
          // One tile's worth of denoised picture, rebuilt per tile from cached
          // evidence. The whole-frame resolved texture this replaces is 340 MB
          // on a 42 MP frame, and allocating it is what used to put a denoised
          // Full over any budget.
          denoiseResolvedTexture: denoiseActive
            ? this.device.createTexture({
              label: "tile-denoise-resolved",
              size: { width, height },
              format: "rgba16float",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
                | GPUTextureUsage.COPY_SRC,
            })
            : null,
          byteSize: width * height * (8 * 6 + (sourceFormat === "rgba16float" ? 8 : 16))
            + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0)
            + (denoiseActive ? width * height * 8 : 0),
        };
      } catch (error) {
        this.recordAllocationFailure("tile-graph", error, { width, height });
        this[graphKey] = null;
        return null;
      }
      this.recordAllocation("tile-graph", this[graphKey].byteSize, { width, height });
      if (this.gpuAllocator) {
        // A pinned reservation: the graph is the pass's own working set, never
        // an eviction candidate while it exists.
        this[graphKey].allocatorEntry = this.gpuAllocator.register({
          kind: "tile-graph", key: graphKey, bytes: this[graphKey].byteSize, pinned: true,
        });
      }
      return this[graphKey];
    }

    destroyTileGraph(graphKey = "tileGraph") {
      const graph = this[graphKey];
      if (!graph) return;
      this[graphKey] = null;
      if (graph.allocatorEntry) {
        this.gpuAllocator?.unregister(graph.allocatorEntry);
        graph.allocatorEntry = null;
      }
      this.destroyAfterActiveRenders(() => {
        graph.sourceTexture?.destroy();
        graph.baseTexture?.destroy();
        graph.localTexture?.destroy();
        graph.detailScratchTexture?.destroy();
        graph.detailResultTexture?.destroy();
        graph.filmTexture?.destroy();
        graph.finishTexture?.destroy();
        graph.spatialATexture?.destroy();
        graph.spatialBTexture?.destroy();
        graph.denoiseResolvedTexture?.destroy();
      });
    }

    /**
     * The source region this pass should fetch, or null for the whole frame.
     *
     * A region is only safe when the retained target already holds the
     * accepted frame at this size, lane, geometry and format -- that is what
     * guarantees the pass processes the viewport's tiles rather than the whole
     * frame. The frame dimensions are confirmed after the fetch; a mismatch
     * falls back to the whole-frame route.
     */
    roiRegionFor(canvas, context, sessionId, lane, adjustments, sourceSize, referenceWhiteNits, sourceOptions, activeLocals, longEdge) {
      const viewport = sourceOptions?.viewport || null;
      if (!viewport) return null;
      // Only the tiled route draws a region; anything else needs the frame.
      if (this.executionOverrideFor(sourceOptions) !== "tiled") return null;
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      // Luma leaves need the scene picture and a globally aligned feather
      // halo. Supported expression graphs compose those same regional leaves.
      if (lane === "hdr" && (sourceOptions?.identity || "source") === "source"
        && (activeLocals || []).some((local) => maskUsesLuminance(local.mask)
          && !isGpuLumaMask(local.mask) && !gpuRegionalGraphEligible(local.mask, geometrySignature)
          && !this.sourceSpaceMask(sessionId, local.mask, longEdge, geometrySignature))) return null;
      // The whole frame's source, once resident, serves every region of it
      // with no fetch at all.
      if (this.wholeSourceResident(sessionId, lane, longEdge, geometrySignature, sourceOptions?.identity || "source")) {
        return null;
      }
      const surface = this.configureSurface(canvas, context, lane === "hdr");
      const Contract = typeof window !== "undefined" ? window.HDRViewportRequest : null;
      if (!Contract?.sourceFetchRegion) return null;
      let previousFrame = this.retainedTiledFrame(sessionId, lane, geometrySignature, surface.format)
        ? this.lastPresentedFrame : null;
      // A viewport is measured in the requested frame's coordinates. A
      // retained frame from another scale cannot anchor its ROI fetch.
      if (previousFrame && (previousFrame.longEdge || Math.max(previousFrame.width, previousFrame.height)) !== longEdge) {
        previousFrame = null;
      }
      if (!previousFrame) {
        // The first magnified pass has no frame of its own size to go by. The
        // app states the size it will be, and any frame of this session and
        // lane gives the working space. The fetch clamps to the real frame.
        const size = sourceOptions?.frameSize;
        const known = this.lastPresentedFrame;
        if (!(size?.width > 0 && size?.height > 0) || !known?.workingSpace
          || known.sessionId !== sessionId || known.lane !== lane) return null;
        previousFrame = { width: size.width, height: size.height, longEdge, workingSpace: known.workingSpace };
      }
      if (!previousFrame.workingSpace) return null;
      const Scheduler = typeof window !== "undefined" ? window.HDRTileScheduler : null;
      const tileSize = Math.max(64, Math.floor(Number(sourceOptions?.tileSize) || Scheduler?.DEFAULT_TILE_SIZE || 512));
      // A mask finished in source space is not feathered on the picture.
      const pictureLumaLocals = (activeLocals || []).filter(local =>
        !this.sourceSpaceMask(sessionId, local.mask, longEdge, geometrySignature));
      const halo = this.roiSourceHalo(
        lane, adjustments, previousFrame, sourceSize, surface, referenceWhiteNits, sourceOptions, activeLocals,
        pictureLumaLocals,
      );
      const request = this.tileViewportRequest(
        sessionId, lane, previousFrame, sourceSize, sourceOptions, geometrySignature, tileSize, halo,
      );
      let region = Contract.sourceFetchRegion(
        request.visible,
        previousFrame.width,
        previousFrame.height,
        tileSize,
        request.halo,
        request.minimumRoiFraction,
      );
      if (region && lumaSceneSource(lane, sourceOptions?.identity, previousFrame.workingSpace)) {
        // Downsampling must start on the same cells as a whole-frame mask.
        let alignment = 1;
        const gcd = (a,b) => b ? gcd(b,a%b) : a;
        for (const leaf of pictureLumaLocals.flatMap(local => gpuLumaLeaves(local.mask))) {
          const factor = lumaFeatherPlan(leaf.mask_feather, previousFrame.width,
            previousFrame.height, this.featherReferenceScale?.(geometrySignature) || 1).factor;
          alignment = alignment / gcd(alignment,factor) * factor;
          if (alignment > 512) return null;
        }
        const x = Math.floor(region.x/alignment)*alignment, y = Math.floor(region.y/alignment)*alignment;
        region = {x,y,width:Math.min(previousFrame.width,Math.ceil((region.x+region.width)/alignment)*alignment)-x,
          height:Math.min(previousFrame.height,Math.ceil((region.y+region.height)/alignment)*alignment)-y};
        // A resident region may only stand in for this one on the same cells.
        if (alignment > 1) region.alignment = alignment;
      }
      return region;
    }

    /**
     * Whether the rest of a frame can be drawn around a region pass without
     * asking the backend for a single mask: every local's mask is a soft
     * bitmap already resident, or is made on the GPU. A hard-edged mask is
     * produced for the visible region only (Viewport PRD 5.1), so a frame
     * with one is completed tile by tile as the view reaches it, never whole.
     */
    catchUpNeedsNoBackendMasks(sessionId, lane, longEdge, geometrySignature, localAdjustments) {
      return activeGpuLocals(lane, localAdjustments).every((local) => {
        const mask = local.mask;
        if (isGpuLumaMask(mask)) return this.wholeSourceResident(sessionId, "hdr", longEdge, geometrySignature, "source");
        if (mask?.operator !== "leaf") return false;
        if (this.gpuAnalyticMasksEnabled && isGpuLinearGradientMask(mask, geometrySignature)) return true;
        if (this.gpuAnalyticMasksEnabled && window.HDRMaskRaster?.eligible(mask,geometrySignature)) return true;
        const entry = this.softMasks.get(softMaskIdentity(sessionId, geometrySignature, gpuMaskIdentity(mask)));
        return Boolean(entry && !entry.destroyed && (entry.soft || (entry.larger?.soft && !entry.larger.destroyed)));
      });
    }

    wholeSourceResident(sessionId, lane, longEdge, geometrySignature, sourceIdentity = "source") {
      return this.proxies.has(`${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}`);
    }

    /**
     * The last finished frame of this session, lane and geometry, if its
     * texture is still the one the direct route holds for this canvas.
     */
    placeholderFor(canvas, sessionId, lane, geometrySignature) {
      const source = this.placeholderSource;
      if (!source || source.canvas !== canvas || source.sessionId !== sessionId || source.lane !== lane
        || source.geometrySignature !== geometrySignature) return null;
      const intermediate = this.intermediates.get(canvas);
      return intermediate && intermediate === source.intermediate && intermediate.finishTexture === source.texture
        ? source.texture : null;
    }

    /** One immutable frame-anchored request shared by source, graph and masks. */
    tileViewportRequest(sessionId, lane, frame, sourceSize, sourceOptions, geometrySignature, tileSize, halo) {
      const Contract = typeof window !== "undefined" ? window.HDRViewportRequest : null;
      if (!Contract) throw new Error("HDRViewportRequest is required for tiled rendering");
      const source = sourceSize || { width: frame.width, height: frame.height };
      const requested = sourceOptions?.viewport;
      const left = Math.max(0, Math.min(frame.width, Math.floor(Number(requested?.x) || 0)));
      const top = Math.max(0, Math.min(frame.height, Math.floor(Number(requested?.y) || 0)));
      const right = Math.max(left, Math.min(frame.width, Math.ceil((Number(requested?.x) || 0) + (Number(requested?.width) || 0))));
      const bottom = Math.max(top, Math.min(frame.height, Math.ceil((Number(requested?.y) || 0) + (Number(requested?.height) || 0))));
      const visible = requested && right > left && bottom > top
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null;
      return Contract.build({
        sessionId, lane, geometrySignature,
        applicationGeneration: sourceOptions?.applicationGeneration,
        editRevision: sourceOptions?.editRevision,
        output: { width: frame.width, height: frame.height },
        source,
        scale: this.sourcePixelScaleFor(frame, source),
        visible,
        minimumRoiFraction: sourceOptions?.minimumRoiFraction,
        tileSize, halo,
        dpr: sourceOptions?.dpr,
        zoom: sourceOptions?.zoom,
      });
    }

    /**
     * Whether the retained presentation target still holds the accepted frame
     * for this session, lane, geometry and surface format.
     *
     * This is about the frame, not the request: a whole-frame catch-up retains
     * too, it just has no region to answer from the pan cache. It is also what
     * makes a region source safe -- without a retained frame the pass
     * processes every tile, not just the viewport's.
     */
    retainedTiledFrame(sessionId, lane, geometrySignature, format) {
      const previousFrame = this.lastPresentedFrame;
      return Boolean(this.presentationTarget?.valid)
        && Boolean(previousFrame)
        && previousFrame.sessionId === sessionId
        && previousFrame.lane === lane
        && previousFrame.geometrySignature === geometrySignature
        && previousFrame.execution === "tiled"
        && previousFrame.format === format;
    }

    /**
     * The graph halo a magnified ROI pass will need, computed before its
     * source is fetched so the fetch region can be sized correctly.
     *
     * The retained frame carries the working space and dimensions this pass
     * will use, so the parameter set and the composed halo are the same ones
     * `encodeTiledGeneration` derives after the proxy arrives.
     */
    roiSourceHalo(lane, adjustments, frame, sourceSize, surface, referenceWhiteNits, sourceOptions, activeLocals,
      lumaLocals = activeLocals) {
      if (!frame?.workingSpace) return 0;
      const params = buildParams(
        lane, adjustments, frame.workingSpace, surface.hdr, referenceWhiteNits,
        this.sourcePixelScaleFor(frame, sourceSize),
      );
      const surround = sourceOptions?.claritySurround || null;
      let { halo } = this.composedTileHalo(frame.width, frame.height, surroundHaloParams(params, surround),
        surroundHaloLocals(activeLocals, lane, surround), lane);
      const selector = this.denoiseSourceSelector;
      const adaptive = this.adaptiveDenoiseSelected();
      const denoiseActive = adaptive || Boolean(
        selector?.cache && selector.original
        && selector.selected === "resolved"
        && selector.original.width === frame.width
        && selector.original.height === frame.height,
      );
      const alignment = denoiseActive ? denoiseTileAlignment(selector.cache.settings.levels) : 1;
      if (halo % alignment) halo = Math.ceil(halo / alignment) * alignment;
      // Adaptive Denoise reconstructs a tile from the source around it, so the
      // region has to reach that far past every tile's halo.
      if (adaptive) halo += Math.ceil(ADAPTIVE_DENOISE_MARGIN / alignment) * alignment;
      // Global Clarity's map pre-pass reads the picture around the tiles, not
      // just their halos: its reach, rounded out to whole blocks and to the
      // denoise grid. The source region has to cover that too.
      const contract = graphScaleContract();
      if (contract.clarityActive(params) && !surround?.global) {
        const clarity = contract.clarityMapPlan(contract.claritySigma(frame.width, frame.height, params[151]));
        halo = Math.max(halo, clarity.reach + clarity.scale + alignment);
      }
      const referenceScale = this.featherReferenceScale?.(JSON.stringify(adjustments.shared?.geometry || {})) || 1;
      if (!sourceOptions?.analysisMasks && lumaSceneSource(lane, sourceOptions?.identity, frame.workingSpace)) {
        for (const leaf of (lumaLocals || []).flatMap(local => gpuLumaLeaves(local.mask))) {
          const plan = lumaFeatherPlan(leaf.mask_feather,frame.width,frame.height,referenceScale);
          halo = Math.max(halo, lumaFeatherReach(plan));
        }
      }
      // A measurement patch makes its plain luminance leaves from its own
      // pixels, so it carries their feather's reach.
      if (sourceOptions?.analysisNativeLuma && lumaSceneSource(lane, sourceOptions?.identity, frame.workingSpace)) {
        for (const local of activeLocals || []) {
          const plan = analysisLumaPlan(local.mask, frame.width, frame.height, referenceScale);
          if (plan) halo = Math.max(halo, lumaFeatherReach(plan));
        }
      }
      return halo;
    }

    /**
     * Render the selected tier tile by tile.
     *
     * Every foreground tile uses the same ordered graph as Direct. The
     * immutable viewport request fixes the frame scale, ROI and halo for
     * source fetch, scheduler, masks and graph execution. Small command
     * batches write an offscreen target; one final copy presents it.
     */
    prefetchZoomMasks(canvas, sessionId, locals, editRevision, geometrySignature, sourceOptions, serial, longEdge = 0) {
      if (!sourceOptions?.viewport || sourceOptions?.measureOnly) return;
      const generation = this.resourceGeneration;
      const current = () => generation === this.resourceGeneration
        && serial === this.renderSerials.get(canvas) && sourceOptions?.isCurrent?.() !== false;
      let uncropped = geometrySignature;
      try { uncropped = JSON.stringify({...JSON.parse(geometrySignature), crop: {x: 0, y: 0, width: 1, height: 1}}); } catch { /* keep */ }
      for (const local of locals) {
        const signal = this.sourceAbortSignal();
        // A straightened or perspective mask is warped on the GPU: prepare
        // its range (and feather field) instead of a bitmap it will not use.
        const recipe = this.gpuAnalyticMasksEnabled && this.resamplePlan(sessionId, local.mask, longEdge, geometrySignature);
        if (recipe) {
          void this.gpuMaskExtent(sessionId, local.mask, longEdge, recipe.frame,
            () => current() && !signal?.aborted).catch(() => null);
          continue;
        }
        if (local.mask?.operator !== "leaf" || isGpuLumaMask(local.mask)) continue;
        // An index crop changes placement, not eligibility: such a leaf is
        // rastered for the region and needs no bitmap.
        if (this.gpuAnalyticMasksEnabled && (window.HDRMaskRaster?.eligible(local.mask, uncropped)
          || isGpuLinearGradientMask(local.mask, uncropped))) continue;
        const leaf = local.mask.leaf;
        const field = () => this.prefetchGpuBrushFeatherField(sessionId, local.mask, longEdge, geometrySignature, current);
        // Native Shift never uses a qualified bitmap, so none is prepared.
        if (leaf?.type === "brush" && Number(leaf.mask_shift_edge) && field()) continue;
        const resident = this.softMasks.get(softMaskIdentity(sessionId, geometrySignature, gpuMaskIdentity(local.mask)));
        const erased = leaf?.type === "brush" && leaf.strokes?.some(stroke => stroke.erase);
        if (erased && !(resident?.soft && !resident.destroyed) && field()) continue;
        void this.softLeafMask(sessionId, local, local.mask, "", editRevision, geometrySignature, current, signal)
          .then(soft => { if (!soft && !signal?.aborted) field(); }).catch(() => null);
      }
    }

    /** Start the viewport-independent feather field while the zoomed source
     * is still in transit. Returns whether this mask takes the native route.
     */
    prefetchGpuBrushFeatherField(sessionId, expression, longEdge, geometrySignature, current) {
      const helper = window.HDRGpuBrushMask;
      if (!this.gpuAnalyticMasksEnabled || !helper?.featherFieldPlan || !(longEdge > SOFT_MASK_MAX_EDGE)
        || expression?.leaf?.type !== "brush" || !current()) return false;
      let frame = null;
      try { frame = this.analyticMaskFrame(sessionId, longEdge, geometrySignature); } catch { return false; }
      if (!frame) return false;
      const limit = this.device.limits.maxTextureDimension2D;
      if (!helper.featherFieldPlan(expression, frame.width, frame.height, frame.geometrySignature, limit)) {
        // Unfeathered Shift has no field; its pipelines can still compile now.
        const shifted = Boolean(helper.shiftRegionPlan(expression, frame.width, frame.height, frame.geometrySignature,
          {x: 0, y: 0, width: 1, height: 1}, limit));
        if (shifted) helper.warm(this);
        return shifted;
      }
      const generation = this.resourceGeneration, device = this.device;
      void this.loadGpuBrushFeatherField(sessionId, longEdge, geometrySignature, expression, frame,
        () => current() && this.resourceGeneration === generation && this.device === device).catch(() => null);
      return true;
    }

    async loadEditingMask(sessionId, local, revision, signature, frame, sourceSize, isCurrent, signal) {
      const nativeEdge = Math.max(sourceSize?.width || frame.width, sourceSize?.height || frame.height);
      const width = Math.ceil(frame.width * SOFT_MASK_MAX_EDGE / nativeEdge);
      const height = Math.ceil(frame.height * SOFT_MASK_MAX_EDGE / nativeEdge);
      // Reuse precisely the existing preview fallback, only where its bitmap
      // fits the measurement budget. Never enter the native-mask alternative.
      if (local.mask?.operator === "leaf" && !isGpuLumaMask(local.mask)
        && width * height <= 4 * 1024 * 1024) {
        const identity = softMaskIdentity(sessionId, signature, gpuMaskIdentity(local.mask));
        const verdict = this.softMasks.get(identity);
        if (verdict && !verdict.soft && verdict.softRetryable) {
          const soft = await this.softLeafMask(sessionId, local, local.mask, "", revision, signature, isCurrent, signal);
          if (soft) return soft;
        }
      }
      return this.loadLocalMask(sessionId, local, 1600, revision, signature, isCurrent, signal, false);
    }

    async renderTiledTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      if (!this.available || !this.device) return false;
      if (sourceSize) this.maskSourceSize = {sessionId,...sourceSize};
      const Scheduler = typeof window !== "undefined" ? window.HDRTileScheduler : null;
      if (!Scheduler) return { rendered: false, refusals: ["tile scheduler is unavailable"] };
      this.activeRenderCount += 1;
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      // Read-only reductions do not supersede the visible canvas generation.
      if (!sourceOptions?.measureOnly) this.renderSerials.set(canvas, serial);
      // The source this pass reads is pinned for the pass: a cache allocation
      // inside the pass may trigger global eviction, and the texture being
      // copied from must never be the victim.
      let proxyPin = null;
      try {

      const tileSize = Math.max(64, Math.floor(Number(sourceOptions?.tileSize) || Scheduler.DEFAULT_TILE_SIZE));
      // The signature is derived from the adjustments this render was handed,
      // exactly as the Direct path derives it, so both request the same proxy.
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceIdentity = sourceOptions?.identity || "source";
      const activeLocals = activeGpuLocals(lane, localAdjustments);

      const context = canvas.getContext("webgpu");
      if (!context) return { rendered: false, refusals: ["no webgpu canvas context"] };
      // A measurement pass never presents, so it must not resize the canvas
      // the viewer is looking at, and it needs no presentation surface at its
      // own resolution -- which is the whole reason a native measurement is
      // affordable when a native *presentation* would not be. It borrows the
      // surface format only, to pick the same pipelines.
      const measureOnly = Boolean(sourceOptions?.measureOnly);
      // The canvas is resized and configured only at presentation time, inside
      // `encodeTiledGeneration`, once masks and the tile graph are ready. The
      // accepted frame stays on screen until its replacement can actually be
      // encoded, and a superseded generation never clears it.
      const surface = this.configureSurface(canvas, context, lane === "hdr");
      // A magnified ROI fetches only the source region it will
      // process, from the mip this pass needs, instead of the whole frame at
      // that scale. `roiRegionFor` returns null unless the retained frame
      // makes the region safe, so this is the ordinary whole-frame route in
      // every other case.
      const previousFrame = this.lastPresentedFrame;
      const region = sourceOptions?.analysisRegion || this.roiRegionFor(
        canvas, context, sessionId, lane, adjustments, sourceSize, referenceWhiteNits, sourceOptions, activeLocals, longEdge,
      );
      this.prefetchZoomMasks(canvas, sessionId, activeLocals, editRevision, geometrySignature, sourceOptions, serial, longEdge);
      let proxy = sourceOptions?.analysisPatch
        ? await this.loadProxyRegion(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity,
          `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}:analysis:${JSON.stringify(region)}`, region,
          {isCurrent: sourceOptions?.isCurrent})
        : await this.loadProxy(
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity,
        { isCurrent: sourceOptions?.isCurrent, onProgress: sourceOptions?.onSourceProgress, region },
      );
      if (!proxy) return { rendered: false, refusals: ["source proxy unavailable"] };
      if (!sourceOptions?.analysisPatch && proxy.region && (!previousFrame
        || proxy.width !== previousFrame.width || proxy.height !== previousFrame.height)) {
        const whole = await this.loadProxy(
          sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity,
          { isCurrent: sourceOptions?.isCurrent },
        );
        if (whole) proxy = whole;
      }
      proxyPin = this.gpuAllocator && proxy.allocatorEntry ? this.gpuAllocator.pin(proxy.allocatorEntry) : null;

      const pipelines = this.pipelineFor(surface.format);

      const params = buildParams(
        lane, adjustments, proxy.workingSpace, surface.hdr, referenceWhiteNits,
        this.sourcePixelScaleFor(proxy, sourceSize),
      );
      const { spatialActive, detailActive } = this.graphActivity(params);

      const refusals = this.tiledExecutionRefusals({
        activeLocals, detailActive, spatialActive, overlayMask: maskOverlay, params, surface,
      });
      if (refusals.length) {
        this.recordStage("tiled-refused", { lane, longEdge, refusals });
        return { rendered: false, refusals };
      }

      // The highlight anchor is a whole-image measurement, so it is taken once
      // and shared by every tile. Measuring per tile would make each tile fit
      // its own peak and the seams would show.
      const anchor = this.highlightAnchorRequest(lane, adjustments, proxy, params, localAdjustments);
      const highlightAnchorOnly = Boolean(sourceOptions?.highlightAnchorOnly);
      if (anchor && !highlightAnchorOnly) {
        params[75] = await this.resolveHighlightAnchor(anchor, proxy, params, { interactive: false, lane });
      }
      // The finish pass is upstream of output highlights, so this sentinel
      // only changes what the tile reduction reads.  Nothing is presented by
      // an anchor-only pass.
      if (highlightAnchorOnly) params[74] = -1;

      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[131] = overlayIndex >= 0 ? 1 : 0;
      params[132] = overlayIndex >= 0 ? gpuMaskInfluenceOpacity(activeLocals[overlayIndex].mask) : 0;
      params[133] = Number(overlayColor[0]) || 0;
      params[134] = Number(overlayColor[1]) || 0;
      params[135] = Number(overlayColor[2]) || 0;

      this.uploadParamsAndCurves(lane, adjustments, curveSampler, params, activeLocals);

      const result = await this.encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, {
        measureOnly,
        analysisPatch: sourceOptions?.analysisPatch,
        analysisMasks: sourceOptions?.analysisMasks,
        analysisNativeLuma: sourceOptions?.analysisNativeLuma,
        claritySurround: sourceOptions?.claritySurround,
        Scheduler,
        serial,
        isCurrent: sourceOptions?.isCurrent || null,
        viewport: sourceOptions?.viewport || null,
        panPass: sourceOptions?.panPass,
        roiCatchUp: sourceOptions?.roiCatchUp,
        tileSize,
        lane,
        longEdge,
        editRevision,
        applicationGeneration: sourceOptions?.applicationGeneration,
        sessionId,
        activeLocals,
        geometrySignature,
        overlayIndex,
        sourcePixelScale: this.sourcePixelScaleFor(proxy, sourceSize),
        sourceSize,
        minimumRoiFraction: sourceOptions?.minimumRoiFraction,
        dpr: sourceOptions?.dpr,
        zoom: sourceOptions?.zoom,
      });
      const measured = result?.metrics?.exactPeak;
      if (highlightAnchorOnly && anchor && Number.isFinite(measured) && !sourceOptions?.analysisPatch) {
        this.peakReductionCache.set(anchor.key, measured);
        this.requestedCanonicalHighlightKeys.delete(anchor.key);
        this.noteHighlightMeasurement(lane, proxy, params, measured);
        result.highlightAnchor = { key: anchor.key, value: measured };
      } else if (highlightAnchorOnly && anchor) {
        this.requestedCanonicalHighlightKeys.delete(anchor.key);
      }
      return result;
      } finally {
        if (proxyPin) this.gpuAllocator.unpin(proxyPin);
        this.finishActiveRender();
      }
    }

    // `scope` is "global" or "local". The two are counted apart because they
    // answer different questions: a global amount drag must reuse every global
    // band, while the local bands below it legitimately regenerate, since the
    // global Detail composite is their input. One combined counter cannot tell
    // correct downstream invalidation from a cache that simply does not work.
    detailBandTile(key, width, height, scope = "global") {
      let entry = this.detailBandTiles.get(key);
      if (entry && entry.width === width && entry.height === height) {
        this.detailBandTiles.delete(key);
        this.detailBandTiles.set(key, entry);
        this.detailCacheCounters.hits += 1;
        this.detailCacheCounters[`${scope}Hits`] += 1;
        return { ...entry, hit: true };
      }
      if (entry) {
        const previous = entry;
        this.destroyAfterActiveRenders(() => previous.texture.destroy());
      }
      const texture = this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      entry = { texture, width, height, byteSize: width * height * 8 };
      this.detailBandTiles.set(key, entry);
      this.detailCacheCounters.misses += 1;
      this.detailCacheCounters[`${scope}Misses`] += 1;
      this.detailCacheCounters.analysisPasses += 2;
      return { ...entry, hit: false };
    }

    /**
     * How many bytes the two tile caches may hold between them.
     *
     * A flat fraction of the configured budget is wrong: the proxy, the
     * presentation surface and the tiled working graph are resident too, and at
     * 24 MP and above they are a large share of the budget. Taking 60% and 15%
     * of the *total* for the caches left less than the rest of the resident set
     * needed, so a measured peak could exceed the budget the planner had just
     * admitted the render against. Sizing the caches from what is actually
     * free keeps the two consistent.
     */
    cacheBudgetBytes(share, floorBytes) {
      const snapshot = this.resourceMemorySnapshot();
      const categories = snapshot.resident?.categories || {};
      const cacheBytes = (categories.detailBandCacheBytes || 0) + (categories.maskTileBytes || 0);
      const nonCacheBytes = Math.max(0, (snapshot.resident?.totalBytes || 0) - cacheBytes);
      // A tenth of the budget is held back for the contingency the planner
      // already reserves, so the two do not disagree about what fits.
      const free = Math.max(0, this.memoryBudgetBytes() * 0.9 - nonCacheBytes);
      return Math.max(floorBytes, Math.floor(free * share));
    }

    /**
     * One tile of adaptive Denoise's reconstruction, kept across generations.
     *
     * The reconstruction reads only ungraded source pixels, the noise model and
     * the Denoise controls, all of which are in `key`, so a grade edit finds
     * the tile it reconstructed last time. `hit` is false for a new or resized
     * entry, which the caller must fill before anything reads it.
     */
    denoiseTile(key, width, height) {
      let entry = this.denoiseTiles.get(key);
      if (entry && entry.width === width && entry.height === height) {
        this.denoiseTiles.delete(key);
        this.denoiseTiles.set(key, entry);
        this.denoiseTileCounters.hits += 1;
        return { ...entry, hit: true };
      }
      if (entry) {
        const previous = entry;
        this.destroyAfterActiveRenders(() => previous.texture.destroy());
      }
      const texture = this.device.createTexture({
        label: "denoise-tile",
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      entry = { texture, width, height, byteSize: width * height * 8 };
      this.denoiseTiles.set(key, entry);
      this.denoiseTileCounters.misses += 1;
      return { ...entry, hit: false };
    }

    /** Forget these tiles (all of them by default) and release their textures. */
    dropDenoiseTiles(keys = null) {
      for (const key of keys || [...this.denoiseTiles.keys()]) {
        const entry = this.denoiseTiles.get(key);
        if (!entry) continue;
        this.denoiseTiles.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture?.destroy());
      }
    }

    /**
     * Keep the denoised tiles inside a quarter of what the budget has free
     * once everything that is not a tile cache is counted. The detail and mask
     * caches see these bytes as resident, so the three cannot overcommit.
     */
    trimDenoiseTiles(pinned = []) {
      let bytes = [...this.denoiseTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      if (!bytes) return 0;
      const protectedKeys = new Set(pinned);
      const snapshot = this.resourceMemorySnapshot();
      const categories = snapshot.resident?.categories || {};
      const cacheBytes = (categories.detailBandCacheBytes || 0) + (categories.maskTileBytes || 0)
        + (categories.denoiseTileBytes || 0);
      const nonCacheBytes = Math.max(0, (snapshot.resident?.totalBytes || 0) - cacheBytes);
      const free = Math.max(0, this.memoryBudgetBytes() * 0.9 - nonCacheBytes);
      const budget = Math.max(64 * 1024 * 1024, Math.floor(free * 0.25));
      for (const [key, entry] of [...this.denoiseTiles]) {
        if (bytes <= budget) break;
        if (protectedKeys.has(key)) continue;
        this.denoiseTiles.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture.destroy());
        bytes -= entry.byteSize;
        this.denoiseTileCounters.evictions += 1;
      }
      return bytes;
    }

    trimDetailBandTiles(pinned = []) {
      const protectedKeys = new Set(pinned);
      const budget = this.cacheBudgetBytes(0.80, 64 * 1024 * 1024);
      let bytes = [...this.detailBandTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      for (const [key, entry] of [...this.detailBandTiles]) {
        if (bytes <= budget) break;
        if (protectedKeys.has(key)) continue;
        this.detailBandTiles.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture.destroy());
        bytes -= entry.byteSize;
        this.detailCacheCounters.evictions += 1;
      }
      return bytes;
    }

    /**
     * Load every missing tile of one local in a single batched request.
     *
     * Resident tiles are answered from `maskTiles` without a request, so a
     * pan or a grade-only edit fetches only the tiles that are actually new.
     * One response carries the whole batch as a length-prefixed container and
     * each entry is split back into the same per-tile cache shape the
     * single-tile path used, so pinning and eviction are unchanged.
     */
    async loadLocalMaskTiles(
      sessionId, batch, longEdge, editRevision, geometrySignature, isCurrent, signal, proxy = null,
      sceneMaskSource = null,
    ) {
      const signature = gpuMaskIdentity(batch.local.mask);
      if (this.gpuAnalyticMasksEnabled && proxy) {
        const resampled = await this.loadGpuResampledRegion(sessionId,batch,longEdge,geometrySignature,isCurrent,signal,proxy);
        if (resampled) return resampled;
        if (signal?.aborted || !isCurrent()) return {localIndex:batch.localIndex,entries:new Map()};
      }
      if (this.gpuAnalyticMasksEnabled && proxy && longEdge > SOFT_MASK_MAX_EDGE) {
        const shifted = await this.loadGpuBrushShiftRegion(sessionId,batch,longEdge,
          geometrySignature,isCurrent,signal,proxy);
        if (shifted) return shifted;
      }
      if (this.gpuAnalyticMasksEnabled && proxy?.region && longEdge > SOFT_MASK_MAX_EDGE) {
        const separated = await this.loadGpuBrushEraseRegion(sessionId,batch,longEdge,editRevision,
          geometrySignature,isCurrent,signal,proxy);
        if (separated) return separated;
        if (signal?.aborted || !isCurrent()) return {localIndex:batch.localIndex,entries:new Map()};
      }
      if (this.gpuAnalyticMasksEnabled && proxy?.region) {
        const generated = this.loadGpuAnalyticRegion(
          sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy,
        );
        if (generated) return generated;
      }
      if (this.gpuAnalyticMasksEnabled && proxy
        && window.HDRMaskRaster?.eligible(batch.local.mask, geometrySignature)) {
        const generated = this.loadGpuShapeTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy);
        if (generated) return generated;
      }
      if (this.gpuAnalyticMasksEnabled && proxy && isGpuLinearGradientMask(batch.local.mask, geometrySignature)) {
        return this.loadGpuLinearGradientTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy);
      }
      const lumaRegionSource = sceneMaskSource || (proxy?.region
        && lumaSceneSource(proxy.lane, proxy.sourceIdentity, proxy.workingSpace) ? proxy : null);
      if (this.gpuAnalyticMasksEnabled && lumaRegionSource
        && gpuRegionalGraphEligible(batch.local.mask, geometrySignature)) {
        const graph = await this.loadGpuMaskGraph(sessionId, batch.local, longEdge, editRevision,
          geometrySignature, isCurrent, signal, true, lumaRegionSource);
        if (graph) return { localIndex: batch.localIndex,
          entries: new Map(batch.tiles.map(tile => [tile.key, graph])) };
        if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
      }
      if (this.gpuAnalyticMasksEnabled && proxy && batch.local.mask?.operator !== "leaf") {
        // A combination the regional route cannot hold (a feathered or shifted
        // brush among its leaves) is composed in source space instead.
        const composed = await this.loadGpuComposedRegion(sessionId, batch, longEdge, geometrySignature, isCurrent, signal, proxy);
        if (composed) return composed;
        if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
      }
      if (isGpuLumaMask(batch.local.mask)
        && (lumaRegionSource || this.wholeSourceResident(sessionId, "hdr", longEdge, geometrySignature, "source"))) {
        // The same GPU-made mask the direct route draws with, once the source
        // it is made from is on the GPU: no backend compile, no upload.
        const luma = await this.loadGpuLumaMask(
          sessionId, batch.local, longEdge, editRevision, geometrySignature, isCurrent, signal, false, lumaRegionSource,
        );
        if (luma) {
          luma.wholeFrame = true;
          return { localIndex: batch.localIndex, entries: new Map(batch.tiles.map((tile) => [tile.key, luma])) };
        }
        if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
      }
      if (longEdge > SOFT_MASK_MAX_EDGE) {
        // A soft mask is the same small bitmap for every tile.
        const soft = await this.softLeafMask(
          sessionId, batch.local, batch.local.mask, "", editRevision, geometrySignature, isCurrent, signal,
        );
        if (soft) {
          return { localIndex: batch.localIndex, entries: new Map(batch.tiles.map((tile) => [tile.key, soft])) };
        }
        if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
        if (this.gpuAnalyticMasksEnabled && proxy) {
          // Feathered paint no bitmap qualifies for: export's own reduced
          // grid at native coordinates rather than a CPU mask compile.
          const feathered = await this.loadGpuBrushShiftRegion(sessionId,batch,longEdge,
            geometrySignature,isCurrent,signal,proxy,true);
          if (feathered) return feathered;
          if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
        }
      }
      return maskLoader().loadCpuMaskTiles(this, {
        sessionId, batch, longEdge, editRevision, geometrySignature, maskSignature: signature, isCurrent, signal,
      });
    }

    /** Straighten and perspective. Export finishes the mask in source space
     * (every leaf and the whole combination) and warps it with the picture;
     * the plan is that exact warp, or null for index geometry, an unsupported
     * leaf anywhere in the mask or a frame that does not match.
     */
    resamplePlan(sessionId, expression, longEdge, geometrySignature) {
      const planner = window.HDRGeometryResample, size = this.maskSourceSize;
      if (!planner || !window.HDRGpuMaskResample || !window.HDRGpuBrushMask?.nativeScratch
        || size?.sessionId !== sessionId || !expression) return null;
      let geometry;
      try { geometry = JSON.parse(geometrySignature); } catch { return null; }
      if (!Number(geometry.straighten_angle || 0) && !Number(geometry.perspective_rotate || 0)
        && !Number(geometry.perspective_horizontal || 0) && !Number(geometry.perspective_vertical || 0)) return null;
      const round = window.HDRGpuBrushMask.evenRound, scale = Math.min(1, longEdge / Math.max(size.width, size.height));
      const sourceWidth = Math.max(1, round(size.width * scale)), sourceHeight = Math.max(1, round(size.height * scale));
      // A perspective plan walks a 512-pixel proxy; keep the few in use.
      const planKey = `${sourceWidth}x${sourceHeight}:${geometrySignature}`;
      this.resamplePlans ||= new Map();
      if (!this.resamplePlans.has(planKey)) {
        this.resamplePlans.set(planKey, planner.plan(sourceWidth, sourceHeight, geometry));
        while (this.resamplePlans.size > 16) this.resamplePlans.delete(this.resamplePlans.keys().next().value);
      }
      const recipe = this.resamplePlans.get(planKey);
      if (!recipe) return null;
      const oriented = recipe.orientedSignature;
      if (!this.sourceSpaceEligible(expression, oriented)) return null;
      return {...recipe, frame: {width: recipe.orientedWidth, height: recipe.orientedHeight, geometrySignature: oriented}};
    }

    /** Whether every leaf of a mask has a source-space GPU producer for a
     * frame with only quarter turns and flips.
     */
    sourceSpaceEligible(expression, oriented) {
      const eligible = node => {
        if (node?.operator !== "leaf") {
          // A proper combination has at least two operands; degenerate and
          // disabled graphs keep the established path.
          const children = node?.enabled === false ? [] : (node?.children || []).filter(child => child.enabled !== false);
          return children.length >= 2 && children.every(eligible);
        }
        if (node.children?.length) return false;
        const leaf = node.leaf;
        if (isGpuLumaMask(node)) return node.enabled !== false;
        const spatial = leaf?.type === "brush" ? {...node, leaf: {...leaf, mask_feather: 0, mask_shift_edge: 0}} : node;
        return Boolean(leaf?.type === "linear_gradient" ? isGpuLinearGradientMask(node, oriented)
          : window.HDRMaskRaster?.eligible(spatial, oriented));
      };
      return eligible(expression);
    }

    /** Index geometry: the uncropped frame a combination is composed in when
     * the regional graph route cannot hold one of its leaves (a feathered or
     * shifted brush). Null for leaves, resampling geometry and graphs that
     * route already serves.
     */
    composedFrame(sessionId, expression, longEdge, geometrySignature, width, height) {
      if (!this.gpuAnalyticMasksEnabled || !window.HDRGpuBrushMask?.nativeScratch || !window.HDRGpuMaskResample
        || !expression || expression.operator === "leaf" || gpuRegionalGraphEligible(expression, geometrySignature)) return null;
      let frame = null;
      try {
        const geometry = JSON.parse(geometrySignature);
        if (Number(geometry.straighten_angle || 0) || Number(geometry.perspective_rotate || 0)
          || Number(geometry.perspective_horizontal || 0) || Number(geometry.perspective_vertical || 0)) return null;
        frame = this.analyticMaskFrame(sessionId, longEdge, geometrySignature, width, height);
      } catch { return null; }
      return frame && this.sourceSpaceEligible(expression, frame.geometrySignature) ? frame : null;
    }

    /** A mask finished in source space takes nothing from the picture: no
     * luminance halo, grid alignment or scene region.
     */
    sourceSpaceMask(sessionId, expression, longEdge, geometrySignature) {
      return Boolean(this.resamplePlan(sessionId, expression, longEdge, geometrySignature)
        || this.composedFrame(sessionId, expression, longEdge, geometrySignature));
    }

    /** Viewport form of a composed combination under index geometry. */
    async loadGpuComposedRegion(sessionId, batch, longEdge, geometrySignature, isCurrent, signal, proxy) {
      const expression = batch.local.mask;
      const frame = this.composedFrame(sessionId, expression, longEdge, geometrySignature, proxy.width, proxy.height);
      if (!frame || signal?.aborted || !isCurrent()) return null;
      const halos = batch.tiles.map(tile => tile.haloRect);
      if (!proxy.region && (!halos.length || halos.some(rect => !rect))) return null;
      const x = proxy.region?.x ?? Math.min(...halos.map(rect => rect.x));
      const y = proxy.region?.y ?? Math.min(...halos.map(rect => rect.y));
      const region = proxy.region || {x, y, width: Math.max(...halos.map(rect => rect.x + rect.width)) - x,
        height: Math.max(...halos.map(rect => rect.y + rect.height)) - y};
      const limit = this.device.limits.maxTextureDimension2D;
      if (region.width > limit || region.height > limit || region.width * region.height > 16777216) {
        // Keep each catch-up mask bounded rather than compose a whole frame.
        if (batch.tiles.length <= 1 || halos.some(rect => !rect)) return null;
        const entries = new Map();
        for (const tile of batch.tiles) {
          if (signal?.aborted || !isCurrent()) return null;
          const result = await this.loadGpuComposedRegion(sessionId, {...batch, tiles: [tile]}, longEdge,
            geometrySignature, isCurrent, signal, {...proxy, region: tile.haloRect});
          if (!result) return null;
          entries.set(tile.key, result.entries.get(tile.key));
        }
        return {localIndex: batch.localIndex, entries};
      }
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-composed:${gpuMaskIdentity(expression)}:${JSON.stringify(region)}`;
      let entry = this.localMasks.get(key);
      const generation = this.resourceGeneration, device = this.device;
      const current = () => !signal?.aborted && isCurrent() && this.resourceGeneration === generation && this.device === device;
      for (let own = false; !entry && !own;) {
        let record = this.localMaskInflight.get(key);
        if (!record || record.signal?.aborted) {
          own = true;
          const promise = (async () => {
            const started = performance.now();
            const made = await this.gpuOrientedMaskRegion(sessionId, expression, longEdge, frame,
              {x: region.x + frame.x, y: region.y + frame.y, width: region.width, height: region.height}, current);
            if (!made) return null;
            if (!current()) { made.texture.destroy(); return null; }
            const generated = {cacheKey: key, texture: made.texture, width: region.width, height: region.height,
              byteSize: region.width * region.height * 2, kind: "gpu-composed-graph", wholeFrame: true,
              frameRect: [region.x / proxy.width, region.y / proxy.height, region.width / proxy.width, region.height / proxy.height]};
            this.localMasks.set(key, generated);
            this.performanceMetrics.maskEvents ||= [];
            this.performanceMetrics.maskEvents.push({kind: generated.kind, longEdge, width: region.width, height: region.height,
              gpuPrepareMs: performance.now() - started, cpuMaskRequest: false});
            return generated;
          })();
          record = {promise, signal}; this.localMaskInflight.set(key, record);
        }
        try { entry = await record.promise; } finally { if (this.localMaskInflight.get(key) === record) this.localMaskInflight.delete(key); }
        if (!current()) return null;
      }
      if (!entry) {
        // A leaf can refuse a region that fits (a wide Shift halo around a
        // large view); its tiles are small enough to hold that halo.
        if (batch.tiles.length <= 1 || halos.some(rect => !rect) || signal?.aborted || !isCurrent()) return null;
        const entries = new Map();
        for (const tile of batch.tiles) {
          const result = await this.loadGpuComposedRegion(sessionId, {...batch, tiles: [tile]}, longEdge,
            geometrySignature, isCurrent, signal, {...proxy, region: tile.haloRect});
          if (!result) return null;
          entries.set(tile.key, result.entries.get(tile.key));
        }
        return {localIndex: batch.localIndex, entries};
      }
      this.retainLocalMask(entry, longEdge);
      return {localIndex: batch.localIndex, entries: new Map(batch.tiles.map(tile => [tile.key, entry]))};
    }

    /** Scene luminance of the source before straighten or perspective, for
     * one rectangle of the oriented frame. Export qualifies a luminance mask
     * there and warps the finished mask; the warped picture is no substitute.
     */
    async fetchOrientedLuminance(sessionId, longEdge, frame, rect, signal) {
      const geometry = JSON.parse(frame.geometrySignature);
      const response = await fetch(`/api/session/${sessionId}/source-luminance?long_edge=${longEdge}`
        + `&x=${rect.x}&y=${rect.y}&width=${rect.width}&height=${rect.height}`
        + `&rotation=${Number(geometry.rotation || 0)}&flip_horizontal=${Boolean(geometry.flip_horizontal)}`
        + `&flip_vertical=${Boolean(geometry.flip_vertical)}`, {signal});
      if (!response.ok) { await response.arrayBuffer().catch(() => null); return null; }
      const header = name => Number(response.headers.get(name));
      return {data: await response.arrayBuffer(), width: header("X-Tile-Width"), height: header("X-Tile-Height"),
        frameWidth: header("X-Output-Width"), frameHeight: header("X-Output-Height")};
    }

    /** One resident tile of that luminance. Tiles are shared by every mask
     * and viewport, so a fetch belongs to the session, not to one request.
     */
    orientedLuminanceTile(sessionId, longEdge, frame, x, y) {
      const key = `${sessionId}:${longEdge}:${frame.geometrySignature}:${x},${y}`;
      const cached = this.orientedLuminance.get(key);
      if (cached) return Promise.resolve(cached);
      let pending = this.orientedLuminanceInflight.get(key);
      if (!pending) {
        const device = this.device, generation = this.resourceGeneration;
        const rect = {x, y, width: Math.min(ORIENTED_LUMINANCE_TILE, frame.width - x),
          height: Math.min(ORIENTED_LUMINANCE_TILE, frame.height - y)};
        pending = (async () => {
          const started = performance.now();
          const tile = await this.fetchOrientedLuminance(sessionId, longEdge, frame, rect, this.sourceAbortSignal());
          if (!tile || tile.frameWidth !== frame.width || tile.frameHeight !== frame.height
            || tile.width !== rect.width || tile.height !== rect.height
            || this.device !== device || this.resourceGeneration !== generation) return null;
          const texture = device.createTexture({size: [rect.width, rect.height], format: "r16float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC});
          device.queue.writeTexture({texture}, tile.data, {bytesPerRow: rect.width * 2, rowsPerImage: rect.height},
            [rect.width, rect.height]);
          const entry = {texture, ...rect, byteSize: rect.width * rect.height * 2};
          this.orientedLuminance.set(key, entry);
          let total = 0;
          for (const value of this.orientedLuminance.values()) total += value.byteSize;
          for (const oldKey of [...this.orientedLuminance.keys()]) {
            if (total <= ORIENTED_LUMINANCE_BYTES || oldKey === key) break;
            total -= this.orientedLuminance.get(oldKey).byteSize;
            this.evictGpuCacheEntry("oriented-luminance", oldKey);
          }
          this.performanceMetrics.maskEvents ||= [];
          this.performanceMetrics.maskEvents.push({kind: "oriented-luminance-tile", longEdge, ...rect,
            requestMs: performance.now() - started, cpuMaskRequest: false});
          return entry;
        })().catch(() => null).finally(() => {
          if (this.orientedLuminanceInflight.get(key) === pending) this.orientedLuminanceInflight.delete(key);
        });
        this.orientedLuminanceInflight.set(key, pending);
      }
      return pending;
    }

    /** One rectangle of that luminance as a texture the caller owns. */
    async orientedLuminanceRegion(sessionId, longEdge, frame, rect, current) {
      const side = ORIENTED_LUMINANCE_TILE, device = this.device;
      for (let attempt = 0; attempt < 3 && current(); attempt++) {
        const wanted = [];
        for (let y = Math.floor(rect.y / side) * side; y < rect.y + rect.height; y += side) {
          for (let x = Math.floor(rect.x / side) * side; x < rect.x + rect.width; x += side) {
            wanted.push(this.orientedLuminanceTile(sessionId, longEdge, frame, x, y));
          }
        }
        const tiles = await Promise.all(wanted);
        if (tiles.some(tile => !tile) || !current() || this.device !== device) return null;
        // A tile evicted while its neighbours loaded is fetched again.
        if (tiles.some(tile => tile.destroyed)) continue;
        const texture = device.createTexture({size: [rect.width, rect.height], format: "r16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
        const encoder = device.createCommandEncoder();
        for (const tile of tiles) {
          const x = Math.max(rect.x, tile.x), y = Math.max(rect.y, tile.y);
          const right = Math.min(rect.x + rect.width, tile.x + tile.width);
          const bottom = Math.min(rect.y + rect.height, tile.y + tile.height);
          encoder.copyTextureToTexture({texture: tile.texture, origin: [x - tile.x, y - tile.y]},
            {texture, origin: [x - rect.x, y - rect.y]}, [right - x, bottom - y]);
        }
        device.queue.submit([encoder.finish()]);
        return texture;
      }
      return null;
    }

    /** A luminance leaf over one oriented rectangle: qualified and feathered
     * in source space, with the feather's whole reach around the rectangle
     * and its reduced grid anchored to the frame.
     */
    async gpuOrientedLumaRegion(sessionId, expression, longEdge, frame, rect, current) {
      const resample = window.HDRGpuMaskResample, inverted = Boolean(expression.inverted);
      const feather = Math.min(0.05, Math.max(0, Number(expression.leaf.mask_feather) || 0));
      const plan = lumaFeatherPlan(feather, frame.width, frame.height);
      const feathered = plan.sigma >= 0.25, reach = feathered ? lumaFeatherReach(plan) : 0, grid = plan.factor;
      const x = Math.floor(Math.max(0, rect.x - reach) / grid) * grid;
      const y = Math.floor(Math.max(0, rect.y - reach) / grid) * grid;
      const right = Math.min(frame.width, Math.ceil((rect.x + rect.width + reach) / grid) * grid);
      const bottom = Math.min(frame.height, Math.ceil((rect.y + rect.height + reach) / grid) * grid);
      const width = right - x, height = bottom - y, limit = this.device.limits.maxTextureDimension2D;
      if (width > limit || height > limit || width * height > ORIENTED_LUMA_REGION_PIXELS) return null;
      const luminance = await this.orientedLuminanceRegion(sessionId, longEdge, frame, {x, y, width, height}, current);
      if (!luminance) return null;
      const baseTexture = this.createMaskTexture(width, height);
      const qualifyValues = buildGpuLumaQualificationParams(expression);
      const qualifyBuffer = this.createStorageBuffer(qualifyValues);
      this.device.queue.writeBuffer(qualifyBuffer, 0, qualifyValues);
      const entry = {texture: baseTexture, baseTexture, qualifyBuffer, width, height, byteSize: 0,
        horizontalTexture: null, refinedTexture: null, horizontalBuffer: null, verticalBuffer: null};
      const encoder = this.device.createCommandEncoder();
      this.encodeMaskPass(encoder, this.maskPipelines.qualify, this.createMaskBindGroup(luminance, qualifyBuffer), baseTexture);
      this.device.queue.submit([encoder.finish()]);
      if (feathered || inverted) {
        // Export's own boxes wherever their prefix sums fit: the warp that
        // follows amplifies the reduced grid's sub-level error to whole levels.
        this.refineLumaMask(entry, plan, inverted, width * height <= ORIENTED_LUMA_EXACT_PIXELS
          || x === 0 || y === 0 || right >= frame.width || bottom >= frame.height);
      }
      let texture = entry.texture, buffer = null;
      if (x === rect.x && y === rect.y && width === rect.width && height === rect.height) {
        // The whole region is the answer; keep it out of the scratch release.
        for (const name of ["texture", "baseTexture", "refinedTexture"]) if (entry[name] === texture) entry[name] = null;
      } else {
        const values = new Float32Array([rect.x - x, rect.y - y, 0, 0]);
        buffer = this.createStorageBuffer(values);
        this.device.queue.writeBuffer(buffer, 0, values);
        texture = this.createMaskTexture(rect.width, rect.height);
        const crop = this.device.createCommandEncoder();
        this.encodeMaskPass(crop, resample.cropPipeline(this), this.createMaskBindGroup(entry.texture, buffer), texture);
        this.device.queue.submit([crop.finish()]);
      }
      this.destroyAfterActiveRenders(() => { this.destroyLocalMaskEntry(entry); luminance.destroy(); buffer?.destroy(); });
      return {texture, width: rect.width, height: rect.height};
    }

    /** A combination over one oriented rectangle, composed in source space
     * as export composes it before the warp. Operands are made one at a time.
     */
    async gpuOrientedGraphRegion(sessionId, expression, longEdge, frame, rect, current) {
      const children = (expression.children || []).filter(child => child.enabled !== false), made = [];
      const release = () => this.destroyAfterActiveRenders(() => made.forEach(item => item.destroy()));
      let result = null;
      for (const [index, child] of children.entries()) {
        const operand = await this.gpuOrientedMaskRegion(sessionId, child, longEdge, frame, rect, current);
        if (operand) made.push(operand.texture);
        if (!operand || !current()) { release(); return null; }
        const opacity = child.operator === "leaf" ? Math.min(1, Math.max(0, Number(child.leaf?.mask_opacity ?? 1))) : 1;
        if (!result) { result = {texture: operand.texture, opacity}; continue; }
        const values = new Float32Array([gpuMaskOperatorCode(expression.operator), result.opacity, opacity,
          index === children.length - 1 && expression.inverted ? 1 : 0]);
        const buffer = this.createStorageBuffer(values), target = this.createMaskTexture(rect.width, rect.height);
        this.device.queue.writeBuffer(buffer, 0, values);
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(encoder, this.maskPipelines.combine,
          this.createMaskBindGroup(result.texture, buffer, operand.texture), target);
        this.device.queue.submit([encoder.finish()]);
        made.push(buffer, target);
        result = {texture: target, opacity: 1};
      }
      made.splice(made.indexOf(result.texture), 1);
      release();
      return {texture: result.texture, width: rect.width, height: rect.height};
    }

    /** One rectangle of the finished mask in the oriented source frame
     * (quarter turns and flips only), from the existing native producers.
     * The caller owns the returned texture.
     */
    async gpuOrientedMaskRegion(sessionId, expression, longEdge, frame, rect, current) {
      const helper = window.HDRGpuBrushMask, leaf = expression.leaf, limit = this.device.limits.maxTextureDimension2D;
      const {width, height, geometrySignature: signature} = frame;
      if (rect.width > limit || rect.height > limit || rect.width * rect.height > 16777216 || !current()) return null;
      if (expression.operator !== "leaf") return this.gpuOrientedGraphRegion(sessionId, expression, longEdge, frame, rect, current);
      if (isGpuLumaMask(expression)) return this.gpuOrientedLumaRegion(sessionId, expression, longEdge, frame, rect, current);
      if (leaf.type === "brush") {
        if (helper.featherFieldPlan(expression, width, height, signature, limit)) {
          const field = await this.loadGpuBrushFeatherField(sessionId, longEdge, signature, expression, frame, current);
          return field ? helper.generateFeatherRegion(this, expression, width, height, signature, rect, field, current) : null;
        }
        if (helper.shiftRegionPlan(expression, width, height, signature, rect, limit)) {
          return helper.generateShiftRegion(this, expression, width, height, signature, rect, current);
        }
        // A Shift this region cannot hold is refused; one below a quarter
        // pixel leaves the paint untouched, as does such a Feather.
        if (helper.shiftRegionPlan(expression, width, height, signature, {x: 0, y: 0, width: 1, height: 1}, limit)) return null;
        expression = {...expression, leaf: {...leaf, mask_feather: 0, mask_shift_edge: 0}};
      }
      const gradient = leaf.type === "linear_gradient";
      const values = gradient ? buildGpuLinearGradientParams(expression, rect, width, height, signature)
        : window.HDRMaskRaster.parameters(expression, rect, width, height, signature);
      if (!values) return null;
      const buffer = this.createStorageBuffer(values), texture = this.createMaskTexture(rect.width, rect.height);
      // Neither analytic shader samples the texture its bind layout requires.
      const unused = this.createMaskTexture(1, 1);
      this.device.queue.writeBuffer(buffer, 0, values);
      const encoder = this.device.createCommandEncoder();
      this.encodeMaskPass(encoder, gradient ? this.maskPipelines.linearGradient : this.maskPipelines.shapeRaster,
        this.createMaskBindGroup(unused, buffer), texture);
      this.device.queue.submit([encoder.finish()]);
      this.destroyAfterActiveRenders(() => { buffer.destroy(); unused.destroy(); });
      return {texture, width: rect.width, height: rect.height};
    }

    /** Export clips the warped mask to the range of the whole source mask.
     * The range is scanned once per mask in bounded tiles and remembered as
     * two numbers; no mask texture is retained.
     */
    async gpuMaskExtent(sessionId, expression, longEdge, frame, current) {
      const key = `${sessionId}:${longEdge}:${frame.geometrySignature}:${gpuMaskIdentity(expression)}`;
      this.maskExtents ||= new Map(); this.maskExtentInflight ||= new Map();
      for (let own = false; !own && current();) {
        const cached = this.maskExtents.get(key);
        if (cached) return cached;
        let pending = this.maskExtentInflight.get(key);
        if (!pending) {
          own = true;
          pending = this.scanGpuMaskExtent(sessionId, expression, longEdge, frame, current)
            .finally(() => { if (this.maskExtentInflight.get(key) === pending) this.maskExtentInflight.delete(key); });
          this.maskExtentInflight.set(key, pending);
        }
        const extent = await pending.catch(() => null);
        if (extent) {
          this.maskExtents.set(key, extent);
          while (this.maskExtents.size > 64) this.maskExtents.delete(this.maskExtents.keys().next().value);
          return extent;
        }
      }
      return null;
    }

    async scanGpuMaskExtent(sessionId, expression, longEdge, frame, current) {
      const helper = window.HDRGpuBrushMask, device = this.device, started = performance.now();
      if (!helper.warm(this)) return null;
      const pipelines = this.brushPipelines;
      // A tile and its filter halo must fit the scratch cap; halve until all do.
      // A luminance feather builds its reach around every tile, so start smaller.
      const first = maskUsesLuminance(expression) ? ORIENTED_LUMINANCE_TILE : 4096;
      for (let side = Math.min(first, device.limits.maxTextureDimension2D); side >= 256 && current(); side /= 2) {
        const scratch = helper.nativeScratch(this, current), {texture, draw} = scratch;
        try {
          const across = Math.ceil(frame.width / side), count = across * Math.ceil(frame.height / side);
          const one = texture(1, 1), lists = [texture(1, count), texture(1, count)], pair = texture(2, 1);
          let refused = false;
          for (let i = 0; i < count && !refused; i++) {
            const x = (i % across) * side, y = Math.floor(i / across) * side;
            const rect = {x, y, width: Math.min(side, frame.width - x), height: Math.min(side, frame.height - y)};
            const tile = await this.gpuOrientedMaskRegion(sessionId, expression, longEdge, frame, rect, current);
            if (!current()) { tile?.texture.destroy(); return null; }
            if (!tile) { refused = true; break; }
            const line = texture(1, rect.height), encoder = device.createCommandEncoder();
            [pipelines.bandMaximum, pipelines.bandMinimum].forEach((reduction, index) => {
              draw(encoder, reduction, tile.texture, line, new Float32Array([0, rect.height, 0, rect.width]));
              draw(encoder, pipelines.maximum, line, one, new Float32Array([1]));
              encoder.copyTextureToTexture({texture: one}, {texture: lists[index], origin: [0, i]}, [1, 1]);
            });
            device.queue.submit([encoder.finish()]);
            await device.queue.onSubmittedWorkDone();
            tile.texture.destroy(); scratch.release(line);
          }
          if (refused) continue;
          const buffer = device.createBuffer({size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          scratch.buffers.push(buffer);
          const encoder = device.createCommandEncoder();
          lists.forEach((list, index) => {
            draw(encoder, pipelines.maximum, list, one, new Float32Array([1]));
            encoder.copyTextureToTexture({texture: one}, {texture: pair, origin: [index, 0]}, [1, 1]);
          });
          encoder.copyTextureToBuffer({texture: pair}, {buffer, bytesPerRow: 256}, [2, 1]);
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          const values = new Float32Array(buffer.getMappedRange().slice(0, 8));
          buffer.unmap();
          if (!current()) return null;
          const extent = {max: Math.round(values[0] * 255), min: Math.round((1 - values[1]) * 255)};
          this.performanceMetrics.maskEvents ||= [];
          this.performanceMetrics.maskEvents.push({kind: "gpu-mask-extent", longEdge, width: frame.width, height: frame.height,
            tiles: count, gpuPrepareMs: performance.now() - started, ...extent, cpuMaskRequest: false});
          return extent;
        } finally { void scratch.dispose(); }
      }
      return null;
    }

    /** One output rectangle of a mask under straighten/perspective. */
    async loadGpuResampledMask(sessionId, expression, longEdge, geometrySignature, recipe, rect, isCurrent, signal) {
      const resample = window.HDRGpuMaskResample, source = resample.sourceRect(recipe, rect);
      if (!source || rect.x < 0 || rect.y < 0 || rect.x + rect.width > recipe.width || rect.y + rect.height > recipe.height) return null;
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-resampled:${gpuMaskIdentity(expression)}:${JSON.stringify(rect)}`;
      let entry = this.localMasks.get(key);
      const generation = this.resourceGeneration, device = this.device;
      const current = () => !signal?.aborted && isCurrent() && this.resourceGeneration === generation && this.device === device;
      for (let own = false; !entry && !own;) {
        let record = this.localMaskInflight.get(key);
        if (!record || record.signal?.aborted) {
          own = true;
          const promise = (async () => {
            const started = performance.now();
            const extent = await this.gpuMaskExtent(sessionId, expression, longEdge, recipe.frame, current);
            const oriented = extent && await this.gpuOrientedMaskRegion(sessionId, expression, longEdge, recipe.frame, source, current);
            if (!oriented) return null;
            if (!current()) { oriented.texture.destroy(); return null; }
            const values = resample.parameters(recipe, rect, source, extent), buffer = this.createStorageBuffer(values);
            const texture = this.createMaskTexture(rect.width, rect.height);
            device.queue.writeBuffer(buffer, 0, values);
            const encoder = device.createCommandEncoder();
            this.encodeMaskPass(encoder, resample.pipeline(this), this.createMaskBindGroup(oriented.texture, buffer), texture);
            device.queue.submit([encoder.finish()]);
            this.destroyAfterActiveRenders(() => { buffer.destroy(); oriented.texture.destroy(); });
            const generated = {cacheKey: key, texture, width: rect.width, height: rect.height, byteSize: rect.width * rect.height * 2,
              kind: `gpu-resampled-${expression.leaf?.type || "graph"}`};
            this.localMasks.set(key, generated);
            this.performanceMetrics.maskEvents ||= [];
            this.performanceMetrics.maskEvents.push({kind: generated.kind, longEdge, width: rect.width, height: rect.height,
              sourceRegion: source, gpuPrepareMs: performance.now() - started, cpuMaskRequest: false});
            return generated;
          })();
          record = {promise, signal}; this.localMaskInflight.set(key, record);
        }
        try { entry = await record.promise; } finally { if (this.localMaskInflight.get(key) === record) this.localMaskInflight.delete(key); }
        if (!current()) return null;
      }
      if (!entry) return null;
      this.retainLocalMask(entry, longEdge);
      return entry;
    }

    /** Whole-frame form for Fit, scopes and measurements. */
    async loadGpuResampledLeaf(sessionId, expression, longEdge, geometrySignature, isCurrent, signal) {
      const recipe = this.resamplePlan(sessionId, expression, longEdge, geometrySignature);
      if (!recipe) return null;
      const picture = [...this.proxies.values()].find(proxy => !proxy.region && proxy.sessionId === sessionId
        && proxy.longEdge === longEdge && proxy.geometrySignature === geometrySignature);
      if (picture && (picture.width !== recipe.width || picture.height !== recipe.height)) return null;
      return this.loadGpuResampledMask(sessionId, expression, longEdge, geometrySignature, recipe,
        {x: 0, y: 0, width: recipe.width, height: recipe.height}, isCurrent, signal);
    }

    /** Viewport form: the foreground halos of a tiled picture. */
    async loadGpuResampledRegion(sessionId, batch, longEdge, geometrySignature, isCurrent, signal, proxy) {
      const expression = batch.local.mask, recipe = this.resamplePlan(sessionId, expression, longEdge, geometrySignature);
      if (!recipe || recipe.width !== proxy.width || recipe.height !== proxy.height || signal?.aborted || !isCurrent()) return null;
      const halos = batch.tiles.map(tile => tile.haloRect);
      if (!proxy.region && (!halos.length || halos.some(rect => !rect))) return null;
      const x = proxy.region?.x ?? Math.min(...halos.map(rect => rect.x));
      const y = proxy.region?.y ?? Math.min(...halos.map(rect => rect.y));
      const region = proxy.region || {x, y, width: Math.max(...halos.map(rect => rect.x + rect.width)) - x,
        height: Math.max(...halos.map(rect => rect.y + rect.height)) - y};
      const source = window.HDRGpuMaskResample.sourceRect(recipe, region), limit = this.device.limits.maxTextureDimension2D;
      const fits = source && source.width <= limit && source.height <= limit && source.width * source.height <= 16777216
        && region.width <= limit && region.height <= limit;
      const whole = fits ? await this.loadGpuResampledMask(sessionId, expression, longEdge, geometrySignature, recipe, region, isCurrent, signal) : null;
      if (!whole) {
        if (signal?.aborted || !isCurrent()) return null;
        // Keep each mask bounded rather than warp a whole frame. A producer
        // can also refuse a region that fits (a wide Shift halo around a
        // large view). Halve the tiles along their longer run until each
        // part is accepted: every part carries its own halo once, where
        // per-tile masks would each recompute it.
        if (batch.tiles.length <= 1 || halos.some(rect => !rect)) return null;
        const columns = [...new Set(halos.map(rect => rect.x))].sort((a, b) => a - b);
        const rows = [...new Set(halos.map(rect => rect.y))].sort((a, b) => a - b);
        const across = columns.length >= rows.length, cuts = across ? columns : rows;
        const cut = cuts[Math.ceil(cuts.length / 2)];
        const entries = new Map();
        for (const tiles of [batch.tiles.filter(tile => (across ? tile.haloRect.x : tile.haloRect.y) < cut),
          batch.tiles.filter(tile => (across ? tile.haloRect.x : tile.haloRect.y) >= cut)]) {
          if (signal?.aborted || !isCurrent()) return null;
          const part = tiles.map(tile => tile.haloRect);
          const left = Math.min(...part.map(rect => rect.x)), top = Math.min(...part.map(rect => rect.y));
          const result = await this.loadGpuResampledRegion(sessionId, {...batch, tiles}, longEdge, geometrySignature, isCurrent, signal,
            {...proxy, region: {x: left, y: top, width: Math.max(...part.map(rect => rect.x + rect.width)) - left,
              height: Math.max(...part.map(rect => rect.y + rect.height)) - top}});
          if (!result) return null;
          for (const [key, entry] of result.entries) entries.set(key, entry);
        }
        return {localIndex: batch.localIndex, entries};
      }
      const entry = whole;
      Object.assign(entry, {wholeFrame: true, frameRect: [region.x / proxy.width, region.y / proxy.height,
        region.width / proxy.width, region.height / proxy.height]});
      return {localIndex: batch.localIndex, entries: new Map(batch.tiles.map(tile => [tile.key, entry]))};
    }

    /** Native Shift Edge, with or without Feather. Feather without Shift
     * keeps its qualified bitmap routes and arrives here (`featherOnly`)
     * only after they refuse, so admission is unchanged.
     */
    async loadGpuBrushShiftRegion(sessionId,batch,longEdge,geometrySignature,isCurrent,signal,proxy,featherOnly=false) {
      const helper=window.HDRGpuBrushMask,expression=batch.local.mask;
      if(Boolean(Number(expression?.leaf?.mask_shift_edge))===featherOnly)return null;
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,proxy.width,proxy.height);
      if(!frame||!helper?.shiftRegionPlan||signal?.aborted||!isCurrent())return null;
      const limit=this.device.limits.maxTextureDimension2D;
      const feathered=Boolean(helper.featherFieldPlan?.(expression,frame.width,frame.height,frame.geometrySignature,limit));
      if(featherOnly&&!feathered)return null;
      const halos=batch.tiles.map(tile=>tile.haloRect);
      if(!proxy.region&&(!halos.length||halos.some(rect=>!rect)))return null;
      const x=proxy.region?.x??Math.min(...halos.map(rect=>rect.x));
      const y=proxy.region?.y??Math.min(...halos.map(rect=>rect.y));
      const region=proxy.region||{x,y,width:Math.max(...halos.map(rect=>rect.x+rect.width))-x,
        height:Math.max(...halos.map(rect=>rect.y+rect.height))-y};
      const rect={...region,x:region.x+frame.x,y:region.y+frame.y};
      if(!(feathered?helper.featherRegionPlan:helper.shiftRegionPlan)(
        expression,frame.width,frame.height,frame.geometrySignature,rect,limit)){
        // Whole-proxy catch-up can contain many tiles. Keep each native mask
        // bounded rather than turning the catch-up into a whole-mask compile.
        if(batch.tiles.length<=1||halos.some(rect=>!rect))return null;
        const entries=new Map();
        for(const tile of batch.tiles){
          if(signal?.aborted||!isCurrent())return null;
          const result=await this.loadGpuBrushShiftRegion(sessionId,{...batch,tiles:[tile]},longEdge,
            geometrySignature,isCurrent,signal,{...proxy,region:tile.haloRect},featherOnly);
          if(!result)return null;
          entries.set(tile.key,result.entries.get(tile.key));
        }
        return {localIndex:batch.localIndex,entries};
      }
      const key=`${sessionId}:${longEdge}:${geometrySignature}:gpu-brush-native-${feathered?'feather':'shift'}:${gpuMaskIdentity(expression)}:${JSON.stringify(region)}`;
      let entry=this.localMasks.get(key);
      const generation=this.resourceGeneration,device=this.device;
      const current=()=>!signal?.aborted&&isCurrent()&&this.resourceGeneration===generation&&this.device===device;
      // A shared generation follows its first requester. A later requester
      // that is still current repeats it rather than fall to a CPU compile.
      for(let own=false;!entry&&!own;){
        let record=this.localMaskInflight.get(key);
        if(!record||record.signal?.aborted){
          own=true;
          const pending=(async()=>{
            const field=feathered&&await this.loadGpuBrushFeatherField(sessionId,longEdge,geometrySignature,expression,frame,current);
            const generated=feathered
              ?field&&await helper.generateFeatherRegion(this,expression,frame.width,frame.height,frame.geometrySignature,rect,field,current)
              :await helper.generateShiftRegion(this,expression,frame.width,frame.height,frame.geometrySignature,rect,current);
            if(!generated)return null;
            if(!current()){generated.texture.destroy();return null;}
            Object.assign(generated,{cacheKey:key,wholeFrame:true,frameRect:[region.x/proxy.width,
              region.y/proxy.height,region.width/proxy.width,region.height/proxy.height]});
            this.localMasks.set(key,generated);
            this.performanceMetrics.maskEvents||=[];
            this.performanceMetrics.maskEvents.push({kind:generated.kind,longEdge,width:generated.width,height:generated.height,
              ...generated.timings,scratchRegion:generated.scratchRegion,cpuMaskRequest:false});
            return generated;
          })();
          record={promise:pending,signal};this.localMaskInflight.set(key,record);
        }
        try{entry=await record.promise;}finally{if(this.localMaskInflight.get(key)===record)this.localMaskInflight.delete(key);}
        if(!current())return null;
      }
      if(!entry)return null;
      this.retainLocalMask(entry,longEdge);
      return {localIndex:batch.localIndex,entries:new Map(batch.tiles.map(tile=>[tile.key,entry]))};
    }

    /** The feather field depends on the mask and frame, never the viewport:
     * one resident coarse grid and its global peaks serve every native region
     * and pan. A requester that outlives a superseded generation makes its own.
     */
    async loadGpuBrushFeatherField(sessionId,longEdge,geometrySignature,expression,frame,current) {
      const key=`${sessionId}:${longEdge}:${geometrySignature}:gpu-brush-native-feather-field:${gpuMaskIdentity(expression)}`;
      for(let own=false;!own&&current();){
        let entry=this.localMasks.get(key);
        if(!entry||entry.destroyed){
          let record=this.localMaskInflight.get(key);
          if(!record){
            own=true;
            const promise=(async()=>{
              const generated=await window.HDRGpuBrushMask.generateFeatherField(
                this,expression,frame.width,frame.height,frame.geometrySignature,current);
              if(!generated)return null;
              if(!current()){generated.texture.destroy();return null;}
              generated.cacheKey=key;
              this.localMasks.set(key,generated);
              this.performanceMetrics.maskEvents||=[];
              this.performanceMetrics.maskEvents.push({kind:generated.kind,longEdge,width:generated.width,height:generated.height,
                ...generated.timings,factor:generated.factor,bands:generated.bands,cpuMaskRequest:false});
              return generated;
            })();
            record={promise};this.localMaskInflight.set(key,record);
          }
          try{entry=await record.promise;}finally{if(this.localMaskInflight.get(key)===record)this.localMaskInflight.delete(key);}
        }
        if(entry&&!entry.destroyed&&current()){this.retainLocalMask(entry,longEdge);return entry;}
      }
      return null;
    }

    /** A steep post-feather eraser must not force the painted feather to CPU.
     * Qualification applies to paint only; attenuation is exact regional
     * geometry, including repaint after erase and inversion before erase.
     */
    async loadGpuBrushEraseRegion(sessionId,batch,longEdge,editRevision,geometrySignature,isCurrent,signal,proxy) {
      const expression=batch.local.mask,leaf=expression?.leaf;
      if(expression?.operator!=='leaf'||leaf?.type!=='brush'||!Number(leaf.mask_feather)
        ||Number(leaf.mask_shift_edge)||!leaf.strokes?.some(stroke=>stroke.erase))return null;
      const resident=this.softMasks.get(softMaskIdentity(sessionId,geometrySignature,gpuMaskIdentity(expression)));
      if(resident?.soft&&!resident.destroyed)return null;
      // Export's own reduced grid at native coordinates needs no bitmap
      // qualification; the qualified painted bitmap remains its fallback.
      const native=await this.loadGpuBrushShiftRegion(sessionId,batch,longEdge,geometrySignature,isCurrent,signal,proxy,true);
      if(native||signal?.aborted||!isCurrent())return native;
      const spatial={...expression,leaf:{...leaf,mask_feather:0,mask_shift_edge:0}};
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,proxy.width,proxy.height);
      if(!frame||!window.HDRMaskRaster?.eligible(spatial,frame.geometrySignature))return null;
      const paint={...expression,leaf:{...leaf,strokes:leaf.strokes.filter(stroke=>!stroke.erase)}};
      let soft;
      for(const edge of [512,1024,1600,3200]){
        soft=await this.loadGpuBrushLeaf(sessionId,batch.local,paint,'',edge,editRevision,
          geometrySignature,isCurrent,signal);
        if(soft?.soft||signal?.aborted||!isCurrent())break;
      }
      if(!soft?.soft||signal?.aborted||!isCurrent())return null;
      const rect=proxy.region,key=`${sessionId}:${longEdge}:${geometrySignature}:gpu-brush-erase:${gpuMaskIdentity(expression)}:${JSON.stringify(rect)}`;
      let entry=this.localMasks.get(key);
      if(!entry){
        const raster=window.HDRMaskRaster.parameters(spatial,{...rect,x:rect.x+frame.x,y:rect.y+frame.y},frame.width,frame.height,frame.geometrySignature);
        if(!raster)return null;
        const values=new Float32Array([...raster,proxy.width,proxy.height,rect.x,rect.y,...(soft.frameRect||[0,0,1,1])]);
        const buffer=this.createStorageBuffer(values),texture=this.createMaskTexture(rect.width,rect.height);
        this.device.queue.writeBuffer(buffer,0,values);
        const encoder=this.device.createCommandEncoder();
        this.encodeMaskPass(encoder,this.maskPipelines.brushRegionalErase,this.createMaskBindGroup(soft.texture,buffer),texture);
        this.device.queue.submit([encoder.finish()]);this.destroyAfterActiveRenders(()=>buffer.destroy());
        entry={cacheKey:key,texture,width:rect.width,height:rect.height,byteSize:rect.width*rect.height*2,
          kind:'gpu-brush-regional-erase',wholeFrame:true,frameRect:[rect.x/proxy.width,rect.y/proxy.height,rect.width/proxy.width,rect.height/proxy.height]};
        this.localMasks.set(key,entry);
        this.performanceMetrics.maskEvents||=[];
        this.performanceMetrics.maskEvents.push({kind:entry.kind,longEdge,width:rect.width,height:rect.height,
          paintLongEdge:soft.longEdge,paintEstimate:soft.softEstimate,cpuMaskRequest:false});
      }
      this.retainLocalMask(entry,longEdge);
      return {localIndex:batch.localIndex,entries:new Map(batch.tiles.map(tile=>[tile.key,entry]))};
    }

    /** SDR base pixels are not scene luminance. Fetch one independent HDR
     * region for all eligible scene-qualified locals in this foreground pass.
     * Feather support and its downsample grid are anchored to the full frame.
     * A refused region keeps the existing mask fallback; no whole-source load.
     */
    async loadSceneMaskRegion(sessionId, proxy, tiles, locals, longEdge, editRevision,
      geometrySignature, isCurrent, signal) {
      if (!this.gpuAnalyticMasksEnabled || !proxy?.region || proxy.lane !== "sdr"
        || lumaSceneSource(proxy.lane, proxy.sourceIdentity, proxy.workingSpace)) return null;
      const leaves = locals.filter(local => (isGpuLumaMask(local.mask)
        || gpuRegionalGraphEligible(local.mask, geometrySignature))
        && !this.sourceSpaceMask(sessionId, local.mask, longEdge, geometrySignature)).flatMap(local => gpuLumaLeaves(local.mask));
      if (!leaves.length || !tiles.length || !isCurrent()) return null;
      let reach = 0, alignment = 1;
      const gcd = (a,b) => b ? gcd(b,a%b) : a;
      for (const leaf of leaves) {
        const plan = lumaFeatherPlan(leaf.mask_feather, proxy.width, proxy.height,
          this.featherReferenceScale?.(geometrySignature) || 1);
        reach = Math.max(reach, lumaFeatherReach(plan));
        alignment = alignment / gcd(alignment,plan.factor) * plan.factor;
        if (alignment > 512) return null;
      }
      const halos = tiles.map(tile => tile.haloRect);
      const x = Math.max(0, Math.floor((Math.min(...halos.map(rect => rect.x))-reach)/alignment)*alignment);
      const y = Math.max(0, Math.floor((Math.min(...halos.map(rect => rect.y))-reach)/alignment)*alignment);
      const right = Math.min(proxy.width, Math.ceil((Math.max(...halos.map(rect => rect.x+rect.width))+reach)/alignment)*alignment);
      const bottom = Math.min(proxy.height, Math.ceil((Math.max(...halos.map(rect => rect.y+rect.height))+reach)/alignment)*alignment);
      const region = {x,y,width:right-x,height:bottom-y};
      if (alignment > 1) region.alignment = alignment;
      const limit = this.device?.limits?.maxTextureDimension2D || 8192;
      if (!(region.width > 0 && region.height > 0) || region.width > limit || region.height > limit
        || region.width*region.height >= proxy.width*proxy.height*.9) return null;
      const source = await this.loadProxy(sessionId, "hdr", longEdge, geometrySignature,
        editRevision, "source", {region, regionOnly:true, signal, isCurrent});
      if (!source || !isCurrent() || signal?.aborted || source.width !== proxy.width || source.height !== proxy.height
        || !source.region || source.workingSpace !== "acescg"
        || !lumaSceneSource(source.lane, source.sourceIdentity, source.workingSpace)) return null;
      return source;
    }

    /** One analytic bitmap for the bounded source region, shared by its tiles.
     * The cache owns it once; every tile pins that same key. Frame placement
     * lets local passes sample their halo without stretching the mask.
     */
    analyticMaskFrame(sessionId,longEdge,geometrySignature,width,height) {
      const geometry=JSON.parse(geometrySignature),crop=geometry.crop||{};
      // Without picture dimensions (zoom preparation) the frame follows
      // source metadata alone, exactly as the cropped case already does.
      const derived=width==null;
      if(!derived&&!Number(crop.x||0)&&!Number(crop.y||0)&&(crop.width??1)===1&&(crop.height??1)===1)
        return {geometrySignature,width,height,x:0,y:0};
      const size=this.maskSourceSize;
      if(size?.sessionId!==sessionId)return null;
      const normalized=JSON.stringify({...geometry,crop:{x:0,y:0,width:1,height:1}});
      if(!window.HDRMaskRaster?.eligible({operator:'leaf',leaf:{type:'brush'}},normalized))return null;
      const round=window.HDRGpuBrushMask?.evenRound;
      if(!round)return null;
      const scale=Math.min(1,longEdge/Math.max(size.width,size.height));
      let w=Math.max(1,round(size.width*scale)),h=Math.max(1,round(size.height*scale));
      if(Number(geometry.rotation||0)%180)[w,h]=[h,w];
      const x=Math.min(w-1,Math.max(0,round((crop.x||0)*w))),y=Math.min(h-1,Math.max(0,round((crop.y||0)*h)));
      const right=Math.min(w,Math.max(x+1,round(((crop.x||0)+(crop.width??1))*w)));
      const bottom=Math.min(h,Math.max(y+1,round(((crop.y||0)+(crop.height??1))*h)));
      if(!derived&&(right-x!==width||bottom-y!==height))return null;
      return {geometrySignature:normalized,width:w,height:h,x,y};
    }

    loadGpuAnalyticRegion(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy) {
      const sourceRect = proxy.region;
      const limit = this.device?.limits?.maxTextureDimension2D || 8192;
      if (!sourceRect || !batch.tiles.length
        || batch.tiles.some(({ haloRect: tile }) => !tile
          || tile.x < sourceRect.x || tile.y < sourceRect.y
          || tile.x + tile.width > sourceRect.x + sourceRect.width
          || tile.y + tile.height > sourceRect.y + sourceRect.height)) return null;
      // The scene source may include an additional luma-feather halo. Shape
      // and gradient masks only need the union of the actual pass halos.
      const halos = batch.tiles.map(tile => tile.haloRect);
      const x = Math.min(...halos.map(tile => tile.x)), y = Math.min(...halos.map(tile => tile.y));
      const rect = { x, y,
        width: Math.max(...halos.map(tile => tile.x + tile.width)) - x,
        height: Math.max(...halos.map(tile => tile.y + tile.height)) - y };
      if (rect.width > limit || rect.height > limit) return null;
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,proxy.width,proxy.height);
      if(!frame)return null;
      const shape = window.HDRMaskRaster?.eligible(batch.local.mask, frame.geometrySignature);
      if (!shape && !isGpuLinearGradientMask(batch.local.mask, frame.geometrySignature)) return null;
      if (!isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
      const regionBatch = { ...batch, tiles: [{ key: "region", rect, halo: 0, haloRect: rect }] };
      // Keep region entries distinct from tile entries, even if their bounds
      // happen to coincide, since the latter have implicit pass placement.
      const result = shape
        ? this.loadGpuShapeTiles(sessionId, regionBatch, longEdge, geometrySignature, `${signature}:region`, isCurrent, proxy)
        : this.loadGpuLinearGradientTiles(sessionId, regionBatch, longEdge, geometrySignature, `${signature}:region`, isCurrent, proxy);
      if (!result) return null;
      const entry = result.entries.get("region");
      if (!entry) return { localIndex: batch.localIndex, entries: new Map() };
      entry.wholeFrame = true;
      entry.frameRect = [rect.x / proxy.width, rect.y / proxy.height,
        rect.width / proxy.width, rect.height / proxy.height];
      return { localIndex: batch.localIndex, entries: new Map(batch.tiles.map(tile => [tile.key, entry])) };
    }

    loadGpuLinearGradientTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy) {
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,proxy.width,proxy.height);
      if(!frame)return null;
      const prefix = `${sessionId}:${batch.local.id}:${longEdge}:${geometrySignature}:${signature}:`;
      const entries = new Map();
      const encoder = this.device.createCommandEncoder();
      const buffers = [];
      let generated = 0;
      const expression = batch.local.mask;
      for (const tile of batch.tiles) {
        if (!isCurrent()) break;
        const key = `${prefix}${maskLoader().spatialTileKey(tile)}`;
        let entry = this.maskTiles.get(key);
        if (!entry) {
          const rect = tile.haloRect;
          const texture = this.createMaskTexture(rect.width, rect.height);
          const values = buildGpuLinearGradientParams(expression,{...rect,x:rect.x+frame.x,y:rect.y+frame.y},
            frame.width,frame.height,frame.geometrySignature);
          const buffer = this.createStorageBuffer(values);
          this.device.queue.writeBuffer(buffer, 0, values);
          this.encodeMaskPass(encoder, this.maskPipelines.linearGradient,
            this.createMaskBindGroup(proxy.texture, buffer), texture);
          buffers.push(buffer);
          entry = { key, texture, width: rect.width, height: rect.height,
            byteSize: rect.width * rect.height * 2, kind: "gpu-linear-gradient" };
          this.maskTiles.set(key, entry);
          generated += 1;
        } else {
          this.maskTiles.delete(key);
          this.maskTiles.set(key, entry);
        }
        entries.set(tile.key, entry);
      }
      if (generated) {
        this.device.queue.submit([encoder.finish()]);
        this.destroyAfterActiveRenders(() => buffers.forEach((buffer) => buffer.destroy()));
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({ kind: "gpu-linear-gradient", longEdge, tiles: generated,
          cpuMaskRequest: false });
      }
      return { localIndex: batch.localIndex, entries };
    }

    loadGpuShapeTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy) {
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,proxy.width,proxy.height);
      if(!frame)return null;
      const prefix = `${sessionId}:${batch.local.id}:${longEdge}:${geometrySignature}:${signature}:gpu-shape:`;
      // Prepare every tile before allocating: oversized geometry retains the
      // established fallback without leaving a partially published mask.
      const prepared = batch.tiles.map(tile => ({tile, values: window.HDRMaskRaster.parameters(
        batch.local.mask,{...tile.haloRect,x:tile.haloRect.x+frame.x,y:tile.haloRect.y+frame.y},
        frame.width,frame.height,frame.geometrySignature)}));
      if (prepared.some(item => !item.values)) return null;
      const entries = new Map(), encoder = this.device.createCommandEncoder(), buffers = [];
      let generated = 0;
      for (const {tile,values} of prepared) {
        if (!isCurrent()) break;
        const key = `${prefix}${maskLoader().spatialTileKey(tile)}`;
        let entry = this.maskTiles.get(key);
        if (!entry) {
          const rect = tile.haloRect, texture = this.createMaskTexture(rect.width,rect.height);
          const buffer = this.createStorageBuffer(values);
          this.device.queue.writeBuffer(buffer,0,values);
          this.encodeMaskPass(encoder,this.maskPipelines.shapeRaster,this.createMaskBindGroup(proxy.texture,buffer),texture);
          buffers.push(buffer);
          entry = {key,texture,width:rect.width,height:rect.height,byteSize:rect.width*rect.height*2,
            kind:`gpu-${batch.local.mask.leaf.type}-raster`};
          this.maskTiles.set(key,entry);generated++;
        } else {this.maskTiles.delete(key);this.maskTiles.set(key,entry);}
        entries.set(tile.key,entry);
      }
      if (generated) {
        this.device.queue.submit([encoder.finish()]);
        this.destroyAfterActiveRenders(()=>buffers.forEach(buffer=>buffer.destroy()));
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({kind:`gpu-${batch.local.mask.leaf.type}-raster`,longEdge,tiles:generated,cpuMaskRequest:false});
      }
      return {localIndex:batch.localIndex,entries};
    }

    trimMaskTiles(pinned = []) {
      // The tiles of the frame on screen stay, whoever is trimming: a
      // measurement pass over the whole image must not cost the viewer the
      // masks under the region it is looking at.
      const protectedKeys = new Set([...pinned, ...(this.presentedMaskKeys || [])]);
      const budget = this.cacheBudgetBytes(0.20, 32 * 1024 * 1024);
      let bytes = [...this.maskTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      for (const [key, entry] of [...this.maskTiles]) {
        if (bytes <= budget) break;
        if (protectedKeys.has(key)) continue;
        this.maskTiles.delete(key);
        this.destroyAfterActiveRenders(() => entry.texture.destroy());
        bytes -= entry.byteSize;
      }
      return bytes;
    }

    scheduleTileCacheTrim() {
      const device = this.device;
      if (!device?.queue) return;
      if (this.pendingCacheTrim && this.pendingCacheTrimDevice === device) {
        return this.pendingCacheTrim;
      }
      // Wait for active encoders first, then drain all their submissions. A
      // new render may start during that drain: wait again rather than destroy
      // textures that its later submissions still need.
      const trimWhenIdle = () => new Promise((resolve, reject) => {
        this.destroyAfterActiveRenders(() => {
          device.queue.onSubmittedWorkDone().then(() => {
            if (this.device !== device) return resolve();
            if (this.activeRenderCount > 0 || this.activeScopeCount > 0) {
              resolve(trimWhenIdle());
              return;
            }
            this.trimDetailBandTiles();
            this.trimMaskTiles();
            this.trimDenoiseTiles();
            resolve();
          }).catch(reject);
        });
      });
      this.pendingCacheTrimDevice = device;
      const pending = trimWhenIdle().catch(() => null).finally(() => {
        // A replacement device may already have scheduled its own trim.
        if (this.pendingCacheTrim !== pending) return;
        this.pendingCacheTrim = null;
        this.pendingCacheTrimDevice = null;
      });
      this.pendingCacheTrim = pending;
      return pending;
    }

    /** Encode and submit one complete haloed tiled generation. */
    async encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, options = {}) {
      const Scheduler = options.Scheduler
        || (typeof window !== "undefined" ? window.HDRTileScheduler : null);
      if (!Scheduler) return { rendered: false, refusals: ["tile scheduler is unavailable"] };
      try {
      const tileSize = Math.max(64, Math.floor(Number(options.tileSize) || Scheduler.DEFAULT_TILE_SIZE));
      // A measurement pass renders the graph to read one number off it and
      // presents nothing, so it must leave every piece of state that describes
      // the presented generation exactly as it found it.
      const measureOnly = Boolean(options.measureOnly);
      const lane = options.lane || "hdr";
      const longEdge = Number(options.longEdge) || Math.max(proxy.width, proxy.height);
      const editRevision = Number(options.editRevision) || 0;
      const activeLocals = options.activeLocals || [];
      const { detailActive, spatialActive, filmNeighbourhoodActive } = this.graphActivity(params);
      const localDetailActive = activeLocals.some((local) => gpuLocalDetailActive(local[`${lane}_grade`]));
      writeClarityPlan(params, proxy.width, proxy.height, params[151]);
      // Denoise reconstructs into a tile-sized texture rather than reading a
      // whole-frame resolved one. The alignment is the wavelet grid: a Haar
      // decomposition indexes from the frame's origin, so a tile that started
      // off the grid would reconstruct against the wrong parity.
      const denoiseSelector = this.denoiseSourceSelector;
      // The evidence is indexed against the frame the analysis ran on. If this
      // render is at a different resolution the indexing does not line up, and
      // reconstructing anyway would denoise against the wrong pixels -- so the
      // graph renders undenoised rather than wrongly, exactly as it did before
      // an analysis existed.
      //
      // `selected` is the switch. Direct honours it through
      // selectedDenoiseSource; this path used to reconstruct from the evidence
      // whenever a cache existed, without asking whether denoise was on. A
      // cache outlives the toggle -- bypassing sets `selected` to "original"
      // and keeps the evidence so re-enabling is free -- so on every tiled
      // render, which is every render at the Full tier, Denoise could not be
      // switched off at all.
      //
      // Adaptive Denoise holds no evidence, only a noise model, so it
      // reconstructs from whatever source this pass loaded -- a region of the
      // frame as readily as the whole of it.
      const adaptiveDenoise = this.adaptiveDenoiseFor(proxy);
      const denoiseActive = adaptiveDenoise || Boolean(
        denoiseSelector?.cache && denoiseSelector.original
        && denoiseSelector.selected === "resolved"
        && (denoiseSelector.identity === proxy.identity || (options.analysisMasks && denoiseSelector.original.sessionId === proxy.sessionId && denoiseSelector.original.geometrySignature === proxy.geometrySignature))
        && denoiseSelector.original.width === proxy.width
        && denoiseSelector.original.height === proxy.height,
      );
      const denoiseSource = adaptiveDenoise ? proxy : null;
      const denoiseControls = denoiseSelector?.controls
        || { amount: 0.5, luminance: 0.5, colorNoise: 0.5, detailRecovery: 0 };
      // Show noise differences the original against this generation's own
      // reconstruction, so whether anything was removed is decided here.
      const noiseView = params[NOISE_VIEW_INDEX] > 0;
      if (noiseView) params[NOISE_VIEW_INDEX] = denoiseActive ? 1 : 2;
      const denoiseAlignment = denoiseActive
        ? denoiseTileAlignment(denoiseSelector.cache.settings.levels)
        : 1;
      // A measurement may bring Clarity's maps from a reduced render of the
      // frame; the tile then needs no halo for them.
      const surround = options.claritySurround || null;
      let { halo, detailHalo, spatialHalo } = this.composedTileHalo(
        proxy.width, proxy.height, surroundHaloParams(params, surround),
        surroundHaloLocals(activeLocals, lane, surround), lane,
      );
      if (denoiseActive && halo % denoiseAlignment) {
        halo = Math.ceil(halo / denoiseAlignment) * denoiseAlignment;
      }
      const viewportRequest = this.tileViewportRequest(
        options.sessionId, lane, proxy, options.sourceSize,
        { ...options, viewport: options.viewport, editRevision },
        options.geometrySignature || "{}", tileSize, halo,
      );
      const scheduler = this.tileScheduler instanceof Scheduler
        ? this.tileScheduler
        : (this.tileScheduler = new Scheduler({
          tileSize,
          maxResidentBytes: Math.floor(this.memoryBudgetBytes() * 0.7),
          maxScratchBytes: (tileSize + halo * 2) ** 2 * 8,
        }));
      // The view mode is part of tile identity so the pan cache never answers a
      // noise-view pass with graded tiles, or the reverse. So is Denoise: the
      // toggle changes neither the edit revision nor the generation, so without
      // this a bypass at Full or zoomed in found every visible tile already
      // drawn for this generation, redrew nothing, and left the denoised
      // picture up until something else moved the identity.
      const denoiseIdentity = denoiseActive
        ? `|denoise:${denoiseSelector.identity}:${JSON.stringify(denoiseControls)}`
        : "";
      const identity = `${proxy.identity}|${editRevision}|${surface.format}${noiseView ? "|noise" : ""}${denoiseIdentity}`;
      const nodes = ["geometry"];
      if (denoiseActive) nodes.push({ id: "denoise", halo });
      nodes.push("exposure", "white-balance", "curves", "color", "grading");
      // Every neighbourhood node declares the composed reach, because each of
      // them has to be correct over the tile plus whatever the stages after it
      // will read. Detail runs first, so its own reach is the largest.
      if (detailActive || localDetailActive) nodes.push({ id: "detail", halo });
      if (activeLocals.length) nodes.push({ id: "mask-feather", halo });
      if (params[85] > 0.5) nodes.push({ id: "halation", halo });
      if (params[92] > 0.5 && params[93] > 0) nodes.push({ id: "bloom", halo });
      if (filmNeighbourhoodActive && !spatialActive) nodes.push({ id: "softness", halo });
      if (params[123] > 0.5 && params[124] !== 0) nodes.push("vignette");
      if (params[156] > 0.5 && params[157] > 0) nodes.push("grain");
      const plan = scheduler.plan({
        width: proxy.width,
        height: proxy.height,
        identity,
        generation: Number(options.applicationGeneration ?? 0),
        tileSize,
        nodes,
        // A real viewport request orders visible tiles
        // first and lets a magnified ROI keep offscreen tiles out of the
        // foreground batch. No viewport means Fit, which is the whole output.
        viewport: viewportRequest.fit ? undefined : viewportRequest.visible,
      });
      if (options.analysisPatch) {
        const patch = options.analysisPatch;
        plan.tiles = plan.tiles.filter(tile => tile.rect.x === patch.x && tile.rect.y === patch.y);
        plan.tileCount = plan.tiles.length;
        plan.visibleCount = plan.tiles.length;
        plan.visibleKeys = plan.tiles.map(tile => tile.key);
      }
      const workWidth = Math.min(proxy.width, tileSize + halo * 2);
      const workHeight = Math.min(proxy.height, tileSize + halo * 2);
      // Foreground selection. With a viewport and an accepted frame of
      // this exact size and identity already on the canvas, only the tiles that
      // intersect the viewport are processed and the rest of the accepted
      // frame is kept: offscreen tiles are not part of the foreground batch.
      // Without a viewport, or when the canvas has nothing to retain, every
      // tile is processed exactly as before.
      const Contract = typeof window !== "undefined" ? window.HDRViewportRequest : null;
      const viewport = viewportRequest.fit ? null : viewportRequest.visible;
      // The retained target holds the accepted frame between generations, so a
      // viewport pass can load it and process only its foreground tiles.
      const presentationTarget = measureOnly
        ? null
        : this.ensurePresentationTarget(proxy.width, proxy.height, surface.format);
      // Pad the request by a fraction of itself before selecting foreground
      // tiles. Without the padding a small pan exposes the previous pass's
      // boundary as a seam inside the viewport, because the newly visible strip
      // was never refined. The padding is a mitigation, not a fix: an edit that
      // moves the view further than the padding, or leaves the frame at all,
      // still needs progressive catch-up before the rest of the image matches.
      const foregroundRegion = viewport ? viewportRequest.roi : null;
      // Whether the target behind this pass still holds the accepted frame at
      // this exact size, identity and format. This is about the frame, not the
      // request: a whole-frame catch-up retains too, it just has no region to
      // answer from the pan cache. The signature string must be the one this
      // pass stored, never the global helper of the same name.
      const retainedFrame = this.retainedTiledFrame(
        options.sessionId, lane, options.geometrySignature || "{}", surface.format,
      );
      // Display-scale pan cache. A viewport pass over a
      // retained frame is split into the tiles that still owe the current
      // generation and the tiles the cache already holds at this display
      // scale (the plan's identity is per proxy, so the scale is part of the
      // key). Panning back into a region refined for this generation then
      // processes nothing at all, and a newly exposed strip is the only work.
      // A frame that is not retained -- a new target size, a direct pass in
      // between -- has no trustworthy cache, so it redraws whole.
      // A magnified pass draws only its region even when the target holds
      // no frame of this size yet (a zoom in, a lane switch): the rest of the
      // target is filled from the last finished frame instead of being drawn,
      // and nothing drawn for an earlier frame counts as current.
      const regionOnly = !retainedFrame && !measureOnly && Boolean(Contract && foregroundRegion);
      if (regionOnly) scheduler.accepted.clear();
      const viewportTiles = (retainedFrame || regionOnly) && Contract && foregroundRegion
        ? Contract.foregroundTiles(plan.tiles, foregroundRegion)
        : null;
      // A catch-up over a retained frame owes only the tiles the region pass
      // before it did not draw at this generation.
      const candidateTiles = viewportTiles
        || (retainedFrame && !measureOnly && options.roiCatchUp && Contract ? plan.tiles : null);
      const panCache = candidateTiles
        ? Contract.partitionByGeneration(
          candidateTiles,
          (key) => scheduler.acceptedGeneration(key),
          plan.generation,
        )
        : null;
      const foregroundTiles = panCache ? panCache.pending : plan.tiles;
      const reusedTiles = panCache ? panCache.cached : [];
      // A region source only carries the viewport's corner of
      // the frame, so every tile this pass will copy must lie inside it. The
      // fetch region is sized for exactly that; a miss means the region math
      // and the plan disagree, and refusing is safer than reading outside the
      // texture and presenting whatever is there.
      if (proxy.region) {
        const region = proxy.region;
        const uncovered = foregroundTiles.some((tile) => (
          tile.haloRect.x < region.x || tile.haloRect.y < region.y
          || tile.haloRect.x + tile.haloRect.width > region.x + region.width
          || tile.haloRect.y + tile.haloRect.height > region.y + region.height
        ));
        if (uncovered) {
          this.recordStage("roi-region-refused", { lane, longEdge, region: { ...region },
            frame: { width: proxy.width, height: proxy.height }, viewport: viewport ? { ...viewport } : null,
            roi: foregroundRegion ? { ...foregroundRegion } : null, halo });
          return { rendered: false, refusals: ["roi source region does not cover its foreground tiles"] };
        }
      }
      let cancelled = false;
      const graph = this.ensureTileGraph(
        workWidth, workHeight, surface.format, proxy.pixelFormat, spatialActive, denoiseActive,
        spatialGridScale(proxy.width, proxy.height), Boolean(options.analysisPatch),
      );
      if (!graph) return { rendered: false, refusals: ["tile graph allocation failed"] };

      const isCurrent = options.isCurrent || (() => true);
      // Parameter buffers the reconstruction encoded against. They must outlive
      // the submission that reads them, so they are freed alongside the local
      // buffers once it has gone through.
      const denoiseParamBuffers = [];
      let denoiseTileResolves = 0;
      // Denoised tiles are kept only for the picture on screen, and only when
      // the source this pass holds reaches a full reconstruction margin past
      // the tile (or the frame ends first), so a kept tile is exactly what the
      // whole frame would give. Show noise and measurement passes reconstruct.
      //
      // Tiles are kept for one Denoise state at a time, and only from the
      // second pass that draws it: a Denoise control drag, a geometry edit or a
      // new zoom level changes the state every pass, and keeping a set of tiles
      // for each would fill the budget with tiles nothing will read again.
      const denoiseTileIdentity = adaptiveDenoise && !noiseView && !measureOnly
        ? `${denoiseSelector.cache.identity}|${JSON.stringify(denoiseControls)}`
        : null;
      const denoiseStateSeen = denoiseTileIdentity !== null && this.denoiseTileIdentity === denoiseTileIdentity;
      if (denoiseTileIdentity !== null && !denoiseStateSeen) {
        this.dropDenoiseTiles();
        this.denoiseTileIdentity = denoiseTileIdentity;
      }
      const denoiseTilePrefix = denoiseStateSeen ? denoiseTileIdentity : null;
      const denoiseHeld = proxy.region || { x: 0, y: 0, width: proxy.width, height: proxy.height };
      const denoiseTileKey = (region) => {
        if (!denoiseTilePrefix) return null;
        const reaches = (start, size, heldStart, heldSize, frameSize) => (
          Math.max(0, start - ADAPTIVE_DENOISE_MARGIN) >= heldStart
          && Math.min(frameSize, start + size + ADAPTIVE_DENOISE_MARGIN) <= heldStart + heldSize
        );
        if (!reaches(region.x, region.width, denoiseHeld.x, denoiseHeld.width, proxy.width)
          || !reaches(region.y, region.height, denoiseHeld.y, denoiseHeld.height, proxy.height)) return null;
        return `${denoiseTilePrefix}|${region.x},${region.y},${region.width},${region.height}`;
      };
      // Tiles this pass created, and those whose fill is still in an encoder
      // that has not been submitted: a pass that stops early must not leave a
      // tile behind that was never written.
      const denoiseTilesCreated = [];
      const denoiseTilesUnsubmitted = [];
      const denoiseTilesUsed = [];
      let denoiseTileHits = 0;
      // Tiles are grouped by local and sent as bounded batches: one HTTP
      // request and one coordinator slot per batch, and one mask identity per
      // batch for the backend to compile once.
      const maskBatches = activeLocals.length && foregroundTiles.length && this.maskTileBatch
        ? this.maskTileBatch.plan({ locals: activeLocals, tiles: foregroundTiles })
        : [];
      const sceneMaskSource = options.analysisMasks ? null : await this.loadSceneMaskRegion(
        options.sessionId, proxy, foregroundTiles, activeLocals, longEdge, editRevision,
        options.geometrySignature || "{}", isCurrent, this.sourceAbortSignal());
      const scenePin = sceneMaskSource?.allocatorEntry && this.gpuAllocator
        ? this.gpuAllocator.pin(sceneMaskSource.allocatorEntry) : null;
      this.markResidentMaskFrame(options.sessionId, activeLocals, options.analysisMasks ? 1600 : longEdge,
        options.geometrySignature || "{}", options.analysisMasks ? null : (sceneMaskSource?.region || proxy.region));
      const maskCoordinator = measureOnly
        ? this.backgroundMaskRequestCoordinator
        : this.maskRequestCoordinator;
      const maskGeneration = `${identity}|${Number(options.applicationGeneration ?? 0)}|${measureOnly ? "analysis" : "foreground"}`;
      let loadedMasks;
      try {
        loadedMasks = maskBatches.length && maskCoordinator
          ? await maskCoordinator.run(
            maskGeneration,
            maskBatches,
            async (batch, _index, signal) => {
              if (options.analysisMasks) {
                const mask = (options.analysisNativeLuma
                  && this.analysisLumaMask(batch.local, proxy, options.geometrySignature || "{}"))
                  || await this.loadEditingMask(options.sessionId, batch.local, editRevision,
                    options.geometrySignature || "{}", proxy, options.sourceSize, isCurrent, signal);
                const entry = mask ? {...mask, wholeFrame:true} : null;
                return {localIndex:batch.localIndex, entries:new Map(batch.tiles.map(tile => [tile.key,entry]))};
              }
              return this.loadLocalMaskTiles(options.sessionId, batch, longEdge, editRevision,
                options.geometrySignature || "{}", isCurrent, signal, proxy, sceneMaskSource);
            },
            isCurrent,
          )
          : { results: [], current: isCurrent() };
      } finally {
        if (scenePin) this.gpuAllocator.unpin(scenePin);
      }
      const tileIndexByKey = new Map(plan.tiles.map((tile, index) => [tile.key, index]));
      const maskMatrix = plan.tiles.map(() => activeLocals.map(() => null));
      if (loadedMasks.current && isCurrent()) {
        for (const loaded of loadedMasks.results) {
          if (!loaded) continue;
          loaded.entries.forEach((entry, tileKey) => {
            const tileIndex = tileIndexByKey.get(tileKey);
            if (tileIndex !== undefined) maskMatrix[tileIndex][loaded.localIndex] = entry;
          });
        }
      }
      if (!loadedMasks.current || !isCurrent() || foregroundTiles.some((tile) => (
        maskMatrix[tileIndexByKey.get(tile.key)].some((entry) => !entry)
      ))) {
        return { rendered: false, refusals: ["mask tile unavailable or superseded"] };
      }

      // Global Clarity reads one brightness map of the whole frame, filled by a
      // pre-pass that runs only the base grade, so it adds nothing to the
      // tile halo. The map is keyed by the picture entering Detail, and by
      // Denoise's live controls when Denoise reconstructs that picture.
      const clarityFrame = !noiseView && foregroundTiles.length && graphScaleContract().clarityActive(params)
        && !surround?.global
        ? this.planClarityFrameMap({
          proxy,
          params,
          identity: `${detailBandIdentity(params, proxy.identity, "global")}|${denoiseActive ? JSON.stringify(denoiseControls) : "-"}`,
          tiles: foregroundTiles,
          workWidth,
          workHeight,
          alignment: denoiseAlignment,
          analysis: Boolean(options.analysisMasks),
        })
        : null;
      if (clarityFrame && proxy.region) {
        const region = proxy.region;
        const uncovered = clarityFrame.chunks.some(({ region: chunk }) => (
          chunk.x < region.x || chunk.y < region.y
          || chunk.x + chunk.width > region.x + region.width
          || chunk.y + chunk.height > region.y + region.height
        ));
        if (uncovered) {
          this.recordStage("roi-region-refused", { lane, longEdge, region: { ...region }, reason: "clarity-map" });
          return { rendered: false, refusals: ["roi source region does not cover the clarity map's reach"] };
        }
      }
      const clarityChunks = clarityFrame ? clarityFrame.chunks.length : 0;

      const alignment = 256;
      const stride = Math.ceil(params.byteLength / alignment) * alignment;
      const required = stride * (plan.tileCount + clarityChunks);
      if (!this.tileCompositeParamBuffer || this.tileCompositeParamBuffer.size < required) {
        this.tileCompositeParamBuffer?.destroy();
        this.tileCompositeParamBuffer = this.device.createBuffer({
          size: required, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      const slots = new Float32Array((stride / 4) * (plan.tileCount + clarityChunks));
      // The Clarity pre-pass's regions take the slots after the tiles'.
      (clarityFrame?.chunks || []).forEach(({ region }, index) => {
        const base = (plan.tileCount + index) * (stride / 4);
        slots.set(params, base);
        slots[base + 160] = region.x;
        slots[base + 161] = region.y;
        slots[base + 162] = region.width;
        slots[base + 163] = region.height;
        slots[base + 164] = proxy.width;
        slots[base + 165] = proxy.height;
      });
      plan.tiles.forEach((tile, index) => {
        const base = index * (stride / 4);
        slots.set(params, base);
        slots[base + 160] = tile.haloRect.x;
        slots[base + 161] = tile.haloRect.y;
        slots[base + 162] = tile.haloRect.width;
        slots[base + 163] = tile.haloRect.height;
        slots[base + 164] = proxy.width;
        slots[base + 165] = proxy.height;
        if (surround?.global) {
          const origin = surroundMapRect(tile.haloRect, params[CLARITY_MAP_SCALE_INDEX]);
          slots[base + CLARITY_MAP_ORIGIN_X_INDEX] = origin.x;
          slots[base + CLARITY_MAP_ORIGIN_Y_INDEX] = origin.y;
        }
        writeMaskRect(
          slots, base, options.overlayIndex >= 0 ? maskMatrix[index][options.overlayIndex] : null,
          proxy.width, proxy.height,
        );
        // The peak reduction reads its grid from the same slots the scope
        // passes do. Nothing else in the render graph reads them.
        slots[base + 136] = SCOPE_PEAK_GRID;
        slots[base + 137] = SCOPE_PEAK_GRID;
      });
      this.device.queue.writeBuffer(this.tileCompositeParamBuffer, 0, slots);

      const tiledLocalState = buildTiledLocalState(
        proxy.identity, params, activeLocals, lane, options.sourcePixelScale || 1,this.localCurveOffsets,
      );
      const localBuffers = activeLocals.map((local, localIndex) => {
        const localStride = Math.ceil(PARAM_COUNT * 4 / alignment) * alignment;
        const buffer = this.device.createBuffer({
          size: localStride * plan.tileCount,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const values = new Float32Array((localStride / 4) * plan.tileCount);
        plan.tiles.forEach((tile, index) => {
          const offset = index * (localStride / 4);
          values.set(tiledLocalState[localIndex].params, offset);
          values[offset + 160] = tile.haloRect.x;
          values[offset + 161] = tile.haloRect.y;
          values[offset + 162] = tile.haloRect.width;
          values[offset + 163] = tile.haloRect.height;
          values[offset + 164] = proxy.width;
          values[offset + 165] = proxy.height;
          writeMaskRect(values, offset, maskMatrix[index][localIndex], proxy.width, proxy.height);
          // A local builds its Clarity map inside the tile; the map starts at
          // the frame block holding the halo rectangle's first pixel.
          const slot = values.subarray(offset, offset + PARAM_COUNT);
          const clarity = writeClarityPlan(slot, proxy.width, proxy.height, slot[16], tile.haloRect.x, tile.haloRect.y);
          if (surround?.locals.has(local.id)) {
            const origin = surroundMapRect(tile.haloRect, clarity.scale);
            slot[CLARITY_MAP_ORIGIN_X_INDEX] = origin.x;
            slot[CLARITY_MAP_ORIGIN_Y_INDEX] = origin.y;
          }
        });
        this.device.queue.writeBuffer(buffer, 0, values);
        return { buffer, stride: localStride };
      });

      const sourceView = graph.sourceTexture.createView();
      const baseView = graph.baseTexture.createView();
      const localView = graph.localTexture.createView();
      const scratchView = graph.detailScratchTexture.createView();
      const detailResultView = graph.detailResultTexture.createView();
      const filmView = graph.filmTexture.createView();
      const finishView = graph.finishTexture.createView();
      // No finished picture exists in the noise view, so there is no peak to
      // measure, and reading back an unwritten grid would report a stale one.
      const peakTarget = noiseView ? null : this.ensureScopePeakTarget();
      const peakView = peakTarget?.texture.createView() || null;
      const globalInputIdentity = detailBandIdentity(params, proxy.identity, "global");
      const pinnedDetail = [];
      const pinnedMasks = maskMatrix.flat().map((entry) => entry?.key).filter(Boolean);
      const cacheBefore = { ...this.detailCacheCounters };
      const startedAt = performance.now();
      // The presentation gate is taken here, after every await this generation
      // needs: proxy, masks, tile graph and parameter buffers are all ready.
      // Only the newest generation may resize the canvas, and a superseded one
      // refuses before it has cleared anything.
      let presentation = null;
      if (!measureOnly) {
        presentation = this.presentationGate
          ? await this.presentationGate.acquire(
            canvas,
            () => options.serial === this.renderSerials.get(canvas) && isCurrent(),
            () => {
              if (canvas.width !== proxy.width) canvas.width = proxy.width;
              if (canvas.height !== proxy.height) canvas.height = proxy.height;
            },
          )
          : { current: () => true, release: () => {} };
        if (!presentation) {
          localBuffers.forEach((entry) => entry.buffer.destroy());
          if (peakTarget) peakTarget.busy = false;
          this.recordStage("tiled-refused", { lane, longEdge, refusals: ["superseded-before-presentation"] });
          return { rendered: false, refusals: ["superseded-before-presentation"] };
        }
        this.configureSurface(canvas, context, lane === "hdr");
      }
      let encodeError = null;
      let validationError = null;
      let validationScopeOpen = false;
      let processedTiles = 0;
      // Small-batch submission. The GPU starts on one batch
      // while the CPU encodes the next, and a superseded generation stops
      // submitting at the next batch boundary instead of finishing the image.
      // The retained target keeps the batches invisible until the final copy.
      const tileBatchSize = Math.max(1, Math.floor(Number(options.tileBatchSize) || 4));
      let batchTiles = 0;
      let submissions = 0;
      try {
      if (!measureOnly) this.scopeSources.delete(canvas);
      this.device.pushErrorScope("validation");
      validationScopeOpen = true;
      let encoder = this.device.createCommandEncoder();
      const flushTiles = () => {
        if (batchTiles === 0) return;
        this.device.queue.submit([encoder.finish()]);
        this.recordSubmission(lane, options, batchTiles);
        encoder = this.device.createCommandEncoder();
        denoiseTilesUnsubmitted.length = 0;
        batchTiles = 0;
        submissions += 1;
      };
      // The denoised picture for one region, left in the graph's source
      // texture: copied from a kept tile, or reconstructed and kept.
      const denoiseInto = async (region) => {
        const key = denoiseTileKey(region);
        const kept = key ? this.denoiseTile(key, region.width, region.height) : null;
        const extent = { width: region.width, height: region.height, depthOrArrayLayers: 1 };
        const origin = { x: 0, y: 0, z: 0 };
        if (kept) denoiseTilesUsed.push(key);
        if (kept?.hit) {
          denoiseTileHits += 1;
          encoder.copyTextureToTexture({ texture: kept.texture, origin }, { texture: graph.sourceTexture, origin }, extent);
          return;
        }
        if (kept) {
          denoiseTilesCreated.push(key);
          denoiseTilesUnsubmitted.push(key);
        }
        // Reconstruct only this region, into a texture the size of one tile,
        // and into the same encoder so the generation stays one submission.
        // The reconstruction reads the original at its true frame position,
        // so the pixels are the ones the whole-frame resolve would produce.
        const resolved = await this.resolveDenoiseProxy(denoiseControls, {
          region: { ...region },
          destination: {
            texture: graph.denoiseResolvedTexture,
            width: graph.width,
            height: graph.height,
            byteSize: graph.width * graph.height * 8,
          },
          encoder,
          source: denoiseSource,
        });
        if (resolved?.paramBuffer) denoiseParamBuffers.push(resolved.paramBuffer);
        denoiseTileResolves += 1;
        // Show noise keeps the reconstruction where it is and takes the
        // original as the source.
        if (noiseView) return;
        encoder.copyTextureToTexture({ texture: graph.denoiseResolvedTexture, origin }, { texture: graph.sourceTexture, origin }, extent);
        if (kept) encoder.copyTextureToTexture({ texture: graph.denoiseResolvedTexture, origin }, { texture: kept.texture, origin }, extent);
      };
      const pass = (view, pipeline, bindGroup, width, height, alpha = 1) => {
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: alpha }, loadOp: "clear", storeOp: "store" }],
        });
        renderPass.setViewport(0, 0, width, height, 0, 1);
        renderPass.setScissorRect(0, 0, width, height);
        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3);
        renderPass.end();
      };
      // A measurement pass must not acquire the swap chain: doing so would
      // hand it a texture sized to the canvas the viewer is looking at, and
      // presenting it would replace their frame with a partial one. A
      // presenting pass composites into the retained target instead and copies
      // that to the canvas once the frame is complete.
      const canvasView = presentationTarget ? presentationTarget.texture.createView() : null;
      let placeholderDrawn = false;
      if (regionOnly && canvasView) {
        const placeholder = options.allowPlaceholder && !noiseView
          ? this.placeholderFor(canvas, options.sessionId, lane, options.geometrySignature || "{}")
          : null;
        const fill = encoder.beginRenderPass({
          colorAttachments: [{ view: canvasView, loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store" }],
        });
        if (placeholder) {
          const view = placeholder.createView();
          fill.setPipeline(pipelines.placeholder);
          fill.setBindGroup(0, this.bindGraphResources(view, view, { buffer: this.paramBuffer }, view));
          fill.draw(3);
          placeholderDrawn = true;
        }
        fill.end();
      }
      const bandTileKey = (prefix, candidate) => `${prefix}|${candidate.rect.x},${candidate.rect.y},${candidate.rect.width},${candidate.rect.height}|h${candidate.halo}`;
      const intersect = (left, right) => {
        const x0 = Math.max(left.x, right.x);
        const y0 = Math.max(left.y, right.y);
        const x1 = Math.min(left.x + left.width, right.x + right.width);
        const y1 = Math.min(left.y + left.height, right.y + right.height);
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
      };
      const assemblePackedHalo = (prefix, targetTile) => {
        const pieces = plan.tiles.map((candidate) => ({
          candidate,
          overlap: intersect(candidate.rect, targetTile.haloRect),
          entry: this.detailBandTiles.get(bandTileKey(prefix, candidate)),
        })).filter((piece) => piece.overlap);
        if (pieces.some((piece) => !piece.entry)) return false;
        pieces.forEach(({ candidate, overlap, entry }) => {
          encoder.copyTextureToTexture(
            { texture: entry.texture, origin: { x: overlap.x - candidate.rect.x, y: overlap.y - candidate.rect.y, z: 0 } },
            { texture: graph.detailResultTexture, origin: { x: overlap.x - targetTile.haloRect.x, y: overlap.y - targetTile.haloRect.y, z: 0 } },
            { width: overlap.width, height: overlap.height, depthOrArrayLayers: 1 },
          );
        });
        return true;
      };

      // The Clarity pre-pass: fill whatever the frame map is missing for these
      // tiles, then re-blur it if anything changed. Only the base grade runs
      // over each region, and every tile below reads the finished map.
      let clarityMapView = detailResultView;
      if (clarityFrame) {
        const [reduced] = clarityFrame.textures;
        const bindWith = (view, binding) => this.bindGraphResources(view, view, binding, view);
        for (const [chunkIndex, { texels, region }] of clarityFrame.chunks.entries()) {
          if (isCurrent() === false) {
            cancelled = true;
            break;
          }
          const binding = {
            buffer: this.tileCompositeParamBuffer, offset: (plan.tileCount + chunkIndex) * stride, size: params.byteLength,
          };
          if (denoiseActive) {
            await denoiseInto(region);
          } else {
            const sourceOrigin = proxy.region || { x: 0, y: 0 };
            encoder.copyTextureToTexture(
              { texture: proxy.texture, origin: { x: region.x - sourceOrigin.x, y: region.y - sourceOrigin.y, z: 0 } },
              { texture: graph.sourceTexture, origin: { x: 0, y: 0, z: 0 } },
              { width: region.width, height: region.height, depthOrArrayLayers: 1 },
            );
          }
          pass(baseView, pipelines.base, bindWith(sourceView, binding), region.width, region.height);
          this.encodeClarityPass(encoder, reduced.createView(), pipelines.clarityReduce, bindWith(baseView, binding), texels, true);
          batchTiles += 1;
          if (batchTiles >= tileBatchSize) flushTiles();
        }
        if (!cancelled) {
          // Any slot carries the frame size and the map's plan, which is all
          // the level and blur passes read from it.
          const binding = { buffer: this.tileCompositeParamBuffer, offset: 0, size: params.byteLength };
          const finished = clarityFrame.textures[1];
          if (clarityFrame.reblur) {
            this.encodeClarityLevels(encoder, pipelines, (view) => bindWith(view, binding),
              clarityFrame.textures, clarityFrame.extents);
          }
          clarityFrame.commit();
          clarityMapView = finished.createView();
        }
      }

      // Denoise reconstructs into the same encoder, one tile at a time, so this
      // loop has to be able to wait for it. Command order is call order, and
      // every tile is reconstructed before the copy that reads it.
      const planIndexOf = new Map(plan.tiles.map((candidate, index) => [candidate, index]));
      const foregroundEntries = foregroundTiles.map((tile) => ({ tile, index: planIndexOf.get(tile) }));
      for (const [position, { tile, index }] of foregroundEntries.entries()) {
        // A superseded generation stops at a tile boundary. Nothing has been
        // submitted yet, so it never presents a partial frame; the newer
        // generation presents instead.
        if (cancelled || isCurrent() === false) {
          cancelled = true;
          break;
        }
        processedTiles += 1;
        const width = tile.haloRect.width;
        const height = tile.haloRect.height;
        const parameterBinding = {
          buffer: this.tileCompositeParamBuffer, offset: index * stride, size: params.byteLength,
        };
        const bind = (source, spatial = source, overlay = spatial, binding = parameterBinding) =>
          this.bindGraphResources(source, spatial, binding, overlay);
        if (denoiseActive) {
          await denoiseInto({
            x: tile.haloRect.x, y: tile.haloRect.y,
            width: tile.haloRect.width, height: tile.haloRect.height,
          });
        }
        if (!denoiseActive || noiseView) {
          // A region source is positioned at the region's own origin, so the
          // tile's frame coordinates become region-relative ones. The plan,
          // the parameters and the presentation target all stay frame-anchored.
          const sourceOrigin = proxy.region || { x: 0, y: 0 };
          encoder.copyTextureToTexture(
            {
              texture: proxy.texture,
              origin: {
                x: tile.haloRect.x - sourceOrigin.x,
                y: tile.haloRect.y - sourceOrigin.y,
                z: 0,
              },
            },
            { texture: graph.sourceTexture, origin: { x: 0, y: 0, z: 0 } },
            { width, height, depthOrArrayLayers: 1 },
          );
        }
        pass(baseView, pipelines.base, noiseView && denoiseActive
          ? bind(sourceView, sourceView, graph.denoiseResolvedTexture.createView())
          : bind(sourceView), width, height);
        // Show noise presents the base pass itself; the grade never runs.
        if (!noiseView) {
          let localSource = graph.baseTexture;

          if (detailActive) {
            const prefix = `global|${globalInputIdentity}`;
            const key = bandTileKey(prefix, tile);
            const packed = this.detailBandTile(key, tile.rect.width, tile.rect.height, "global");
            pinnedDetail.push(key);
            const assembled = packed.hit && assemblePackedHalo(prefix, tile);
            if (!assembled) {
              pass(scratchView, pipelines.detailHorizontal, bind(baseView, baseView), width, height, 0);
              pass(detailResultView, pipelines.detailVertical, bind(scratchView, scratchView), width, height, 0);
              encoder.copyTextureToTexture(
                { texture: graph.detailResultTexture, origin: { x: tile.rect.x - tile.haloRect.x, y: tile.rect.y - tile.haloRect.y, z: 0 } },
                { texture: packed.texture },
                { width: tile.rect.width, height: tile.rect.height, depthOrArrayLayers: 1 },
              );
            }
            const globalClarityView = surround?.global && graphScaleContract().clarityActive(params)
              ? this.encodeSurroundClarityMap(encoder, pipelines, surround, surround.global, params[151], proxy, tile.haloRect).createView()
              : clarityMapView;
            pass(localView, pipelines.detailComposite, bind(baseView, detailResultView, globalClarityView), width, height);
            localSource = graph.localTexture;
          }

          activeLocals.forEach((local, localIndex) => {
            const target = localSource === graph.baseTexture ? graph.localTexture : graph.baseTexture;
            const targetView = target.createView();
            const localBinding = {
              buffer: localBuffers[localIndex].buffer,
              offset: index * localBuffers[localIndex].stride,
              size: PARAM_COUNT * 4,
            };
            const maskView = maskMatrix[index][localIndex].texture.createView();
            if (gpuLocalDetailActive(local[`${lane}_grade`])) {
              pass(finishView, pipelines.localCandidate,
                bind(localSource.createView(), localSource.createView(), localSource.createView(), localBinding), width, height);
              const prefix = tiledLocalState[localIndex].detailPrefix;
              const key = bandTileKey(prefix, tile);
              const packed = this.detailBandTile(key, tile.rect.width, tile.rect.height, "local");
              pinnedDetail.push(key);
              const assembled = packed.hit && assemblePackedHalo(prefix, tile);
              if (!assembled) {
                pass(scratchView, pipelines.localDetailHorizontal,
                  bind(finishView, finishView, finishView, localBinding), width, height, 0);
                pass(detailResultView, pipelines.localDetailVertical,
                  bind(scratchView, scratchView, scratchView, localBinding), width, height, 0);
                encoder.copyTextureToTexture(
                  { texture: graph.detailResultTexture, origin: { x: tile.rect.x - tile.haloRect.x, y: tile.rect.y - tile.haloRect.y, z: 0 } },
                  { texture: packed.texture },
                  { width: tile.rect.width, height: tile.rect.height, depthOrArrayLayers: 1 },
                );
              }
              // A local's Clarity map is built here, from this tile's candidate.
              // The halo carries the map's whole reach, so every texel the
              // tile's own pixels read is the one the whole-frame map holds.
              let localClarityView = detailResultView;
              const radiusPercent = Number(local[`${lane}_grade`].detail?.clarity_radius_percent) || 0.75;
              if (surround?.locals.has(local.id)) {
                localClarityView = this.encodeSurroundClarityMap(
                  encoder, pipelines, surround, surround.locals.get(local.id), radiusPercent, proxy, tile.haloRect,
                ).createView();
              } else if (graphScaleContract().localClarityActive(local[`${lane}_grade`])) {
                const clarity = writeClarityPlan(
                  new Float32Array(PARAM_COUNT), proxy.width, proxy.height, radiusPercent,
                );
                const extents = clarityMapExtents(clarity, tile.haloRect.x, tile.haloRect.y, width, height);
                const maps = this.clarityMapTextures("work", extents.baseWidth, extents.baseHeight);
                localClarityView = this.encodeClarityMap(
                  encoder, pipelines, (view) => bind(view, view, view, localBinding),
                  finishView, maps.textures, extents,
                ).createView();
              }
              pass(scratchView, pipelines.localDetailComposite,
                bind(finishView, detailResultView, localClarityView, localBinding), width, height);
              pass(targetView, pipelines.localDetailMix,
                bind(localSource.createView(), maskView, scratchView, localBinding), width, height);
            } else {
              pass(targetView, pipelines.local,
                bind(localSource.createView(), maskView, maskView, localBinding), width, height);
            }
            localSource = target;
          });

          pass(filmView, pipelines.response, bind(localSource.createView()), width, height);
          let spatialResultView = sourceView;
          if (spatialActive) {
            // The spatial grid is anchored to the frame, and this tile's halo
            // rectangle starts on one of its texels, so the valid region is
            // exactly the tile's own extent on that grid. Rendering only that
            // region keeps an edge tile from writing texels its source never
            // covered, which `validSpatialDimensions()` then reads back.
            const spatialWidth = Math.ceil(width / graph.spatialGrid);
            const spatialHeight = Math.ceil(height / graph.spatialGrid);
            const spatialAView = graph.spatialATexture.createView();
            const spatialBView = graph.spatialBTexture.createView();
            pass(spatialAView, pipelines.extract, bind(filmView, spatialBView), spatialWidth, spatialHeight, 0);
            pass(spatialBView, pipelines.blurHorizontal, bind(filmView, spatialAView), spatialWidth, spatialHeight, 0);
            pass(spatialAView, pipelines.blurVertical, bind(filmView, spatialBView), spatialWidth, spatialHeight, 0);
            spatialResultView = graph.spatialATexture.createView();
          }
          pass(finishView, pipelines.finish, bind(filmView, spatialResultView), width, height);
        }
        // The finished tile is measured before it is composited, because the
        // composite encodes for the display and this has to read the picture.
        // On a measurement pass this is the only thing the tile is for.
        if (peakTarget) {
          let peakBindGroup = bind(finishView);
          if (options.analysisPatch && (tile.rect.width !== width || tile.rect.height !== height)) {
            // A measurement reads the patch alone. The halo is there to make
            // the patch's pixels right; its own outer pixels lack the
            // neighbours Detail reads, and a wrong one can outshine the patch.
            const patchTexture = this.device.createTexture({
              size: { width: tile.rect.width, height: tile.rect.height }, format: "rgba16float",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            encoder.copyTextureToTexture(
              { texture: graph.finishTexture, origin: { x: tile.rect.x - tile.haloRect.x, y: tile.rect.y - tile.haloRect.y, z: 0 } },
              { texture: patchTexture },
              { width: tile.rect.width, height: tile.rect.height, depthOrArrayLayers: 1 },
            );
            const patchValues = slots.slice(index * (stride / 4), index * (stride / 4) + params.length);
            patchValues[160] = tile.rect.x;
            patchValues[161] = tile.rect.y;
            patchValues[162] = tile.rect.width;
            patchValues[163] = tile.rect.height;
            const patchBuffer = this.createStorageBuffer(patchValues);
            this.device.queue.writeBuffer(patchBuffer, 0, patchValues);
            const patchView = patchTexture.createView();
            peakBindGroup = this.bindGraphResources(patchView, patchView, { buffer: patchBuffer }, patchView);
            this.destroyAfterActiveRenders(() => { patchTexture.destroy(); patchBuffer.destroy(); });
          }
          const peakPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: peakView,
              loadOp: position === 0 ? "clear" : "load",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              storeOp: "store",
            }],
          });
          peakPass.setPipeline(pipelines.scopePeakTile);
          peakPass.setBindGroup(0, peakBindGroup);
          peakPass.draw(3);
          peakPass.end();
        }
        if (!measureOnly) {
          const overlayView = options.overlayIndex >= 0
            ? maskMatrix[index][options.overlayIndex].texture.createView()
            : sourceView;
          const compositeBind = bind(noiseView ? baseView : finishView, sourceView, overlayView);
          const compositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: canvasView,
              // A retained ROI pass loads the accepted frame and overwrites
              // only the tiles it processed; the first full pass clears.
              loadOp: position === 0 && !retainedFrame && !regionOnly ? "clear" : "load",
              clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
            }],
          });
          compositePass.setScissorRect(tile.rect.x, tile.rect.y, tile.rect.width, tile.rect.height);
          compositePass.setPipeline(pipelines.composite);
          compositePass.setBindGroup(0, compositeBind);
          compositePass.draw(3);
          compositePass.end();
        }
        // Only a tile that was actually composited may be recorded as current
        // for this generation. A measurement pass never presents, so it must
        // not make the pan cache believe its tiles are in the retained frame.
        if (!measureOnly) scheduler.acceptTile(tile.key, plan.generation);
        batchTiles += 1;
        if (batchTiles >= tileBatchSize) flushTiles();
      }

      // A superseded generation stops before the next batch is submitted: the
      // batches already submitted finish, and nothing further is encoded or
      // presented.
      if (cancelled) {
        // Some of the map's pre-pass may never be submitted, so its record of
        // what it holds cannot be trusted.
        if (clarityFrame) this.clarityFrameMap = null;
        this.recordStage("tiled-cancelled", {
          lane, processedTiles, foregroundTiles: foregroundTiles.length, submissions,
        });
        return { rendered: false, refusals: ["superseded-during-encode"] };
      }
      flushTiles();
      if (presentationTarget) {
        // One copy hands the completed frame to the canvas: the swap chain is
        // never presented cleared or half-written, whatever the pass did to
        // the target.
        encoder.copyTextureToTexture(
          { texture: presentationTarget.texture },
          { texture: context.getCurrentTexture() },
          { width: proxy.width, height: proxy.height },
        );
        presentationTarget.valid = true;
      }
      if (peakTarget && processedTiles > 0) {
        encoder.copyTextureToBuffer(
          { texture: peakTarget.texture },
          { buffer: peakTarget.readBuffer, bytesPerRow: peakTarget.bytesPerRow, rowsPerImage: peakTarget.size },
          { width: peakTarget.size, height: peakTarget.size },
        );
      }
      submissions += 1;
      this.device.queue.submit([encoder.finish()]);
      denoiseTilesUnsubmitted.length = 0;
      this.recordSubmission(lane, options, 0);
      } catch (error) {
        encodeError = error;
      } finally {
        presentation?.release();
        localBuffers.forEach((entry) => entry.buffer.destroy());
        denoiseParamBuffers.forEach((buffer) => buffer.destroy());
        // A cancelled or failed pass never submitted its last encoder.
        this.dropDenoiseTiles(denoiseTilesUnsubmitted);
        if (cancelled || encodeError) {
          if (peakTarget) peakTarget.busy = false;
        }
        if (validationScopeOpen) validationError = await this.device.popErrorScope();
      }
      if (encodeError) {
        if (clarityFrame) this.clarityFrameMap = null;
        throw encodeError;
      }
      if (validationError) {
        if (clarityFrame) this.clarityFrameMap = null;
        this.dropDenoiseTiles(denoiseTilesCreated);
        if (peakTarget) peakTarget.busy = false;
        this.recordStage("tiled-validation-error", { message: validationError.message });
        return { rendered: false, refusals: [`validation: ${validationError.message}`] };
      }
      if (!measureOnly) {
        // What the canvas now shows. A later ROI pass of this exact size and
        // identity may keep it and process only its foreground tiles.
        this.lastPresentedFrame = {
          sessionId: options.sessionId,
          lane,
          // The signature string, never the global helper: a retained pass
          // compares this to decide whether a region source is safe.
          geometrySignature: options.geometrySignature || "{}",
          width: proxy.width,
          height: proxy.height,
          execution: "tiled",
          longEdge: proxy.longEdge,
          format: surface.format,
          // A retained pass that wants a region source needs this pass's
          // working space to derive the same parameters before its fetch.
          workingSpace: proxy.workingSpace,
          applicationGeneration: Number(options.applicationGeneration ?? 0),
        };
        this.recordFrameMasks({
          execution: "tiled", sessionId: options.sessionId, lane, width: proxy.width, height: proxy.height,
          locals: activeLocals, retained: Boolean(panCache),
          pieces: foregroundTiles.map((tile) => ({
            rect: tile.rect, origin: tile.haloRect, entries: maskMatrix[tileIndexByKey.get(tile.key)],
          })),
        });
      }
      // Taken now, while this generation's grid is still the one in the
      // target. It is an exact maximum over every pixel the tiles covered, and
      // `measuredLongEdge` says what resolution those pixels were, because a
      // maximum over a downsampled proxy is a lower bound on the real one and
      // must never be presented as though it were not.
      // A pass that processed nothing (a pan answered entirely from the cache)
      // has no fresh grid to measure, so it leaves the previous peak alone
      // rather than attributing a stale maximum to the current generation.
      let measuredPeak = null;
      if (peakTarget) {
        if (processedTiles > 0) measuredPeak = await this.readScopePeak(peakTarget);
        else peakTarget.busy = false;
      }
      if (measuredPeak !== null && !measureOnly) {
        this.exactScopePeak = {
          peak: measuredPeak,
          lane,
          longEdge: Math.max(proxy.width, proxy.height),
          width: proxy.width,
          height: proxy.height,
          editRevision,
          applicationGeneration: Number(options.applicationGeneration ?? 0),
          identity: proxy.identity,
        };
      }
      if (!measureOnly) this.presentedMaskKeys = new Set(pinnedMasks);
      const detailCacheBytes = this.trimDetailBandTiles(pinnedDetail);
      const maskCacheBytes = this.trimMaskTiles(pinnedMasks);
      const denoiseTileCacheBytes = this.trimDenoiseTiles(denoiseTilesUsed);
      const durationMs = performance.now() - startedAt;
      const metrics = {
        width: proxy.width, height: proxy.height, tileSize, halo,
        detailHalo, spatialHalo, tileWidth: workWidth, tileHeight: workHeight,
        exactPeak: measuredPeak, exactPeakLongEdge: Math.max(proxy.width, proxy.height),
        tileCount: plan.tileCount, visibleCount: plan.visibleCount, submissions,
        tileBatchSize,
        // Encoding is this thread's time up to the last submission; the
        // remainder waits for the GPU to finish the tiles and return the peak grid.
        encodeMs: Math.max(0, (this.lastSubmissionAt ?? startedAt) - startedAt),
        // What the request asked for versus what the graph
        // processed. Each tile processes its haloed rect, so the sum is the
        // real processed area and the ratio is the halo amplification.
        viewport: plan.viewport ? { ...plan.viewport } : null,
        viewportRequested: Boolean(options.viewport),
        viewportRequest: {
          version: viewportRequest.version,
          scale: viewportRequest.scale,
          halo: viewportRequest.halo,
          roi: { ...viewportRequest.roi },
          sourceRect: { ...viewportRequest.sourceRect },
          applicationGeneration: viewportRequest.applicationGeneration,
        },
        activeNodes: nodes.map((node) => node.id || node),
        roiCatchUp: Boolean(options.roiCatchUp),
        // Display-scale pan cache diagnostics. `viewportTiles` is what
        // the padded region asked for; `reusedTiles` came back from the
        // retained frame at this generation and was not re-processed;
        // `foregroundTiles` is what actually ran. A pan back into a refined
        // region reports zero foreground tiles and a full cache hit.
        panPass: Boolean(options.panPass),
        roi: foregroundRegion ? { ...foregroundRegion } : null,
        offscreenTiles: plan.tileCount - plan.visibleCount,
        viewportTiles: viewportTiles ? viewportTiles.length : null,
        reusedTiles: reusedTiles.length,
        reusedPixels: reusedTiles.reduce(
          (sum, tile) => sum + tile.haloRect.width * tile.haloRect.height, 0,
        ),
        foregroundTiles: processedTiles,
        maskTilesRequested: maskBatches.reduce((sum, batch) => sum + batch.tiles.length, 0),
        skippedTiles: plan.tileCount - processedTiles,
        retainedFrame,
        cancelled,
        // Only the tiles this pass actually processed contribute work.
        processedPixels: foregroundTiles.reduce(
          (sum, tile) => sum + tile.haloRect.width * tile.haloRect.height, 0,
        ),
        outputPixels: proxy.width * proxy.height,
        workingSetBytes: graph.byteSize, proxyBytes: proxy.byteSize,
        // What the source transport actually carried. A region
        // pass uploads its region, not the frame, and the driver reads these
        // to prove the warm-Fit and ROI transport gates.
        sourceRoute: proxy.region ? "region" : (proxy.streamed ? "streamed" : "whole-frame"),
        sourceRegion: proxy.region ? { ...proxy.region } : null,
        sourceTextureBytes: proxy.byteSize,
        sourceFrameBytes: proxy.width * proxy.height * (proxy.pixelFormat === "rgba16float" ? 8 : 16),
        // The processing scale this generation ran at. It is the
        // same number the graph's radius conversions used, so telemetry and the
        // contract can never disagree about which scale produced the frame.
        processingScale: Number.isFinite(Number(options.sourcePixelScale))
          ? Number(options.sourcePixelScale)
          : null,
        detailCacheBytes, maskCacheBytes,
        detailCacheHits: this.detailCacheCounters.hits - cacheBefore.hits,
        detailCacheMisses: this.detailCacheCounters.misses - cacheBefore.misses,
        detailAnalysisPasses: this.detailCacheCounters.analysisPasses - cacheBefore.analysisPasses,
        detailGlobalCacheHits: this.detailCacheCounters.globalHits - cacheBefore.globalHits,
        detailGlobalCacheMisses: this.detailCacheCounters.globalMisses - cacheBefore.globalMisses,
        detailLocalCacheHits: this.detailCacheCounters.localHits - cacheBefore.localHits,
        detailLocalCacheMisses: this.detailCacheCounters.localMisses - cacheBefore.localMisses,
        // The Clarity frame map: how many regions its pre-pass had to fill, and
        // whether it was re-blurred. A Radius or Amount change fills none.
        clarityMapChunks: clarityChunks,
        // Denoise reconstructions this generation ran: one per tile, plus one
        // per Clarity map region when Denoise feeds the map.
        denoiseTileResolves,
        // Regions answered from a tile an earlier generation reconstructed.
        denoiseTileHits,
        denoiseTileCacheBytes,
        clarityMapReblurred: Boolean(clarityFrame?.reblur),
        clarityMapScale: clarityFrame ? clarityFrame.plan.scale : null,
        detailBandStacks: (detailActive ? 1 : 0)
          + activeLocals.filter((local) => gpuLocalDetailActive(local[`${lane}_grade`])).length,
        presentableGeneration: scheduler.presentableGeneration(plan), durationMs,
      };
      this.recordStage("detail-cache", { ...this.tiledExecutionMetrics });
      // Likewise the diagnostics: `tiledExecutionMetrics` describes the
      // generation on screen, and a measurement pass has not put one there.
      // Its own numbers come back through the return value instead.
      if (!measureOnly) this.tiledExecutionMetrics = metrics;
      this.recordStage(measureOnly ? "tiled-measure" : "tiled-render", { lane, longEdge, ...metrics });
      return {
        rendered: true, refusals: [], width: proxy.width, height: proxy.height,
        hdr: surface.hdr, proxyFormat: proxy.pixelFormat,
        sourceSerial: proxy.sourceSerial ?? null, execution: "tiled", metrics,
      };
      } finally {
        this.scheduleTileCacheTrim();
      }
    }

    /** Record why a render declined, so a falsy result is diagnosable. */
    refuseRender(reason) {
      this.lastRenderRefusal = { reason, at: performance.now() };
      this.recordStage("render-refused", { reason });
      return false;
    }

    async renderTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      if (!this.available || !sessionId) return this.refuseRender("unavailable-or-no-session");
      const activeLocals = activeGpuLocals(lane, localAdjustments);
      // Eligibility is deliberately checked before resetting a session or
      // requesting a proxy. Unsupported local modules use the CPU renderer,
      // and must not first pay for a WebGPU proxy that cannot be presented.
      if (!activeLocals.every((local) => gpuLocalSupported(local[`${lane}_grade`]))) return this.refuseRender("unsupported-local-adjustment");
      const renderStartedAt = performance.now();
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      if (sourceSize) this.maskSourceSize = {sessionId,...sourceSize};
      const resourceGeneration = this.resourceGeneration;
      this.activeRenderCount += 1;
      let proxyPin = null;
      let draftPresentation = null;
      let draftReturned = false;
      try {
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      this.renderSerials.set(canvas, serial);
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceIdentity = sourceOptions?.identity || "source";
      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The comparison WebGPU canvas context is unavailable");
      // A magnified ROI fetches only the region it processes,
      // at the mip this pass needs. Admission has not run yet, so a region
      // request that is later admitted Direct is replaced by the whole frame
      // below.
      // Denoise evidence is indexed against its whole processing frame. The
      // analysis has already made that source level resident, so reuse it and
      // process only the visible ROI rather than uploading a second region.
      const denoiseAtScale = this.denoiseSourceSelector?.selected === "resolved"
        && !this.adaptiveDenoiseSelected()
        && this.denoiseSourceSelector?.original?.longEdge === longEdge
        && this.denoiseSourceSelector?.original?.sourceIdentity === sourceIdentity;
      const region = denoiseAtScale ? null : this.roiRegionFor(
        canvas, context, sessionId, lane, adjustments, sourceSize, referenceWhiteNits, sourceOptions, activeLocals, longEdge,
      );
      // Native background measurement used to warm these preview bitmaps.
      // A requested zoom can overlap the same bounded fallback with its source
      // transfer, without compiling a native whole-image measurement mask.
      this.prefetchZoomMasks(canvas, sessionId, activeLocals, editRevision, geometrySignature, sourceOptions, serial, longEdge);
      // A Match candidate grades the scene picture as SDR whatever the SDR
      // lane's own source is, so it names the lane its source comes from.
      const sourceLane = sourceOptions?.sourceLane || lane;
      let proxy = await this.loadProxy(
        sessionId,
        sourceLane,
        longEdge,
        geometrySignature,
        editRevision,
        sourceIdentity,
        {
          isCurrent: () => this.sourceLoadIsCurrent(canvas, serial, resourceGeneration, sourceOptions),
          onProgress: sourceOptions?.onSourceProgress,
          region,
        },
      );
      const proxyReadyAt = performance.now();
      if (resourceGeneration !== this.resourceGeneration
        || serial !== this.renderSerials.get(canvas)
        || !proxy
        || sourceOptions?.isCurrent?.() === false) return this.refuseRender("superseded-before-proxy");
      let sourceProxy = this.selectedDenoiseSource(proxy);
      // Export's Match analysis reads the source as decoded, not a reconstruction.
      if (sourceOptions?.frameAnchor) sourceProxy = proxy;
      proxyPin = this.gpuAllocator && proxy.allocatorEntry ? this.gpuAllocator.pin(proxy.allocatorEntry) : null;
      let masks = [];
      let masksReadyAt = proxyReadyAt;

      let surface = this.configureSurface(canvas, context, lane === "hdr" && !sourceOptions?.forceSdrSurface);
      let pipelines = this.pipelineFor(surface.format);
      const sourcePixelScale = this.sourcePixelScaleFor(proxy, sourceSize);
      let params = buildParams(
        lane,
        adjustments,
        proxy.workingSpace,
        surface.hdr,
        referenceWhiteNits,
        sourcePixelScale,
      );
      // Activity and admission are decided before the anchor, because a region
      // source belongs to the tiled route and the anchor must measure the
      // source the pass will actually use. They read only grade-derived
      // parameter slots, so the surface-format rebuild below cannot change
      // them.
      const { spatialActive, detailActive } = this.graphActivity(params);
      const localDetailActive = activeLocals.some((local) => gpuLocalDetailActive(local[`${lane}_grade`]));
      // Admission runs against the graph this render is about to build, so the
      // plan and the decision describe real work rather than a generic guess.
      // Stale levels leave before admission, so the plan charges what the
      // device will actually hold for this render.
      if (!sourceOptions?.scopeAnalysis) this.evictStaleProxies({ sessionId, lane, geometrySignature, sourceIdentity, keep: proxy.identity });
      const plan = this.planRender(proxy.width, proxy.height, {
        executionOverride: this.executionOverrideFor(sourceOptions),
        // A region proxy covers only the visible area; if Direct is admitted
        // the whole frame is loaded below, so admission charges it now.
        pendingSourceBytes: proxy.region ? proxy.width * proxy.height * (proxy.pixelFormat === "rgba16float" ? 8 : 16) : 0,
        detailActive: detailActive || localDetailActive,
        spatialActive,
        // Without this the tiled model sizes its working set to a bare tile
        // while the encoder builds one tile plus its halo, and admission would
        // be decided against a working set nobody allocates. A spatial graph
        // makes the gap large: a 256 tile with a 136 halo is 528 on a side.
        halo: this.composedTileHalo(proxy.width, proxy.height, params, activeLocals, lane).halo,
        sourceBytesPerPixel: proxy.pixelFormat === "rgba16float" ? 8 : 16,
        tier: sourceOptions?.tier ?? null,
      });
      // A region source belongs to the tiled route. When admission chooses
      // Direct for a viewport request, Direct executes every active node over
      // the whole frame, so it needs the whole-frame source: load it here.
      if (proxy.region && plan.decision.mode !== "tiled") {
        const whole = await this.loadProxy(
          sessionId,
          lane,
          longEdge,
          geometrySignature,
          editRevision,
          sourceIdentity,
          {
            isCurrent: () => resourceGeneration === this.resourceGeneration
              && serial === this.renderSerials.get(canvas)
              && sourceOptions?.isCurrent?.() !== false,
          },
        );
        if (whole) {
          proxy = whole;
          sourceProxy = this.selectedDenoiseSource(proxy);
        }
      }
      // Direct grades one whole-frame texture, so adaptive Denoise fills its
      // reconstruction here, the first time this frame is drawn that way.
      if (plan.decision.mode !== "tiled" && await this.ensureDenoiseResolved(proxy)) {
        if (resourceGeneration !== this.resourceGeneration
          || serial !== this.renderSerials.get(canvas)
          || sourceOptions?.isCurrent?.() === false) return this.refuseRender("superseded-before-proxy");
        sourceProxy = sourceOptions?.frameAnchor ? proxy : this.selectedDenoiseSource(proxy);
      }
      // The anchor is measured before anything is encoded, so this render can
      // never await once it owns GPU resources or the canvas. A settled draft
      // that loses its race returns false, and the scheduler answers that with
      // a full CPU preview -- visible as a flash -- so awaiting later is not an
      // option here. Measuring the finished picture instead of this
      // source-domain estimate needs the scheduler to request a refinement
      // after the reduction lands, rather than an await inside the render.
      // Show noise never reaches the output mapping, so it has no peak to anchor.
      const noiseView = Boolean(sourceOptions?.noiseView);
      const anchor = noiseView ? null : this.highlightAnchorRequest(lane, adjustments, sourceProxy, params, localAdjustments);
      if (anchor && sourceOptions?.frameAnchor) {
        // Export's analysis frame anchors its shoulder on its own pixels. A
        // frame rendered to be compared with one does the same, through the
        // SDR prefix reduction, and leaves the editing anchor cache and its
        // scheduler alone.
        if (lane !== "sdr") return this.refuseRender("frame-anchor-unsupported-lane");
        const key = `frame:${serial}:${anchor.key}`;
        params[75] = await this.measureToneAdjustedPeak(sourceProxy, params, anchor.measurement, key);
        this.peakReductionCache.delete(key);
        if (resourceGeneration !== this.resourceGeneration || serial !== this.renderSerials.get(canvas)
          || sourceOptions?.isCurrent?.() === false) return this.refuseRender("peak:superseded");
      } else if (anchor) {
        const interactive = sourceOptions?.tier === "interactive";
        // An interactive frame that stopped for a whole-image reduction would
        // miss its deadline, so it carries the last measurement instead and
        // the skipped measurement runs afterwards.
        params[75] = await this.resolveHighlightAnchor(anchor, sourceProxy, params, { interactive, lane });
        if (!interactive && anchor.cached === undefined) {
          if (resourceGeneration !== this.resourceGeneration) return this.refuseRender("peak:resource-generation");
          if (serial !== this.renderSerials.get(canvas)) return this.refuseRender("peak:newer-render-started");
          if (sourceOptions?.isCurrent?.() === false) return this.refuseRender("peak:application-not-current");
        }
      }
      // Changing a visible canvas's backing size clears its presented frame.
      // Keep the previous interactive image intact while settled/refinement
      // work awaits highlight-peak analysis, then resize and submit the new
      // frame in one synchronous presentation step. Otherwise the compositor
      // can expose the cleared (black) canvas between pointerup and settle.
      // Direct's whole-frame masks must be fetched before the resize below.
      // Resizing a visible canvas clears its presented frame, so any await
      // between the resize and the submission can leave a cleared canvas on
      // screen -- and, if the render is then superseded, leave it there with no
      // accepted presentation at all, which strands the geometry handoff. Tiled
      // skips this entirely: it carries bounded per-tile masks instead.
      if (plan.decision.mode !== "tiled") {
        if (!sourceOptions?.measureOnly) this.maskUseSerial += 1;
        this.markResidentMaskFrame(sessionId, activeLocals, longEdge, geometrySignature);
        const isMaskCurrent = () => resourceGeneration === this.resourceGeneration
          && serial === this.renderSerials.get(canvas)
          && sourceOptions?.isCurrent?.() !== false;
        const loadedMasks = await this.loadDirectMasks({
          generation: `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${Number(sourceOptions?.applicationGeneration ?? 0)}:${serial}`,
          sessionId,
          activeLocals,
          longEdge,
          editRevision,
          geometrySignature,
          isCurrent: isMaskCurrent,
          remember: !sourceOptions?.measureOnly || Boolean(sourceOptions?.scopeAnalysis),
        });
        masks = loadedMasks.results;
        masksReadyAt = performance.now();
        if (!loadedMasks.current || !isMaskCurrent()
          || masks.some((mask) => !mask)
        ) return this.refuseRender("superseded-after-masks");
      }
      const measuredPeak = params[75];
      // The resize happens at presentation time, not here. Resizing a visible
      // canvas clears its presented frame, and this generation still has an
      // intermediate graph to build and passes to encode; clearing before then
      // would leave the viewer with nothing if the encode failed or was
      // superseded. The presentation gate below is the only place that resizes.
      const presentationSurface = this.configureSurface(canvas, context, lane === "hdr" && !sourceOptions?.forceSdrSurface);
      if (presentationSurface.format !== surface.format || presentationSurface.hdr !== surface.hdr) {
        surface = presentationSurface;
        pipelines = this.pipelineFor(surface.format);
        params = buildParams(
          lane,
          adjustments,
          proxy.workingSpace,
          surface.hdr,
          referenceWhiteNits,
          sourcePixelScale,
        );
        params[75] = measuredPeak;
      }
      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayMask = overlayIndex >= 0;
      const overlayLocal = overlayIndex >= 0 ? activeLocals[overlayIndex] : null;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[131] = overlayMask && !noiseView ? 1 : 0;
      params[132] = overlayLocal ? gpuMaskInfluenceOpacity(overlayLocal.mask) : 0;
      params[133] = Number(overlayColor[0]) || 0;
      params[134] = Number(overlayColor[1]) || 0;
      params[135] = Number(overlayColor[2]) || 0;
      // Direct reads a whole-frame resolved source; Tiled re-derives this per
      // generation from whether it reconstructs tiles.
      params[NOISE_VIEW_INDEX] = noiseView ? (sourceProxy !== proxy ? 1 : 2) : 0;
      writeMaskRect(params, 0, overlayIndex >= 0 ? masks[overlayIndex] : null, proxy.width, proxy.height);
      writeClarityPlan(params, proxy.width, proxy.height, params[151]);
      // Direct's frame is every intermediate's size, which is what the shader
      // falls back to. The Clarity map passes read map-sized textures, so the
      // frame is stated rather than inferred.
      params[164] = proxy.width;
      params[165] = proxy.height;
      this.uploadParamsAndCurves(lane, adjustments, curveSampler, params, activeLocals);
      if (plan.decision.mode === "tiled") {
        const refusals = this.tiledExecutionRefusals({
          activeLocals,
          detailActive,
          spatialActive,
          overlayMask,
          params,
          surface,
        });
        // A whole-frame tiled pass is too slow for a drag frame; a region
        // pass is bounded by the viewport and is not.
        if (sourceOptions?.tier === "interactive" && !sourceOptions?.viewport) refusals.push("interactive render");
        // Scopes, the navigation thumbnail and Match candidates draw on their
        // own canvas and only use a Direct result. Tiled would draw them into
        // the viewer's retained target and replace its accepted frame.
        if (sourceOptions?.scopeAnalysis) refusals.push("auxiliary render");
        if (refusals.length) {
          this.recordStage("tiled-refused", { lane, longEdge, refusals });
          return this.refuseRender(`tiled-refused:${refusals.join(",")}`);
        }
        this.recordStage("admission", {
          mode: "tiled",
          reason: plan.decision.violations.map((violation) => violation.rule).join(",") || "planner",
          width: proxy.width,
          height: proxy.height,
          peakLogicalBytes: plan.totals.peakLogicalBytes,
          budgetBytes: plan.budgetBytes,
        });
        // Show noise needs the original and a reconstruction per tile, so it
        // hands Tiled the original even when a whole-frame resolve is resident.
        const tiled = await this.encodeTiledGeneration(canvas, context, noiseView ? proxy : sourceProxy, surface, pipelines, params, {
          tileSize: sourceOptions?.tileSize,
          serial,
          viewport: sourceOptions?.viewport || null,
          // The app's own passes reach the encoder here, not through
          // renderTiledTo, so the ROI flags have to be forwarded here too or
          // the catch-up and pan telemetry can never be true.
          roiCatchUp: sourceOptions?.roiCatchUp,
          // This entry has uploaded the frame's parameters, which the
          // placeholder's output mapping reads.
          allowPlaceholder: true,
          panPass: sourceOptions?.panPass,
          lane,
          longEdge,
          editRevision,
          applicationGeneration: sourceOptions?.applicationGeneration,
          sessionId,
          activeLocals,
          geometrySignature,
          overlayIndex,
          sourcePixelScale,
          isCurrent: () => resourceGeneration === this.resourceGeneration
            && serial === this.renderSerials.get(canvas)
            && sourceOptions?.isCurrent?.() !== false,
        });
        if (!tiled?.rendered) {
          return this.refuseRender(`tiled-encode-failed:${(tiled?.refusals || []).join(",")}`);
        }
        // The resolution this generation was processed at, which is not the
        // size of the picture it produced: geometry trims the frame. The
        // viewer needs the former to decide whether the selected tier has
        // been reached.
        return { ...tiled, sourceSerial: serial, processedLongEdge: proxy.longEdge };
      }
      const intermediate = this.ensureIntermediate(
        canvas,
        proxy.width,
        proxy.height,
        spatialActive,
        detailActive || localDetailActive,
      );
      if (!intermediate) {
        // An allocation failed and the backoff is recorded. Abandon this render
        // and keep the previous presentation; the selected tier is unchanged.
        this.recordStage("admission", {
          mode: "tiled",
          reason: this.allocationBackoff?.reason || "allocation failed",
          width: proxy.width,
          height: proxy.height,
          peakLogicalBytes: plan.totals.peakLogicalBytes,
          budgetBytes: plan.budgetBytes,
        });
        return this.refuseRender("intermediate-allocation-failed");
      }
      // Direct's passes each own a whole parameter buffer, while Tiled binds
      // one buffer at a per-tile offset, so this adapts the buffer to the
      // binding resource the shared helper takes.
      const makeBindGroup = (sourceView, spatialView, parameterBuffer = this.paramBuffer, overlayView = spatialView) =>
        this.bindGraphResources(sourceView, spatialView, { buffer: parameterBuffer }, overlayView);
      // When spatial effects are inactive, use the immutable proxy as the
      // required placeholder binding. Binding filmTexture here would make the
      // response pass sample from the same texture it renders into, which is
      // invalid in WebGPU even when the inactive shader branch never samples it.
      const fallbackSpatialView = sourceProxy.texture.createView();
      const spatialAView = intermediate.spatialATexture?.createView() || fallbackSpatialView;
      // Show noise binds the original as the source and the resolved picture
      // in the overlay slot, so the base pass can difference the two.
      const baseBindGroup = params[NOISE_VIEW_INDEX] === 1
        ? makeBindGroup(proxy.texture.createView(), spatialAView, this.paramBuffer, sourceProxy.texture.createView())
        : makeBindGroup(sourceProxy.texture.createView(), spatialAView);
      // Detail blur samples the filterable spatial binding so fractional radii
      // move continuously instead of jumping between integer texels. Each pass
      // binds its immutable input to both sampled slots; neither aliases that
      // pass's render attachment.
      const detailHorizontalBindGroup = detailActive
        ? makeBindGroup(intermediate.baseTexture.createView(), intermediate.baseTexture.createView())
        : null;
      const detailVerticalBindGroup = detailActive
        ? makeBindGroup(intermediate.detailATexture.createView(), intermediate.detailATexture.createView())
        : null;
      const detailCompositeBindGroup = detailActive
        ? makeBindGroup(intermediate.baseTexture.createView(), intermediate.detailBTexture.createView())
        : null;
      const extractBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const horizontalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialATexture.createView())
        : null;
      const verticalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const finishBindGroup = makeBindGroup(intermediate.filmTexture.createView(), spatialAView);
      if (!intermediate.compositeParamBuffer
        || intermediate.compositeParamBuffer.size < Math.max(16, Math.ceil(params.byteLength / 4) * 4)) {
        intermediate.compositeParamBuffer?.destroy();
        intermediate.compositeParamBuffer = this.createStorageBuffer(params);
      }
      const compositeBindGroup = makeBindGroup(
        (noiseView ? intermediate.baseTexture : intermediate.finishTexture).createView(),
        spatialAView,
        intermediate.compositeParamBuffer,
        masks[overlayIndex]?.texture?.createView() || spatialAView,
      );
      const encoder = this.device.createCommandEncoder();
      if (sourceOptions?.captureClarity) {
        sourceOptions.captureClarity.frameWidth = proxy.width;
        sourceOptions.captureClarity.frameHeight = proxy.height;
      }
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
      // Show noise presents the base pass directly: nothing after it belongs
      // to what Denoise removed.
      if (!noiseView) {
        let localSource = intermediate.baseTexture;
        if (detailActive) {
          const detailHorizontalPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.detailATexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          detailHorizontalPass.setPipeline(pipelines.detailHorizontal);
          detailHorizontalPass.setBindGroup(0, detailHorizontalBindGroup);
          detailHorizontalPass.draw(3);
          detailHorizontalPass.end();

          const detailVerticalPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.detailBTexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          detailVerticalPass.setPipeline(pipelines.detailVertical);
          detailVerticalPass.setBindGroup(0, detailVerticalBindGroup);
          detailVerticalPass.draw(3);
          detailVerticalPass.end();

          let compositeBindGroup = detailCompositeBindGroup;
          if (graphScaleContract().clarityActive(params)) {
            const extents = clarityMapExtents({
              scale: params[CLARITY_MAP_SCALE_INDEX], baseScale: params[CLARITY_BASE_SCALE_INDEX],
            }, 0, 0, proxy.width, proxy.height);
            const maps = this.clarityMapTextures("work", extents.baseWidth, extents.baseHeight);
            const map = this.encodeClarityMap(
              encoder, pipelines, (view) => makeBindGroup(view, view, this.paramBuffer, view),
              intermediate.baseTexture.createView(), maps.textures, extents,
            );
            if (sourceOptions?.captureClarity) {
              sourceOptions.captureClarity.global = this.captureClarityMap(encoder, map, extents);
            }
            compositeBindGroup = makeBindGroup(
              intermediate.baseTexture.createView(), intermediate.detailBTexture.createView(), this.paramBuffer, map.createView(),
            );
          }
          const detailCompositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: intermediate.localTexture.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            }],
          });
          detailCompositePass.setPipeline(pipelines.detailComposite);
          detailCompositePass.setBindGroup(0, compositeBindGroup);
          detailCompositePass.draw(3);
          detailCompositePass.end();
          localSource = intermediate.localTexture;
        }
        for (let index = 0; index < activeLocals.length; index += 1) {
          const local = activeLocals[index];
          const target = localSource === intermediate.baseTexture ? intermediate.localTexture : intermediate.baseTexture;
          const localBuffer = this.localParamBuffer(local, lane, sourcePixelScale, proxy.width, proxy.height, masks[index]);
          if (gpuLocalDetailActive(local[`${lane}_grade`])) {
            // Preserve the pre-local source until the final mask mix. The normal
            // ping-pong target holds the unmasked candidate, while the two Detail
            // scratch textures are reused serially for every local adjustment.
            const candidateBindGroup = makeBindGroup(localSource.createView(), localSource.createView(), localBuffer);
            const candidatePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: target.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            candidatePass.setPipeline(pipelines.localCandidate);
            candidatePass.setBindGroup(0, candidateBindGroup);
            candidatePass.draw(3);
            candidatePass.end();

            const horizontalBindGroup = makeBindGroup(target.createView(), target.createView(), localBuffer);
            const horizontalPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: intermediate.detailATexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            horizontalPass.setPipeline(pipelines.localDetailHorizontal);
            horizontalPass.setBindGroup(0, horizontalBindGroup);
            horizontalPass.draw(3);
            horizontalPass.end();

            const verticalBindGroup = makeBindGroup(
              intermediate.detailATexture.createView(),
              intermediate.detailATexture.createView(),
              localBuffer,
            );
            const verticalPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: intermediate.detailBTexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            verticalPass.setPipeline(pipelines.localDetailVertical);
            verticalPass.setBindGroup(0, verticalBindGroup);
            verticalPass.draw(3);
            verticalPass.end();

            let clarityMapView = intermediate.detailBTexture.createView();
            if (graphScaleContract().localClarityActive(local[`${lane}_grade`])) {
              const values = this.localParamValues.get(`${local.id}:${lane}`);
              const extents = clarityMapExtents({
                scale: values[CLARITY_MAP_SCALE_INDEX], baseScale: values[CLARITY_BASE_SCALE_INDEX],
              }, 0, 0, proxy.width, proxy.height);
              const maps = this.clarityMapTextures("work", extents.baseWidth, extents.baseHeight);
              const map = this.encodeClarityMap(
                encoder, pipelines, (view) => makeBindGroup(view, view, localBuffer, view),
                target.createView(), maps.textures, extents,
              );
              sourceOptions?.captureClarity?.locals.set(local.id, this.captureClarityMap(encoder, map, extents));
              clarityMapView = map.createView();
            }
            const detailCompositeBindGroup = makeBindGroup(
              target.createView(),
              intermediate.detailBTexture.createView(),
              localBuffer,
              clarityMapView,
            );
            const detailCompositePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: intermediate.detailATexture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            detailCompositePass.setPipeline(pipelines.localDetailComposite);
            detailCompositePass.setBindGroup(0, detailCompositeBindGroup);
            detailCompositePass.draw(3);
            detailCompositePass.end();

            const mixBindGroup = makeBindGroup(
              localSource.createView(),
              masks[index].texture.createView(),
              localBuffer,
              intermediate.detailATexture.createView(),
            );
            const mixPass = encoder.beginRenderPass({
              colorAttachments: [{
                view: target.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            mixPass.setPipeline(pipelines.localDetailMix);
            mixPass.setBindGroup(0, mixBindGroup);
            mixPass.draw(3);
            mixPass.end();
            localSource = target;
            continue;
          }
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
        const responseBindGroup = makeBindGroup(localSource.createView(), spatialAView);
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
        const finishPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.finishTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        finishPass.setPipeline(pipelines.finish);
        finishPass.setBindGroup(0, finishBindGroup);
        finishPass.draw(3);
        finishPass.end();
      }
      // A settled render splits here: the finished picture has to exist before
      // its peak can be measured, and the measured peak has to exist before the
      // limiter runs. The submit count matches the previous scheme, which also
      // performed one reduction and one readback per settled render.
      //
      // Presentation is the only part that touches the canvas, so it is the
      // only part that takes the gate. The intermediate graph, the bind groups
      // and the whole command encoder are ready before the frame is replaced,
      // and a superseded generation refuses here without clearing it.
      const presentation = this.presentationGate
        ? await this.presentationGate.acquire(
          canvas,
          () => serial === this.renderSerials.get(canvas)
            && resourceGeneration === this.resourceGeneration
            && sourceOptions?.isCurrent?.() !== false,
          () => {
            if (canvas.width !== proxy.width) canvas.width = proxy.width;
            if (canvas.height !== proxy.height) canvas.height = proxy.height;
          },
        )
        : { current: () => true, release: () => {} };
      if (!presentation) return this.refuseRender("superseded-before-presentation");
      this.configureSurface(canvas, context, lane === "hdr" && !sourceOptions?.forceSdrSurface);
      try {
      this.device.queue.writeBuffer(intermediate.compositeParamBuffer, 0, params);
      // Perspective keeps one bounded graded, uncropped GPU image. The
      // caller owns this texture; slider movement only resamples it.
      if (sourceOptions?.retainPresentation) {
        draftPresentation = this.device.createTexture({
          label: "Perspective draft base",
          size: [proxy.width, proxy.height], format: surface.format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
      }
      const pass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, endOfPassWriteIndex: 1 } } : {}),
        colorAttachments: [{
          view: (draftPresentation || context.getCurrentTexture()).createView(),
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
      } finally {
        presentation.release();
      }
      // Direct composites straight to the canvas, so there is no retained
      // target behind this frame and a later tiled pass must redraw it whole.
      if (!sourceOptions?.measureOnly) {
      this.lastPresentedFrame = {
        sessionId,
        lane,
        geometrySignature,
        width: proxy.width,
        height: proxy.height,
        execution: "direct",
        longEdge: proxy.longEdge,
        workingSpace: proxy.workingSpace,
        format: presentationSurface.format,
        applicationGeneration: Number(sourceOptions?.applicationGeneration ?? 0),
      };
      // The finished picture of this frame, for a region pass to show outside
      // the tiles it draws.
      this.placeholderSource = noiseView ? null : {
        canvas, sessionId, lane, geometrySignature, intermediate, texture: intermediate.finishTexture,
      };
      this.recordFrameMasks({
        execution: "direct", sessionId, lane, width: proxy.width, height: proxy.height, locals: activeLocals,
        pieces: activeLocals.length ? [{
          rect: { x: 0, y: 0, width: proxy.width, height: proxy.height },
          origin: { x: 0, y: 0, width: proxy.width, height: proxy.height },
          entries: masks,
        }] : [],
      });
      }
      const submittedAt = performance.now();
      this.recordStage("grading", {
        serial,
        lane,
        longEdge,
        source: sourceProxy === proxy ? "original" : "resolved",
        durationMs: submittedAt - masksReadyAt,
      });
      // Scopes describe the graded picture; the noise view has no finished
      // texture for them to read this generation.
      if (noiseView) this.scopeSources.delete(canvas);
      else this.scopeSources.set(canvas, {
        serial,
        applicationGeneration: sourceOptions?.applicationGeneration ?? null,
        geometrySignature,
        lane,
        width: proxy.width,
        height: proxy.height,
        // Scopes read the finished picture the composite pass presented, so they
        // never recompute Film Look and never disagree with it.
        filmTexture: intermediate.finishTexture,
        spatialTexture: intermediate.spatialATexture || intermediate.finishTexture,
        params: new Float32Array(params),
        sessionId,
      });
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
      draftReturned = true;
      return {
        presentationTexture: draftPresentation,
        presentationFormat: surface.format,
        width: proxy.width,
        height: proxy.height,
        hdr: surface.hdr,
        proxyFormat: proxy.pixelFormat,
        sourceSerial: serial,
        execution: "direct",
        processedLongEdge: proxy.longEdge,
      };
      } finally {
        if (!draftReturned) draftPresentation?.destroy();
        if (proxyPin) this.gpuAllocator.unpin(proxyPin);
        this.finishActiveRender();
      }
    }

    selectedDenoiseSource(originalProxy) {
      const selector = this.denoiseSourceSelector;
      if (!selector || selector.identity !== originalProxy.identity) {
        return originalProxy;
      }
      // The source cache can replace this identity's copy and free the old
      // texture (a same-key reload, or eviction and reload). The pixels are the
      // same, so the selector adopts the live copy; holding the old one made
      // every Denoise-off frame sample a freed texture and present black.
      if (selector.original !== originalProxy) selector.original = originalProxy;
      if (selector.selected === "resolved" && selector.resolved) return selector.resolved;
      return originalProxy;
    }

    /** Whether adaptive Denoise is switched on, at whatever scale it was set up for. */
    adaptiveDenoiseSelected() {
      const selector = this.denoiseSourceSelector;
      return Boolean(selector?.cache?.algorithmVersion === ADAPTIVE_DENOISE_ALGORITHM_VERSION
        && selector.selected === "resolved");
    }

    /**
     * Whether adaptive Denoise applies to this source: the frame it was set up
     * for, whole or as a region of it.
     */
    adaptiveDenoiseFor(proxy) {
      if (!proxy || !this.adaptiveDenoiseSelected()) return false;
      const selector = this.denoiseSourceSelector;
      return selector.identity
        === `${proxy.sessionId}:${proxy.lane}:${proxy.longEdge}:${proxy.geometrySignature}:${proxy.sourceIdentity}`;
    }

    /**
     * Fill adaptive Denoise's whole-frame reconstruction of `proxy` if it is
     * missing or was made with other controls. Returns whether it did any work.
     */
    async ensureDenoiseResolved(proxy) {
      if (!proxy || proxy.region || !this.adaptiveDenoiseFor(proxy)) return false;
      const selector = this.denoiseSourceSelector;
      if (selector.identity !== proxy.identity) return false;
      if (selector.original !== proxy) selector.original = proxy;
      if (selector.resolved && selector.resolvedFor === JSON.stringify(selector.controls || {})) return false;
      await this.resolveDenoiseProxy(selector.controls || {}, { source: proxy });
      return true;
    }

    createDenoiseTexture(width, height, label) {
      const texture = this.device.createTexture({
        label,
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      return { texture, width, height, byteSize: width * height * 8 };
    }

    /**
     * Set Denoise up for a frame: fetch its noise model. No source is loaded
     * for it. A render reconstructs from the source it loads for itself, which
     * zoomed in is only the part on screen.
     */
    async analyzeDenoiseProxy(sessionId, lane, adjustments, longEdge, editRevision = 0, sourceIdentity = "source", controls = {}) {
      if (!this.available || !sessionId) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const frame = { identity: `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}` };
      return this.analyzeAdaptiveDenoise(sessionId, lane, frame, longEdge, editRevision, geometrySignature, generation, {
        amount: controls.amount ?? 0.5,
        luminance: controls.luminance ?? 0.5,
        colorNoise: controls.colorNoise ?? controls.color_noise ?? 0.5,
        detailRecovery: controls.detailRecovery ?? controls.detail_recovery ?? 0,
        finestNoise: controls.finestNoise ?? controls.finest_noise ?? 0.5,
        fineNoise: controls.fineNoise ?? controls.fine_noise ?? 0.5,
        mediumNoise: controls.mediumNoise ?? controls.medium_noise ?? 0.5,
        coarseNoise: controls.coarseNoise ?? controls.coarse_noise ?? 0.5,
      });
    }

    async ensureAdaptiveDenoisePipelines() {
      if (this.adaptiveDenoisePipelines) return this.adaptiveDenoisePipelines;
      const module = this.device.createShaderModule({ code: ADAPTIVE_DENOISE_SHADER_SOURCE });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
      const compute = GPUShaderStage.COMPUTE;
      const sampled = { sampleType: "unfilterable-float" };
      // One explicit layout for every entry point, so a pass binds the same
      // eight slots and fills the ones it does not read with dummies.
      const layout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: compute, texture: sampled },
          { binding: 1, visibility: compute, texture: sampled },
          { binding: 2, visibility: compute, texture: sampled },
          { binding: 3, visibility: compute, texture: sampled },
          { binding: 4, visibility: compute, storageTexture: { access: "write-only", format: "rgba32float" } },
          { binding: 5, visibility: compute, storageTexture: { access: "write-only", format: "rgba16float" } },
          { binding: 6, visibility: compute, buffer: { type: "uniform" } },
          { binding: 7, visibility: compute, texture: sampled },
        ],
      });
      const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const names = ["Load", "Blur", "Noise", "EnergyHorizontal", "EnergyVertical", "Accumulate", "Final"];
      const created = await Promise.all(names.map((name) => this.device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: `adaptive${name}Main` },
      })));
      const dummy = (format, usage) => this.device.createTexture({ size: { width: 1, height: 1 }, format, usage });
      this.adaptiveDenoisePipelines = {
        layout,
        ...Object.fromEntries(names.map((name, index) => [name[0].toLowerCase() + name.slice(1), created[index]])),
        dummySampled: dummy("rgba32float", GPUTextureUsage.TEXTURE_BINDING),
        dummyStorage32: dummy("rgba32float", GPUTextureUsage.STORAGE_BINDING),
        dummyStorage16: dummy("rgba16float", GPUTextureUsage.STORAGE_BINDING),
      };
      return this.adaptiveDenoisePipelines;
    }

    /** One tile's worth of scratch, reused by every tile of every resolve. */
    createAdaptiveDenoiseScratch() {
      const size = ADAPTIVE_DENOISE_SCRATCH;
      const make = (label) => this.device.createTexture({
        label,
        size: { width: size, height: size },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      const names = ["current", "next", "blur", "energyRow", "energy", "noise", "sumA", "sumB"];
      const textures = Object.fromEntries(names.map((name) => [name, make(`adaptive-denoise-${name}`)]));
      return { textures, byteSize: names.length * size * size * 16, textureCount: names.length };
    }

    warmDenoiseModel(sessionId, lane, native) {
      if (!(native >= 256 && native <= 16384)) return Promise.resolve(false);
      const key = `${sessionId}:${lane}:${native}`;
      if (this.denoiseModelWarm?.key === key) return this.denoiseModelWarm.promise;
      const warm = { key, promise: null };
      warm.promise = fetch(`/api/session/${sessionId}/denoise-model/${lane}?long_edge=${native}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Denoise warm-up failed (${response.status}).`);
          await response.json();
          return true;
        }).catch(() => {
          // Failed warm-ups may be retried; they must not poison this photo.
          if (this.denoiseModelWarm === warm) this.denoiseModelWarm = null;
          return false;
        });
      this.denoiseModelWarm = warm;
      return warm.promise;
    }

    /**
     * Fetch the noise model the backend measured for this frame and install it
     * as the selector's cache. Nothing heavier is cached and no source is
     * loaded: the reconstruction recomputes its bands from the source a render
     * hands it, which is what keeps a 42 MP frame's denoise from holding
     * evidence, or the frame, at all.
     */
    async analyzeAdaptiveDenoise(sessionId, lane, frame, longEdge, editRevision, geometrySignature, generation, controls) {
      const startedAt = performance.now();
      this.denoiseCounters.analysisCalls += 1;
      this.recordStage("denoise-analysis", { state: "started", generation, longEdge, algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION });
      const response = await fetch(`/api/session/${sessionId}/denoise-model/${lane}?long_edge=${longEdge}&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}`);
      if (!response.ok) throw new Error(`Denoise noise model request failed (${response.status}).`);
      const model = await response.json();
      // The full-size model is one measurement per source, about a second on a
      // 42 MP frame. Asking for it now, from a smaller view, means the first
      // zoom to 100% finds it already made.
      const native = this.maskSourceSize?.sessionId === sessionId
        ? Math.max(this.maskSourceSize.width, this.maskSourceSize.height) : 0;
      if (native > longEdge) void this.warmDenoiseModel(sessionId, lane, native);
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
        this.recordStage("denoise-analysis", { state: "stale", generation });
        return false;
      }
      await this.ensureAdaptiveDenoisePipelines();
      const settings = { name: "Adaptive", algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION, levels: 1 };
      const scratch = this.createAdaptiveDenoiseScratch();
      const previous = this.denoiseSourceSelector;
      const cache = {
        algorithmVersion: ADAPTIVE_DENOISE_ALGORITHM_VERSION,
        settings,
        model,
        identity: `${frame.identity}|${ADAPTIVE_DENOISE_ALGORITHM_VERSION}|${JSON.stringify(model)}`,
        tiles: [],
        levels: [],
        resolveScratch: [],
        adaptiveScratch: scratch,
        byteSize: scratch.byteSize,
        textureCount: scratch.textureCount,
      };
      this.denoiseSourceSelector = {
        identity: frame.identity,
        // Adopted by the first Direct render of this frame; a tiled render
        // never needs it.
        original: this.proxies.get(frame.identity) || null,
        resolved: null,
        selected: "resolved",
        cache,
        generation,
      };
      this.setDenoiseControls(controls);
      this.destroyDenoiseSelector(previous);
      this.denoiseCounters.allocations += cache.textureCount;
      this.denoiseCounters.allocatedBytes += cache.byteSize;
      this.denoiseCounters.evidenceBytes = 0;
      this.denoiseCounters.analysisScratchBytes = 0;
      this.denoiseCounters.resolveScratchBytes = scratch.byteSize;
      this.recordAllocation("denoise-adaptive-scratch", scratch.byteSize, { textures: scratch.textureCount, longEdge });
      this.recordStage("denoise-analysis", {
        state: "ready", generation, durationMs: performance.now() - startedAt, algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION,
      });
      return true;
    }

    /**
     * Encode the adaptive reconstruction of `target` into `candidate`.
     *
     * The target is covered by 512-pixel tiles, each computed from a scratch
     * region 66 pixels wider on every side (clamped to the frame), so every
     * tile equals the whole-frame result. Thirty-two dispatches per tile: the
     * load, the noise map's two smoothing levels, five bands of blur, energy
     * and accumulation, and the final write.
     */
    encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, candidate, destinationOrigin, source) {
      const pipelines = this.adaptiveDenoisePipelines;
      const { model } = selector.cache;
      const scratch = selector.cache.adaptiveScratch.textures;
      const frameWidth = source.width;
      const frameHeight = source.height;
      // What of the frame the source texture holds. A region source is fetched
      // wide enough for every margin; clamping to it is the guard for one that
      // was not, and then only the outermost margin is short.
      const held = source.region || { x: 0, y: 0, width: frameWidth, height: frameHeight };
      const strengths = adaptiveDenoiseStrengths({
        amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes,
      });
      const tiles = [];
      for (let y = target.y; y < target.y + target.height; y += ADAPTIVE_DENOISE_TILE) {
        for (let x = target.x; x < target.x + target.width; x += ADAPTIVE_DENOISE_TILE) {
          const width = Math.min(ADAPTIVE_DENOISE_TILE, target.x + target.width - x);
          const height = Math.min(ADAPTIVE_DENOISE_TILE, target.y + target.height - y);
          const x0 = Math.max(held.x, x - ADAPTIVE_DENOISE_MARGIN);
          const y0 = Math.max(held.y, y - ADAPTIVE_DENOISE_MARGIN);
          const x1 = Math.min(held.x + held.width, x + width + ADAPTIVE_DENOISE_MARGIN);
          const y1 = Math.min(held.y + held.height, y + height + ADAPTIVE_DENOISE_MARGIN);
          tiles.push({ tile: { x, y, width, height }, scratch: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        }
      }
      const dispatchesPerTile = 1 + 5 + ADAPTIVE_DENOISE_LEVELS * 5 + 1;
      const paramBuffer = this.device.createBuffer({
        size: Math.max(ADAPTIVE_DENOISE_SLOT, tiles.length * dispatchesPerTile * ADAPTIVE_DENOISE_SLOT),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const slots = new Float32Array(paramBuffer.size / 4);
      let slot = 0;
      const originalView = source.texture.createView();
      const dispatch = (pipeline, binding, values, { width, height }) => {
        slots.set(values, slot * (ADAPTIVE_DENOISE_SLOT / 4));
        const view = (texture) => texture.createView();
        const bindGroup = this.device.createBindGroup({
          layout: pipelines.layout,
          entries: [
            { binding: 0, resource: binding.src || view(pipelines.dummySampled) },
            { binding: 1, resource: binding.aux ? view(binding.aux) : view(pipelines.dummySampled) },
            { binding: 2, resource: binding.aux2 ? view(binding.aux2) : view(pipelines.dummySampled) },
            { binding: 3, resource: binding.aux3 ? view(binding.aux3) : view(pipelines.dummySampled) },
            { binding: 4, resource: binding.dst ? view(binding.dst) : view(pipelines.dummyStorage32) },
            { binding: 5, resource: binding.out ? view(binding.out) : view(pipelines.dummyStorage16) },
            { binding: 6, resource: { buffer: paramBuffer, offset: slot * ADAPTIVE_DENOISE_SLOT, size: 112 } },
            { binding: 7, resource: binding.sum ? view(binding.sum) : view(pipelines.dummySampled) },
          ],
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        pass.end();
        slot += 1;
      };
      for (const { tile, scratch: region } of tiles) {
        const common = (level, axis, sigmas = [0, 0, 0]) => [
          region.x, region.y, region.width, region.height,
          frameWidth, frameHeight, level, axis,
          tile.x, tile.y, tile.width, tile.height,
          destinationOrigin.x, destinationOrigin.y, held.x, held.y,
          model.a, model.b, model.c, 0,
          strengths.luma, strengths.chroma, strengths.fineMultiplier, strengths.fineFloor,
          ...sigmas, 0,
        ];
        const blur = (level, from, to) => {
          dispatch(pipelines.blur, { src: from.createView(), dst: scratch.blur }, common(level, 0), region);
          dispatch(pipelines.blur, { src: scratch.blur.createView(), dst: to }, common(level, 1), region);
        };
        dispatch(pipelines.load, { src: originalView, dst: scratch.current }, common(0, 0), region);
        // The noise map reads luminance smoothed by bands 0 and 1, carried in
        // alpha through the same blur the bands use.
        blur(0, scratch.current, scratch.next);
        blur(1, scratch.next, scratch.energyRow);
        dispatch(pipelines.noise, { src: scratch.energyRow.createView(), dst: scratch.noise }, common(0, 0), region);
        let current = scratch.current;
        let next = scratch.next;
        let sum = scratch.sumA;
        let nextSum = scratch.sumB;
        for (let level = 0; level < ADAPTIVE_DENOISE_LEVELS; level += 1) {
          // A size multiplier scales this band's noise the way strength does.
          const sigmas = [0, 1, 2].map((component) => (
            (Number(model.band_sigmas[component][level]) || 0) * strengths.sizeMultiplier(level)
          ));
          blur(level, current, next);
          dispatch(pipelines.energyHorizontal, { src: current.createView(), aux: next, dst: scratch.energyRow }, common(level, 0), region);
          dispatch(pipelines.energyVertical, { src: scratch.energyRow.createView(), dst: scratch.energy }, common(level, 1), region);
          dispatch(pipelines.accumulate, {
            src: current.createView(), aux: next, aux2: scratch.energy, aux3: scratch.noise, sum: level > 0 ? sum : null, dst: nextSum,
          }, common(level, 0, sigmas), region);
          [sum, nextSum] = [nextSum, sum];
          [current, next] = [next, current];
        }
        dispatch(pipelines.final, { src: sum.createView(), aux: current, out: candidate.texture }, common(0, 0), region);
      }
      this.device.queue.writeBuffer(paramBuffer, 0, slots);
      return { paramBuffer, dispatches: slot, tiles: tiles.length };
    }

    async resolveAdaptiveDenoise(selector, weights, sizes, generation, startedAt, region, destination, sharedEncoder, source) {
      await this.ensureAdaptiveDenoisePipelines();
      const frame = { x: 0, y: 0, width: source.width, height: source.height };
      const held = source.region || frame;
      const left = Math.max(held.x, Math.floor(region ? region.x : 0));
      const top = Math.max(held.y, Math.floor(region ? region.y : 0));
      const target = region
        ? {
          x: left,
          y: top,
          width: Math.min(held.x + held.width, Math.floor(region.x + region.width)) - left,
          height: Math.min(held.y + held.height, Math.floor(region.y + region.height)) - top,
        }
        : frame;
      if (target.width <= 0 || target.height <= 0) return false;
      // The whole-frame reconstruction is one texture of the whole frame.
      if (!destination && source.region) return false;
      const destinationOrigin = destination ? { x: target.x, y: target.y } : { x: 0, y: 0 };
      const candidateIsNew = !destination && !selector.resolved;
      const candidate = destination || selector.resolved
        || this.createDenoiseTexture(frame.width, frame.height, "denoise-resolved");
      let paramBuffer = null;
      try {
        const encoder = sharedEncoder || this.device.createCommandEncoder();
        const encoded = this.encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, candidate, destinationOrigin, source);
        paramBuffer = encoded.paramBuffer;
        this.denoiseCounters.resolveDispatches += encoded.dispatches;
        this.denoiseCounters.resolveTiles += encoded.tiles;
        if (sharedEncoder) {
          const buffer = paramBuffer;
          paramBuffer = null;
          return { encoded: true, dispatches: encoded.dispatches, tiles: encoded.tiles, paramBuffer: buffer };
        }
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        if (generation !== this.denoiseSelectorGeneration || selector !== this.denoiseSourceSelector) {
          if (candidateIsNew) candidate.texture.destroy();
          this.recordStage("denoise-resolve", { state: "stale", generation });
          return false;
        }
        if (candidateIsNew) {
          selector.resolved = {
            ...candidate,
            workingSpace: selector.original.workingSpace,
            pixelFormat: "rgba16float",
            geometrySignature: selector.original.geometrySignature,
            identity: selector.original.identity,
          };
          this.denoiseCounters.allocations += 1;
          this.denoiseCounters.allocatedBytes += candidate.byteSize;
          this.recordAllocation("denoise-resolved", candidate.byteSize, { generation });
        }
        const stage = {
          state: "ready", generation, durationMs: performance.now() - startedAt, tiles: encoded.tiles,
          dispatches: encoded.dispatches, algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION,
          region: region ? `${target.x},${target.y},${target.width},${target.height}` : "whole",
        };
        if (destination) {
          this.recordStage("denoise-resolve", { ...stage, destination: "bounded" });
          return true;
        }
        selector.selected = "resolved";
        selector.resolvedVersion = ++this.denoiseResolveVersion;
        selector.controls = {
          amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes,
        };
        selector.resolvedFor = JSON.stringify(selector.controls);
        selector.resolvedRegion = region ? target : null;
        this.denoiseCounters.atomicSwaps += 1;
        this.recordStage("denoise-resolve", stage);
        return true;
      } catch (error) {
        if (candidateIsNew) candidate.texture.destroy();
        this.recordStage("denoise-resolve", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      } finally {
        paramBuffer?.destroy();
      }
    }

    /**
     * Hand the tiled path new Denoise controls without reconstructing the
     * whole frame.
     *
     * A tiled render reconstructs each tile it draws from `selector.controls`,
     * so during a drag at Full or when zoomed in, a whole-frame reconstruction
     * per step is work nobody sees (NEXT-01 #4). The whole-frame result is
     * left as it was; the caller must run `resolveDenoiseProxy` once the drag
     * ends so a later Direct render does not show the old controls.
     */
    setDenoiseControls(controls = {}) {
      const selector = this.denoiseSourceSelector;
      if (!selector?.cache || selector.selected !== "resolved") return false;
      const weights = ["amount", "luminance", "colorNoise", "detailRecovery"].map((name) => {
        const value = Number(controls[name] ?? 0.5);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      const sizes = adaptiveDenoiseSizes(controls);
      selector.controls = {
        amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes,
      };
      return true;
    }

    async resolveDenoiseProxy(controls = {}, { region = null, destination = null, encoder: sharedEncoder = null, source = null } = {}) {
      const selector = this.denoiseSourceSelector;
      if (!selector?.cache) return false;
      // Reconstruction reads the original's pixels; adopt the live copy if the
      // source cache has replaced (and freed) the one the selector holds.
      const live = this.proxies.get(selector.identity);
      if (live && live !== selector.original) selector.original = live;
      if (!source && (!selector.original || !selector.resolved)) {
        // No whole-frame reconstruction in use: there is nothing
        // to reconstruct ahead of time. The controls are what a tiled render
        // reads, and a Direct render reconstructs once it has loaded its frame
        // (`ensureDenoiseResolved`). Reconstructing here regardless filled a
        // frame-sized texture at Full that no tiled render ever reads.
        return selector.selected === "resolved" && this.setDenoiseControls(controls);
      }
      const generation = ++this.denoiseSelectorGeneration;
      const startedAt = performance.now();
      this.denoiseCounters.resolveCalls += 1;
      const weights = ["amount", "luminance", "colorNoise", "detailRecovery"].map((name) => {
        const value = Number(controls[name] ?? 0.5);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      return this.resolveAdaptiveDenoise(
        selector, weights, adaptiveDenoiseSizes(controls), generation, startedAt, region, destination, sharedEncoder,
        source || selector.original,
      );
    }

    async prepareDenoiseSelectorSeam(sessionId, lane, adjustments, longEdge, editRevision = 0, variant = "resolved-a", sourceIdentity = "source") {
      if (!this.available || !sessionId) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const original = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, {
        isCurrent: () => generation === this.denoiseSelectorGeneration && this.sessionId === sessionId,
      });
      if (!original) return false;
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) return false;
      const startedAt = performance.now();
      const texture = this.device.createTexture({
        size: { width: original.width, height: original.height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const byteSize = original.width * original.height * 8;
      this.denoiseCounters.allocations += 1;
      this.denoiseCounters.allocatedBytes += byteSize;
      this.recordAllocation("denoise-selector-fixture", byteSize, { width: original.width, height: original.height, variant });
      const colors = {
        "resolved-a": { r: 0, g: 0, b: 0, a: 1 },
        "resolved-b": { r: 4, g: 4, b: 4, a: 1 },
      };
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: colors[variant] || colors["resolved-a"],
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
        texture.destroy();
        this.recordStage("selector-stale-candidate", { generation, variant });
        return false;
      }
      const previous = this.denoiseSourceSelector;
      this.denoiseSourceSelector = {
        identity: original.identity,
        original,
        resolved: {
          texture,
          width: original.width,
          height: original.height,
          workingSpace: original.workingSpace,
          pixelFormat: "rgba16float",
          geometrySignature: original.geometrySignature,
          identity: original.identity,
          byteSize,
        },
        selected: previous?.identity === original.identity ? previous.selected : "original",
        resolvedVersion: ++this.denoiseResolveVersion,
        variant,
        generation,
      };
      this.destroyDenoiseSelector(previous);
      this.denoiseCounters.atomicSwaps += 1;
      this.recordStage("selector-atomic-swap", { generation, variant, durationMs: performance.now() - startedAt });
      return true;
    }

    selectDenoiseSelectorSource(enabled) {
      if (!this.denoiseSourceSelector) return false;
      this.denoiseSourceSelector.selected = enabled ? "resolved" : "original";
      this.denoiseCounters.toggles += 1;
      this.recordStage("selector-toggle", { source: this.denoiseSourceSelector.selected });
      return true;
    }

    cancelDenoiseProcessing({ selectOriginal = true } = {}) {
      const generation = ++this.denoiseSelectorGeneration;
      if (selectOriginal && this.denoiseSourceSelector) {
        this.denoiseSourceSelector.selected = "original";
      }
      this.recordStage("denoise-cancel", {
        generation,
        source: this.denoiseSourceSelector?.selected || "none",
      });
      return Boolean(this.denoiseSourceSelector);
    }

    async readDenoiseSelectorPixel() {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const buffer = this.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const values = new Uint16Array(buffer.getMappedRange());
        return [halfToFloat(values[0]), halfToFloat(values[1]), halfToFloat(values[2]), halfToFloat(values[3])];
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    // `x` and `y` let a caller read a window that straddles a denoise tile
    // boundary, which is where a seam would be if there were one.
    async readDenoiseResolvedRegion(width = 16, height = 16, x = 0, y = 0) {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const originX = Math.min(Math.max(0, Math.trunc(Number(x) || 0)), resolved.width - 1);
      const originY = Math.min(Math.max(0, Math.trunc(Number(y) || 0)), resolved.height - 1);
      const copyWidth = Math.min(Math.max(1, Number(width) || 1), resolved.width - originX);
      const copyHeight = Math.min(Math.max(1, Number(height) || 1), resolved.height - originY);
      const bytesPerRow = Math.ceil((copyWidth * 8) / 256) * 256;
      const buffer = this.device.createBuffer({
        size: bytesPerRow * copyHeight,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture, origin: { x: originX, y: originY, z: 0 } },
        { buffer, bytesPerRow, rowsPerImage: copyHeight },
        { width: copyWidth, height: copyHeight },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint16Array(buffer.getMappedRange());
        const stride = bytesPerRow / 2;
        const values = [];
        for (let y = 0; y < copyHeight; y += 1) {
          for (let x = 0; x < copyWidth * 4; x += 1) values.push(halfToFloat(source[y * stride + x]));
        }
        return { width: copyWidth, height: copyHeight, x: originX, y: originY, values };
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    /**
     * Diagnostic readback. The retained presentation
     * target is the frame both the legacy whole-frame pass and the ROI pass
     * composite into, before the single copy to the canvas, so comparing a
     * region of it compares rendered pixels rather than a canvas screenshot.
     */
    async readPresentationRegion(width = 16, height = 16, x = 0, y = 0) {
      const target = this.presentationTarget;
      if (!target?.texture || !target.valid) return null;
      const originX = Math.min(Math.max(0, Math.trunc(Number(x) || 0)), target.width - 1);
      const originY = Math.min(Math.max(0, Math.trunc(Number(y) || 0)), target.height - 1);
      const copyWidth = Math.min(Math.max(1, Number(width) || 1), target.width - originX);
      const copyHeight = Math.min(Math.max(1, Number(height) || 1), target.height - originY);
      const bytesPerTexel = String(target.format).includes("16float") ? 8 : 4;
      const bytesPerRow = Math.ceil((copyWidth * bytesPerTexel) / 256) * 256;
      const buffer = this.device.createBuffer({
        size: bytesPerRow * copyHeight,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: target.texture, origin: { x: originX, y: originY, z: 0 } },
        { buffer, bytesPerRow, rowsPerImage: copyHeight },
        { width: copyWidth, height: copyHeight },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const values = [];
        if (bytesPerTexel === 8) {
          const source = new Uint16Array(buffer.getMappedRange());
          const stride = bytesPerRow / 2;
          for (let row = 0; row < copyHeight; row += 1) {
            for (let column = 0; column < copyWidth * 4; column += 1) {
              values.push(halfToFloat(source[row * stride + column]));
            }
          }
        } else {
          const source = new Uint8Array(buffer.getMappedRange());
          for (let row = 0; row < copyHeight; row += 1) {
            for (let column = 0; column < copyWidth * 4; column += 1) {
              values.push(source[row * bytesPerRow + column] / 255);
            }
          }
        }
        return { x: originX, y: originY, width: copyWidth, height: copyHeight, values };
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    /**
     * Which mask texture each local was drawn with, for the frame on screen.
     *
     * Diagnostic bookkeeping only: it holds references, never textures of its
     * own. A tiled pass over a retained frame adds its tiles to the record;
     * any other pass replaces it.
     */
    recordFrameMasks({ execution, sessionId, lane, width, height, locals, pieces, retained = false }) {
      const localIds = locals.map((local) => local.id);
      const identity = `${execution}:${sessionId}:${lane}:${width}x${height}:${localIds.join(",")}`;
      if (!retained || this.frameMaskRecord?.identity !== identity) {
        this.frameMaskRecord = { identity, execution, lane, width, height, localIds, pieces: new Map() };
      }
      for (const piece of pieces) this.frameMaskRecord.pieces.set(`${piece.rect.x},${piece.rect.y}`, piece);
    }

    /**
     * Diagnostic readback of one local's mask as the frame on screen sampled
     * it, for a region of the output, before the local's and the mask's
     * opacity. Each texture the frame bound is drawn through the same shader
     * function the local passes use. Nothing is compiled or fetched: a mask
     * that is no longer resident is reported as missing, never rebuilt.
     */
    async readLocalMaskRegion(localId, x = 0, y = 0, width = 16, height = 16) {
      const record = this.frameMaskRecord;
      const localIndex = record ? record.localIds.indexOf(localId) : -1;
      if (localIndex < 0) return { error: "No mask was recorded for this local in the frame on screen." };
      const left = Math.min(Math.max(0, Math.trunc(Number(x) || 0)), record.width - 1);
      const top = Math.min(Math.max(0, Math.trunc(Number(y) || 0)), record.height - 1);
      const region = {
        x: left,
        y: top,
        width: Math.min(Math.max(1, Math.trunc(Number(width) || 1)), record.width - left),
        height: Math.min(Math.max(1, Math.trunc(Number(height) || 1)), record.height - top),
      };
      this.maskProbePipeline ||= this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localMaskProbeFragmentMain", targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
      // The probe reads only the slots that place a mask: the pass's origin in
      // the frame and, for a soft mask, the rectangle its bitmap covers.
      const slots = new Float32Array(PARAM_COUNT);
      const parameters = this.createStorageBuffer(slots);
      const values = new Float32Array(region.width * region.height).fill(Number.NaN);
      const sources = new Set();
      let covered = 0;
      let missing = 0;
      this.device.pushErrorScope("validation");
      try {
        for (const piece of record.pieces.values()) {
          const x0 = Math.max(piece.rect.x, region.x);
          const y0 = Math.max(piece.rect.y, region.y);
          const x1 = Math.min(piece.rect.x + piece.rect.width, region.x + region.width);
          const y1 = Math.min(piece.rect.y + piece.rect.height, region.y + region.height);
          if (x1 <= x0 || y1 <= y0) continue;
          const entry = piece.entries[localIndex];
          const resident = entry?.texture
            && (entry.key ? this.maskTiles.get(entry.key) === entry : !entry.destroyed);
          if (!resident) {
            missing += 1;
            continue;
          }
          const copyWidth = x1 - x0;
          const copyHeight = y1 - y0;
          const originX = x0 - piece.origin.x;
          const originY = y0 - piece.origin.y;
          // The pass this piece stands for: the whole frame on the direct
          // route, one tile and its halo on the tiled route.
          const passWidth = piece.origin.width;
          const passHeight = piece.origin.height;
          slots[160] = piece.origin.x;
          slots[161] = piece.origin.y;
          writeMaskRect(slots, 0, entry, record.width, record.height);
          this.device.queue.writeBuffer(parameters, 0, slots);
          const target = this.device.createTexture({
            size: { width: passWidth, height: passHeight },
            format: "r16float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          });
          const bytesPerRow = Math.ceil((copyWidth * 2) / 256) * 256;
          const buffer = this.device.createBuffer({
            size: bytesPerRow * copyHeight,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const maskView = entry.texture.createView();
          const encoder = this.device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store",
            }],
          });
          pass.setViewport(0, 0, passWidth, passHeight, 0, 1);
          pass.setScissorRect(originX, originY, copyWidth, copyHeight);
          pass.setPipeline(this.maskProbePipeline);
          pass.setBindGroup(0, this.bindGraphResources(maskView, maskView, { buffer: parameters }, maskView));
          pass.draw(3);
          pass.end();
          encoder.copyTextureToBuffer(
            { texture: target, origin: { x: originX, y: originY, z: 0 } },
            { buffer, bytesPerRow, rowsPerImage: copyHeight },
            { width: copyWidth, height: copyHeight },
          );
          this.device.queue.submit([encoder.finish()]);
          try {
            await buffer.mapAsync(GPUMapMode.READ);
            const halves = new Uint16Array(buffer.getMappedRange());
            const stride = bytesPerRow / 2;
            for (let row = 0; row < copyHeight; row += 1) {
              const base = (y0 - region.y + row) * region.width + (x0 - region.x);
              for (let column = 0; column < copyWidth; column += 1) {
                values[base + column] = halfToFloat(halves[row * stride + column]);
              }
            }
            covered += copyWidth * copyHeight;
            const placement = slots[MASK_RECT_INDEX + 2] > 0
              ? (entry.soft ? ` soft ${entry.width}x${entry.height}` : " whole frame") : "";
            sources.add(`${entry.kind || "cpu-mask-tile"}${placement}`);
          } finally {
            if (buffer.mapState === "mapped") buffer.unmap();
            buffer.destroy();
            target.destroy();
          }
        }
      } finally {
        const validationError = await this.device.popErrorScope();
        parameters.destroy();
        if (validationError) return { error: `validation: ${validationError.message}` };
      }
      return {
        ...region,
        values,
        execution: record.execution,
        lane: record.lane,
        sources: [...sources],
        coveredPixels: covered,
        missingPieces: missing,
      };
    }

    disposeDenoiseSelectorSeam() {
      this.denoiseSelectorGeneration += 1;
      const selector = this.denoiseSourceSelector;
      this.denoiseSourceSelector = null;
      this.destroyAfterActiveRenders(() => this.destroyDenoiseSelector(selector));
      this.denoiseCounters = this.emptyDenoiseCounters();
    }

    evictDenoiseCache() {
      this.denoiseSelectorGeneration += 1;
      const selector = this.denoiseSourceSelector;
      this.denoiseSourceSelector = null;
      this.destroyAfterActiveRenders(() => this.destroyDenoiseSelector(selector));
      this.recordStage("denoise-cache-evicted", {});
    }

    destroyDenoiseSelector(selector) {
      if (!selector) return;
      selector.resolved?.texture?.destroy();
      for (const level of selector.cache?.levels || []) {
        for (const item of level.evidence || []) item.texture?.destroy();
      }
      for (const item of selector.cache?.resolveScratch || []) item.texture?.destroy();
      for (const buffer of selector.cache?.resolveParamBuffers || []) buffer.destroy();
      for (const texture of Object.values(selector.cache?.adaptiveScratch?.textures || {})) texture.destroy();
    }

    async renderScopeProxy(sessionId, lane, adjustments, curveSampler, longEdge, locals, revision, white, sourceSize, options) {
      this.scopeAnalysisCanvas ||= document.createElement("canvas");
      const canvas = this.scopeAnalysisCanvas;
      const rendered = await this.renderTo(canvas, sessionId, lane, adjustments, curveSampler,
        Math.max(1, Math.min(1600, longEdge)), locals, revision, null, white, sourceSize,
        { ...options, measureOnly: true, scopeAnalysis: true });
      // A whole-picture scope cannot sample a viewport-only retained target.
      return rendered?.execution === "direct" && this.scopeSources.has(canvas)
        ? { canvas, sourceSerial: rendered.sourceSerial } : null;
    }

    /**
     * One SDR Match candidate: the given recipe graded from the scene source
     * at the analysis size, returned as the display-linear sRGB picture the
     * export pipeline's candidate is (output highlights applied, clamped, no
     * grain). Null when this renderer cannot draw the recipe; the fit then
     * runs on the CPU.
     */
    async renderMatchCandidate(sessionId, adjustments, curveSampler, locals, revision, white, sourceSize, longEdge, expected) {
      this.matchCandidateCanvas ||= document.createElement("canvas");
      const canvas = this.matchCandidateCanvas;
      const startedAt = performance.now();
      const candidate = structuredClone(adjustments);
      candidate.sdr.film_look = { ...(candidate.sdr.film_look || {}), grain_amount: 0 };
      const rendered = await this.renderTo(canvas, sessionId, "sdr", candidate, curveSampler,
        longEdge, locals, revision, null, white, sourceSize,
        { measureOnly: true, scopeAnalysis: true, forceSdrSurface: true, sourceLane: "hdr", frameAnchor: true });
      if (rendered?.execution !== "direct" || rendered.width !== expected.width || rendered.height !== expected.height
        || !this.scopeSources.has(canvas)) return null;
      const renderedAt = performance.now();
      const analysis = await this.analyzeScope(canvas, {
        width: rendered.width, height: rendered.height, tier: "picture", raw: true,
      });
      return analysis ? { pixels: analysis.halves, width: analysis.width, height: analysis.height,
        anchor: this.scopeSources.get(canvas)?.params?.[75] ?? null,
        renderMs: renderedAt - startedAt, readbackMs: performance.now() - renderedAt } : null;
    }

    async renderNavigationProxy(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, options) {
      this.navigationAnalysisCanvas ||= document.createElement("canvas");
      const canvas = this.navigationAnalysisCanvas;
      const rendered = await this.renderTo(canvas, sessionId, lane, adjustments, curveSampler,
        512, locals, revision, null, white, sourceSize,
        { ...options, measureOnly: true, scopeAnalysis: true, forceSdrSurface: true });
      if (rendered?.execution !== "direct" || options.isCurrent?.() === false) return null;
      await this.waitForSubmittedWork();
      if (options.isCurrent?.() === false) return null;
      return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }

    async analyzeScope(canvas, { width = 256, height = 128, generation = 0, tier = "interactive", raw = false } = {}) {
      if (!this.available) return null;
      const source = this.scopeSources.get(canvas);
      if (!source) return null;
      const resource = this.acquireScopeResource(width, height);
      if (!resource) return null;
      const startedAt = performance.now();
      resource.busy = true;
      this.activeScopeCount += 1;
      const params = new Float32Array(source.params);
      params[136] = width;
      params[137] = height;
      this.device.queue.writeBuffer(resource.paramBuffer, 0, params);
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: source.filmTexture.createView() },
          { binding: 1, resource: { buffer: resource.paramBuffer } },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: source.spatialTexture.createView() },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: source.spatialTexture.createView() },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: resource.texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(tier === "interactive" ? this.scopePipeline
        : tier === "picture" ? this.outputPicturePipeline : this.settledScopePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: resource.texture },
        { buffer: resource.readBuffer, bytesPerRow: resource.bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const encodedAt = performance.now();
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      return scopeReadback().readAnalysis(this, {
        canvas, source, resource, width, height, generation, tier,
        startedAt, encodedAt, submittedAt, halfToFloat, raw,
      });
    }

    acquireScopeResource(width, height) {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
      const key = `${width}x${height}`;
      let pool = this.scopeResources.get(key);
      if (!pool) {
        pool = [];
        this.scopeResources.set(key, pool);
      }
      const available = pool.find((resource) => !resource.busy && resource.readBuffer.mapState === "unmapped");
      if (available) return available;
      if (pool.length >= 2) return null;
      const resource = {
        busy: false,
        bytesPerRow,
        byteSize: width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4,
        texture: this.device.createTexture({
          size: { width, height },
          format: "rgba16float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        }),
        readBuffer: this.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        paramBuffer: this.device.createBuffer({
          size: PARAM_COUNT * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
      };
      pool.push(resource);
      this.recordAllocation("scope", width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4, { width, height });
      return resource;
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
              // The retained presentation target is copied into the canvas, so
              // the swap-chain texture must be a copy destination.
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
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
        context.configure({
          device: this.device,
          format,
          colorSpace: "srgb",
          alphaMode: "opaque",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
        });
        this.surfaceKeys.set(canvas, key);
      }
      return { format, hdr: false };
    }

    /**
     * Bounded submission log for the supersession stop-gate measurement. Records
     * when a tiled generation submitted and how many tiles that batch carried,
     * so a driver can prove that a superseded generation stopped submitting
     * within the gate instead of finishing the image.
     */
    recordSubmission(lane, options, tiles) {
      this.lastSubmissionAt = performance.now();
      if (!this.instrumentationEnabled) return;
      this.submissionLog.push({
        at: performance.now(),
        lane,
        tiles,
        serial: options?.serial ?? null,
        generation: Number(options?.applicationGeneration ?? 0),
      });
      if (this.submissionLog.length > 128) this.submissionLog.shift();
    }

    /**
     * The retained presentation target.
     *
     * A swap-chain texture is undefined outside what the current pass writes,
     * so it cannot hold the accepted frame between generations. This texture
     * can: tiled passes composite into it, a retained pass loads its previous
     * contents instead of clearing them, and one copy hands the completed
     * frame to the canvas. It is tiled-only, sized to the processed output, and
     * freed with the session.
     */
    ensurePresentationTarget(width, height, format) {
      const existing = this.presentationTarget;
      if (existing && existing.width === width && existing.height === height && existing.format === format) {
        return existing;
      }
      if (existing) {
        const previous = existing.texture;
        if (existing.allocatorEntry) {
          this.gpuAllocator?.unregister(existing.allocatorEntry);
          existing.allocatorEntry = null;
        }
        this.destroyAfterActiveRenders(() => previous.destroy());
      }
      const texture = this.device.createTexture({
        size: { width, height },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const target = {
        texture,
        width,
        height,
        format,
        byteSize: width * height * (format === "rgba16float" ? 8 : 4),
        valid: false,
      };
      this.presentationTarget = target;
      if (this.gpuAllocator) {
        // The accepted frame is a reservation, not a cache entry: nothing may
        // evict it while it is retained.
        target.allocatorEntry = this.gpuAllocator.register({
          kind: "presentation-surface", key: "presentation", bytes: target.byteSize, pinned: true,
        });
      }
      this.recordAllocation("presentation-surface", target.byteSize, { width, height, format });
      return target;
    }

    createMaskPipeline(entryPoint) {
      return this.device.createRenderPipeline({
        layout: this.maskPipelineLayout,
        vertex: { module: this.maskModule, entryPoint: "vertexMain" },
        fragment: { module: this.maskModule, entryPoint, targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
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
      const localCandidate = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localCandidateFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailComposite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailMix = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailMixFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailComposite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const clarityPipeline = (entryPoint) => this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint, targets: [{ format: CLARITY_MAP_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      const clarityReduce = clarityPipeline("clarityReduceFragmentMain");
      const clarityLevel = clarityPipeline("clarityLevelFragmentMain");
      const clarityBlurHorizontal = clarityPipeline("clarityBlurHorizontalFragmentMain");
      const clarityBlurVertical = clarityPipeline("clarityBlurVerticalFragmentMain");
      const claritySurround = clarityPipeline("claritySurroundFragmentMain");
      const extract =this.device.createRenderPipeline({
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
      const finish = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "finishFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const composite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const placeholder = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "placeholderFragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      // Max blending is what lets every tile accumulate into one grid without
      // a readback each. `one`/`one` with operation `max` is a plain maximum:
      // the factors are ignored for min and max operations.
      const scopePeakTile = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: {
          module: this.module,
          entryPoint: "scopePeakTileFragmentMain",
          targets: [{
            format: "rgba16float",
            blend: {
              color: { operation: "max", srcFactor: "one", dstFactor: "one" },
              alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
      const pipelines = {
        peakCandidateLocal: this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "peakCandidateLocalFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        }),
        base,
        finish,
        scopePeakTile,
        local,
        localCandidate,
        localDetailHorizontal,
        localDetailVertical,
        localDetailComposite,
        localDetailMix,
        detailHorizontal,
        detailVertical,
        detailComposite,
        clarityReduce,
        clarityLevel,
        clarityBlurHorizontal,
        clarityBlurVertical,
        claritySurround,
        response,
        extract,
        blurHorizontal,
        blurVertical,
        composite,
        placeholder,
      };
      this.pipelines.set(format, pipelines);
      return pipelines;
    }

    ensureIntermediate(canvas, width, height, spatialActive = false, detailActive = false) {
      const current = this.intermediates.get(canvas);
      const spatialGrid = spatialGridScale(width, height);
      const spatialWidth = Math.max(1, Math.ceil(width / spatialGrid));
      const spatialHeight = Math.max(1, Math.ceil(height / spatialGrid));
      const createSpatialTexture = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const createTexture = () => this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      // PRD 4.3: an allocation failure records a durable backoff. This render
      // retains the last valid presentation; the next plan selects Tiled. The
      // selected preview resolution is never reduced.
      const guard = (create, kind) => {
        try {
          return create();
        } catch (error) {
          this.recordAllocationFailure(kind, error, { width, height });
          throw error;
        }
      };
      if (current?.width === width && current?.height === height) {
        if (spatialActive && (!current.spatialATexture || !current.spatialBTexture)) {
          try {
            current.spatialATexture = guard(createSpatialTexture, "spatial-a");
            current.spatialBTexture = guard(createSpatialTexture, "spatial-b");
          } catch {
            return null;
          }
          this.recordAllocation(
            "grading-spatial-intermediates",
            spatialWidth * spatialHeight * 8 * 2,
            { width, height, spatialWidth, spatialHeight },
          );
        }
        if (detailActive && (!current.detailATexture || !current.detailBTexture)) {
          try {
            current.detailATexture = guard(createTexture, "grading-detail-a");
            current.detailBTexture = guard(createTexture, "grading-detail-b");
          } catch {
            return null;
          }
          this.recordAllocation("grading-detail-intermediates", width * height * 8 * 2, { width, height });
        }
        // Retain spatial textures after first use. Bypass toggles and non-spatial
        // slider edits can then reuse every 4K intermediate instead of destroying
        // and reallocating the full render set.
        current.spatialActive = spatialActive;
        return current;
      }
      current?.baseTexture?.destroy();
      current?.filmTexture?.destroy();
      current?.finishTexture?.destroy();
      current?.spatialATexture?.destroy();
      current?.spatialBTexture?.destroy();
      current?.localTexture?.destroy();
      current?.detailATexture?.destroy();
      current?.detailBTexture?.destroy();
      current?.compositeParamBuffer?.destroy();
      let intermediate;
      try {
        intermediate = {
          baseTexture: guard(createTexture, "grading-base"),
          filmTexture: guard(createTexture, "grading-film"),
          // Film Look, Vignette and grain resolve here so the output limiter can
          // measure the finished picture instead of predicting it, and so the
          // scope pass reads that result instead of computing it a second time.
          finishTexture: guard(createTexture, "grading-finish"),
          localTexture: guard(createTexture, "grading-local"),
          detailATexture: detailActive ? guard(createTexture, "grading-detail-a") : null,
          detailBTexture: detailActive ? guard(createTexture, "grading-detail-b") : null,
          spatialATexture: spatialActive ? guard(createSpatialTexture, "spatial-a") : null,
          spatialBTexture: spatialActive ? guard(createSpatialTexture, "spatial-b") : null,
          spatialActive,
          width,
          height,
        };
      } catch {
        // The backoff is already recorded. Returning null abandons this render
        // and leaves the previous accepted presentation on screen.
        return null;
      }
      this.intermediates.set(canvas, intermediate);
      this.recordAllocation(
        "grading-intermediates",
        width * height * 8 * (4 + (detailActive ? 2 : 0)) + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0),
        { width, height, spatialWidth: spatialActive ? spatialWidth : 0, spatialHeight: spatialActive ? spatialHeight : 0 },
      );
      return intermediate;
    }

    ensureStorageBuffers(paramBytes, curveBytes) {
      if (!this.paramBuffer) {
        this.paramBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(paramBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      if (this.curveBuffer && this.curveBuffer.size < curveBytes) {
        const previous = this.curveBuffer;
        this.curveBuffer = null;
        this.lastCurveSamples = null;
        this.destroyAfterActiveRenders(()=>previous.destroy());
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
      const keys = [...this.proxies.keys()].filter((key) => key.startsWith(prefix) && !key.includes(":analysis:"));
      // A lane keeps its source levels until the central budget asks for them
      // back: evicting the level a warm step is about to reuse is exactly the
      // churn this item removes. The global LRU evicts by budget and protects
      // anything a pass has pinned, so the count below is only a last-resort
      // cap for pathological key growth.
      while (keys.length > this.proxyLevelCapPerLane) {
        // The eviction hook releases the registry entry and destroys the
        // texture in one place, so the map and the allocator cannot disagree.
        this.evictGpuCacheEntry("source-proxy", keys.shift());
      }
    }

    createStorageBuffer(values) {
      const size = Math.max(16, Math.ceil(values.byteLength / 4) * 4);
      return this.device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    async ensurePeakReductionPipeline(entryPoint = "peakReductionMain") {
      this.peakReductionPipelines = this.peakReductionPipelines || new Map();
      const existing = this.peakReductionPipelines.get(entryPoint);
      if (existing) return existing;
      if (!this.peakReductionModule) {
        const module = this.device.createShaderModule({ code: PEAK_REDUCTION_SHADER_SOURCE });
        const compilation = await module.getCompilationInfo();
        const errors = compilation.messages.filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
        this.peakReductionModule = module;
      }
      const pipeline = await this.device.createComputePipelineAsync({
        layout: "auto",
        compute: { module: this.peakReductionModule, entryPoint },
      });
      this.peakReductionPipelines.set(entryPoint, pipeline);
      return pipeline;
    }

    async measureToneAdjustedPeak(sourceProxy, params, measurement, cacheKey, { reference = null } = {}) {
      const cached = this.peakReductionCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const pipeline = await this.ensurePeakReductionPipeline();
      const measure = () => this.runPeakReduction(
        pipeline, sourceProxy.texture, sourceProxy.width, sourceProxy.height, params, measurement, cacheKey,
      );
      const first = await measure();
      // A result far above anything this grade can plausibly produce is taken
      // once more before it is trusted. The second result is used as measured:
      // nothing is invented or clamped, so a genuinely extreme highlight still
      // anchors the shoulder. (One such reading, cached, turned the owner's
      // zoomed preview SDR-looking on 2026-09-25.)
      if (reference > 0 && first > reference * HIGHLIGHT_ANCHOR_RECHECK_FACTOR) {
        this.peakReductionCache.delete(cacheKey);
        const second = await measure();
        this.recordStage("highlight-anchor-recheck", { first, second, reference });
        return second;
      }
      return first;
    }

    async runPeakReduction(pipeline, texture, width, height, params, measurement, cacheKey) {
      const valueCount = 1 + PEAK_HISTOGRAM_BINS;
      const byteSize = valueCount * 4;
      const resultBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = this.device.createBuffer({
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const parameterBuffer = this.createStorageBuffer(params);
      this.device.queue.writeBuffer(resultBuffer, 0, new Uint32Array(valueCount));
      this.device.queue.writeBuffer(parameterBuffer, 0, params);
      const bindGroup = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: parameterBuffer } },
          { binding: 2, resource: { buffer: resultBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      encoder.copyBufferToBuffer(resultBuffer, 0, readBuffer, 0, byteSize);
      this.device.queue.submit([encoder.finish()]);
      try {
        await readBuffer.mapAsync(GPUMapMode.READ);
        const values = new Uint32Array(readBuffer.getMappedRange());
        let peak = new Float32Array(new Uint32Array([values[0]]).buffer)[0];
        if (measurement === "robust") {
          const population = width * height;
          const threshold = Math.max(1, Math.ceil(population * 0.9999));
          let cumulative = 0;
          for (let index = 0; index < PEAK_HISTOGRAM_BINS; index += 1) {
            cumulative += values[index + 1];
            if (cumulative >= threshold) {
              // Use the upper edge so the robust anchor remains conservative
              // rather than undershooting the selected percentile.
              peak = 2 ** (-32 + (index + 1) * 64 / PEAK_HISTOGRAM_BINS);
              break;
            }
          }
        }
        const measured = Math.max(0.0018, Number.isFinite(peak) ? peak : 0.0018);
        this.peakReductionCache.set(cacheKey, measured);
        while (this.peakReductionCache.size > 32) this.peakReductionCache.delete(this.peakReductionCache.keys().next().value);
        return measured;
      } finally {
        if (readBuffer.mapState === "mapped") readBuffer.unmap();
        resultBuffer.destroy();
        readBuffer.destroy();
        parameterBuffer.destroy();
      }
    }

    /**
     * Fill a Direct source texture from bounded tile responses.
     *
     * PRD 5.4: for Direct execution the renderer may allocate a full source
     * texture but fill it incrementally, so the browser never needs a single
     * image-sized response buffer. Chunks are full-width row strips, which
     * keeps each response's row pitch identical to the whole-frame case and
     * makes the assembled texture what the whole-frame path would have written.
     *
     * Returns null when the backend declines the tile route, so the caller can
     * fall back to the whole-frame request rather than failing the render.
     */
    /**
     * Session-scoped abort signal for source transport. The renderer never
     * aborts on its own: callers pass their currency check, and replacing the
     * session aborts everything still in flight for the old one.
     */
    sourceAbortSignal() {
      if (typeof AbortController === "undefined") return undefined;
      if (!this.sourceAbort) this.sourceAbort = new AbortController();
      return this.sourceAbort.signal;
    }

    /**
     * Copy one row chunk into a source texture through a bounded ring of
     * reusable staging buffers.
     *
     * `queue.writeTexture` accumulates every chunk in one Dawn dynamic-uploader
     * buffer until the eventual render submit; at 42 MP that silently
     * reconstructs an image-sized staging allocation and exceeds WebGPU's
     * default 256 MiB maxBufferSize. One mapped buffer per chunk avoids that,
     * but awaiting `onSubmittedWorkDone()` after each copy serialises the whole
     * stream behind every chunk: no fetch can start while a copy runs. The only
     * thing a slot's next write must wait for is that slot's own earlier copy,
     * and `mapAsync` is exactly that fence. A small ring therefore overlaps
     * fetches with copies and needs one queue drain at the end of the stream,
     * not one per chunk.
     *
     * Returns the buffer the chunk was written through, so the caller can
     * release the ring once the stream is done.
     */
    async copySourceChunkStaged(ring, retired, slot, data, { bytesPerRow, rows, width, texture, origin }) {
      return sourceTransport().copyChunkStaged(
        this, ring, retired, slot, data, { bytesPerRow, rows, width, texture, origin },
      );
    }

    /** Release a staging ring once its copies have executed. */
    async releaseSourceStaging(ring, retired = []) {
      return sourceTransport().releaseStaging(this, ring, retired);
    }

    /**
     * Select the transport for an above-budget source frame.
     * Kept on the renderer so a driver can A/B the routes against the same
     * session and a field problem can fall back without a rebuild.
     */
    setSourceTransport(mode) {
      return sourceTransport().setMode(this, mode);
    }

    /**
     * Read one whole-frame proxy response as a byte stream and fill the source
     * texture through the bounded staging ring.
     *
     * The per-strip route pays a fresh backend encode and a request round trip
     * per chunk. This route asks for the frame once: `stream` reads it back as
     * chunked row strips while the backend is still encoding later rows, and
     * `single` reads the prebuilt body the same way. Either way the frame never
     * exists as an image-sized buffer in JS -- the request body is consumed in
     * chunks and copied into the ring as it arrives -- and the row math is the
     * same as the strip route, so the uploaded bytes are identical.
     */
    async loadProxyStreaming(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options = {}) {
      return sourceTransport().loadStreaming(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options,
      });
    }

    async loadProxyStreamed(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options = {}) {
      return sourceTransport().loadStrips(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options,
      });
    }

    /**
     * Load only the source region one ROI pass will process.
     *
     * The whole-frame route uploads the entire frame at the pass's scale even
     * though a magnified pass reads a viewport-sized corner of it. This asks
     * the source-tile endpoint for exactly the fetch region at the same mip
     * level the pass needs, one row-chunk at a time, and returns a proxy whose
     * texture covers that region while its width and height stay the frame's,
     * so the tile plan, the presentation target and every frame-anchored
     * parameter are unchanged. Returns null when the endpoint cannot serve the
     * geometry (409), when the region is empty, or when the delivered region
     * is the whole frame -- the caller then falls back to the ordinary
     * whole-frame route.
     */
    async loadProxyRegion(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, region, options = {}) {
      return sourceTransport().loadRegion(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, region, options,
      });
    }

    async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", editRevision = 0, sourceIdentity = "source", options = {}) {
      return sourceTransport().loadProxy(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, options,
      });
    }

    async loadDirectMasks({
      generation, sessionId, activeLocals, longEdge, editRevision, geometrySignature, isCurrent = () => true,
      remember = true,
    }) {
      const tasks = Array.from(activeLocals || []);
      if (!tasks.length) return { results: [], current: isCurrent() };
      if (!this.maskRequestCoordinator) {
        const results = [];
        for (const local of tasks) {
          if (!isCurrent()) break;
          results.push(await this.loadLocalMask(
            sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, undefined, remember,
          ));
        }
        while (results.length < tasks.length) results.push(null);
        return { results, current: isCurrent() };
      }
      return this.maskRequestCoordinator.run(
        generation,
        tasks,
        (local, _index, signal) => this.loadLocalMask(
          sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, signal, remember,
        ),
        isCurrent,
      );
    }

    async loadLocalMask(
      sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true, signal = undefined,
      remember = true,
    ) {
      if (local.mask?.operator !== "leaf") {
        if (this.gpuAnalyticMasksEnabled) {
          // Composed in source space and warped once, as export does it.
          const resampled = await this.loadGpuResampledLeaf(sessionId, local.mask, longEdge, geometrySignature, isCurrent, signal);
          if (resampled) return resampled;
          if (signal?.aborted || !isCurrent()) return null;
        }
        return this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, signal, remember);
      }
      return this.loadMaskLeaf(
        sessionId, local, local.mask, "", longEdge, editRevision, geometrySignature, isCurrent, signal, true, remember,
      );
    }

    async loadMaskLeaf(
      sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature,
      isCurrent = () => true, signal = undefined, allowSoft = true, remember = true,
    ) {
      if (signal?.aborted || !isCurrent()) return null;
      if (this.gpuAnalyticMasksEnabled) {
        const resampled = await this.loadGpuResampledLeaf(sessionId, expression, longEdge, geometrySignature, isCurrent, signal);
        if (resampled) return resampled;
        if (signal?.aborted || !isCurrent()) return null;
      }
      const leafLocal = { ...local, id: maskPath ? `${local.id}:${maskPath}` : local.id, mask: expression };
      if (longEdge <= SOFT_MASK_MAX_EDGE && this.gpuAnalyticMasksEnabled) {
        const shape = this.loadGpuAnalyticLeaf(sessionId,expression,longEdge,geometrySignature,isCurrent);
        if (shape) return shape;
      }
      if (isGpuLumaMask(expression)) {
        return this.loadGpuLumaMask(
          sessionId, leafLocal, longEdge, editRevision, geometrySignature, isCurrent, signal, !remember,
        );
      }
      if (allowSoft && expression?.operator==='leaf' && expression.leaf?.type==='brush'
        && Number(expression.leaf.mask_feather) && !Number(expression.leaf.mask_shift_edge)) {
        // Scopes and Fit share the same qualified small bitmap as native
        // editing. The CPU fallback's 1600-edge default must not prevent a
        // bounded GPU brush from trying 512, 1024 and the existing larger-bitmap fallback.
        for (const edge of [...new Set([512,1024,1600,3200].map(edge=>Math.min(longEdge,edge)))]) {
          const brush=await this.loadGpuBrushLeaf(sessionId,local,expression,maskPath,edge,editRevision,
            geometrySignature,isCurrent,signal);
          if(brush?.soft)return brush;
          if(signal?.aborted||!isCurrent())return null;
          // A bitmap made at the requested scale is the mask itself, soft or
          // not; measurements and scopes need no CPU compile for it.
          if(edge===longEdge){if(brush)return brush;break;}
        }
      }
      if (allowSoft && longEdge > SOFT_MASK_MAX_EDGE) {
        const soft = await this.softLeafMask(
          sessionId, local, expression, maskPath, editRevision, geometrySignature, isCurrent, signal,
        );
        if (soft) return soft;
        if (signal?.aborted || !isCurrent()) return null;
      }
      // A bitmap made at the requested scale is the mask itself, so a
      // measurement of a combination needs no CPU compile for its brush leaf.
      if (remember || (longEdge <= SOFT_MASK_MAX_EDGE
        && (Number(expression.leaf?.mask_shift_edge) || Number(expression.leaf?.mask_feather)))) {
        const brush = await this.loadGpuBrushLeaf(sessionId,local,expression,maskPath,longEdge,editRevision,
          geometrySignature,isCurrent,signal);
        if (brush) return brush;
        if (signal?.aborted || !isCurrent()) return null;
      }
      return this.loadCpuLeafAt(
        sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature, isCurrent, signal, remember,
      );
    }

    loadGpuAnalyticLeaf(sessionId, expression, longEdge, geometrySignature, isCurrent) {
      if (!isCurrent()) return null;
      // Fit/Direct already loaded this frame. Geometry-only masks need its
      // dimensions, but never another source fetch or a backend compile.
      let source = [...this.proxies.values()].find(proxy => !proxy.region
        && proxy.sessionId === sessionId && proxy.longEdge === longEdge && proxy.geometrySignature === geometrySignature);
      if (!source && this.maskSourceSize?.sessionId===sessionId) {
        // Auxiliary masks can request a different bounded edge than the
        // resident picture. Their dimensions follow source metadata, not
        // whichever picture proxy happens to be cached. The analytic shader
        // does not sample the texture required by the shared bind layout.
        const size=this.maskSourceSize,geometry=JSON.parse(geometrySignature),crop=geometry.crop||{};
        const normalized=JSON.stringify({...geometry,crop:{x:0,y:0,width:1,height:1}});
        const binding=[...this.proxies.values()].find(proxy=>proxy.sessionId===sessionId)?.texture;
        if(binding && (window.HDRMaskRaster?.eligible(expression,normalized) || isGpuLinearGradientMask(expression,normalized))){
          const scale=Math.min(1,longEdge/Math.max(size.width,size.height));
          let width=Math.max(1,lumaEvenRound(size.width*scale)),height=Math.max(1,lumaEvenRound(size.height*scale));
          if(Number(geometry.rotation||0)%180)[width,height]=[height,width];
          const left=Math.min(width-1,Math.max(0,lumaEvenRound((crop.x||0)*width)));
          const top=Math.min(height-1,Math.max(0,lumaEvenRound((crop.y||0)*height)));
          const right=Math.min(width,Math.max(left+1,lumaEvenRound(((crop.x||0)+(crop.width??1))*width)));
          const bottom=Math.min(height,Math.max(top+1,lumaEvenRound(((crop.y||0)+(crop.height??1))*height)));
          source={width:right-left,height:bottom-top,texture:binding};
        }
      }
      if (!source) return null;
      const frame=this.analyticMaskFrame(sessionId,longEdge,geometrySignature,source.width,source.height);
      if(!frame)return null;
      const gradient = isGpuLinearGradientMask(expression,frame.geometrySignature);
      if(!gradient&&!window.HDRMaskRaster?.eligible(expression,frame.geometrySignature))return null;
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-shape:${gpuMaskIdentity(expression)}`;
      let entry = this.localMasks.get(key);
      if (!entry) {
        const {width,height} = source, rect = {x:frame.x,y:frame.y,width,height};
        const values = gradient ? buildGpuLinearGradientParams(expression,rect,frame.width,frame.height,frame.geometrySignature)
          : window.HDRMaskRaster.parameters(expression,rect,frame.width,frame.height,frame.geometrySignature);
        if (!values) return null;
        const buffer = this.createStorageBuffer(values), texture = this.createMaskTexture(width,height);
        this.device.queue.writeBuffer(buffer,0,values);
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(encoder,gradient ? this.maskPipelines.linearGradient : this.maskPipelines.shapeRaster,
          this.createMaskBindGroup(source.texture,buffer),texture);
        this.device.queue.submit([encoder.finish()]);
        this.destroyAfterActiveRenders(()=>buffer.destroy());
        entry = {texture,width,height,byteSize:width*height*2,
          kind:gradient ? 'gpu-linear-gradient' : `gpu-${expression.leaf.type}-raster`};
        this.localMasks.set(key,entry);
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({kind:entry.kind,longEdge,width,height,cpuMaskRequest:false});
      } else {this.localMasks.delete(key);this.localMasks.set(key,entry);}
      this.retainLocalMask(entry,longEdge);
      return entry;
    }

    /**
     * The small bitmap of a CPU-made leaf, if the backend showed it is soft
     * enough to be stretched over a magnified frame; otherwise null and the
     * caller takes the exact path. Zooming in reuses the bitmap the Fit view
     * loaded, so a soft mask costs no compile and no upload.
     */
    async softLeafMask(
      sessionId, local, expression, maskPath, editRevision, geometrySignature,
      isCurrent = () => true, signal = undefined,
    ) {
      if (expression?.operator !== "leaf" || expression.leaf?.type === "luminance_range") return null;
      const identity = softMaskIdentity(sessionId, geometrySignature, gpuMaskIdentity(expression));
      let entry = this.softMasks.get(identity);
      // The verdict belongs to the mask and its bitmap size, so it outlives
      // the texture: a mask shown not to be soft is not asked for again.
      if (entry && !entry.soft) {
        // Edges a little too steep for the Fit bitmap may still be carried by
        // a larger one. It is tried once per mask; a whole-image compile is
        // the only alternative for a feathered brush.
        if (!entry.softRetryable || entry.longEdge >= SOFT_MASK_MAX_EDGE) return null;
        // Steepness falls roughly in proportion to the bitmap's size. A mask
        // that would still be over the limit at the larger size is not worth
        // the compile: the estimate has to come down with half a level to spare.
        const expected = entry.softEstimate * entry.longEdge / SOFT_MASK_MAX_EDGE;
        if (!(expected <= entry.softLimit - 0.5)) return null;
        if (entry.larger === undefined || entry.larger?.destroyed) {
          let gpuLarger=null;
          for(const edge of [1024,1600,SOFT_MASK_MAX_EDGE]){
            if(edge<=entry.longEdge)continue;
            gpuLarger=await this.loadGpuBrushLeaf(sessionId,local,expression,maskPath,edge,editRevision,
              geometrySignature,isCurrent,signal);
            if(gpuLarger?.soft||signal?.aborted||!isCurrent())break;
          }
          if(signal?.aborted||!isCurrent())return null;
          entry.larger = gpuLarger?.soft ? gpuLarger : await this.loadCpuLeafAt(
            sessionId, local, expression, maskPath, SOFT_MASK_MAX_EDGE, editRevision, geometrySignature,
            isCurrent, signal, false,
          ) || undefined;
        }
        if (!entry.larger?.soft) return null;
        entry.larger.lastUseSerial = this.maskUseSerial;
        return entry.larger;
      }
      if (!entry || entry.destroyed) {
        // An evicted bitmap is asked for at the size it had, which the backend
        // still holds, rather than compiled again at another.
        const bitmapEdge = entry?.longEdge || Math.min(SOFT_MASK_LONG_EDGE,512);
        entry = await this.loadGpuBrushLeaf(
          sessionId, local, expression, maskPath, bitmapEdge, editRevision,
          geometrySignature, isCurrent, signal,
        );
        if (!entry && !signal?.aborted && isCurrent()) entry = await this.loadCpuLeafAt(
          sessionId, local, expression, maskPath, bitmapEdge, editRevision,
          geometrySignature, isCurrent, signal,
        );
      }
      if (!entry?.soft || entry.destroyed) return null;
      if (entry.cacheKey && this.localMasks.get(entry.cacheKey) === entry) {
        this.localMasks.delete(entry.cacheKey);
        this.localMasks.set(entry.cacheKey, entry);
      }
      entry.lastUseSerial = this.maskUseSerial;
      return entry;
    }

    /** Called by the mask loader for every small bitmap it uploads. */
    rememberSoftMask(sessionId, geometrySignature, maskSignature, entry) {
      const identity = softMaskIdentity(sessionId, geometrySignature, maskSignature);
      this.softMasks.delete(identity);
      this.softMasks.set(identity, entry);
      while (this.softMasks.size > 128) this.softMasks.delete(this.softMasks.keys().next().value);
    }

    async loadGpuBrushLeaf(sessionId, local, expression, maskPath, longEdge, editRevision,
      geometrySignature, isCurrent = () => true, signal = undefined) {
      const helper=window.HDRGpuBrushMask, size=this.maskSourceSize;
      if (!this.gpuAnalyticMasksEnabled || !helper || size?.sessionId!==sessionId || longEdge>SOFT_MASK_MAX_EDGE
        || signal?.aborted || !isCurrent()) return null;
      const scale=Math.min(1,longEdge/Math.max(size.width,size.height));
      let width=Math.max(1,helper.evenRound(size.width*scale)),height=Math.max(1,helper.evenRound(size.height*scale));
      const geometry=JSON.parse(geometrySignature);
      if (Number(geometry.rotation||0)%180) [width,height]=[height,width];
      if (!helper.plan(expression,width,height,geometrySignature)) return null;
      const signature=gpuMaskIdentity(expression),key=`${sessionId}:${longEdge}:${geometrySignature}:gpu-brush:${signature}`;
      const cached=this.localMasks.get(key);
      if(cached){cached.lastUseSerial=this.maskUseSerial;return cached;}
      const generation=this.resourceGeneration,device=this.device;
      const current=()=>!signal?.aborted&&isCurrent()&&this.resourceGeneration===generation&&this.device===device;
      const inflight=this.localMaskInflight.get(key);
      if(inflight&&!inflight.signal?.aborted){
        let entry;try{entry=await inflight.promise;}catch(error){if(error?.name!=='AbortError')throw error;}
        if(!current())return null;
        if(entry)return entry;
        if(this.localMaskInflight.get(key)===inflight)this.localMaskInflight.delete(key);
        return this.loadGpuBrushLeaf(sessionId,local,expression,maskPath,longEdge,editRevision,geometrySignature,isCurrent,signal);
      }
      const pending=(async()=>{
        const started=performance.now();let entry=await helper.generate(this,expression,width,height,geometrySignature,current);
        if(!entry)return null;
        try{
          const packingStarted=performance.now();
          const metadata=new TextEncoder().encode(JSON.stringify({mask:spatialLeafExpression(expression),edit_revision:editRevision,long_edge:longEdge,
            geometry_signature:geometrySignature,width:entry.width,height:entry.height}));
          const prefix=new ArrayBuffer(4);new DataView(prefix).setUint32(0,metadata.byteLength,true);
          const requestBody=new Blob([prefix,metadata,entry.bitmap],{type:'application/octet-stream'});
          const transportPackMs=performance.now()-packingStarted,classificationStarted=performance.now();
          const response=await fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}/bitmap-verdict-raw`,{
            method:'POST',headers:{'Content-Type':'application/octet-stream'},signal,
            body:requestBody});
          const classificationRoundTripMs=performance.now()-classificationStarted;
          if(!response.ok||response.headers.get('X-Geometry-Signature')!==geometrySignature||!current()){
            this.performanceMetrics.maskEvents ||= [];
            this.performanceMetrics.maskEvents.push({kind:'gpu-brush-verdict-refusal',longEdge,width:entry.width,height:entry.height,
              status:response.status,current:current(),detail:response.ok?'':(await response.text()).slice(0,500)});
            return null;
          }
          delete entry.bitmap;Object.assign(entry,{cacheKey:key,longEdge,soft:response.headers.get('X-Mask-Soft')==='1',
            softReason:response.headers.get('X-Mask-Soft-Reason'),
            softTerms:JSON.parse(response.headers.get('X-Mask-Soft-Terms') || '{}'),
            softRetryable:['bend','border'].includes(response.headers.get('X-Mask-Soft-Reason')),
            softEstimate:Number(response.headers.get('X-Mask-Soft-Estimate')),softLimit:Number(response.headers.get('X-Mask-Soft-Limit')),
            frameRect:response.headers.get('X-Mask-Frame-Rect').split(',').map(Number)});
          this.localMasks.set(key,entry);this.rememberSoftMask(sessionId,geometrySignature,signature,entry);
          this.retainLocalMask(entry,longEdge);
          this.performanceMetrics.maskEvents ||= [];
          this.performanceMetrics.maskEvents.push({kind:entry.kind,longEdge,width,height,requestMs:performance.now()-started,
            ...entry.timings,transportPackMs,classificationRoundTripMs,soft:entry.soft,softReason:entry.softReason,
            softTerms:entry.softTerms,
            classificationCpuMs:Number(response.headers.get('X-Mask-Classification-Ms')),
            softEstimate:entry.softEstimate,cpuMaskRequest:false});
          const result=entry;entry=null;return result;
        }finally{entry?.texture.destroy();}
      })();
      const record={promise:pending,signal};this.localMaskInflight.set(key,record);
      try{return await pending;}finally{if(this.localMaskInflight.get(key)===record)this.localMaskInflight.delete(key);}
    }

    async loadCpuLeafAt(
      sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature,
      isCurrent = () => true, signal = undefined, remember = true,
    ) {
      const maskSignature = gpuMaskIdentity(expression);
      // The mask endpoint rasterizes the backend's committed local, and the
      // edit revision only moves when a commit lands. While a mask control is
      // being dragged the leaf here is newer than that, so a plain fetch would
      // return the committed mask and cache it under this leaf's identity,
      // where every later frame at this resolution reuses it. Rasterize the
      // requested leaf itself until the backend has acknowledged it.
      const acknowledged = this.acknowledgedMaskSignature?.(local.id, maskPath);
      const draftExpression = acknowledged !== undefined && acknowledged !== spatialMaskSignature(expression)
        ? spatialLeafExpression(expression)
        : null;
      return maskLoader().loadCpuMaskLeaf(this, {
        sessionId, local, maskPath, longEdge, editRevision, geometrySignature, maskSignature, isCurrent, signal,
        draftExpression, remember,
      });
    }

    async loadGpuMaskGraph(
      sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true, signal = undefined,
      remember = true,
      sourceOverride = null,
    ) {
      const startedAt = performance.now();
      const layoutIdentity = gpuMaskGraphLayoutIdentity(local.mask);
      const key = `${sessionId}:${local.id}:${longEdge}:${geometrySignature}:gpu-mask-graph:${layoutIdentity}`
        + (sourceOverride ? `:region:${JSON.stringify(sourceOverride.region)}` : "");
      let entry = this.localMasks.get(key);
      const influenceIdentity = JSON.stringify(gpuMaskRenderPayload(local.mask));
      if (entry?.influenceIdentity === influenceIdentity) {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
        entry.lastUseSerial = this.maskUseSerial;
        return entry;
      }

      const resolveNode = async (expression, path) => {
        if (expression.operator === "leaf") {
          if (sourceOverride) {
            const leafLocal = { ...local, id: `${local.id}:${path}`, mask: expression };
            const leafEntry = isGpuLumaMask(expression)
              ? await this.loadGpuLumaMask(sessionId, leafLocal, longEdge, editRevision,
                geometrySignature, isCurrent, signal, false, sourceOverride)
              : this.loadGpuAnalyticRegion(sessionId, { localIndex: 0, local: leafLocal,
                tiles: [{ key: "region", rect: sourceOverride.region, haloRect: sourceOverride.region, halo: 0 }] },
                longEdge, geometrySignature, gpuMaskIdentity(expression), isCurrent, sourceOverride)?.entries.get("region");
            return leafEntry ? { expression, leafEntry, children: [] } : null;
          }
          // A combination is built texel for texel from its leaves, so each
          // leaf is loaded at the frame's own size, never as a small bitmap.
          const leafEntry = await this.loadMaskLeaf(
            sessionId, local, expression, path, longEdge, editRevision, geometrySignature, isCurrent, signal, false, remember,
          );
          return leafEntry ? { expression, leafEntry, children: [] } : null;
        }
        if (expression.enabled === false) {
          const child = expression.children?.[0];
          return child ? resolveNode(child, path ? `${path}.0` : "0") : null;
        }
        const activeChildren = expression.children
          .map((child, index) => ({ child, index }))
          .filter(({ child }) => child.enabled !== false);
        const children = [];
        for (const { child, index } of activeChildren) {
          if (signal?.aborted || !isCurrent()) return null;
          children.push(await resolveNode(child, path ? `${path}.${index}` : String(index)));
        }
        return children.some((child) => !child) ? null : { expression, children };
      };
      const resolved = await resolveNode(local.mask, "");
      if (!resolved || !isCurrent()) return null;
      if (resolved.leafEntry) return resolved.leafEntry;

      const firstLeaf = firstResolvedMaskLeaf(resolved);
      const passCount = gpuMaskGraphPassCount(local.mask);
      if (!entry || entry.width !== firstLeaf.width || entry.height !== firstLeaf.height || entry.nodeTextures.length !== passCount) {
        if (entry) this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
        const nodeTextures = Array.from({ length: passCount }, () => this.createMaskTexture(firstLeaf.width, firstLeaf.height));
        entry = {
          kind: "gpu-mask-graph",
          texture: nodeTextures.at(-1),
          nodeTextures,
          width: firstLeaf.width,
          height: firstLeaf.height,
          byteSize: firstLeaf.width * firstLeaf.height * 2 * passCount,
          influenceIdentity: null,
          wholeFrame: Boolean(sourceOverride),
          frameRect: firstLeaf.frameRect,
        };
      }

      const encoder = this.device.createCommandEncoder();
      const parameterBuffers = [];
      let textureIndex = 0;
      const encodeNode = (node) => {
        if (node.expression.operator === "leaf") {
          return {
            texture: node.leafEntry.texture,
            opacity: Math.min(1, Math.max(0, Number(node.expression.leaf?.mask_opacity ?? 1))),
          };
        }
        let result = encodeNode(node.children[0]);
        for (let childIndex = 1; childIndex < node.children.length; childIndex += 1) {
          const right = encodeNode(node.children[childIndex]);
          const target = entry.nodeTextures[textureIndex++];
          const finalChild = childIndex === node.children.length - 1;
          const values = new Float32Array([
            gpuMaskOperatorCode(node.expression.operator),
            result.opacity,
            right.opacity,
            finalChild && node.expression.inverted ? 1 : 0,
          ]);
          const parameterBuffer = this.createStorageBuffer(values);
          parameterBuffers.push(parameterBuffer);
          this.device.queue.writeBuffer(parameterBuffer, 0, values);
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.combine,
            this.createMaskBindGroup(result.texture, parameterBuffer, right.texture),
            target,
          );
          result = { texture: target, opacity: 1 };
        }
        return result;
      };
      const result = encodeNode(resolved);
      entry.texture = result.texture;
      entry.influenceIdentity = influenceIdentity;
      this.device.queue.submit([encoder.finish()]);
      parameterBuffers.forEach((buffer) => buffer.destroy());
      this.localMasks.set(key, entry);
      if (!remember) this.retainEditingMask(entry);
      else this.retainLocalMask(entry, longEdge);
      if (this.instrumentationEnabled) {
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({
          kind: "gpu-mask-graph",
          longEdge,
          width: entry.width,
          height: entry.height,
          passCount,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        });
      }
      return entry;
    }

    async loadSceneLuminance(
      sessionId, longEdge, editRevision, geometrySignature, isCurrent = () => true, signal = undefined,
      sourceOverride = null,
    ) {
      const regionIdentity = sourceOverride?.region ? `:region:${JSON.stringify(sourceOverride.region)}` : "";
      const key = `${sessionId}:${longEdge}:${geometrySignature}${regionIdentity}`;
      const cached = this.sceneLuminance.get(key);
      if (cached) return { ...cached, created: false };
      const inflight = this.sceneLuminanceInflight.get(key);
      if (inflight && !inflight.signal?.aborted) return inflight.promise;
      const pending = (async () => {
        const source = sourceOverride || await this.loadProxy(
          sessionId, "hdr", longEdge, geometrySignature, editRevision, "source", { signal, isCurrent },
        );
        if (!source || signal?.aborted || !isCurrent()) return null;
        const width = source.textureWidth || source.width, height = source.textureHeight || source.height;
        const texture = this.createMaskTexture(width, height);
        const params = this.createStorageBuffer(new Float32Array(4));
        this.device.queue.writeBuffer(params, 0, new Float32Array(4));
        const bindGroup = this.createMaskBindGroup(source.texture, params);
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(encoder, this.maskPipelines.sceneLuminance, bindGroup, texture);
        this.device.queue.submit([encoder.finish()]);
        params.destroy();
        const entry = {
          texture,
          width, height, frameWidth: source.width, frameHeight: source.height,
          regionIdentity,
          frameRect: source.region ? [source.region.x/source.width,source.region.y/source.height,
            width/source.width,height/source.height] : null,
          byteSize: width * height * 2,
        };
        this.sceneLuminance.set(key, entry);
        const prefix = `${sessionId}:`;
        const keys = [...this.sceneLuminance.keys()].filter((candidate) => candidate.startsWith(prefix));
        while (keys.length > 2) {
          const staleKey = keys.shift();
          const stale = this.sceneLuminance.get(staleKey);
          this.destroyAfterActiveRenders(() => stale?.texture?.destroy());
          this.sceneLuminance.delete(staleKey);
        }
        return { ...entry, created: true };
      })();
      const record = { promise: pending, signal };
      this.sceneLuminanceInflight.set(key, record);
      try {
        return await pending;
      } finally {
        if (this.sceneLuminanceInflight.get(key) === record) this.sceneLuminanceInflight.delete(key);
      }
    }

    async loadGpuLumaMask(
      sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true, signal = undefined,
      editingMeasurement = false,
      sourceOverride = null,
    ) {
      const startedAt = performance.now();
      const scene = await this.loadSceneLuminance(
        sessionId, longEdge, editRevision, geometrySignature, isCurrent, signal, sourceOverride,
      );
      if (!scene || signal?.aborted || !isCurrent()) return null;
      const baseSignature = gpuLumaBaseIdentity(local.mask);
      // Different locals may share range stops but have different feathers.
      // One mutable refinement used to be overwritten for each local on every
      // frame; cache each immutable refinement independently.
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-luma:${baseSignature}${scene.regionIdentity || ""}`
        + `:refinement:${Number(local.mask.leaf.mask_feather)||0}:${Boolean(local.mask.inverted)}`;
      let entry = this.localMasks.get(key);
      let baseRegenerated = false;
      if (!entry) {
        const baseTexture = this.createMaskTexture(scene.width, scene.height);
        const qualifyValues = buildGpuLumaQualificationParams(local.mask);
        const qualifyBuffer = this.createStorageBuffer(qualifyValues);
        this.device.queue.writeBuffer(qualifyBuffer, 0, qualifyValues);
        entry = {
          kind: scene.regionIdentity ? "gpu-luma-region" : "gpu-luma",
          texture: baseTexture,
          baseTexture,
          horizontalTexture: null,
          refinedTexture: null,
          qualifyBuffer,
          horizontalBuffer: null,
          verticalBuffer: null,
          width: scene.width,
          height: scene.height,
          frameRect: scene.frameRect,
          byteSize: scene.width * scene.height * 2 + 16,
          refinementIdentity: null,
        };
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(
          encoder,
          this.maskPipelines.qualify,
          this.createMaskBindGroup(scene.texture, qualifyBuffer),
          baseTexture,
        );
        this.device.queue.submit([encoder.finish()]);
        this.localMasks.set(key, entry);
        baseRegenerated = true;
      } else {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
      }

      const leaf = local.mask.leaf;
      const feather = Math.min(0.05, Math.max(0, Number(leaf.mask_feather) || 0));
      const inverted = Boolean(local.mask.inverted);
      const referenceScale = Math.max(0.001, Number(this.featherReferenceScale?.(geometrySignature)) || 1);
      const refinementIdentity = `${feather}:${inverted}:${referenceScale}`;
      let refinementRan = false;
      if (entry.refinementIdentity !== refinementIdentity) {
        const plan = lumaFeatherPlan(feather, scene.frameWidth, scene.frameHeight, referenceScale);
        if (plan.sigma < 0.25 && !inverted) {
          entry.texture = entry.baseTexture;
        } else {
          this.refineLumaMask(entry, plan, inverted, !scene.frameRect || scene.frameRect[0] === 0
            || scene.frameRect[1] === 0 || scene.frameRect[0] + scene.frameRect[2] >= 1
            || scene.frameRect[1] + scene.frameRect[3] >= 1);
          refinementRan = true;
        }
        entry.refinementIdentity = refinementIdentity;
      }
      if (editingMeasurement) this.retainEditingMask(entry);
      else this.retainLocalMask(entry, longEdge);
      if (this.instrumentationEnabled) {
        const event = {
          kind: "gpu-luma",
          longEdge,
          width: entry.width,
          height: entry.height,
          sceneLuminanceCreated: scene.created,
          baseRegenerated,
          refinementRan,
          feather,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        };
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push(event);
        if (this.performanceMetrics.maskEvents.length > 480) this.performanceMetrics.maskEvents.shift();
      }
      return entry;
    }

    /** Feather and invert `entry.baseTexture` into `entry.refinedTexture`.
     * A mask that reaches the frame edge takes export's own boxes there.
     */
    refineLumaMask(entry, plan, inverted, touchesFrameEdge) {
      if (!entry.refinedTexture) {
        entry.refinedTexture = this.createMaskTexture(entry.width, entry.height);
        entry.horizontalBuffer = this.createStorageBuffer(new Float32Array(260));
        entry.verticalBuffer = this.createStorageBuffer(new Float32Array(260));
        entry.byteSize += entry.width * entry.height * 2 + 2080;
      }
      // A full-size intermediate only for a small feather; a large one is
      // blurred at a reduced size.
      if (plan.factor === 1 && !entry.horizontalTexture) {
        entry.horizontalTexture = this.createMaskTexture(entry.width, entry.height);
        entry.byteSize += entry.width * entry.height * 2;
      }
      const encoder = this.device.createCommandEncoder();
      if (touchesFrameEdge && plan.sigma >= .25) {
        this.encodeExactLumaBoxes(encoder, entry, plan, inverted);
      } else if (plan.factor === 1) {
        this.device.queue.writeBuffer(entry.horizontalBuffer, 0, lumaBlurParams(plan,0,false));
        this.device.queue.writeBuffer(entry.verticalBuffer, 0, lumaBlurParams(plan,1,inverted));
        this.encodeMaskPass(encoder, this.maskPipelines.refine,
          this.createMaskBindGroup(entry.baseTexture, entry.horizontalBuffer), entry.horizontalTexture);
        this.encodeMaskPass(encoder, this.maskPipelines.refine,
          this.createMaskBindGroup(entry.horizontalTexture, entry.verticalBuffer), entry.refinedTexture);
      } else {
        const reduced = this.lumaFeatherScratch(entry, plan.factor);
        const values = [
          [plan.factor, 0, 0, 0],
          [plan.factor, 1, 0, 0],
          lumaBlurParams(plan,0,false),
          lumaBlurParams(plan,1,false),
          [plan.factor, inverted ? 1 : 0, 0, 0],
        ];
        values.forEach((value, index) => this.device.queue.writeBuffer(reduced.buffers[index], 0, new Float32Array(value)));
        // Area-average across, then down (the first pass writes into the
        // full-width scratch texture), blur at the reduced size, and
        // interpolate back to the mask's own size.
        this.encodeMaskPass(encoder, this.maskPipelines.downsample,
          this.createMaskBindGroup(entry.baseTexture, reduced.buffers[0]), reduced.narrow);
        this.encodeMaskPass(encoder, this.maskPipelines.downsample,
          this.createMaskBindGroup(reduced.narrow, reduced.buffers[1]), reduced.first);
        this.encodeMaskPass(encoder, this.maskPipelines.refine,
          this.createMaskBindGroup(reduced.first, reduced.buffers[2]), reduced.second);
        this.encodeMaskPass(encoder, this.maskPipelines.refine,
          this.createMaskBindGroup(reduced.second, reduced.buffers[3]), reduced.first);
        this.encodeMaskPass(encoder, this.maskPipelines.upsample,
          this.createMaskBindGroup(reduced.first, reduced.buffers[4]), entry.refinedTexture);
      }
      this.device.queue.submit([encoder.finish()]);
      if(entry.exactFeatherScratch){
        const scratch=entry.exactFeatherScratch;
        this.destroyAfterActiveRenders(()=>{
          if(entry.exactFeatherScratch!==scratch)return;
          scratch.textures.forEach(texture=>texture.destroy());scratch.prefix.destroy();
          scratch.buffers.forEach(buffer=>buffer.destroy());entry.exactFeatherScratch=null;
          entry.byteSize-=entry.width*entry.height*12+12*16;
          this.syncGpuCacheBytes(entry);
        });
      }
      entry.texture = entry.refinedTexture;
    }

    /**
     * Scratch textures for a large luma feather, kept per mask entry and
     * rebuilt only when the reduction factor changes.
     */
    encodeExactLumaBoxes(encoder, entry, plan, inverted) {
      const device = this.device;
      if (this.lumaBoxDevice !== device) {
        const module = device.createShaderModule({code: `
          @group(0) @binding(0) var source: texture_2d<f32>;
          @group(0) @binding(1) var<storage,read_write> prefix: array<f32>;
          @group(0) @binding(2) var<storage,read> params: array<f32>;
          @group(0) @binding(3) var output: texture_storage_2d<r32float,write>;
          var<workgroup> scan: array<f32,128>;
          var<workgroup> carry: f32;
          @compute @workgroup_size(128) fn sumRows(
            @builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
            let size=textureDimensions(source); let vertical=params[0]>.5;
            let length=select(size.x,size.y,vertical); let row=group.x;
            if(lane==0u){carry=0.0;} workgroupBarrier();
            for(var start=0u;start<length;start+=128u){
              let position=start+lane; var value=0.0;
              if(position<length){value=textureLoad(source,vec2i(select(vec2u(position,row),vec2u(row,position),vertical)),0).r;}
              scan[lane]=value; workgroupBarrier();
              for(var offset=1u;offset<128u;offset*=2u){
                var previous=0.0; if(lane>=offset){previous=scan[lane-offset];}
                workgroupBarrier(); scan[lane]+=previous; workgroupBarrier();
              }
              if(position<length){prefix[row*length+position]=carry+scan[lane];}
              workgroupBarrier(); if(lane==0u){carry+=scan[127];} workgroupBarrier();
            }
          }
          @compute @workgroup_size(8,8) fn box(@builtin(global_invocation_id) id: vec3u){
            let size=textureDimensions(source); if(any(id.xy>=size)){return;}
            let vertical=params[0]>.5; let length=i32(select(size.x,size.y,vertical));
            let position=i32(select(id.x,id.y,vertical)); let row=select(id.y,id.x,vertical);
            let radius=i32(params[1]); let left=max(0,position-radius); let right=min(length-1,position+radius);
            var total=prefix[row*u32(length)+u32(right)];
            if(left>0){total-=prefix[row*u32(length)+u32(left-1)];}
            let first=vec2i(select(vec2u(0,row),vec2u(row,0),vertical));
            let last=vec2i(select(vec2u(u32(length-1),row),vec2u(row,u32(length-1)),vertical));
            total+=f32(max(0,radius-position))*textureLoad(source,first,0).r;
            total+=f32(max(0,position+radius-length+1))*textureLoad(source,last,0).r;
            textureStore(output,vec2i(id.xy),vec4f(clamp(total/f32(2*radius+1),0.0,1.0)));
          }`});
        this.lumaBoxPipelines = ['sumRows','box'].map(entryPoint => device.createComputePipeline({
          layout:'auto',compute:{module,entryPoint}}));
        this.lumaBoxDevice = device;
      }
      if (!entry.exactFeatherScratch) {
        const bytes=entry.width*entry.height*4;
        const textures=[0,1].map(()=>device.createTexture({size:[entry.width,entry.height],format:'r32float',
          usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}));
        const prefix=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE});
        const buffers=Array.from({length:12},()=>this.createStorageBuffer(new Float32Array(4)));
        entry.exactFeatherScratch={textures,prefix,buffers};
        entry.byteSize+=bytes*3+12*16;
        this.syncGpuCacheBytes(entry);
      }
      const scratch=entry.exactFeatherScratch;
      let source=entry.baseTexture,index=0;
      for(const axis of [0,1])for(const radius of lumaBoxRadii(plan.sigma)){
        const target=scratch.textures[index%2],buffer=scratch.buffers[index];
        device.queue.writeBuffer(buffer,0,new Float32Array([axis,radius,0,0]));
        for(let stage=0;stage<2;stage++){
          const pipeline=this.lumaBoxPipelines[stage];
          const entries=[{binding:0,resource:source.createView()},
            {binding:1,resource:{buffer:scratch.prefix}},{binding:2,resource:{buffer}}];
          if(stage)entries.push({binding:3,resource:target.createView()});
          const pass=encoder.beginComputePass();pass.setPipeline(pipeline);
          pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries}));
          if(stage)pass.dispatchWorkgroups(Math.ceil(entry.width/8),Math.ceil(entry.height/8));
          else pass.dispatchWorkgroups(axis?entry.width:entry.height);
          pass.end();
        }
        source=target;index++;
      }
      device.queue.writeBuffer(entry.verticalBuffer,0,new Float32Array([0,0,0,inverted?1:0]));
      this.encodeMaskPass(encoder,this.maskPipelines.refine,
        this.createMaskBindGroup(source,entry.verticalBuffer),entry.refinedTexture);
    }

    lumaFeatherScratch(entry, factor) {
      if (entry.featherScratch?.factor === factor) return entry.featherScratch;
      this.releaseLumaFeatherScratch(entry);
      const width = Math.ceil(entry.width / factor);
      const height = Math.ceil(entry.height / factor);
      const scratch = {
        factor,
        narrow: this.createMaskTexture(width, entry.height),
        first: this.createMaskTexture(width, height),
        second: this.createMaskTexture(width, height),
        buffers: [4,4,260,260,4].map(length => this.createStorageBuffer(new Float32Array(length))),
        byteSize: (width * entry.height + width * height * 2) * 2 + 48 + 2080,
      };
      entry.featherScratch = scratch;
      entry.byteSize += scratch.byteSize;
      this.syncGpuCacheBytes(entry);
      return scratch;
    }

    releaseLumaFeatherScratch(entry) {
      const scratch = entry.featherScratch;
      if (!scratch) return;
      entry.featherScratch = null;
      entry.byteSize -= scratch.byteSize;
      this.syncGpuCacheBytes(entry);
      this.destroyAfterActiveRenders(() => {
        [scratch.narrow, scratch.first, scratch.second].forEach((texture) => texture.destroy());
        scratch.buffers.forEach((buffer) => buffer.destroy());
      });
    }

    createMaskTexture(width, height) {
      return this.device.createTexture({
        size: { width, height },
        format: "r16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    createMaskBindGroup(texture, parameterBuffer, operandTexture = texture) {
      return this.device.createBindGroup({
        layout: this.maskBindGroupLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: parameterBuffer } },
          { binding: 2, resource: operandTexture.createView() },
        ],
      });
    }

    encodeMaskPass(encoder, pipeline, bindGroup, targetTexture) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }

    markResidentMaskFrame(sessionId, locals, longEdge, geometrySignature, region = null) {
      // Mark every resident input before the first retain can trim the cache.
      // A frame may legitimately need more than the idle mask budget; loading
      // its first local must not evict the locals it is about to read next.
      const mark = (key) => {
        const entry = this.localMasks.get(key);
        if (entry && !entry.destroyed) entry.lastUseSerial = this.maskUseSerial;
      };
      const prefix = `${sessionId}:${longEdge}:${geometrySignature}:`;
      const regionIdentity = region ? `:region:${JSON.stringify(region)}` : "";
      const visit = (expression) => {
        if (expression?.operator === "leaf") {
          mark(isGpuLumaMask(expression)
            ? `${prefix}gpu-luma:${gpuLumaBaseIdentity(expression)}${regionIdentity}`
            : `${prefix}cpu-spatial-leaf:${gpuMaskIdentity(expression)}`);
        } else for (const child of expression?.children || []) visit(child);
      };
      for (const local of locals) {
        visit(local.mask);
        if (local.mask?.operator !== "leaf") {
          mark(`${sessionId}:${local.id}:${longEdge}:${geometrySignature}:gpu-mask-graph:${gpuMaskGraphLayoutIdentity(local.mask)}${regionIdentity}`);
        }
      }
    }

    retainLocalMask(entry, longEdge) {
      this.syncGpuCacheBytes(entry);
      entry.editingMeasurement = false;
      entry.magnifiedMask = longEdge > 1600;
      entry.lastUseSerial = this.maskUseSerial;
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024, false, entry.magnifiedMask);
    }

    retainEditingMask(entry) {
      this.syncGpuCacheBytes(entry);
      entry.editingMeasurement = true;
      entry.lastUseSerial = this.maskUseSerial;
      this.trimLocalMaskCache(96 * 1024 * 1024, true);
    }

    /**
     * Evict least-recently-used masks down to `budget`, except the ones the
     * current render uses, which may exceed it together.
     */
    trimLocalMaskCache(budget, editingMeasurement = false, magnifiedMask = false) {
      // Magnified masks must not spend the Fit bitmap budget. Otherwise the
      // first zoom evicts dozens of small masks and the return to Fit fetches
      // them all again, even though their identities have not changed.
      const entries = [...this.localMasks.entries()].filter(([,entry]) => Boolean(entry.editingMeasurement) === editingMeasurement
        && (editingMeasurement || Boolean(entry.magnifiedMask) === magnifiedMask));
      let total = entries.reduce((sum, [,entry]) => sum + entry.byteSize, 0);
      for (const [key, entry] of entries) {
        if (total <= budget) break;
        if (entry.lastUseSerial === this.maskUseSerial) continue;
        this.destroyAfterActiveRenders(() => this.destroyLocalMaskEntry(entry));
        this.localMasks.delete(key);
        total -= entry.byteSize;
      }
    }

    destroyLocalMaskEntry(entry) {
      if (!entry || entry.destroyed) return;
      entry.destroyed = true;
      const textures = new Set([
        entry.texture,
        entry.baseTexture,
        entry.horizontalTexture,
        entry.refinedTexture,
        ...(entry.nodeTextures || []),
      ].filter(Boolean));
      textures.forEach((texture) => texture.destroy());
      entry.qualifyBuffer?.destroy();
      entry.horizontalBuffer?.destroy();
      entry.verticalBuffer?.destroy();
      if (entry.featherScratch) {
        [entry.featherScratch.narrow, entry.featherScratch.first, entry.featherScratch.second].forEach((texture) => texture.destroy());
        entry.featherScratch.buffers.forEach((buffer) => buffer.destroy());
        entry.featherScratch = null;
      }
      if (entry.exactFeatherScratch) {
        entry.exactFeatherScratch.textures.forEach(texture=>texture.destroy());
        entry.exactFeatherScratch.prefix.destroy();
        entry.exactFeatherScratch.buffers.forEach(buffer=>buffer.destroy());
        entry.exactFeatherScratch=null;
      }
    }

    /**
     * Textures for a Clarity map, grown on demand and kept between renders.
     * `frame` holds the tiled path's whole-frame map (reduced, scratch,
     * blurred); `work` is scratch for a map built and consumed within one
     * render. They are small: a map texel covers a block of the picture.
     */
    clarityMapTextures(key, width, height) {
      if (!this.clarityMaps) this.clarityMaps = new Map();
      const existing = this.clarityMaps.get(key);
      if (existing && existing.width >= width && existing.height >= height) return existing;
      const grownWidth = Math.max(1, width, existing?.width || 0);
      const grownHeight = Math.max(1, height, existing?.height || 0);
      if (existing) this.destroyAfterActiveRenders(() => existing.textures.forEach((texture) => texture.destroy()));
      const make = () => this.device.createTexture({
        size: { width: grownWidth, height: grownHeight },
        format: CLARITY_MAP_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const entry = { width: grownWidth, height: grownHeight, textures: [make(), make(), make()] };
      this.clarityMaps.set(key, entry);
      this.recordAllocation("clarity-map", grownWidth * grownHeight * 4 * 3, { key, width: grownWidth, height: grownHeight });
      return entry;
    }

    releaseClarityMaps() {
      const maps = this.clarityMaps;
      this.clarityMaps = new Map();
      this.clarityFrameMap = null;
      if (maps?.size) {
        this.destroyAfterActiveRenders(() => maps.forEach((entry) => entry.textures.forEach((texture) => texture.destroy())));
      }
    }

    /**
     * Decide what the tiled path's whole-frame Clarity map still needs.
     *
     * The map belongs to the picture as it enters Detail, so it is kept for as
     * long as that picture's identity holds; Clarity's own controls never
     * invalidate it. It remembers which of its texels have been filled, so a
     * viewport pass fills only the part its tiles read -- their rectangles
     * plus the map's reach -- and a later pass fills the rest as it needs it.
     * Missing texels are filled in chunks that fit the tile graph's textures,
     * each a region of the picture that only the base grade runs over.
     * `alignment` is Denoise's wavelet grid, which a reconstructed region
     * has to start on.
     */
    planClarityFrameMap({ proxy, params, identity, tiles, workWidth, workHeight, alignment = 1, analysis = false }) {
      const plan = writeClarityPlan(new Float32Array(PARAM_COUNT), proxy.width, proxy.height, params[151]);
      const extents = clarityMapExtents(plan, 0, 0, proxy.width, proxy.height);
      // The frame keeps its base map, which every radius shares; only the
      // finished map depends on the radius.
      const scale = plan.baseScale;
      const columns = extents.baseWidth;
      const rows = extents.baseHeight;
      const entry = this.clarityMapTextures(analysis ? "analysis-frame" : "frame", columns, rows);
      const reducedKey = `${identity}|s${scale}|${proxy.width}x${proxy.height}`;
      let state = analysis ? this.analysisClarityFrameMap : this.clarityFrameMap;
      if (!state || state.reducedKey !== reducedKey || state.entry !== entry) {
        state = { reducedKey, entry, blurKey: null, covered: new Uint8Array(columns * rows) };
        if (analysis) this.analysisClarityFrameMap = state;
        else this.clarityFrameMap = state;
      }
      const bounds = tiles.reduce((box, tile) => ({
        x0: Math.min(box.x0, tile.rect.x),
        y0: Math.min(box.y0, tile.rect.y),
        x1: Math.max(box.x1, tile.rect.x + tile.rect.width),
        y1: Math.max(box.y1, tile.rect.y + tile.rect.height),
      }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      // Whole blocks of the finished map, in base texels.
      const ratio = plan.scale / scale;
      const needed = {
        x0: Math.floor(Math.max(0, bounds.x0 - plan.reach) / plan.scale) * ratio,
        y0: Math.floor(Math.max(0, bounds.y0 - plan.reach) / plan.scale) * ratio,
        x1: Math.min(columns, Math.ceil(Math.min(proxy.width, bounds.x1 + plan.reach) / plan.scale) * ratio),
        y1: Math.min(rows, Math.ceil(Math.min(proxy.height, bounds.y1 + plan.reach) / plan.scale) * ratio),
      };
      const missing = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (let y = needed.y0; y < needed.y1; y += 1) {
        for (let x = needed.x0; x < needed.x1; x += 1) {
          if (state.covered[y * columns + x]) continue;
          missing.x0 = Math.min(missing.x0, x);
          missing.y0 = Math.min(missing.y0, y);
          missing.x1 = Math.max(missing.x1, x + 1);
          missing.y1 = Math.max(missing.y1, y + 1);
        }
      }
      const chunks = [];
      if (missing.x1 > missing.x0) {
        // A chunk's region is its blocks widened to the alignment grid, which
        // adds under one alignment step at each end.
        const pad = 2 * Math.max(0, alignment - 1);
        const stepX = Math.max(1, Math.floor((workWidth - pad) / scale));
        const stepY = Math.max(1, Math.floor((workHeight - pad) / scale));
        for (let ty = missing.y0; ty < missing.y1; ty += stepY) {
          for (let tx = missing.x0; tx < missing.x1; tx += stepX) {
            const texels = {
              x: tx, y: ty,
              width: Math.min(stepX, missing.x1 - tx),
              height: Math.min(stepY, missing.y1 - ty),
            };
            const x0 = Math.floor((texels.x * scale) / alignment) * alignment;
            const y0 = Math.floor((texels.y * scale) / alignment) * alignment;
            const x1 = Math.min(proxy.width, Math.ceil(Math.min(proxy.width, (texels.x + texels.width) * scale) / alignment) * alignment);
            const y1 = Math.min(proxy.height, Math.ceil(Math.min(proxy.height, (texels.y + texels.height) * scale) / alignment) * alignment);
            chunks.push({ texels, region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
          }
        }
      }
      const blurKey = `${reducedKey}|${plan.scale}|${plan.denseSigma}|${plan.taps}`;
      return {
        plan, extents, state, chunks, columns, rows, blurKey,
        textures: entry.textures,
        reblur: chunks.length > 0 || state.blurKey !== blurKey,
        // Recorded as filled only once the work that fills them is encoded;
        // a generation that stops early discards the whole map instead.
        commit: () => {
          chunks.forEach(({ texels }) => {
            for (let y = texels.y; y < texels.y + texels.height; y += 1) {
              state.covered.fill(1, y * columns + texels.x, y * columns + texels.x + texels.width);
            }
          });
          state.blurKey = blurKey;
        },
      };
    }

    /**
     * Record one Clarity map pass into `encoder`. `rect` is the region of the
     * target to write, in map texels; `load` keeps what the target already
     * holds outside it, which is how the tiled pre-pass fills the frame map a
     * piece at a time.
     */
    encodeClarityPass(encoder, targetView, pipeline, bindGroup, rect, load = false) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: load ? "load" : "clear",
          storeOp: "store",
        }],
      });
      pass.setViewport(rect.x, rect.y, rect.width, rect.height, 0, 1);
      pass.setScissorRect(rect.x, rect.y, rect.width, rect.height);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }

    /**
     * From a base map in `textures[0]` to the finished map in `textures[1]`:
     * average up to the radius's block size (when it is coarser than the
     * base), blur across, blur down. `plan` is `clarityMapExtents`' answer.
     * `bind(view)` makes the bind group a pass reads `view` through, with the
     * parameter buffer whose Clarity plan this map follows.
     */
    encodeClarityLevels(encoder, pipelines, bind, textures, plan) {
      const [base, finished, scratch] = textures;
      const rect = { x: 0, y: 0, width: plan.width, height: plan.height };
      let source = base;
      if (plan.scale > plan.baseScale) {
        this.encodeClarityPass(encoder, finished.createView(), pipelines.clarityLevel, bind(base.createView()), rect);
        source = finished;
      }
      this.encodeClarityPass(encoder, scratch.createView(), pipelines.clarityBlurHorizontal, bind(source.createView()), rect);
      this.encodeClarityPass(encoder, finished.createView(), pipelines.clarityBlurVertical, bind(scratch.createView()), rect);
      return finished;
    }

    /** A whole map in one go, from a picture covering the map's region. */
    encodeClarityMap(encoder, pipelines, bind, sourceView, textures, plan) {
      this.encodeClarityPass(encoder, textures[0].createView(), pipelines.clarityReduce, bind(sourceView), {
        x: 0, y: 0, width: plan.baseWidth, height: plan.baseHeight,
      });
      return this.encodeClarityLevels(encoder, pipelines, bind, textures, plan);
    }

    /** Keep a finished Clarity map past the render that made it. */
    captureClarityMap(encoder, finished, extents) {
      const texture = this.device.createTexture({
        size: { width: extents.width, height: extents.height },
        format: CLARITY_MAP_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      encoder.copyTextureToTexture({ texture: finished }, { texture },
        { width: extents.width, height: extents.height, depthOrArrayLayers: 1 });
      return { texture, scale: extents.scale };
    }

    /**
     * One measurement patch's Clarity map, resampled from a kept map of the
     * reduced frame onto the blocks this frame's own map would use.
     * `writeSurroundMapOrigin` tells the patch's parameters where it starts.
     */
    encodeSurroundClarityMap(encoder, pipelines, surround, kept, radiusPercent, proxy, haloRect) {
      const values = new Float32Array(PARAM_COUNT);
      const plan = writeClarityPlan(values, proxy.width, proxy.height, radiusPercent);
      const rect = surroundMapRect(haloRect, plan.scale);
      values[CLARITY_MAP_ORIGIN_X_INDEX] = rect.x;
      values[CLARITY_MAP_ORIGIN_Y_INDEX] = rect.y;
      values[CLARITY_BASE_SCALE_INDEX] = kept.scale;
      values[TILE_ORIGIN_X_INDEX] = surround.frameWidth;
      values[TILE_ORIGIN_Y_INDEX] = surround.frameHeight;
      values[164] = proxy.width;
      values[165] = proxy.height;
      const buffer = this.createStorageBuffer(values);
      this.device.queue.writeBuffer(buffer, 0, values);
      const texture = this.device.createTexture({
        size: { width: rect.width, height: rect.height },
        format: CLARITY_MAP_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const view = kept.texture.createView();
      this.encodeClarityPass(encoder, texture.createView(), pipelines.claritySurround,
        this.bindGraphResources(view, view, { buffer }, view), { x: 0, y: 0, width: rect.width, height: rect.height });
      this.destroyAfterActiveRenders(() => { texture.destroy(); buffer.destroy(); });
      return texture;
    }

    releaseClaritySurround(surround) {
      if (!surround) return;
      const textures = [surround.global, ...surround.locals.values()].filter(Boolean).map((kept) => kept.texture);
      if (textures.length) this.destroyAfterActiveRenders(() => textures.forEach((texture) => texture.destroy()));
    }

    /**
     * Clarity's brightness maps for an editing measurement, from one reduced
     * render of the whole frame.
     *
     * A patch that builds a map itself needs the map's whole reach around it
     * at full size: more than the editing budget from a 0.6% radius up on a
     * 42 MP frame, and more than the frame itself at the widest. The map is a
     * wide blur of block averages, so the reduced picture gives nearly the
     * same one for a small fraction of the pixels. Export and Proof build
     * theirs at full size.
     */
    async measurementClaritySurround(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, options) {
      const isCurrent = options.isCurrent || (() => true);
      const key = JSON.stringify([sessionId, lane, revision, adjustments.shared?.geometry || {}, adjustments[lane], locals,
        white, options.identity || "source", this.highlightSourceToken({})]);
      const kept = this.claritySurround;
      if (kept?.key === key && kept.generation === this.resourceGeneration) return kept;
      // The Peak readout and the highlight anchor are measured side by side
      // for one edit. They share one render: two on the same canvas would
      // each supersede the other's source load.
      const flight = this.claritySurroundInflight;
      if (flight?.key === key && flight.generation === this.resourceGeneration) {
        flight.current.push(isCurrent);
        return flight.promise;
      }
      const current = [isCurrent];
      const anyCurrent = () => current.some((check) => check());
      const promise = (async () => {
        this.editingAnalysisCanvas ||= document.createElement("canvas");
        // Output highlights follow Detail, so the map does not depend on them,
        // and an HDR render with them on would wait for the anchor this measures.
        const reduced = structuredClone(adjustments);
        if (lane === "hdr") reduced.hdr.highlight_section_enabled = false;
        const surround = { key, generation: this.resourceGeneration, frameWidth: 0, frameHeight: 0, global: null, locals: new Map() };
        const rendered = await this.renderTo(this.editingAnalysisCanvas, sessionId, lane, reduced, curveSampler, 1600, locals,
          revision, null, white, sourceSize, { isCurrent: anyCurrent, measureOnly: true, captureClarity: surround });
        if (!rendered?.width || !surround.frameWidth || !anyCurrent() || surround.generation !== this.resourceGeneration) {
          this.releaseClaritySurround(surround);
          return null;
        }
        this.releaseClaritySurround(this.claritySurround);
        this.claritySurround = surround;
        return surround;
      })();
      const record = { key, generation: this.resourceGeneration, current, promise };
      this.claritySurroundInflight = record;
      try {
        return await promise;
      } finally {
        if (this.claritySurroundInflight === record) this.claritySurroundInflight = null;
      }
    }

    /**
     * A luminance leaf for a measurement patch, qualified from the patch's own
     * pixels. The reduced bitmap averages a small highlight into its
     * surroundings, which can place a specular inside a range it lies above;
     * the local then grades the very pixels the peak is read from. Nothing is
     * kept: a patch is measured once.
     */
    analysisLumaMask(local, proxy, geometrySignature) {
      if (!proxy?.region || !lumaSceneSource(proxy.lane, proxy.sourceIdentity, proxy.workingSpace)) return null;
      const plan = analysisLumaPlan(local.mask, proxy.width, proxy.height,
        Math.max(0.001, Number(this.featherReferenceScale?.(geometrySignature)) || 1));
      if (!plan) return null;
      const width = proxy.textureWidth || proxy.width, height = proxy.textureHeight || proxy.height;
      const frameRect = [proxy.region.x / proxy.width, proxy.region.y / proxy.height, width / proxy.width, height / proxy.height];
      const luminance = this.createMaskTexture(width, height);
      const luminanceBuffer = this.createStorageBuffer(new Float32Array(4));
      this.device.queue.writeBuffer(luminanceBuffer, 0, new Float32Array(4));
      const qualifyValues = buildGpuLumaQualificationParams(local.mask);
      const qualifyBuffer = this.createStorageBuffer(qualifyValues);
      this.device.queue.writeBuffer(qualifyBuffer, 0, qualifyValues);
      const baseTexture = this.createMaskTexture(width, height);
      const entry = {
        kind: "gpu-luma-analysis", texture: baseTexture, baseTexture, horizontalTexture: null, refinedTexture: null,
        qualifyBuffer, horizontalBuffer: null, verticalBuffer: null, width, height, frameRect, wholeFrame: true,
        byteSize: width * height * 2 + 16,
      };
      const encoder = this.device.createCommandEncoder();
      this.encodeMaskPass(encoder, this.maskPipelines.sceneLuminance,
        this.createMaskBindGroup(proxy.texture, luminanceBuffer), luminance);
      this.encodeMaskPass(encoder, this.maskPipelines.qualify, this.createMaskBindGroup(luminance, qualifyBuffer), baseTexture);
      this.device.queue.submit([encoder.finish()]);
      const inverted = Boolean(local.mask.inverted);
      if (plan.sigma >= 0.25 || inverted) {
        this.refineLumaMask(entry, plan, inverted, frameRect[0] === 0 || frameRect[1] === 0
          || frameRect[0] + frameRect[2] >= 1 || frameRect[1] + frameRect[3] >= 1);
      }
      this.destroyAfterActiveRenders(() => {
        this.destroyLocalMaskEntry(entry);
        luminance.destroy();
        luminanceBuffer.destroy();
      });
      return entry;
    }

    localParamBuffer(local, lane, sourcePixelScale, frameWidth = 0, frameHeight = 0, maskEntry = null) {
      const key = `${local.id}:${lane}`;
      let buffer = this.localParamBuffers.get(key);
      const values = buildLocalParams(local, lane, sourcePixelScale,this.localCurveOffsets?.get(local.id) || 0);
      if (frameWidth > 0 && frameHeight > 0) {
        writeClarityPlan(values, frameWidth, frameHeight, values[16]);
        values[164] = frameWidth;
        values[165] = frameHeight;
        writeMaskRect(values, 0, maskEntry, frameWidth, frameHeight);
      }
      if (!buffer) {
        buffer = this.createStorageBuffer(values);
        this.localParamBuffers.set(key, buffer);
      }
      const previous = this.localParamValues.get(key);
      if (!previous || !floatArraysEqual(previous, values)) {
        this.device.queue.writeBuffer(buffer, 0, values);
        this.localParamValues.set(key, values);
      }
      return buffer;
    }
  }

  function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) return sign * fraction * 5.960464477539063e-8;
    if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
  }

  function floatArraysEqual(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
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
    return ["luma_curve", "red_curve", "green_curve", "blue_curve"].every(name=>curvePointsNeutral(branch?.[name]));
  }

  function curvePointsNeutral(points) {
    return Array.isArray(points) && points.length >= 2
      && points.every(point=>Array.isArray(point) && Math.abs(Number(point[0])-Number(point[1]))<0.000001);
  }

  function toneEqualizerNeutral(branch) {
    const nodes = branch?.tone_equalizer_nodes;
    return !Array.isArray(nodes) || nodes.every((node) => Math.abs(Number(node?.adjustment_ev) || 0) < 0.000001);
  }

  // The tone stages the highlight reduction applies before it takes the peak
  // (peakTone in the reduction shader), for one neutral value. Carrying a
  // measurement across a drag runs it back through the settings it was taken
  // with and forward through the current ones.
  function highlightToneSettings(params) {
    return { exposure: params[2] || 0, lift: params[4] || 0, contrast: params[8] || 0, pivot: params[9] || 0.1845 };
  }

  function applyHighlightTone(value, tone) {
    let rgb = value * Math.pow(2, tone.exposure);
    if (tone.lift !== 0) rgb *= 1 + Math.min(tone.lift * (1 - Math.min(1, Math.max(0, rgb))), 1);
    if (tone.contrast !== 0 && rgb > 0.00000001) {
      const pivot = Math.max(tone.pivot, 0.000001);
      const stops = Math.log2(rgb / pivot);
      rgb = pivot * Math.pow(2, Math.min(32, Math.max(-32, stops * Math.pow(2, tone.contrast))));
    }
    return rgb;
  }

  function invertHighlightTone(value, tone) {
    // Monotonic for every legal setting, so bisect in log space.
    let low = -40;
    let high = 40;
    for (let step = 0; step < 80; step += 1) {
      const middle = (low + high) / 2;
      if (applyHighlightTone(2 ** middle, tone) < value) low = middle; else high = middle;
    }
    return 2 ** ((low + high) / 2);
  }

  function toneAdjustedHighlightPeakLinear(branch, toneEnabled, referenceWhiteNits) {
    const authoredPeak = branch.highlight_compression_peak_measurement === "manual"
      ? branch.highlight_compression_manual_peak_nits
      : branch.highlight_compression_source_peak_nits;
    let peak = Math.max(1, Number(authoredPeak) || 1000) * 0.18 / referenceWhiteNits;
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

  function buildParams(lane, adjustments, workingSpace, hdrSurface, referenceWhiteNits = 203, sourcePixelScale = 1) {
    const params = new Float32Array(PARAM_COUNT);
    const projectReferenceWhite = Number(referenceWhiteNits) === 100 ? 100 : 203;
    const branch = adjustments[lane];
    const colorSource = branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const highlightEnabled = branch.highlight_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false;
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = highlightEnabled ? branch.highlight_compression_softness || 0 : 0;
    params[4] = toneEnabled ? (lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0) : 0;
    params[5] = primariesEnabled ? branch.lift || 0 : 0;
    params[6] = primariesEnabled ? branch.gamma || 0 : 0;
    params[7] = primariesEnabled ? branch.gain || 0 : 0;
    params[8] = toneEnabled ? branch.contrast || 0 : 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = colorActive ? colorSource.white_balance_kelvin || 6500 : 6500;
    params[11] = colorActive ? colorSource.tint || 0 : 0;
    params[15] = branch.curves_section_enabled !== false && !curveSetNeutral(branch) ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The transport limit is absolute; scene-linear scale follows the project.
    params[17] = 10000 * 0.18 / projectReferenceWhite;
    params[18] = branch.tone_equalizer_section_enabled !== false && !toneEqualizerNeutral(branch) ? 1 : 0;
    params[19] = Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5));
    const toneNodes = normalizedToneEqualizerNodes(branch.tone_equalizer_nodes);
    params[20] = toneNodes.length;
    toneNodes.forEach((node, index) => {
      params[21 + index] = node.input_ev;
      params[37 + index] = node.adjustment_ev;
    });
    params[53] = lane === "hdr"
      ? ((branch.highlight_compression_start_nits ?? 400) * 0.18 / projectReferenceWhite)
      : (branch.highlight_compression_start_percent ?? 50) / 100;
    params[54] = branch.lift_pivot ?? -2;
    params[55] = branch.lift_range ?? 4;
    params[56] = branch.gamma_pivot ?? 0;
    params[57] = branch.gamma_range ?? 4.25;
    params[58] = branch.gain_pivot ?? 2;
    params[59] = branch.gain_range ?? 4;
    const colorMatrix = colorActive ? rgbPrimariesAdjustmentMatrix(colorSource) : IDENTITY_3X3;
    colorMatrix.forEach((value, index) => { params[61 + index] = value; });
    params[70] = colorActive ? colorSource.saturation || 0 : 0;
    params[71] = colorActive ? colorSource.vibrance || 0 : 0;
    params[72] = colorActive ? 1 : 0;
    // BW-01 Black & White: on/off and Reds..Magentas / 100 (blackAndWhiteWgsl).
    const blackAndWhiteOn = branch.black_and_white_section_enabled === true;
    const blackAndWhite = branch.black_and_white || {};
    params[BLACK_AND_WHITE_PARAM] = blackAndWhiteOn ? 1 : 0;
    ["reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas"].forEach((name, index) => {
      params[BLACK_AND_WHITE_PARAM + 1 + index] = blackAndWhiteOn ? (Number(blackAndWhite[name]) || 0) / 100 : 0;
    });
    params[73] = lane === "hdr" ? ((branch.highlight_compression_target_nits ?? 1000) * 0.18 / projectReferenceWhite) : 1;
    params[74] = highlightEnabled ? (branch.highlight_compression_mode === "peak_fit" ? 1 : branch.highlight_compression_mode === "soft_ceiling" ? 2 : branch.highlight_compression_mode === "clip" ? 3 : 0) : 0;
    params[75] = lane === "hdr"
      ? toneAdjustedHighlightPeakLinear(branch, toneEnabled, projectReferenceWhite)
      : Math.max(0.01, (branch.highlight_compression_peak_measurement === "manual"
        ? branch.highlight_compression_manual_peak_percent ?? 100
        : branch.highlight_compression_source_peak_percent ?? 100) / 100 * (toneEnabled ? Math.pow(2, branch.exposure || 0) : 1));
    params[138] = projectReferenceWhite;
    params[139] = 203;
    params[76] = Math.min(1, Math.max(0, (branch.highlight_compression_peak_detail ?? 35) / 100));
    params[77] = Math.min(1, Math.max(-1, (branch.highlight_compression_bias ?? 0) / 100)) * 0.6;
    const film = branch.film_look || {};
    const filmEnabled = branch.film_look_section_enabled !== false;
    params[78] = filmEnabled ? 1 : 0;
    params[79] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    params[80] = (film.print_strength || 0) / 100;
    params[81] = (film.print_contrast || 0) / 100;
    params[82] = (film.print_toe || 0) / 100;
    params[83] = (film.print_shoulder || 0) / 100;
    params[84] = (film.color_density || 0) / 100;
    // With Black & White on, Film Look adds no colour back: no per-channel
    // print response, no halation tint, no grain colour
    // (adjustments.py black_and_white_neutral_film_look).
    params[143] = blackAndWhiteOn ? 0 : (film.red_response || 0) / 100;
    params[144] = blackAndWhiteOn ? 0 : (film.green_response || 0) / 100;
    params[145] = blackAndWhiteOn ? 0 : (film.blue_response || 0) / 100;
    params[146] = (film.highlight_desaturation || 0) / 100;
    params[147] = (film.shadow_desaturation || 0) / 100;
    params[85] = film.halation_enabled !== false && ((((film.halation_amount || 0) > 0) && (film.halation_radius || 0) > 0) || film.halation_view_map) ? 1 : 0;
    params[86] = (film.halation_amount || 0) / 100;
    params[87] = (film.halation_sensitivity ?? 75) / 100;
    params[88] = film.halation_radius ?? 0.2;
    params[89] = (film.halation_hue_offset || 0) / 100;
    params[90] = blackAndWhiteOn ? 0 : (film.halation_saturation ?? 75) / 100;
    params[91] = film.halation_view_map ? 1 : 0;
    params[92] = film.bloom_enabled !== false && (film.bloom_radius || 0) > 0 ? 1 : 0;
    params[93] = (film.bloom_amount || 0) / 100;
    params[94] = (film.bloom_sensitivity ?? 80) / 100;
    params[95] = film.bloom_radius ?? 0.5;
    params[96] = (film.bloom_highlight_detail ?? 75) / 100;
    // 97-99: Detail's Softness and Microcontrast, run in the film stage where
    // Film Look's Image Structure ran (NEXT-01 #2). Detail's switch gates
    // them; Look Strength and the Film Look switch do not.
    const structureDetail = branch.detail || {};
    params[97] = branch.detail_section_enabled !== false ? 1 : 0;
    params[98] = (Number(structureDetail.softness) || 0) / 100;
    params[99] = (Number(structureDetail.microcontrast) || 0) / 100;
    params[100] = film.grain_enabled !== false ? 1 : 0;
    params[101] = (film.grain_amount || 0) / 100;
    params[102] = (film.grain_size ?? 50) / 100;
    params[103] = (film.grain_softness ?? 25) / 100;
    params[104] = blackAndWhiteOn ? 0 : (film.grain_chroma || 0) / 100;
    params[105] = (film.grain_shadow_response ?? 100) / 100;
    params[106] = (film.grain_midtone_response ?? 100) / 100;
    params[107] = (film.grain_highlight_response ?? 100) / 100;
    params[108] = (film.film_resolution ?? 100) / 100;
    // f32 holds integers exactly only to 2^24, so the seed travels in two
    // 16-bit halves (109 low, 176 high) and the shader reassembles it.
    const grainSeed = (adjustments.shared?.film_grain_seed ?? 271828) >>> 0;
    params[109] = grainSeed & 0xffff;
    params[GRAIN_SEED_HIGH_INDEX] = grainSeed >>> 16;
    params[GRAIN_FILM_TYPE_INDEX] = film.grain_film_type === "black_and_white" ? 1 : 0;
    const filmGates = {
      "65mm": [52.63, 23.01],
      "35mm": [36, 24],
      super35: [24.89, 18.66],
      super16: [12.52, 7.41],
      "16mm": [10.26, 7.49],
      super8: [5.79, 4.01],
    };
    const gate = film.grain_film_format === "custom"
      ? [Math.min(500, Math.max(1, Number(film.grain_custom_width_mm) || 36)), Math.min(500, Math.max(1, Number(film.grain_custom_height_mm) || 24))]
      : (filmGates[film.grain_film_format] || filmGates["35mm"]);
    params[140] = gate[0];
    params[141] = gate[1];
    params[142] = film.grain_capture_geometry === "horizontal_strip" ? 1
      : film.grain_capture_geometry === "vertical_strip" ? 2 : 0;
    params[156] = filmEnabled ? 1 : 0;
    params[157] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    // Viewer-only diagnostic.
    params[158] = film.grain_view_map ? 1 : 0;
    params[110] = branch.highlight_compression_color_handling === "smooth_rolloff" ? 2
      : branch.highlight_compression_color_handling === "path_to_white" ? 1 : 0;
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
    const detail = branch.detail || {};
    params[148] = branch.detail_section_enabled !== false ? 1 : 0;
    params[149] = (Number(detail.texture_amount) || 0) / 100;
    params[150] = (Number(detail.clarity_amount) || 0) / 125;
    params[151] = Math.min(3, Math.max(0.2, Number(detail.clarity_radius_percent) || 0.75));
    params[152] = Math.max(0, Number(detail.sharpen_amount) || 0) / 100;
    params[153] = Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px) || 0.8));
    params[154] = Math.min(1, Math.max(0, Number(detail.sharpen_threshold) || 0) / 100) * 0.50;
    params[155] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1));
    // Read only by the pinned peak-measurement shader, to tell the SDR lane.
    params[159] = lane === "sdr" ? 1 : 0;
    // Direct renders the whole output, so its tile origin is the origin.
    params[TILE_ORIGIN_X_INDEX] = 0;
    params[TILE_ORIGIN_Y_INDEX] = 0;
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

  function buildCurves(lane, adjustments, curveSampler, sampleCache, cacheNamespace = lane) {
    const branch = adjustments[lane];
    const names = ["luma_curve", "red_curve", "green_curve", "blue_curve"];
    const signatures = names.map((name) => JSON.stringify(branch[name]));
    const packedKey = `${cacheNamespace}:packed`;
    const packedSignature = signatures.join("|");
    const packedCached = sampleCache.get(packedKey);
    if (packedCached?.signature === packedSignature) return packedCached.samples;
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    names.forEach((name, channel) => {
      const signature = signatures[channel];
      const cacheKey = `${cacheNamespace}:${name}`;
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
    sampleCache.set(packedKey, { signature: packedSignature, samples: packed });
    return packed;
  }

  function gpuLocalSupported(grade) {
    return Boolean(grade);
  }

  function activeGpuLocals(lane, localAdjustments) {
    return (Array.isArray(localAdjustments) ? localAdjustments : []).filter((local) =>
      local?.enabled !== false
      && Number(local?.opacity) > 0
      && local?.[`${lane}_grade`]?.enabled !== false);
  }

  function gpuLocalDetailActive(grade) {
    return graphScaleContract().localDetailActive(grade);
  }

  function buildLocalParams(local, lane, sourcePixelScale = 1, curveOffset = 0) {
    const grade = local[`${lane}_grade`];
    const detail = grade.detail || {};
    const values = new Float32Array(PARAM_COUNT);
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
    values[14] = (Number(detail.texture_amount) || 0) / 100;
    values[15] = (Number(detail.clarity_amount) || 0) / 125;
    values[16] = Math.min(3, Math.max(0.2, Number(detail.clarity_radius_percent) || 0.75));
    values[17] = Math.min(2, Math.max(0, (Number(detail.sharpen_amount) || 0) / 100));
    values[18] = Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px) || 0.8));
    values[19] = Math.min(1, Math.max(0, (Number(detail.sharpen_threshold) || 0) / 100)) * 0.5;
    values[20] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1));
    ['luma_curve','red_curve','green_curve','blue_curve'].forEach((name,index)=>{
      if (!curvePointsNeutral(grade[name])) values[21] += 1 << index;
    });
    values[22] = curveOffset;
    const grading = grade.color_grading || {};
    values[111] = 1;
    values[112] = 0.55 + 3.45 * (grading.blending ?? 50) / 100;
    values[113] = (grading.balance || 0) / 50;
    [grading.shadows || {},grading.midtones || {},grading.highlights || {}].forEach((wheel,index)=>{
      values[114+index*3] = wheel.hue || 0;
      values[115+index*3] = (wheel.saturation || 0)/400;
      values[116+index*3] = wheel.luminance_ev || 0;
    });
    return values;
  }

  function softMaskIdentity(sessionId, geometrySignature, maskSignature) {
    return `${sessionId}:${geometrySignature}:${maskSignature}`;
  }

  /**
   * State where a pass's mask texture sits in the frame. A soft mask's small
   * bitmap and a whole-frame mask need it; a tile's own mask texture has one
   * texel per pixel of the pass, which the zero rectangle means.
   */
  function writeMaskRect(values, offset, entry, frameWidth, frameHeight) {
    // A whole-frame mask bound to a tile's pass is placed the same way, at
    // one texel per pixel.
    const stretched = Boolean(entry?.wholeFrame)
      || (Boolean(entry?.soft) && (entry.width !== frameWidth || entry.height !== frameHeight));
    const rect = stretched && Array.isArray(entry.frameRect) && entry.frameRect.length === 4
      && entry.frameRect.every(Number.isFinite) && entry.frameRect[2] > 0 && entry.frameRect[3] > 0
      ? entry.frameRect : [0, 0, 1, 1];
    values[offset + MASK_RECT_INDEX] = stretched ? rect[0] * frameWidth : 0;
    values[offset + MASK_RECT_INDEX + 1] = stretched ? rect[1] * frameHeight : 0;
    values[offset + MASK_RECT_INDEX + 2] = stretched ? rect[2] * frameWidth : 0;
    values[offset + MASK_RECT_INDEX + 3] = stretched ? rect[3] * frameHeight : 0;
    return stretched;
  }

  function gpuMaskInfluenceOpacity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return 1;
    return Math.min(1, Math.max(0, Number(expression.leaf.mask_opacity ?? 1)));
  }

  function gpuMaskIdentity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(gpuMaskRenderPayload(expression));
    return JSON.stringify({
      ...gpuMaskRenderPayload(expression),
      leaf: { ...expression.leaf, mask_opacity: 1 },
    });
  }

  function spatialLeafExpression(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return expression;
    return { ...expression, leaf: { ...expression.leaf, mask_opacity: 1 } };
  }

  /** Key-order independent spatial identity, comparable with a backend document. */
  function spatialMaskSignature(expression) {
    return JSON.stringify(gpuMaskRenderPayload(spatialLeafExpression(expression)) ?? null, (key, entry) => (
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map((name) => [name, entry[name]]))
        : entry
    ));
  }

  function gpuMaskRenderPayload(expression) {
    if (!expression) return expression;
    const { id, children, ...payload } = expression;
    return {
      ...payload,
      children: (children || []).map(gpuMaskRenderPayload),
    };
  }

  function maskUsesLuminance(expression) {
    if (!expression) return false;
    if (expression.operator === "leaf") return expression.leaf?.type === "luminance_range";
    return (expression.children || []).some(maskUsesLuminance);
  }

  function gpuLumaLeaves(expression) {
    if (!expression || expression.enabled === false) return [];
    if (isGpuLumaMask(expression)) return [expression.leaf];
    return (expression.children || []).flatMap(gpuLumaLeaves);
  }

  function gpuRegionalGraphEligible(expression, geometrySignature) {
    if (!expression || expression.enabled === false || expression.operator === "leaf") return false;
    // Index crops change placement, not leaf raster eligibility. The region
    // loader separately verifies the rounded uncropped frame and crop bounds.
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch { return false; }
    const leafGeometry = JSON.stringify({...geometry, crop:{x:0,y:0,width:1,height:1}});
    const children = (expression.children || []).filter(child => child.enabled !== false);
    // A proper combination has at least two operands. Degenerate/disabled
    // graphs retain the established path and its opacity/inversion contract.
    return children.length >= 2 && children.every(child => child.operator === "leaf"
      ? isGpuLumaMask(child) || window.HDRMaskRaster?.eligible(child, leafGeometry)
        || isGpuLinearGradientMask(child, leafGeometry)
      : gpuRegionalGraphEligible(child, geometrySignature));
  }

  /**
   * Whether a lane's source is the scene picture a luma mask qualifies.
   *
   * Export always reads ACEScg scene luminance. The HDR lane's source is that
   * picture; so is the SDR lane's unless Match or an authored SDR base
   * replaces it, which the backend states as a different working space.
   */
  function lumaSceneSource(lane, sourceIdentity, workingSpace) {
    return (sourceIdentity || "source") === "source"
      && (lane === "hdr" || (lane === "sdr" && workingSpace === "acescg"));
  }

  function isGpuLumaMask(expression) {
    return expression?.operator === "leaf"
      && expression.leaf?.type === "luminance_range"
      && (!expression.children || expression.children.length === 0);
  }

  function buildGpuLinearGradientParams(expression, rect, width, height, geometrySignature) {
    const geometry = JSON.parse(geometrySignature), rotation = Number(geometry.rotation || 0) / 90;
    const leaf = expression.leaf;
    return new Float32Array([
      Number(leaf.start.x), Number(leaf.start.y), Number(leaf.end.x), Number(leaf.end.y),
      Number(leaf.gradient_midpoint_1), Number(leaf.gradient_midpoint_2), rect.x, rect.y,
      rotation % 2 ? height : width, rotation % 2 ? width : height,
      expression.inverted ? 1 : 0, expression.enabled === false ? 0 : 1,
      rotation + (geometry.flip_horizontal ? 4 : 0) + (geometry.flip_vertical ? 8 : 0),
      Number(leaf.gradient_fan || 0),
    ]);
  }

  function isGpuLinearGradientMask(expression, geometrySignature) {
    if (expression?.operator !== "leaf" || expression.leaf?.type !== "linear_gradient"
      || expression.children?.length || expression.leaf.gradient_luma_enabled
      || !(Number(expression.leaf.gradient_midpoint_1) > 0)
      || !(Number(expression.leaf.gradient_midpoint_2) > Number(expression.leaf.gradient_midpoint_1))
      || !(Number(expression.leaf.gradient_midpoint_2) < 1)) return false;
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch (_) { return false; }
    const crop = geometry?.crop || {};
    return [0, 90, 180, 270].includes(Number(geometry.rotation || 0))
      && Number(geometry.straighten_angle || 0) === 0
      && Number(geometry.perspective_horizontal || 0) === 0
      && Number(geometry.perspective_vertical || 0) === 0
      && Number(geometry.perspective_rotate || 0) === 0
      && Number(crop.x ?? 0) === 0 && Number(crop.y ?? 0) === 0
      && Number(crop.width ?? 1) === 1 && Number(crop.height ?? 1) === 1;
  }

  function gpuLumaBaseIdentity(expression) {
    if (!isGpuLumaMask(expression)) return JSON.stringify(gpuMaskRenderPayload(expression));
    return JSON.stringify({
      ...gpuMaskRenderPayload(expression),
      inverted: false,
      leaf: {
        ...expression.leaf,
        mask_feather: 0,
        mask_opacity: 1,
      },
    });
  }

  /**
   * The luma feather's Gaussian, in pixels of a mask `width` x `height`.
   *
   * Feather is a distance: 0.09 of the uncropped source's long edge at 100%,
   * the same in both directions. `referenceScale` is that long edge over the
   * mask's own (cropped, straightened) long edge, so cropping never changes
   * how soft a mask is, and the preview matches the export. It used to be
   * 0.09 of each side of the cropped frame, which on a 3:2 image spread the
   * feather 1.5 times further sideways than up and down, and halved it under
   * a 50% crop. Above 8 px the
   * blur runs on a copy area-averaged by `factor`, with `reducedSigma` chosen so
   * the averaging and the bilinear upsample (together about a quarter of a
   * reduced texel squared) add up to the requested spread.
   */
  function lumaFeatherPlan(feather, width, height, referenceScale = 1) {
    const amount = Math.min(1, Math.max(0, Number(feather) || 0) / 0.05);
    const sigma = 0.09 * amount * Math.max(width, height) * referenceScale;
    if (sigma < 8) return { sigma, factor: 1, reducedSigma: sigma };
    const factor = Math.floor(sigma / 4);
    return { sigma, factor, reducedSigma: Math.sqrt(Math.max(0.0625, (sigma * sigma) / (factor * factor) - 0.25)) };
  }

  // The feather plan of a mask a measurement patch can make from its own
  // pixels: a plain luminance leaf whose feather is filtered at full size. A
  // wider feather is blurred on a grid anchored to the frame and keeps the
  // reduced bitmap, which such a blur leaves close to the truth anyway.
  function analysisLumaPlan(expression, width, height, referenceScale = 1) {
    if (!isGpuLumaMask(expression) || expression.enabled === false) return null;
    const feather = Math.min(0.05, Math.max(0, Number(expression.leaf.mask_feather) || 0));
    const plan = lumaFeatherPlan(feather, width, height, referenceScale);
    return plan.factor === 1 ? plan : null;
  }

  function lumaFeatherReach(plan) {
    // Six boxes have finite support wider than the former three-sigma
    // Gaussian truncation. Include the reduced-grid interpolation footprint.
    return lumaBoxRadii(plan.sigma).reduce((sum,radius)=>sum+radius,0) + 2 * plan.factor;
  }

  function lumaBoxRadii(sigma) {
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,lumaEvenRound((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    return Array.from({length:6},(_,i)=>(lower+(i<count?0:2)-1)/2);
  }

  function lumaEvenRound(value) {
    const lower=Math.floor(value),fraction=value-lower;
    return fraction===.5 ? lower+(lower%2) : Math.round(value);
  }

  // Export uses six discrete boxes rather than an ideal Gaussian. Build its
  // exact one-dimensional impulse response in linear time, then sample that
  // response on the existing reduced grid with the grid's variance removed.
  // This preserves the same bounded textures and halo/grid contract.
  function lumaBlurParams(plan,axis,inverted) {
    const sigma=Math.min(2048,plan.sigma),round=lumaEvenRound;
    let lower=Math.max(1,Math.floor(Math.sqrt(2*sigma*sigma+1)));
    if(!(lower%2))lower=Math.max(1,lower-1);
    const count=Math.max(0,Math.min(6,round((12*sigma*sigma-6*lower*lower-24*lower-18)/(-4*lower-4))));
    let kernel=new Float64Array([1]),variance=0;
    for(let pass=0;pass<6;pass++){
      const width=lower+(pass<count?0:2),radius=(width-1)/2;
      variance+=(width*width-1)/12;
      const next=new Float64Array(kernel.length+2*radius);
      let sum=0;
      for(let i=0;i<next.length;i++){
        if(i<kernel.length)sum+=kernel[i];
        if(i>=width&&i-width<kernel.length)sum-=kernel[i-width];
        next[i]=sum/width;
      }
      kernel=next;
    }
    const factor=plan.factor,center=(kernel.length-1)/2;
    const spread=factor===1?1:Math.sqrt(Math.max(.01,variance-factor*factor*.25)/Math.max(variance,1e-9));
    const pitch=factor/spread,reach=Math.min(255,Math.ceil(center/pitch)),weights=[];
    for(let i=0;i<=reach;i++){
      const at=center+i*pitch,left=Math.floor(at),fraction=at-left;
      weights.push((kernel[left]||0)*(1-fraction)+(kernel[left+1]||0)*fraction);
    }
    const total=weights[0]+2*weights.slice(1).reduce((sum,w)=>sum+w,0);
    return new Float32Array([sigma,reach+1,axis,inverted?1:0,...weights.map(w=>w/total)]);
  }

  function buildGpuLumaQualificationParams(expression) {
    const leaf = expression.leaf;
    return new Float32Array([
      Number(leaf.fade_in_start_ev),
      Number(leaf.full_start_ev),
      Number(leaf.full_end_ev),
      Number(leaf.fade_out_end_ev),
    ]);
  }

  function gpuMaskGraphLayoutIdentity(expression) {
    if (expression?.operator === "leaf") return `leaf:${expression.leaf?.type || "unknown"}`;
    if (expression?.enabled === false) return gpuMaskGraphLayoutIdentity(expression?.children?.[0]);
    const children = (expression?.children || []).filter((child) => child.enabled !== false);
    return children.length === 1
      ? gpuMaskGraphLayoutIdentity(children[0])
      : `node(${children.map(gpuMaskGraphLayoutIdentity).join(",")})`;
  }

  function gpuMaskGraphPassCount(expression) {
    if (expression?.operator === "leaf") return 0;
    if (expression?.enabled === false) return gpuMaskGraphPassCount(expression?.children?.[0]);
    const children = (expression?.children || []).filter((child) => child.enabled !== false);
    return Math.max(0, children.length - 1)
      + children.reduce((total, child) => total + gpuMaskGraphPassCount(child), 0);
  }

  function firstResolvedMaskLeaf(node) {
    if (node.leafEntry) return node.leafEntry;
    for (const child of node.children || []) {
      const leaf = firstResolvedMaskLeaf(child);
      if (leaf) return leaf;
    }
    return null;
  }

  function gpuMaskOperatorCode(operator) {
    if (operator === "intersect") return 1;
    if (operator === "subtract") return 2;
    return 0;
  }

  // Temporary scope wiring for the render-plan move; removed with gpu-params.
  Object.assign(globalThis, {
    halfToFloat, floatArraysEqual, multiply3x3, invert3x3, rgbToXyzMatrix, rayTriangleDistance, rotateScalePrimary, rgbPrimariesAdjustmentMatrix, colorSettingsNeutral, curveSetNeutral, curvePointsNeutral, toneEqualizerNeutral, highlightToneSettings, applyHighlightTone, invertHighlightTone, toneAdjustedHighlightPeakLinear, buildParams, normalizedToneEqualizerNodes, buildCurves, gpuLocalSupported, activeGpuLocals, gpuLocalDetailActive, buildLocalParams, softMaskIdentity, writeMaskRect, gpuMaskInfluenceOpacity, gpuMaskIdentity, spatialLeafExpression, spatialMaskSignature, gpuMaskRenderPayload, maskUsesLuminance, gpuLumaLeaves, gpuRegionalGraphEligible, lumaSceneSource, isGpuLumaMask, buildGpuLinearGradientParams, isGpuLinearGradientMask, gpuLumaBaseIdentity, lumaFeatherPlan, analysisLumaPlan, lumaFeatherReach, lumaBoxRadii, lumaEvenRound, lumaBlurParams, buildGpuLumaQualificationParams, gpuMaskGraphLayoutIdentity, gpuMaskGraphPassCount, firstResolvedMaskLeaf, gpuMaskOperatorCode
  });

  HDRWebGPUPreview.spatialMaskSignature = spatialMaskSignature;
  window.HDRWebGPUPreview = HDRWebGPUPreview;

})();
