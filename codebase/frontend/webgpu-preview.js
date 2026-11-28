(function () {
  // Local hue masks: selection pixels per band; larger frames are banded.
  const HUE_MASK_BAND_PIXELS = 4 * 1024 * 1024;
  const FINE_GRAIN_FIT_CACHE_SIZE = 4;
  const CLEAN_GRAIN_SMALL_MARGIN = 40;
  const CLEAN_GRAIN_LARGE_MARGIN = 76;
  const CLEAN_GRAIN_FRINGE_MARGIN = 24;

  function cleanGrainMargin(controls) {
    if (controls.method !== "clean_grain") return 0;
    if (controls.cleanSplotches !== false) return controls.splotchSize === "large" ? CLEAN_GRAIN_LARGE_MARGIN : CLEAN_GRAIN_SMALL_MARGIN;
    return controls.cleanFringes !== false ? CLEAN_GRAIN_FRINGE_MARGIN : 0;
  }
  const FINE_GRAIN_REDUCED_CACHE_SIZE = 3;
  const MICRO_GRAIN_MARGIN = 112;
  const FINE_GRAIN_HDR_NITS_ROUNDING_GUARD = 1 - 2 ** -22;

  function fineGrainPixelControls(controls, endpoints = false) {
    const { grainEvenness, colorSplotches, splotchSize, ...core } = controls;
    if (cleanGrainMargin(controls)) {
      return { ...core, grainEvenness, splotchSize, ...(endpoints ? {} : { colorSplotches }) };
    }
    return endpoints ? core : { ...core, grainEvenness };
  }

  function preparedGrainControls(controls) {
    const { amount, luminance, colorNoise, detailRecovery, finestNoise, fineNoise,
      mediumNoise, coarseNoise, method, grainEvenness, cleanSplotches, cleanFringes, protectColorEdges, splotchSize } = controls;
    return { amount, luminance, colorNoise, detailRecovery, finestNoise, fineNoise,
      mediumNoise, coarseNoise, method, grainEvenness, ...(method === "clean_grain" ? { cleanSplotches, cleanFringes, protectColorEdges, splotchSize } : {}) };
  }

  function denoiseDeadline(signal, milliseconds) {
    const timeout = AbortSignal.timeout(milliseconds);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  function grainPreparationReplaced() {
    return Object.assign(new Error("Grain preparation expired or was replaced."), { grainPreparationReplaced: true });
  }

  function fineGrainStripUpload(device, maxWidth, maxRows) {
    const chunkBytes = Math.min(8 * 1024 * 1024, device.limits.maxBufferSize);
    return { device, maxWidth, maxRows, slots: 2, chunkBytes, ring: [], retired: [] };
  }

  function grainWorkRefused(reason, message, details) {
    return Object.assign(new Error(message), { grainReason: reason, grainDetails: details });
  }
  function standaloneHueMask(expression) {
    return expression?.operator === "leaf" && expression.leaf?.type === "hue_range";
  }

  function regionalHueGraphEligible(mask, geometrySignature, lane, sourceIdentity, workingSpace) {
    return gpuRegionalGraphEligible(mask, geometrySignature, { allowHue: true })
      && (!gpuLumaLeaves(mask).length || lumaSceneSource(lane, sourceIdentity, workingSpace));
  }

  function maskHasHueLeaf(expression) {
    if (!expression) return false;
    if (expression.operator === "leaf") return standaloneHueMask(expression);
    return (expression.children || []).some(maskHasHueLeaf);
  }

  function lensGlowActive(params) {
    return params[GPU_PARAMS.FILM_RESPONSE_ENABLED] >= 0.5 && params[GPU_PARAMS.FILM_LOOK_STRENGTH] > 0
      && params[GPU_PARAMS.LENS_FILTER] > 0.5 && params[GPU_PARAMS.LENS_SCATTER] > 0;
  }

  const CLARITY_IGNORED_FILM_PARAMS = Object.entries(GPU_PARAMS)
    .filter(([name]) => name === "LENS_SCATTER" || name.startsWith("GRAIN_"))
    .map(([, index]) => index);

  class HDRWebGPUPreview {
    static usesDraftGrain(options = {}) {
      return !options.delivery && !options.measureOnly
        && (options.tier === "interactive" || Boolean(options.coarse));
    }

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
      // Grain GPU bytes held when a reclaim last released nothing.
      this.emptyGrainReclaimBytes = null;
      this.grainReclaimPressure = "none";
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
      this.filmStockBuffer = null;
      this.lensKernel = null;
      this.lensKernelLayout = null;
      this.lensBlurLayout = null;
      this.filmStockPlaceholder = null;
      this.filmStockUploads = new Map();
      this.curveSampleCache = new Map();
      this.lastCurveSamples = null;
      this.surfaceKeys = new WeakMap();
      this.gradeCanvasSwaps = new Map();
      this.intermediates = new Map();
      this.localMasks = new Map();
      this.localMaskInflight = new Map();
      this.localParamBuffers = new Map();
      this.localParamValues = new Map();
      this.scopeSources = new WeakMap();
      this.scopeResources = new Map();
      this.scopePeakTargets = [];
      this.peakReductionPipeline = null;
      this.scaledFilmPeakReductionModule = null;
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
      this.clarityFrameMapVersion = 0;
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
      this.geometryUnderlayerRender = null;
      this.activeScopeCount = 0;
      this.deferredDestroy = [];
      this.pendingGpuRetireBytes = 0;
      this.gpuRetireFences = new Map();
      this.fineGrainTransientBytes = 0;
      this.denoiseMeasurementBytes = 0;
      this.hslSelectionResources = new Map();
      this.claritySurroundEntries = new Set();
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
      // The whole-frame store a pan copies from is held only while everything
      // resident, the store included, stays under this share of the budget.
      this.panStoreBudgetShare = 0.7;
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
      this.lensGlowTiles = this.trackGpuCache("lens-glow-tile", new Map());
      this.lensTextureIds = new WeakMap();
      this.nextLensTextureId = 0;
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
      this.logGpuConfiguration();
      return this.memoryBudgetBytes();
    }

    configuredGpuBudgetBytes() {
      return this.memoryBudget === "auto" && this.gpuBudget?.budgetBytes > 0
        ? this.gpuBudget.budgetBytes : normalizeGpuBudgetBytes(this.memoryBudget);
    }

    memoryBudgetBytes() {
      // An explicit setting is the user's number and stands, higher or lower
      // than Auto. Auto is the calibrated budget: half of the detected
      // dedicated video memory, or the stated fallback, lowered by verified
      // adapter facts and the allocation probe.
      const configured = this.configuredGpuBudgetBytes();
      return Number.isFinite(this.deliveryBudgetBytes) ? Math.min(configured, this.deliveryBudgetBytes) : configured;
    }

    async reportDeliveryActivity(active = (this.resourceRenderCount > 0 && !this.geometryUnderlayerRender)
      || this.activeScopeCount > 0 || this.deliveryWaitingCount > 0) {
      if (globalThis.location?.pathname?.endsWith("gpu-delivery.html")) return {reserved:0};
      this.deliveryClientId ||= crypto.randomUUID();
      // Report the configured/calibrated budget, before the shared deduction.
      const previous = this.deliveryBudgetBytes; this.deliveryBudgetBytes = null;
      const budget = this.memoryBudgetBytes(); this.deliveryBudgetBytes = previous;
      const response = await fetch("/api/delivery/gpu/activity", {method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({id:this.deliveryClientId,
          active,bytes:this.resourceMemorySnapshot().resident.totalBytes,budget})});
      if (!response.ok) throw Error("Delivery accounting unavailable");
      const value = await response.json(); this.deliveryBudgetBytes = value.budget;
      this.gpuAllocator?.setBudget(this.memoryBudgetBytes());
      return value;
    }

    async acquireForegroundDeliveryBudget() {
      if (!this.deliveryActivityTimer) return;
      // Grade wins at the next bounded submission. Wait for the hidden
      // renderer to release its reservation before admitting a new graph.
      this.deliveryWaitingCount = (this.deliveryWaitingCount || 0) + 1;
      try {
        for (;;) {
          const value = await this.reportDeliveryActivity(true);
          if (!value.reserved) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      } catch { /* Delivery service unavailable: ordinary Grade admission. */ }
      finally { this.deliveryWaitingCount -= 1; }
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
      this.logGpuConfiguration();
      return this.gpuBudget;
    }

    logGpuConfiguration() {
      if (!this.adapterInfo) return;
      const { limits, ...adapter } = this.adapterInfo;
      globalThis.HDRDiagnostics?.event("gpu", "session_gpu_configuration", {
        adapter, limits, budget_bytes: this.memoryBudgetBytes(),
        budget_source: this.memoryBudget === "auto" ? this.gpuBudget?.source : "explicit",
        detected_vram_bytes: this.detectedVideoMemory?.bytes ?? null,
        probe_bytes: this.gpuBudget?.probe?.requestedBytes ?? null,
        probe_passed: this.gpuBudget?.probe?.passed ?? null,
      });
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
    releaseGpuCacheValue(kind, entry, unreferenced = false) {
      if (!entry) return;
      if (kind === "oriented-luminance") entry.destroyed = true;
      this.retireGpuResource(entry.byteSize || 0, () => {
        if (kind === "local-mask") this.destroyLocalMaskEntry(entry);
        else entry.texture?.destroy();
      }, unreferenced);
    }

    touchGpuCache(entry) {
      if (this.gpuAllocator && entry?.allocatorEntry) this.gpuAllocator.touch(entry.allocatorEntry);
      return entry;
    }

    /** Release one registered cache entry by kind and key, through its owner. */
    evictGpuCacheEntry(kind, key, unreferenced = false) {
      const cache = {
        "source-proxy": this.proxies, "detail-band-tile": this.detailBandTiles,
        "mask-tile": this.maskTiles, "denoise-tile": this.denoiseTiles, "lens-glow-tile": this.lensGlowTiles,
        "scene-luminance": this.sceneLuminance, "local-mask": this.localMasks,
        "oriented-luminance": this.orientedLuminance, "fine-grain-reduced": this.fineGrainReduced,
      }[kind];
      const entry = cache?.get(key);
      if (!entry) return;
      cache.delete(key);
      if (kind === "fine-grain-reduced") this.gpuCacheRelease(entry);
      if (kind === "detail-band-tile") this.detailCacheCounters.evictions += 1;
      if (kind === "denoise-tile") this.denoiseTileCounters.evictions += 1;
      this.releaseGpuCacheValue(kind, entry, unreferenced);
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
        + (this.filmStockBuffer?.size || 0)
        + (this.lensKernel?.bytes || (options.lensKernelActive ? this.lensKernelBytes() : 0))
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
      if (!options.backgroundUnderlayer) this.lastRenderPlan = plan;
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
      // The bounded saved-picture canvas has its own normal memory admission.
      if (sourceOptions?.gradeLibraryPicture) return null;
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

    async initialize(beforePipeline = async () => {}) {
      if (!navigator.gpu) {
        this.detail = "WebGPU is unavailable in this browser";
        globalThis.HDRDiagnostics?.event("gpu", "session_gpu_unavailable", { reason: "gpu_unavailable" });
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
        // WebGPU's default 2D texture limit is 8192 even where the adapter
        // allows 16384. At 100% the tiled path presents the whole frame in one
        // texture, so photos wider than 8192 (50 MP and larger sensors) need
        // the adapter's real limit. This raises a limit; it allocates nothing.
        const adapterTextureLimit = Number(this.adapter.limits.maxTextureDimension2D) || 0;
        this.device = await (this.requestPreviewDevice ? this.requestPreviewDevice.bind(this) : this.adapter.requestDevice.bind(this.adapter))({
          requiredFeatures: timestampQueries ? ["timestamp-query"] : [],
          requiredLimits: {
            maxBufferSize: fullSurfaceBufferLimit,
            ...(adapterTextureLimit > 8192 ? { maxTextureDimension2D: adapterTextureLimit } : {}),
          },
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
            { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" } },
          ],
        });
        this.hslSelectionPlaceholder = this.device.createTexture({
          label: "HSL selection placeholder", size: [1, 1, 1], format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        this.hslSelectionPlaceholderView = this.hslSelectionPlaceholder.createView({ dimension: "2d-array" });
        this.spatialSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        });
        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        await beforePipeline();
        this.scopePipeline = await this.device.createRenderPipelineAsync({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "scopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        await beforePipeline();
        this.settledScopePipeline = await this.device.createRenderPipelineAsync({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "settledScopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        await beforePipeline();
        this.outputPicturePipeline = await this.device.createRenderPipelineAsync({
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
        const maskPipeline = async entry => {
          await beforePipeline();
          return this.createMaskPipeline(entry, true);
        };
        this.maskPipelines = {
          sceneLuminance: await maskPipeline("sceneLuminanceFragmentMain"),
          qualify: await maskPipeline("lumaQualificationFragmentMain"),
          refine: await maskPipeline("maskRefinementFragmentMain"),
          downsample: await maskPipeline("maskDownsampleFragmentMain"),
          upsample: await maskPipeline("maskUpsampleFragmentMain"),
          combine: await maskPipeline("maskCombineFragmentMain"),
          linearGradient: await maskPipeline("linearGradientFragmentMain"),
          shapeRaster: await maskPipeline("shapeRasterFragmentMain"),
          brushRegionalErase: await maskPipeline("brushRegionalEraseFragmentMain"),
        };
        await beforePipeline();
        this.hslSelectionEngines = new Map();
        this.hslSelectionTemplate = globalThis.HDRHslSelectionGpu
          ? await new globalThis.HDRHslSelectionGpu(this.device, {
            onAllocate: (bytes, detail) => this.recordAllocation("hsl-selection", bytes, detail),
          }).initialize()
          : null;
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
        if (!globalThis.location?.pathname?.endsWith("gpu-delivery.html")) {
          this.deliveryActivityTimer ||= setInterval(() => this.reportDeliveryActivity().catch(()=>{}), 100);
          this.reportDeliveryActivity(false).catch(()=>{});
        }
        this.detail = this.adapterInfo.fallback
          ? "WebGPU software adapter active; HDR presentation is not authoritative"
          : `WebGPU settled authoring renderer ready (${this.adapterInfo.description})`;
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        globalThis.HDRDiagnostics?.event("gpu", "session_gpu_unavailable", { level: "warn", reason: "gpu_initialization_failed" });
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
      const grainFailures = this._grainFailures;
      this.resetSession(sessionId);
      this.gradeCanvasSwaps.clear();
      this._grainFailures = grainFailures;
      this.lensKernel?.texture.destroy();
      this.device = null;
      this.adapter = null;
      this.adapterInfo = null;
      this.gpuBudget = null;
      this.context = null;
      this.module = null;
      this.maskModule = null;
      this.pipelines = new Map();
      this.surfaceKeys = new WeakMap();
      this.fineGrainResizePipelines = null;
      this.cleanGrainResizePipelines = null;
      const adaptive = this.adaptiveDenoisePipelines;
      adaptive?.dummySampled.destroy();
      adaptive?.dummyStorage32.destroy();
      adaptive?.dummyStorage16.destroy();
      this.adaptiveDenoisePipelines = null;
      this.adaptiveDenoiseCompilation = null;
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
      this.filmStockBuffer = null;
      this.lensKernel = null;
      this.lensKernelLayout = null;
      this.lensBlurLayout = null;
      this.filmStockPlaceholder = null;
      this.filmStockUploads = new Map();
      this.peakReductionPipeline = null;
      this.scaledFilmPeakReductionModule = null;
      this.maskProbePipeline = null;
      this.frameMaskRecord = null;
      this.hslSelectionTemplate = null;
      this.hslSelectionEngines = new Map();
      this.hslSelectionPlaceholder = null;
      this.hslSelectionPlaceholderView = null;
      this.deviceLost = false;
      return this.initialize();
    }

    resetSession(sessionId = null) {
      if (typeof window !== "undefined") window.HDRSourceTransport?.clearCapacityRefusals(this);
      this.resourceGeneration += 1;
      this.denoisePreparationController?.abort();
      this.fineGrainFits = new Map();
      this.releaseFineGrainReduced();
      this.fineGrainReduced = new Map();
      for (const entry of this.gpuAllocator?.entries.values() || []) {
        if (entry.kind === "grain-preview-layer") entry.evict();
      }
      this._grainFailures = null;
      this.releaseHslSelection();
      this.denoiseModelWarm = null;
      this.editingCandidateCache?.clear();
      this.lastNativeHighlightPeak = null;
      this.editingAnalysisCanvas = null;
      this.highlightAnchorCanvas = null;
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
      this.retainPresentedTiles();
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
      for (const key of this.detailBandTiles.keys()) this.evictGpuCacheEntry("detail-band-tile", key);
      this.clearLensGlowTiles();
      for (const key of this.maskTiles.keys()) this.evictGpuCacheEntry("mask-tile", key);
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
      for (const key of this.proxies.keys()) this.evictGpuCacheEntry("source-proxy", key);
      this.proxyInflight.clear();
      for (const key of this.sceneLuminance.keys()) this.evictGpuCacheEntry("scene-luminance", key);
      this.sceneLuminanceInflight.clear();
      for (const key of this.orientedLuminance.keys()) this.evictGpuCacheEntry("oriented-luminance", key);
      this.orientedLuminanceInflight.clear();
      this.maskExtents?.clear();
      for (const intermediate of this.intermediates.values()) {
        this.destroyAfterActiveRenders(() => this.destroyIntermediate(intermediate));
      }
      this.intermediates.clear();
      for (const key of this.localMasks.keys()) this.evictGpuCacheEntry("local-mask", key);
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

    async releaseForSourceReplacement() {
      // The mounted canvas keeps the last swap-chain picture. None of the
      // source, tile or retained render-target textures is needed to show it.
      this.resetSession();
      await new Promise(resolve => this.destroyAfterActiveRenders(resolve));
      await this.waitForSubmittedWork();
    }

    async retireDenoiseZoomResources(sessionId, lane, longEdge, regionOnly) {
      const previous = this.lastPresentedFrame;
      if (previous?.sessionId !== sessionId || previous.lane !== lane) return;
      const scaleChanged = previous.longEdge !== longEdge;
      if (!scaleChanged && !regionOnly) return;
      // The swap chain still shows the last completed picture. Its backing
      // render target, source proxies and resolved tiles are no longer needed
      // for the next processing size.
      const target = scaleChanged || (regionOnly && !this.presentationTarget?.region) ? this.presentationTarget : null;
      if (target) {
        this.presentationTarget = null;
        this.gpuAllocator?.unregister(target.allocatorEntry);
        this.destroyAfterActiveRenders(() => target.texture.destroy());
      }
      if (scaleChanged && !this.denoiseSourceSelector?.cache?.grain?.gpu) {
        this.dropDenoiseTiles();
        this.denoiseTileIdentity = null;
      }
      let retiredProxy = false;
      for (const [key, proxy] of this.proxies) {
        if (proxy.sessionId === sessionId && proxy.lane === lane
          && (proxy.longEdge !== longEdge || (regionOnly && !proxy.region))) {
          const selector = this.denoiseSourceSelector;
          if (proxy === selector?.original) {
            if (!this.adaptiveDenoiseSelected()) continue;
            const resolved = selector.resolved;
            selector.original = null;
            selector.resolved = null;
            selector.resolvedFor = null;
            if (resolved) this.destroyAfterActiveRenders(() => resolved.texture.destroy());
          }
          this.evictGpuCacheEntry("source-proxy", key);
          retiredProxy = true;
        }
      }
      if (target || retiredProxy) await this.waitForSubmittedWork();
    }

    get resourceRenderCount() {
      return this.activeRenderCount;
    }

    destroyAfterActiveRenders(callback) {
      if (this.resourceRenderCount > 0 || this.activeScopeCount > 0) this.deferredDestroy.push(callback);
      else callback();
    }

    retireGpuResource(bytes, destroy, unreferenced = false) {
      const queue = this.device?.queue;
      const releaseCharge = this.gpuAllocator?.deferRetirement(bytes);
      this.pendingGpuRetireBytes += bytes;
      const removeCharge = () => {
        this.pendingGpuRetireBytes -= bytes;
        releaseCharge?.();
      };
      const retire = () => {
        try {
          destroy();
        } finally {
          if (!queue?.onSubmittedWorkDone || !bytes) removeCharge();
          else {
            let batch = this.gpuRetireFences.get(queue);
            if (!batch) {
              this.gpuRetireFences.set(queue, batch = []);
              // Group retirements from the same cleanup without fencing each
              // tile individually. Later retirements get a newer fence.
              const releaseBatch = () => batch.forEach(release => release());
              void Promise.resolve().then(() => {
                this.gpuRetireFences.delete(queue);
                return queue.onSubmittedWorkDone().then(releaseBatch, releaseBatch);
              }).catch(releaseBatch);
            }
            batch.push(removeCharge);
          }
        }
      };
      if (unreferenced) retire();
      else this.destroyAfterActiveRenders(retire);
    }

    flushDeferredDestroy() {
      if (this.resourceRenderCount > 0 || this.activeScopeCount > 0) return;
      const callbacks = this.deferredDestroy.splice(0);
      callbacks.forEach((callback) => callback());
      if (this.gpuAllocator?.overBudgetBytes > 0) this.scheduleTileCacheTrim();
      if (this.pendingGrainReclaim) {
        this.pendingGrainReclaim = false;
        const snapshot = this.grainMemorySnapshot();
        const held = Math.max(snapshot.resident_bytes || 0, snapshot.allocator_bytes || 0);
        // After a reclaim that found nothing, wait until Grain holds more
        // GPU memory or the system pressure changes (acceptGrainMemorySample).
        if (this.emptyGrainReclaimBytes !== null && held <= this.emptyGrainReclaimBytes) return;
        const action = globalThis.HDRDiagnostics?.start("memory", "grade_grain_reclaim", {});
        const released = this.reclaimGrainResources(snapshot, action);
        this.emptyGrainReclaimBytes = released ? null : held;
        action?.finish("complete", { route: "gpu", reason: released ? "rebuildable_cache_released" : "no_reclaimable_resources" });
      }
    }

    finishActiveRender() {
      this.activeRenderCount = Math.max(0, this.activeRenderCount - 1);
      this.flushDeferredDestroy();
    }

    sourceLoadIsCurrent(canvas, serial, resourceGeneration, options) {
      if (resourceGeneration !== this.resourceGeneration) return false;
      if (options?.backgroundUnderlayer && options.signal?.aborted) return false;
      if (!options?.backgroundUnderlayer && typeof options?.isSourceCurrent === "function") return options.isSourceCurrent() !== false;
      return serial === this.renderSerials.get(canvas) && options?.isCurrent?.() !== false;
    }

    stopGeometryUnderlayerRender() {
      const underlayer = this.geometryUnderlayerRender;
      if (!underlayer) return null;
      underlayer.cancel?.();
      return underlayer.unwound;
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
      const queue = this.device.queue;
      try {
        if (this.gpuRetireFences.has(queue)) await Promise.resolve();
        await queue.onSubmittedWorkDone();
        return this.available && this.device?.queue === queue;
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
      const lensGlowTileBytes = [...this.lensGlowTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      const tileGraphBytes = (this.tileGraph?.byteSize || 0) + (this.analysisTileGraph?.byteSize || 0);
      const hslSelectionBytes = [...this.hslSelectionResources.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      const clarityMapBytes = [...(this.clarityMaps?.values() || []), ...this.claritySurroundEntries]
        .reduce((sum, entry) => sum + entry.byteSize, 0);
      const scopeBytes = [...this.scopeResources.values()].reduce(
        (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
        0,
      );
      const intermediateEntries = [...this.intermediates.values()];
      const underlayerIntermediate = this.geometryUnderlayerRender?.intermediate;
      if (underlayerIntermediate) intermediateEntries.push(underlayerIntermediate);
      const gradingCoreBytes = intermediateEntries.reduce(
        (sum, entry) => sum + entry.width * entry.height * 8 * 4,
        0,
      );
      const gradingSpatialBytes = intermediateEntries.reduce((sum, entry) => {
        if (!entry.spatialATexture || !entry.spatialBTexture) return sum;
        const grid = spatialGridScale(entry.width, entry.height);
        return sum + Math.ceil(entry.width / grid) * Math.ceil(entry.height / grid) * 8 * (2 + (entry.lensGlowTexture ? 1 : 0));
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
        + (this.filmStockBuffer?.size || 0)
        + (this.lensKernel?.bytes || 0)
        + [...this.localParamBuffers.values()].reduce((sum, buffer) => sum + (buffer.size || 0), 0)
        + intermediateEntries.reduce((sum, entry) => sum + (entry.compositeParamBuffer?.size || 0), 0)
        + denoiseParameterBufferBytes;
      // The retained presentation target is live device memory
      // (and a pinned allocator reservation). It used to be missing from the
      // resident categories while the peak-agreement driver counted it, which
      // is exactly the drift the exit gate measures.
      const presentationSurfaceBytes = this.presentationTarget?.byteSize || 0;
      const canvasSwapBytes = this.gradeCanvasSwapBytes();
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
        lensGlowTileBytes,
        tileGraphBytes,
        hslSelectionBytes,
        clarityMapBytes,
        scopeBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
        denoiseResolvedBytes,
        denoiseMeasurementBytes: this.denoiseMeasurementBytes,
        fineGrainReducedBytes: this.fineGrainReducedBytes() + this.fineGrainTransientBytes,
        parameterBufferBytes,
        presentationSurfaceBytes,
        canvasSwapBytes,
      };
      const residentBytes = Object.values(residentCategories).reduce((sum, value) => sum + value, 0);
      const cachedCategories = {
        sourceProxyBytes: proxyBytes,
        sceneLuminanceBytes,
        localMaskBytes,
        detailBandCacheBytes,
        maskTileBytes,
        denoiseTileBytes,
        lensGlowTileBytes,
        denoiseEvidenceBytes,
        denoiseReconstructionScratchBytes,
      };
      const cachedBytes = Object.values(cachedCategories).reduce((sum, value) => sum + value, 0);
      const transientBytes = this.pendingGpuRetireBytes;
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
          lensGlowCache: Boolean(planningEntry.lensGlowTexture),
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
          categories: { submittedWorkPendingDestructionBytes: transientBytes },
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
          cacheReady: Boolean(this.denoiseSourceSelector?.cache && !this.denoiseSourceSelector.cache.grain?.stale),
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
              ? spatialWidth * spatialHeight * 8 * (2 + (entry.lensGlowTexture ? 1 : 0))
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

    committedGradeScratch(options, params, activeLocals, lane, detailActive, localDetailActive, spatialActive) {
      if (!options?.gradePreview || options.tier === "interactive" || options.coarse
          || options.noiseView || options.measureOnly || options.underlayerOnly) return null;
      const scale = graphScaleContract();
      return {
        detail: !detailActive && !localDetailActive,
        clarity: !scale.clarityActive(params) && !activeLocals.some(local => scale.localClarityActive(local[`${lane}_grade`])),
        spatial: !spatialActive,
        hsl: !this.hslSelectionChannels(params).length,
      };
    }

    retireInactiveGradeScratch(inactive, isCurrent) {
      if (!inactive) return;
      this.destroyAfterActiveRenders(() => {
        if (!isCurrent()) return;
        for (const [canvas, graph] of this.intermediates) {
          if (inactive.detail) this.retireGraphTextures(graph, ["detailATexture", "detailBTexture"], graph.width * graph.height * 8);
          if (inactive.spatial && this.scopeSources.get(canvas)?.spatialTexture !== graph.spatialATexture) {
            const grid = spatialGridScale(graph.width, graph.height);
            this.retireGraphTextures(graph, ["spatialATexture", "spatialBTexture", "lensGlowTexture"],
              Math.ceil(graph.width / grid) * Math.ceil(graph.height / grid) * 8);
            graph.lensGlowKey = null;
          }
        }
        if (inactive.detail && this.tileGraph?.detailScratch) {
          const graph = this.tileGraph;
          graph.byteSize -= this.retireGraphTextures(graph, ["detailScratchTexture", "detailResultTexture"], graph.width * graph.height * 8);
          graph.detailScratch = false;
          this.syncGpuCacheBytes(graph);
        }
        if (inactive.clarity) this.releaseClarityMaps();
        if (inactive.hsl) this.releaseGlobalHslSelection();
      });
    }

    retireGraphTextures(graph, fields, textureBytes) {
      const textures = [];
      for (const field of fields) {
        if (graph[field]) textures.push(graph[field]);
        graph[field] = null;
      }
      const bytes = textures.length * textureBytes;
      if (bytes) this.retireGpuResource(bytes, () => textures.forEach(texture => texture.destroy()));
      return bytes;
    }

    /**
     * Rank real source candidates on the GPU without spatial-neighbourhood
     * operations. The returned bounded native patches evaluate those stages
     * on real neighbours; the candidate atlas never invents their input.
     */
    async rankEditingPeakCandidates(sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, isCurrent, signal, reuseHighlight = false) {
      if (lane === "sdr" && adjustments.sdr.linked_to_hdr) {
        locals = locals.map(local => ({ ...local, sdr_grade: local.hdr_grade }));
      }
      const signature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceSignal = this.sourceAbortSignal();
      const requestSignal = signal ? AbortSignal.any([signal, sourceSignal]) : sourceSignal;
      this.editingCandidateCache ||= new Map();
      const evidenceKey = `${sessionId}:${lane}:${signature}:${adjustments.sdr?.use_authored_base}`;
      let evidence = this.editingCandidateCache.get(evidenceKey);
      if (!evidence) {
        const response = await fetch(`/api/session/${sessionId}/peak-candidates/${lane}?edit_revision=${revision}`, {
          signal: requestSignal,
        });
        if (!response.ok) throw new Error(`Peak candidate evidence: ${response.status}`);
        evidence = await response.json();
        if (!isCurrent()) return null;
        if (!evidence.samples?.length || evidence.samples.length > 16384) throw new Error("Bounded peak evidence is unavailable");
        this.editingCandidateCache.set(evidenceKey, evidence);
        while (this.editingCandidateCache.size > 4) this.editingCandidateCache.delete(this.editingCandidateCache.keys().next().value);
      }
      const params = buildParams(lane, adjustments, evidence.working_space, lane === "hdr", white, 1);
      const origin = { sessionId, geometrySignature: signature, sourceIdentity: "source", identity: evidenceKey,
        sourceEpoch: evidence.source_epoch };
      const anchor = this.highlightAnchorRequest(lane, adjustments, origin, params, locals);
      const reuseKey = anchor && reuseHighlight && lane === "hdr"
        ? this.nativeHighlightReuseKey(adjustments, origin, params, locals) : null;
      const previous = this.lastNativeHighlightPeak;
      if (reuseKey && previous?.key === reuseKey
        && this.peakReductionCache.get(previous.result.highlightAnchor.key) === previous.result.highlightAnchor.value) {
        return { anchor, reuseKey, reused: previous.result };
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
        // Rank upstream of the shoulder; native patches evaluate all later
        // neighbourhood stages. Unrelated atlas neighbours never feed Detail.
        params[GPU_PARAMS.HIGHLIGHT_MODE] = 0;
        this.uploadParamsAndCurves(lane, adjustments, curveSampler, params, locals);
        if (this.prepareLibraryPipelines) await this.prepareLibraryPipelines("rgba16float");
        const pipelines = this.pipelineFor("rgba16float");
        const masks = [];
        if (lane === "hdr") this.markResidentMaskFrame(sessionId, locals, 1600, signature);
        if (lane === "hdr") for (const local of activeGpuLocals(lane, locals)) {
          const entry = await this.loadEditingMask(sessionId, local, revision, signature, evidence, sourceSize, isCurrent, requestSignal);
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
          const values = buildLocalParams(local, lane, 1,this.localCurveOffsets?.get(local.id) || 0, params);
          values[MASK_PARAMS.LOCAL.TEXTURE_AMOUNT] = values[MASK_PARAMS.LOCAL.CLARITY_AMOUNT] = values[MASK_PARAMS.LOCAL.SHARPEN_AMOUNT] = 0;
          const buffer = this.createStorageBuffer(values); buffers.push(buffer);
          this.device.queue.writeBuffer(buffer, 0, values);
          const target = current === a ? b : a;
          pass(target, pipelines.peakCandidateLocal, current, entry.texture, buffer, positions);
          current = target;
        }
        const read = this.device.createBuffer({ size: side * side * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); buffers.push(read);
        encoder.copyTextureToBuffer({ texture: current }, { buffer: read, bytesPerRow: side * 8 }, [side, side]);
        this.device.queue.submit([encoder.finish()]);
        // The atlas is valid for pointwise peak measurement only. B&W reads a
        // neighbourhood to select its hue response; adjacent atlas entries
        // come from unrelated source locations. Use the same bounded real-image
        // proxy as percentile measurement when that guide is active.
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
        return { ...evidence, samples: undefined, patches, anchor, reuseKey };
      } finally {
        textures.forEach(item => item.destroy()); buffers.forEach(item => item.destroy());
      }
    }

    async measureEditingPeak(canvas, sessionId, lane, adjustments, curveSampler, locals, revision, white, sourceSize, options = {}) {
      if (lane === "sdr" && adjustments.sdr.linked_to_hdr) {
        locals = locals.map(local => ({ ...local, sdr_grade: local.hdr_grade }));
      }
      const isCurrent = options.isCurrent || (() => true);
      if (options.highlightAnchorOnly && adjustments[lane]?.highlight_compression_peak_measurement === "robust") {
        const generation = this.resourceGeneration;
        const current = () => !options.signal?.aborted && isCurrent() && generation === this.resourceGeneration;
        while (current() && this.highlightAnchorInflight) await this.highlightAnchorInflight.catch(() => null);
        if (!current()) return null;
        const work = (async () => {
          const signature = JSON.stringify(adjustments.shared?.geometry || {});
          const identity = options.identity || "source";
          const proxy = await this.loadProxy(sessionId, lane, 1600, signature, revision, identity, {isCurrent: current});
          if (!proxy || !current()) return null;
          const params = buildParams(lane, adjustments, proxy.workingSpace, lane === "hdr", white, this.sourcePixelScaleFor(proxy, sourceSize));
          const anchor = this.highlightAnchorRequest(lane, adjustments, proxy, params, locals);
          if (!anchor) return null;
          const pipeline = await this.ensurePeakReductionPipeline("scaledFilmPeakReductionMain");
          if (!current()) return null;
          const anchorCanvas = (this.highlightAnchorCanvas ||= document.createElement("canvas"));
          const uncompressed = structuredClone(adjustments);
          uncompressed[lane].highlight_section_enabled = false;
          const rendered = await this.renderTo(anchorCanvas, sessionId, lane, uncompressed, curveSampler, 1600, locals, revision,
            null, white, sourceSize, {identity, isCurrent: current, measureOnly: true});
          const finished = this.scopeSources.get(anchorCanvas);
          if (!rendered?.width || !finished || !current()) return null;
          const value = await this.runPeakReduction(pipeline, finished.filmTexture, finished.width, finished.height, params, "robust", anchor.key);
          return current() ? {highlightAnchor: {key: anchor.key, value}} : null;
        })();
        this.highlightAnchorInflight = work;
        try {
          return await work;
        } finally {
          if (this.highlightAnchorInflight === work) this.highlightAnchorInflight = null;
        }
      }
      const device = this.device;
      const generation = this.resourceGeneration;
      const current = () => isCurrent() && !options.signal?.aborted
        && device === this.device && generation === this.resourceGeneration;
      if (!current()) return null;
      const ranked = await this.rankEditingPeakCandidates(sessionId, lane, adjustments, curveSampler, locals,
        revision, white, sourceSize, current, options.signal, options.highlightAnchorOnly && !options.identity);
      if (!ranked || !current()) return null;
      if (ranked.reused) {
        const value = ranked.reused.highlightAnchor.value;
        this.cachePeakReduction(ranked.anchor.key, value);
        const result = { ...ranked.reused, highlightAnchor: { key: ranked.anchor.key, value } };
        this.lastNativeHighlightPeak = { key: ranked.reuseKey, result };
        return result;
      }
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
        if (!current()) return null;
        if (surround) analysis = {...analysis, claritySurround: surround};
        if (!bound()) {
          analysis = {...analysis, analysisNativeLuma: false};
          if (!bound()) return {rendered:false, refusals:["editing peak patch budget exceeded"]};
        }
      }
      let peak = 0, rendered = 0;
      // Neutral-paper patches already reduce into float32. Copy each patch's
      // unchanged result into its own slot and map them together, rather than
      // fencing the GPU between patches. Still check and combine them on CPU.
      const peakReadback = options.highlightAnchorOnly && adjustments[lane].film_look?.film_stock === "none"
        && ranked.patches.length ? device.createBuffer({
          size: ranked.patches.length * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }) : null;
      try {
        for (const patch of ranked.patches) {
          if (!current()) return null;
          const x = Math.max(0, patch.x - halo), y = Math.max(0, patch.y - halo);
          const region = {x, y, width: Math.min(frame.width, patch.x + patch.width + halo)-x, height: Math.min(frame.height, patch.y + patch.height + halo)-y};
          let result;
          try {
            result = await this.renderTiledTo(canvas, sessionId, lane, adjustments, curveSampler, Math.max(sourceSize.width,sourceSize.height), locals, revision, null, white, sourceSize, {
              ...options, isCurrent: current, measureOnly: true, tileSize: 128,
              analysisPatch: patch, analysisRegion: region, analysisMasks: true,
              peakReadback: peakReadback ? { buffer: peakReadback, offset: rendered * 4 } : null,
              ...analysis,
            });
          } finally {
            const key = `${sessionId}:${lane}:${Math.max(sourceSize.width,sourceSize.height)}:${signature}:${options.identity || "source"}:analysis:${JSON.stringify(region)}`;
            this.evictGpuCacheEntry("source-proxy", key);
          }
          if (!current()) return null;
          if (!result?.rendered) return result;
          if (!peakReadback) {
            if (!Number.isFinite(result.metrics?.exactPeak)) return result;
            peak = Math.max(peak, result.metrics.exactPeak);
          }
          rendered++;
        }
        if (peakReadback) {
          if (!current()) return null;
          await peakReadback.mapAsync(GPUMapMode.READ);
          if (!current()) return null;
          for (const measured of new Float32Array(peakReadback.getMappedRange())) {
            if (!Number.isFinite(measured)) return null;
            peak = Math.max(peak, measured);
          }
        }
        const result = {rendered:true, metrics:{exactPeak:peak, exactPeakLongEdge:Math.max(frame.width,frame.height), tileCount:rendered, processedBound, bounded:true,
          claritySurround: Boolean(analysis.claritySurround), nativeLumaMasks: analysis.analysisNativeLuma}};
        if (options.highlightAnchorOnly && ranked.anchor) {
          this.cachePeakReduction(ranked.anchor.key, peak);
          result.highlightAnchor = {key:ranked.anchor.key, value:peak};
          if (ranked.reuseKey) this.lastNativeHighlightPeak = { key: ranked.reuseKey, result };
        }
        return result;
      } finally {
        if (peakReadback?.mapState === "mapped") peakReadback.unmap();
        peakReadback?.destroy();
      }
    }

    nativeHighlightReuseKey(adjustments, origin, params, locals) {
      // Both controls run after the native patches' measured signal. Keep
      // Target (Tone Whites reads it upstream), colour handling and all other
      // source/grade inputs. Do not change the display request key or the
      // carried anchor, so provisional frames and measurement reporting agree.
      const hdr = { ...adjustments.hdr, highlight_compression_start_nits: undefined, highlight_compression_peak_detail: undefined };
      return JSON.stringify([this.resourceGeneration, origin.sourceEpoch, adjustments.shared,
        params[GPU_PARAMS.PROJECT_REFERENCE_WHITE_NITS], this.highlightAnchorRequest("hdr", { ...adjustments, hdr }, origin, params, locals).key]);
    }

    highlightAnchorRequest(lane, adjustments, proxy, params, locals = []) {
      const measurement = adjustments[lane]?.highlight_compression_peak_measurement || "maximum";
      const measures = params[GPU_PARAMS.HIGHLIGHT_MODE] === 1 && measurement !== "manual";
      if (!measures) return null;
      // A denoise reconstruction carries no session or source identity of its
      // own. Name it by the source it was made from, or its key never matches
      // the editing measurement's and the render asks for the anchor forever.
      const selector = this.denoiseSourceSelector;
      const origin = selector?.original && proxy === selector.resolved ? selector.original : proxy;
      const key = JSON.stringify([
        [origin.sessionId, origin.geometrySignature, origin.sourceIdentity],
        this.highlightSourceToken(proxy), lane, measurement,
        params[GPU_PARAMS.EXPOSURE], params[GPU_PARAMS.BLACKS], params[GPU_PARAMS.CONTRAST], params[GPU_PARAMS.CONTRAST_PIVOT], params[GPU_PARAMS.HIGHLIGHT_COLOR_HANDLING],
        ...params.slice(10, 12), ...params.slice(61, 73),
        ...params.slice(BLACK_AND_WHITE_PARAM, BLACK_AND_WHITE_PARAM + 9),
        [adjustments[lane], lane === "sdr" && adjustments.sdr.linked_to_hdr ? adjustments.hdr : null, locals],
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
      if (selector?.selected === "resolved") {
        const controls = JSON.stringify(selector.controls || {});
        // Both zoom layers reconstruct from the same native Grain preparation.
        // Retargeting or uploading a fresh texture does not change those pixels.
        const grain = selector.cache?.grain?.token;
        if (grain) return `grain:${grain}:${controls}`;
        return `denoise:${selector.identity}:${selector.resolvedVersion ?? 0}:${controls}`;
      }
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
      const estimate = params[GPU_PARAMS.HIGHLIGHT_ANCHOR];
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
      const estimate = params[GPU_PARAMS.HIGHLIGHT_ANCHOR];
      const resourceGeneration = this.resourceGeneration;
      const allocator = this.gpuAllocator;
      const pin = allocator?.pin?.(sourceProxy.allocatorEntry);
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
        if (pin) allocator.unpin(pin);
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
    bindGraphResources(sourceView, spatialView, parameterBinding = { buffer: this.paramBuffer }, overlayView = spatialView,
      hslSelectionView = this.hslSelectionPlaceholderView) {
      return this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: sourceView },
          { binding: 1, resource: parameterBinding },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: spatialView },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: overlayView },
          { binding: 6, resource: this.filmStockBinding() },
          { binding: 7, resource: hslSelectionView },
        ],
      });
    }

    /**
     * Shared colour selection for Global HSL (hsl-selection-gpu.js). Each canvas
     * owns a whole-frame cache and a tile scratch, so one canvas's pending,
     * unsubmitted frame can never read another's half-written selection.
     */
    hslSelectionEngine(canvas, route) {
      if (!this.hslSelectionTemplate) return null;
      let owned = this.hslSelectionEngines.get(canvas);
      if (!owned) this.hslSelectionEngines.set(canvas, owned = {});
      return owned[route] ||= this.createHslSelectionEngine();
    }

    createHslSelectionEngine() {
      const engine = this.hslSelectionTemplate.fork();
      const owner = { byteSize: 0, allocatorEntry: null };
      engine.onMemoryChange = bytes => {
        if (owner.byteSize === bytes) return;
        owner.byteSize = bytes;
        if (!bytes) {
          this.hslSelectionResources.delete(engine);
          this.gpuCacheRelease(owner);
        } else {
          if (!owner.allocatorEntry) owner.allocatorEntry = this.gpuAllocator?.register({
            kind: "hsl-selection", bytes, pinned: true,
          });
          else this.syncGpuCacheBytes(owner);
          this.hslSelectionResources.set(engine, owner);
        }
      };
      return engine;
    }

    retireHslSelectionEngine(engine) {
      const owner = this.hslSelectionResources.get(engine);
      this.hslSelectionResources.delete(engine);
      engine.onMemoryChange = null;
      this.gpuCacheRelease(owner);
      this.retireGpuResource(owner?.byteSize || 0, () => engine.destroy());
    }

    releaseGlobalHslSelection() {
      for (const owned of this.hslSelectionEngines?.values() || []) {
        for (const engine of Object.values(owned)) this.retireHslSelectionEngine(engine);
      }
      this.hslSelectionEngines = new Map();
    }

    releaseHslSelection() {
      this.releaseGlobalHslSelection();
      const maskEngine = this.hslMaskEngine;
      this.hslMaskEngine = null;
      if (maskEngine) this.retireHslSelectionEngine(maskEngine);
    }

    /** Global HSL channels as the selection reads them, from the packed slots. */
    hslSelectionChannels(params) {
      if (!(params[GPU_PARAMS.HSL_SHARED_SELECTION] > 0.5)) return [];
      const HSL = globalThis.HDRHSL, channels = [];
      const count = Math.round(params[GPU_PARAMS.HSL_CHANNEL_COUNT] || 0);
      for (let k = 0; k < count; k += 1) {
        const at = HSL.CHANNEL_BASE + k * HSL.CHANNEL_STRIDE, ranges = [];
        for (let j = 0; j < params[at + 4]; j += 1) {
          const r = at + 8 + 4 * j;
          ranges.push({ center: params[r], width: params[r + 1], feather: params[r + 2], subtract: params[r + 3] > 0.5 });
        }
        channels.push({ ranges, floor: 0.02, edge: params[at+6], edge_feather: params[at+7], edge_detail: params[at+136] });
      }
      return channels;
    }

    /**
     * What a whole-frame selection depends on: the source texture and every
     * slot that can change the picture before HSL. HSL's own sliders and the
     * stages after it are left out, so dragging them reuses the selection.
     */
    hslPrepareKey(sourceTexture, params, width, height) {
      if (!this.hslTextureIds) { this.hslTextureIds = new WeakMap(); this.hslTextureSerial = 0; }
      let id = this.hslTextureIds.get(sourceTexture);
      if (!id) this.hslTextureIds.set(sourceTexture, id = ++this.hslTextureSerial);
      const g = GPU_PARAMS, after = [[g.VIGNETTE_SCALE_X, g.VIGNETTE_SCALE_Y], [g.CURVES_ENABLED, g.CURVES_ENABLED],
        [g.FILM_RESPONSE_ENABLED, g.GRAIN_SEED_LOW], [g.COLOR_GRADING_ENABLED, g.SCOPE_HEIGHT],
        [g.DETAIL_ENABLED, g.SHARPEN_THRESHOLD], [g.FILM_LOOK_ENABLED, g.GRAIN_VIEW_MAP],
        [g.CLARITY_MAP_SCALE, g.GRAIN_SEED_HIGH], [g.MASK_RECT_X, g.FILM_STOCK_PREFLASH]];
      const above = [];
      for (let i = 0; i < g.HSL_CHANNEL_COUNT; i += 1) {
        if (!after.some(([lo, hi]) => i >= lo && i <= hi)) above.push(params[i]);
      }
      return `${id}|${width}x${height}|${this.denoiseSourceSelector?.resolvedFor ?? ""}|${above.join(",")}`;
    }

    /**
     * Encode the selection for one region (the whole frame, a tile or a Clarity
     * chunk) before its base pass. `bindGroup` is the base pass's own binding;
     * the fields pass reads the same source and parameters. Returns the view to
     * bind in slot 7 and the token to commit after submission, or null.
     */
    encodeHslSelection(engine, encoder, pipelines, bindGroup, {
      width, height, originX = 0, originY = 0, params, prepareKey = null, channels = null,
    }) {
      channels = engine ? channels || this.hslSelectionChannels(params) : [];
      if (!channels.length) return null;
      const scale = params[GPU_PARAMS.SOURCE_PIXEL_SCALE] || 1;
      engine.ensure(width, height, Math.ceil(channels.length / 4), globalThis.HDRHslSelectionGpu.geometry(scale).cell);
      if (!engine.isPrepared(prepareKey)) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: engine.fieldsView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
        });
        pass.setViewport(0, 0, width, height, 0, 1);
        pass.setScissorRect(0, 0, width, height);
        pass.setPipeline(pipelines.hslFields);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
      }
      const token = engine.encode(encoder, {
        width, height, originX, originY, scale, channels, prepareKey,
        selectKey: prepareKey == null ? null : JSON.stringify(channels),
      });
      return { view: engine.outputView(), token };
    }

    /**
     * The picture a Local hue mask selects from depends on the lane's grade
     * above HSL, so its leaves are keyed by that, not by the mask alone.
     */
    hueContextIdentity(hue, source) {
      if (!hue?.params || !source?.texture) return "";
      const width = source.textureWidth || source.width, height = source.textureHeight || source.height;
      return `${hue.lane}|${source.region ? `${source.region.x},${source.region.y}` : "0,0"}|`
        + this.hslPrepareKey(source.texture, hue.params, width, height);
    }

    /**
     * A Local hue-mask leaf from the shared selection (Global HSL's engine and
     * maths), over the source `hue.proxy` or `sourceOverride` (a region). The
     * frame is processed in bands with the selection's reach as overlap, so a
     * large frame never holds the selection scratch for all of it; the bands
     * together equal the whole-frame result. Unsampled leaves stay empty, even
     * inverted. Returns a mask entry, or null when the route is unavailable.
     */
    async loadGpuHueLeaf(sessionId, expression, hue, longEdge, isCurrent = () => true, sourceOverride = null,
      editingMeasurement = false, maskRegion = null) {
      if (!this.hslSelectionTemplate || globalThis.HDRHueMaskSharedSelection === false || !hue?.params) return null;
      const source = sourceOverride || hue.proxy;
      if (!source?.texture || !isCurrent()) return null;
      const width = maskRegion?.width || source.textureWidth || source.width;
      const height = maskRegion?.height || source.textureHeight || source.height;
      const region = maskRegion || source.region;
      const ox = region?.x || 0, oy = region?.y || 0, leaf = expression.leaf || {};
      const prepareBase = this.hueContextIdentity(hue, source)
        + (maskRegion ? `|region:${JSON.stringify(maskRegion)}` : "");
      const key = `${sessionId}:gpu-hue:${prepareBase}:${JSON.stringify([leaf.hue_center ?? null, leaf.hue_width,
        leaf.hue_smoothness, leaf.saturation_floor, leaf.edge, leaf.edge_feather, leaf.edge_detail, Boolean(expression.inverted)])}`;
      let entry = this.localMasks.get(key);
      if (entry && !entry.destroyed) {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
      } else {
        const startedAt = performance.now();
        entry = {
          kind: "gpu-hue", texture: this.createMaskTexture(width, height), width, height,
          byteSize: width * height * 2,
          frameRect: region ? [ox / source.width, oy / source.height, width / source.width, height / source.height] : null,
        };
        if (leaf.hue_center != null) {
          const engine = (this.hslMaskEngine ||= this.createHslSelectionEngine());
          const scale = hue.params[GPU_PARAMS.SOURCE_PIXEL_SCALE] || 1;
          const reach = globalThis.HDRHslSelectionGpu.geometry(scale, leaf).reach
            + graphScaleContract().blackAndWhiteGuideReach(hue.params);
          const bandRows = Math.max(64, Math.floor(HUE_MASK_BAND_PIXELS / Math.max(1, width)));
          const single = height <= bandRows;
          const channels = [{ ranges: [{ center: leaf.hue_center, width: leaf.hue_width, feather: leaf.hue_smoothness, subtract: false }],
            floor: Number(leaf.saturation_floor ?? 0.04), edge: leaf.edge, edge_feather: leaf.edge_feather, edge_detail: leaf.edge_detail }];
          if (this.prepareLibraryPipelines) await this.prepareLibraryPipelines("rgba16float");
          const pipelines = this.pipelineFor("rgba16float");
          const scratch = single && !maskRegion ? null : this.device.createTexture({
            label: "Hue mask band source", size: [width, Math.min(height, bandRows + 2 * reach)],
            format: source.texture.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          engine.ensure(width, single ? height : Math.min(height, bandRows + 2 * reach), 1,
            globalThis.HDRHslSelectionGpu.geometry(scale).cell);
          const encoder = this.device.createCommandEncoder(), tokens = [], buffers = [];
          const buffer = (values) => {
            const created = this.createStorageBuffer(values);
            this.device.queue.writeBuffer(created, 0, values);
            buffers.push(created);
            return { buffer: created };
          };
          for (let top = 0; top < height; top += bandRows) {
            const y0 = single ? 0 : Math.max(0, top - reach);
            const rows = single ? height : Math.min(height, top + bandRows + reach) - y0;
            if (scratch) {
              encoder.copyTextureToTexture({ texture: source.texture, origin: { x: maskRegion ? maskRegion.x - (source.region?.x || 0) : 0,
                y: (maskRegion ? maskRegion.y - (source.region?.y || 0) : 0) + y0, z: 0 } },
                { texture: scratch, origin: { x: 0, y: 0, z: 0 } }, { width, height: rows, depthOrArrayLayers: 1 });
            }
            const view = (scratch || source.texture).createView();
            const values = new Float32Array(hue.params);
            values[GPU_PARAMS.TILE_ORIGIN_X] = ox;
            values[GPU_PARAMS.TILE_ORIGIN_Y] = oy + y0;
            values[GPU_PARAMS.TILE_VALID_WIDTH] = width;
            values[GPU_PARAMS.TILE_VALID_HEIGHT] = rows;
            values[GPU_PARAMS.FRAME_WIDTH] = source.width;
            values[GPU_PARAMS.FRAME_HEIGHT] = source.height;
            const selection = this.encodeHslSelection(engine, encoder, pipelines,
              this.bindGraphResources(view, view, buffer(values), view), {
                width, height: rows, originX: ox, originY: oy + y0, params: values, channels,
                prepareKey: single ? prepareBase : null,
              });
            tokens.push(selection.token);
            const maskValues = new Float32Array(values);
            maskValues[GPU_PARAMS.TILE_ORIGIN_X] = 0;
            maskValues[GPU_PARAMS.TILE_ORIGIN_Y] = y0;
            maskValues[GPU_PARAMS.HSL_SHARED_SELECTION] = expression.inverted ? 2 : 1;
            const keepRows = single ? height : Math.min(bandRows, height - top);
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: entry.texture.createView(), loadOp: "load", storeOp: "store" }] });
            pass.setViewport(0, single ? 0 : top, width, keepRows, 0, 1);
            pass.setScissorRect(0, single ? 0 : top, width, keepRows);
            pass.setPipeline(pipelines.hslMask);
            pass.setBindGroup(0, this.bindGraphResources(view, view, buffer(maskValues), view, selection.view));
            pass.draw(3);
            pass.end();
          }
          this.device.queue.submit([encoder.finish()]);
          tokens.forEach((token) => engine.commit(token));
          engine.dropRetired();
          buffers.forEach((created) => created.destroy());
          scratch?.destroy();
          // Range drags at Fit reuse the prepared data; a big frame's scratch goes.
          if (!single) engine.release();
          if (this.instrumentationEnabled) {
            this.performanceMetrics.maskEvents ||= [];
            this.performanceMetrics.maskEvents.push({ kind: "gpu-hue", longEdge, width, height, bands: single ? 1 : Math.ceil(height / bandRows),
              encodeSubmitMs: performance.now() - startedAt, cpuMaskRequest: false });
          }
        }
        // An unsampled leaf keeps the zeroed texture: it selects nothing, inverted or not.
        this.localMasks.set(key, entry);
      }
      entry.lastUseSerial = this.maskUseSerial;
      if (editingMeasurement) this.retainEditingMask(entry);
      else this.retainLocalMask(entry, longEdge);
      return entry;
    }

    /**
     * The film stock tables the film pass reads (binding 6): each loaded
     * stock in its fixed slot (film-stocks.js). Until one has loaded a small
     * placeholder is bound; FILM_STOCK_SLOT is 0 then, so nothing reads it.
     * Stock data never changes, so a slot is written once.
     */
    filmStockBinding() {
      const stocks = window.HDRFilmStocks;
      const loaded = stocks?.loadedIds() || [];
      if (!loaded.length) {
        if (!this.filmStockPlaceholder) {
          this.filmStockPlaceholder = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });
        }
        return { buffer: this.filmStockPlaceholder };
      }
      if (!this.filmStockBuffer) {
        const bytes = stocks.slotCount * stocks.slotFloats * 4;
        this.filmStockBuffer = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.filmStockUploads = new Map();
        this.recordAllocation("film-stock", bytes, { slots: stocks.slotCount });
      }
      for (const id of loaded) {
        const data = stocks.packedSlot(id);
        if (this.filmStockUploads.get(id) === data) continue;
        this.device.queue.writeBuffer(this.filmStockBuffer, stocks.bufferIds.indexOf(id) * stocks.slotFloats * 4, data);
        this.filmStockUploads.set(id, data);
      }
      return { buffer: this.filmStockBuffer };
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
    tileGraphMatches(graph, width, height, outputFormat, sourceFormat, spatialActive, denoiseActive, spatialGrid, detailScratch = true) {
      return graph && graph.width === width && graph.height === height
        && graph.outputFormat === outputFormat && graph.sourceFormat === sourceFormat
        && graph.spatialActive === spatialActive && graph.denoiseActive === denoiseActive
        && graph.spatialGrid === spatialGrid && (!detailScratch || graph.detailScratch);
    }

    tileGraphBytes(width, height, sourceFormat, spatialActive, denoiseActive, spatialGrid, detailScratch = true) {
      return width * height * (8 * (detailScratch ? 6 : 4) + (sourceFormat === "rgba16float" ? 8 : 16) + (denoiseActive ? 8 : 0))
        + (spatialActive ? Math.ceil(width / spatialGrid) * Math.ceil(height / spatialGrid) * 8 * 2 : 0);
    }

    ensureTileGraph(width, height, outputFormat, sourceFormat, spatialActive = false, denoiseActive = false, spatialGrid = 4, analysis = false, detailScratch = true) {
      const graphKey = analysis ? "analysisTileGraph" : "tileGraph";
      const current = this[graphKey];
      if (this.tileGraphMatches(current, width, height, outputFormat, sourceFormat, spatialActive, denoiseActive, spatialGrid, detailScratch)) {
        return current;
      }
      const allocated = [];
      const makeTexture = descriptor => {
        const texture = this.device.createTexture(descriptor);
        allocated.push(texture);
        return texture;
      };
      const make = (format, usage) => makeTexture({
        size: { width, height }, format, usage,
      });
      const attachment = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      // The spatial pair is the work tile over the frame's spatial grid in
      // each axis, the same ratio the Direct graph uses.
      const spatialWidth = Math.max(1, Math.ceil(width / spatialGrid));
      const spatialHeight = Math.max(1, Math.ceil(height / spatialGrid));
      const makeSpatial = (extraUsage = 0) => makeTexture({
        size: { width: spatialWidth, height: spatialHeight }, format: "rgba16float", usage: attachment | extraUsage,
      });
      let next;
      try {
        next = {
          width,
          height,
          outputFormat,
          sourceFormat,
          spatialActive,
          sourceTexture: make(sourceFormat, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST),
          baseTexture: make("rgba16float", attachment),
          localTexture: make("rgba16float", attachment),
          detailScratch,
          detailScratchTexture: detailScratch ? make("rgba16float", attachment) : null,
          detailResultTexture: detailScratch ? make("rgba16float", attachment | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST) : null,
          filmTexture: make("rgba16float", attachment | GPUTextureUsage.STORAGE_BINDING),
          // A measurement copies its patch out of the finished tile.
          finishTexture: make("rgba16float", attachment | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING),
          spatialATexture: spatialActive ? makeSpatial() : null,
          spatialBTexture: spatialActive ? makeSpatial(GPUTextureUsage.COPY_SRC) : null,
          spatialWidth,
          spatialHeight,
          spatialGrid,
          denoiseActive,
          // One tile's worth of denoised picture, rebuilt per tile from cached
          // evidence. The whole-frame resolved texture this replaces is 340 MB
          // on a 42 MP frame, and allocating it is what used to put a denoised
          // Full over any budget.
          denoiseResolvedTexture: denoiseActive
            ? makeTexture({
              label: "tile-denoise-resolved",
              size: { width, height },
              format: "rgba16float",
              usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
                | GPUTextureUsage.COPY_SRC,
            })
            : null,
          byteSize: this.tileGraphBytes(width, height, sourceFormat, spatialActive, denoiseActive, spatialGrid, detailScratch),
        };
      } catch (error) {
        allocated.forEach(texture => texture.destroy());
        this.recordAllocationFailure("tile-graph", error, { width, height });
        return null;
      }
      this.destroyTileGraph(graphKey);
      this[graphKey] = next;
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
      this.retireGpuResource(graph.byteSize, () => {
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
      const geometry = adjustments.shared?.geometry || {};
      const geometrySignature = JSON.stringify(geometry);
      // Luma leaves need the scene picture and a globally aligned feather
      // halo. Supported expression graphs compose those same regional leaves.
      if (!sourceOptions?.nativeGeometryViewport && lane === "hdr" && (sourceOptions?.identity || "source") === "source"
        && (activeLocals || []).some((local) => maskUsesLuminance(local.mask)
          && !maskHasHueLeaf(local.mask) && !isGpuLumaMask(local.mask)
          && !gpuRegionalGraphEligible(local.mask, geometrySignature)
          && !this.sourceSpaceMask(sessionId, local.mask, longEdge, geometrySignature))) return null;
      // The whole frame's source, once resident, serves every region of it
      // with no fetch at all.
      if (this.wholeSourceResident(sessionId, lane, longEdge, geometrySignature, sourceOptions?.identity || "source")) {
        return null;
      }
      const probe = this.observeGradeMemory ? this.surfaceProbeCanvas() : canvas;
      const surface = this.configureSurface(probe, probe === canvas ? context : probe.getContext("webgpu"), lane === "hdr");
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
        // A repair resets finished frames but can retain an updated native
        // source region. Its working-space metadata is enough to plan a fresh
        // ROI; no previously graded pixels are accepted as a completed frame.
        const known = [this.lastPresentedFrame, ...this.proxies.values()].find(proxy =>
          proxy && proxy.sessionId === sessionId && proxy.lane === lane
          && proxy.sourceIdentity === (sourceOptions?.identity || "source"));
        const workingSpace = known?.workingSpace || (sourceOptions?.nativeGeometryViewport
          ? (lane === "sdr" && sourceOptions.identity === "authored-sdr" ? "linear-srgb" : "acescg") : null);
        if (!(size?.width > 0 && size?.height > 0) || !workingSpace) return null;
        previousFrame = { width: size.width, height: size.height, longEdge, workingSpace };
      }
      if (!previousFrame.workingSpace) return null;
      if (!sourceOptions?.nativeGeometryViewport && !sourceOptions?.analysisMasks
        && (activeLocals || []).some(({mask}) => maskHasHueLeaf(mask) && !standaloneHueMask(mask)
          && !regionalHueGraphEligible(mask, geometrySignature, lane, sourceOptions?.identity, previousFrame.workingSpace))) return null;
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
      if (region) {
        // Downsampling must start on the same cells as a whole-frame mask.
        const hueGrid = !sourceOptions?.analysisMasks && (activeLocals || []).some(local => maskHasHueLeaf(local.mask))
          ? window.HDRHslSelectionGpu?.geometry(this.sourcePixelScaleFor(previousFrame, sourceSize)) : null;
        let alignment = hueGrid?.cell || 1;
        const gcd = (a,b) => b ? gcd(b,a%b) : a;
        const lumaLeaves = lumaSceneSource(lane, sourceOptions?.identity, previousFrame.workingSpace)
          ? pictureLumaLocals.flatMap(local => gpuLumaLeaves(local.mask)) : [];
        for (const leaf of lumaLeaves) {
          const factor = lumaFeatherPlan(leaf.mask_feather, previousFrame.width,
            previousFrame.height, this.featherReferenceScale?.(geometrySignature) || 1).factor;
          alignment = alignment / gcd(alignment,factor) * factor;
          if (alignment > 512) return sourceOptions?.nativeGeometryViewport ? { ...region, backendLumaMasks: true } : null;
        }
        const x = Math.floor(region.x/alignment)*alignment, y = Math.floor(region.y/alignment)*alignment;
        region = {x,y,width:Math.min(previousFrame.width,Math.ceil((region.x+region.width)/alignment)*alignment)-x,
          height:Math.min(previousFrame.height,Math.ceil((region.y+region.height)/alignment)*alignment)-y};
        const indexGeometry = [0, 90, 180, 270].includes(Number(geometry.rotation || 0))
          && !Number(geometry.straighten_angle || 0) && !Number(geometry.perspective_rotate || 0)
          && !Number(geometry.perspective_horizontal || 0) && !Number(geometry.perspective_vertical || 0);
        if (!sourceOptions?.analysisMasks && ((hueGrid && indexGeometry) || lumaLeaves.length)
          && region.width * region.height >= previousFrame.width * previousFrame.height * .9) region.requireRegion = true;
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
      const adaptive = !sourceOptions?.originalSource && this.adaptiveDenoiseSelected();
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
      if (adaptive) {
        const margin = ADAPTIVE_DENOISE_MARGIN + (selector.cache.grain?.gpu ? cleanGrainMargin(selector.controls) : 0);
        halo += Math.ceil(margin / alignment) * alignment;
      }
      // Global Clarity's map pre-pass reads the picture around the tiles, not
      // just their halos: its reach, rounded out to whole blocks and to the
      // denoise grid. The source region has to cover that too.
      const contract = graphScaleContract();
      if (!sourceOptions?.analysisMasks && activeLocals.some(local => maskHasHueLeaf(local.mask))) {
        const grid = window.HDRHslSelectionGpu?.geometry(params[GPU_PARAMS.SOURCE_PIXEL_SCALE] || 1,
          { edge: 8, edge_feather: 16 });
        if (grid) halo += grid.reach + grid.cell + contract.blackAndWhiteGuideReach(params);
      }
      if (contract.clarityActive(params) && !surround?.global) {
        const clarity = contract.clarityMapPlan(contract.claritySigma(frame.width, frame.height, params[GPU_PARAMS.CLARITY_RADIUS]));
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
    prefetchZoomMasks(canvas, sessionId, locals, editRevision, geometrySignature, sourceOptions, serial, longEdge = 0, requestSignal) {
      if (!sourceOptions?.viewport || sourceOptions?.measureOnly) return;
      const generation = this.resourceGeneration;
      const current = () => generation === this.resourceGeneration
        && serial === this.renderSerials.get(canvas) && sourceOptions?.isCurrent?.() !== false;
      let uncropped = geometrySignature;
      try { uncropped = JSON.stringify({...JSON.parse(geometrySignature), crop: {x: 0, y: 0, width: 1, height: 1}}); } catch { /* keep */ }
      const signal = requestSignal || this.sourceAbortSignal();
      for (const local of locals) {
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
      while (this.denoiseRetirement) await this.denoiseRetirement;
      if (!this.available || !this.device) return false;
      if (this.geometryUnderlayerRender) await this.stopGeometryUnderlayerRender();
      const Scheduler = typeof window !== "undefined" ? window.HDRTileScheduler : null;
      if (!Scheduler) return { rendered: false, refusals: ["tile scheduler is unavailable"] };
      this.activeRenderCount += 1;
      let proxyPin = null;
      try {
      if (this.deliveryActivityTimer) await this.acquireForegroundDeliveryBudget();
      if (sourceSize) this.maskSourceSize = {sessionId,...sourceSize};
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      // Read-only reductions do not supersede the visible canvas generation.
      if (!sourceOptions?.measureOnly) this.renderSerials.set(canvas, serial);
      // The source this pass reads is pinned for the pass: a cache allocation
      // inside the pass may trigger global eviction, and the texture being
      // copied from must never be the victim.
      const tileSize = Math.max(64, Math.floor(Number(sourceOptions?.tileSize) || Scheduler.DEFAULT_TILE_SIZE));
      // The signature is derived from the adjustments this render was handed,
      // exactly as the Direct path derives it, so both request the same proxy.
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const sourceIdentity = sourceOptions?.identity || "source";
      if (lane === "sdr" && adjustments.sdr.linked_to_hdr) {
        localAdjustments = localAdjustments.map(local => ({ ...local, sdr_grade: local.hdr_grade }));
      }
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
      const requestSignal = sourceOptions?.signal
        ? AbortSignal.any([sourceOptions.signal, this.sourceAbortSignal()]) : undefined;
      let proxy = sourceOptions?.analysisPatch
        ? await this.loadProxyRegion(sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity,
          `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}:analysis:${JSON.stringify(region)}`, region,
          {isCurrent: sourceOptions?.isCurrent, signal: requestSignal, peakPatchUpload: sourceOptions?.highlightAnchorOnly})
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

      if (this.prepareLibraryPipelines) await this.prepareLibraryPipelines(surface.format);
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
        params[GPU_PARAMS.HIGHLIGHT_ANCHOR] = await this.resolveHighlightAnchor(anchor, proxy, params, { interactive: false, lane });
      }
      // The finish pass is upstream of output highlights, so this sentinel
      // only changes what the tile reduction reads.  Nothing is presented by
      // an anchor-only pass.
      if (highlightAnchorOnly) params[GPU_PARAMS.HIGHLIGHT_MODE] = -1;

      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[GPU_PARAMS.OVERLAY_ENABLED] = overlayIndex >= 0 ? 1 : 0;
      params[GPU_PARAMS.OVERLAY_OPACITY] = overlayIndex >= 0 ? gpuMaskInfluenceOpacity(activeLocals[overlayIndex].mask) : 0;
      params[GPU_PARAMS.OVERLAY_RED] = Number(overlayColor[0]) || 0;
      params[GPU_PARAMS.OVERLAY_GREEN] = Number(overlayColor[1]) || 0;
      params[GPU_PARAMS.OVERLAY_BLUE] = Number(overlayColor[2]) || 0;

      this.uploadParamsAndCurves(lane, adjustments, curveSampler, params, activeLocals);

      const result = await this.encodeTiledGeneration(canvas, context, proxy, surface, pipelines, params, {
        measureOnly,
        delivery: sourceOptions?.delivery,
        beforeDeliverySubmit: sourceOptions?.beforeDeliverySubmit,
        tileBatchSize: sourceOptions?.tileBatchSize,
        analysisPatch: sourceOptions?.analysisPatch,
        peakReadback: sourceOptions?.peakReadback,
        lensGlowRecipe: adjustments,
        neutralPaperAnchor: highlightAnchorOnly && adjustments[lane].film_look.film_stock === "none",
        analysisMasks: sourceOptions?.analysisMasks,
        analysisNativeLuma: sourceOptions?.analysisNativeLuma,
        claritySurround: sourceOptions?.claritySurround,
        Scheduler,
        serial,
        signal: sourceOptions?.signal,
        requestSignal,
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
        this.cachePeakReduction(anchor.key, measured);
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
    denoiseTile(key, width, height, endpoints = false, packed = false) {
      let entry = this.denoiseTiles.get(key);
      if (entry && entry.width === width && entry.height === height) {
        this.denoiseTiles.delete(key);
        this.denoiseTiles.set(key, entry);
        this.denoiseTileCounters.hits += 1;
        return { ...entry, hit: true };
      }
      if (entry) this.dropDenoiseTiles([key]);
      const byteSize = width * height * (packed ? 16 : 8);
      const cached = this.canRetainDenoiseTile(byteSize);
      // Endpoint blends still need one tile of scratch to keep the same
      // result when the cache is full. Plain resolves already have scratch.
      if (!cached && !endpoints) return null;
      const texture = this.device.createTexture({
        label: "denoise-tile",
        size: { width, height },
        format: packed ? "rgba32uint" : "rgba16float",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
          | (endpoints ? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING : 0),
      });
      entry = { texture, width, height, byteSize, endpoints, transient: !cached };
      if (cached) this.denoiseTiles.set(key, entry);
      this.denoiseTileCounters.misses += 1;
      return { ...entry, hit: false };
    }

    async requestPreparedGrain(grain, { x, y, width, height }, source, signal, warmOnly = false) {
      if (grain.stale) throw grainPreparationReplaced();
      const query = new URLSearchParams({ x, y, width, height, frame_width: source.width, frame_height: source.height });
      if (warmOnly) query.set("warm_only", "true");
      const response = await fetch(`${grain.url}/${grain.token}?${query}`, { signal: denoiseDeadline(signal, 15000) });
      if (response.status === 409) {
        grain.stale = true;
        throw grainPreparationReplaced();
      }
      if (!response.ok) throw new Error(`Clean Grain source request failed (${response.status}).`);
      return response;
    }

    async preparedGrainTile(grain, region, source, isCurrent = () => true, signal = this.librarySignal) {
      const check = () => {
        if (!isCurrent() || signal?.aborted) throw new DOMException("Grain draw cancelled.", "AbortError");
      };
      check();
      if (grain.stale) throw grainPreparationReplaced();
      const { x, y, width, height } = region;
      const key = `grain|${grain.token}|${source.width}x${source.height}|${x},${y},${width},${height}`;
      const previous = this.denoiseTiles.get(key);
      if (previous) {
        this.denoiseTiles.delete(key);
        this.denoiseTiles.set(key, previous);
        try {
          await previous.ready;
          check();
          return previous;
        } catch (error) {
          check();
          if (error?.name !== "AbortError") throw error;
          return this.preparedGrainTile(grain, region, source, isCurrent, signal);
        }
      }
      const byteSize = width * height * 16;
      const cached = this.canRetainDenoiseTile(byteSize);
      const texture = this.device.createTexture({
        label: "prepared-grain",
        size: { width, height },
        format: "rgba32uint",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const entry = { texture, width, height, byteSize, grainToken: grain.token, transient: !cached };
      if (cached) this.denoiseTiles.set(key, entry);
      entry.ready = (async () => {
        const rows = Math.max(1, Math.floor(1024 * 1024 / width));
        for (let offset = 0; offset < height; offset += rows) {
          check();
          const count = Math.min(rows, height - offset);
          const response = await this.requestPreparedGrain(grain, { x, y: y + offset, width, height: count }, source, signal);
          check();
          const body = await response.arrayBuffer();
          check();
          if (body.byteLength !== width * count * 16) throw new Error("Clean Grain returned an incomplete region.");
          const started = this.instrumentationEnabled ? performance.now() : 0;
          this.device.queue.writeTexture({ texture, origin: { x: 0, y: offset } }, body,
            { bytesPerRow: width * 16 }, { width, height: count });
          if (this.instrumentationEnabled) {
            this.recordStage("denoise-tile-upload", { bytes: body.byteLength,
              durationMs: performance.now() - started });
          }
        }
      })();
      try {
        await entry.ready;
        return entry;
      } catch (error) {
        if (cached && this.denoiseTiles.get(key) === entry) this.dropDenoiseTiles([key]);
        else if (!cached) texture.destroy();
        throw error;
      }
    }

    /** Forget these tiles (all of them by default) and release their textures. */
    dropDenoiseTiles(keys = null) {
      for (const key of keys || [...this.denoiseTiles.keys()]) {
        const entry = this.denoiseTiles.get(key);
        if (!entry) continue;
        this.denoiseTiles.delete(key);
        this.releaseGpuCacheValue("denoise-tile", entry);
      }
    }

    // Use the same three backing images previously charged for parked Grain
    // canvases. A retained render target is a separate texture, not a swap.
    gradeCanvasSwapCost(width, height, format) {
      return width * height * (format === "rgba16float" ? 8 : 4) * 3;
    }

    gradeCanvasSwapGrowth(canvas, width, height, format) {
      const previous = this.gradeCanvasSwaps.get(canvas);
      return previous?.width === width && previous?.height === height && previous?.format === format
        ? 0 : this.gradeCanvasSwapCost(width, height, format);
    }

    noteGradeCanvasSwap(canvas, format) {
      this.gradeCanvasSwaps.set(canvas, { width: canvas.width, height: canvas.height, format });
    }

    gradeCanvasSwapBytes({ sharpOnly = false, unregisteredOnly = false } = {}) {
      let bytes = 0;
      for (const [canvas, swap] of this.gradeCanvasSwaps) {
        const sharp = canvas.hdrGrainLayer;
        if (canvas.width !== swap.width || canvas.height !== swap.height
          || (canvas.isConnected === false && !sharp)) {
          this.gradeCanvasSwaps.delete(canvas);
        } else if ((!sharpOnly || sharp) && (!unregisteredOnly || !sharp?.entry)) {
          bytes += this.gradeCanvasSwapCost(swap.width, swap.height, swap.format);
        }
      }
      return bytes;
    }

    cachedGrainCanvasBytes() {
      return this.gradeCanvasSwapBytes({ sharpOnly: true });
    }

    /**
     * Keep the denoised tiles inside a quarter of what the budget has free
     * once everything that is not a tile cache is counted. The detail and mask
     * caches see these bytes as resident, so the three cannot overcommit.
     */
    denoiseTileBudget() {
      const snapshot = this.resourceMemorySnapshot();
      const categories = snapshot.resident?.categories || {};
      const canvasBytes = this.cachedGrainCanvasBytes();
      const cacheBytes = (categories.detailBandCacheBytes || 0) + (categories.maskTileBytes || 0)
        + (categories.denoiseTileBytes || 0) + (categories.fineGrainReducedBytes || 0) + canvasBytes;
      const nonCacheBytes = Math.max(0, (snapshot.resident?.totalBytes || 0) - cacheBytes);
      const free = Math.max(0, this.memoryBudgetBytes() * 0.9 - nonCacheBytes);
      return Math.max(0, Math.max(64 * 1024 * 1024, Math.floor(free * 0.25)) - canvasBytes);
    }

    canRetainDenoiseTile(byteSize) {
      return this.trimDenoiseTiles([], byteSize) + byteSize
        <= Math.max(0, this.denoiseTileBudget() - this.fineGrainReducedBytes());
    }

    trimDenoiseTiles(preferred = [], pendingBytes = 0) {
      let bytes = [...this.denoiseTiles.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      // Do not remove inputs from an encoder that may still be building its
      // batch. A new tile can use scratch instead of entering the cache.
      if (!bytes || (pendingBytes && this.resourceRenderCount)) return bytes;
      const budget = Math.max(0, this.denoiseTileBudget() - this.fineGrainReducedBytes());
      const recent = new Set([...preferred, ...(this.presentedDenoiseTileKeys || [])]);
      const victims = [...this.denoiseTiles].sort(([a], [b]) => Number(recent.has(a)) - Number(recent.has(b)));
      for (const [key, entry] of victims) {
        if (bytes + pendingBytes <= budget) break;
        // The on-screen picture is already composited. Its input tiles get
        // first claim on retention, not an exemption from the allowance.
        this.evictGpuCacheEntry("denoise-tile", key);
        bytes -= entry.byteSize;
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
        this.evictGpuCacheEntry("detail-band-tile", key);
        bytes -= entry.byteSize;
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
      sceneMaskSource = null, hue = null, boundedGeometry = false, retainMask,
    ) {
      const signature = gpuMaskIdentity(batch.local.mask);
      if (hue && proxy && maskHasHueLeaf(batch.local.mask)
        && (!proxy.region || standaloneHueMask(batch.local.mask)
          || regionalHueGraphEligible(batch.local.mask, geometrySignature, proxy.lane, proxy.sourceIdentity, proxy.workingSpace))) {
        // One GPU mask over the region this generation processes, shared by
        // its tiles, made from this lane's picture before HSL.
        // Crop only a single leaf. Its selection needs neighbours beyond the
        // grade tiles' halos; keep that full reach and anchor the coarse grid
        // in frame coordinates, exactly as the whole-source route does.
        // Reserve the supported maximum edge reach so Edge/Feather drags do
        // not resize scratch or discard reusable source preparation each input.
        const halos = batch.tiles.map(tile => tile.haloRect);
        let maskRegion = null;
        if (batch.local.mask.operator === "leaf" && halos.length
          && globalThis.HDRHueMaskRegionalSelection !== false) {
          const grid = globalThis.HDRHslSelectionGpu.geometry(
            hue.params[GPU_PARAMS.SOURCE_PIXEL_SCALE] || 1, { edge: 8, edge_feather: 16 });
          const { cell } = grid;
          const reach = grid.reach + graphScaleContract().blackAndWhiteGuideReach(hue.params);
          const sx = proxy.region?.x || 0, sy = proxy.region?.y || 0;
          const sw = proxy.textureWidth || proxy.width, sh = proxy.textureHeight || proxy.height;
          const x = Math.max(sx, Math.floor((Math.min(...halos.map(r => r.x)) - reach) / cell) * cell);
          const y = Math.max(sy, Math.floor((Math.min(...halos.map(r => r.y)) - reach) / cell) * cell);
          const right = Math.min(sx + sw, Math.ceil((Math.max(...halos.map(r => r.x + r.width)) + reach) / cell) * cell);
          const bottom = Math.min(sy + sh, Math.ceil((Math.max(...halos.map(r => r.y + r.height)) + reach) / cell) * cell);
          maskRegion = { x, y, width: right - x, height: bottom - y };
          if (maskRegion.width === sw && maskRegion.height === sh) maskRegion = null;
        }
        const entry = batch.local.mask.operator === "leaf"
          ? await this.loadGpuHueLeaf(sessionId, batch.local.mask, hue, longEdge, isCurrent, proxy, false, maskRegion)
          : await this.loadGpuMaskGraph(sessionId, batch.local, longEdge, editRevision, geometrySignature,
            isCurrent, signal, true, proxy, hue, retainMask);
        if (entry) {
          entry.wholeFrame = true;
          return { localIndex: batch.localIndex, entries: new Map(batch.tiles.map((tile) => [tile.key, entry])) };
        }
        if (signal?.aborted || !isCurrent()) return { localIndex: batch.localIndex, entries: new Map() };
      }
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
          sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask,
        );
        if (generated) return generated;
      }
      if (this.gpuAnalyticMasksEnabled && proxy
        && window.HDRMaskRaster?.eligible(batch.local.mask, geometrySignature)) {
        const generated = this.loadGpuShapeTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask);
        if (generated) return generated;
      }
      if (this.gpuAnalyticMasksEnabled && proxy && isGpuLinearGradientMask(batch.local.mask, geometrySignature)) {
        return this.loadGpuLinearGradientTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask);
      }
      const lumaRegionSource = sceneMaskSource || (proxy?.region
        && lumaSceneSource(proxy.lane, proxy.sourceIdentity, proxy.workingSpace) ? proxy : null);
      if (this.gpuAnalyticMasksEnabled && lumaRegionSource
        && gpuRegionalGraphEligible(batch.local.mask, geometrySignature)) {
        const graph = await this.loadGpuMaskGraph(sessionId, batch.local, longEdge, editRevision,
          geometrySignature, isCurrent, signal, true, lumaRegionSource, null, retainMask);
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
        sessionId, batch, longEdge, editRevision, geometrySignature, maskSignature: signature,
        sourceEpoch: proxy?.sourceEpoch, pictureRevision: maskHasHueLeaf(batch.local.mask) ? editRevision : undefined,
        boundedGeometry, isCurrent, signal, retainMask,
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
        const values = new Float32Array(PASS_LAYOUTS.record("CROP", { ORIGIN_X: rect.x - x, ORIGIN_Y: rect.y - y, RESERVED_2: 0, RESERVED_3: 0 }));
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
        const values = new Float32Array(PASS_LAYOUTS.record("COMBINE", { OPERATOR: gpuMaskOperatorCode(expression.operator), LEFT_OPACITY: result.opacity, RIGHT_OPACITY: opacity, INVERT: index === children.length - 1 && expression.inverted ? 1 : 0 }));
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
              draw(encoder, reduction, tile.texture, line, new Float32Array(PASS_LAYOUTS.record("BAND_MAXIMUM", { TOP: 0, BOTTOM: rect.height, LEFT: 0, RIGHT: rect.width })));
              draw(encoder, pipelines.maximum, line, one, new Float32Array(PASS_LAYOUTS.record("MAXIMUM", { AXIS: 1 })));
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
            draw(encoder, pipelines.maximum, list, one, new Float32Array(PASS_LAYOUTS.record("MAXIMUM", { AXIS: 1 })));
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
        const region=soft.frameRect||[0,0,1,1];
        const values=new Float32Array([...raster,...PASS_LAYOUTS.record("REGIONAL_ERASE", { FRAME_WIDTH: proxy.width, FRAME_HEIGHT: proxy.height, ORIGIN_X: rect.x, ORIGIN_Y: rect.y, RECT_X: region[0], RECT_Y: region[1], RECT_WIDTH: region[2], RECT_HEIGHT: region[3] })]);
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
      geometrySignature, isCurrent, signal, boundedGeometry = false) {
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
        || (!boundedGeometry && region.width*region.height >= proxy.width*proxy.height*.9)) return null;
      const source = await this.loadProxy(sessionId, "hdr", longEdge, geometrySignature,
        editRevision, "source", {region, regionOnly:true, requireRegion:boundedGeometry, signal, isCurrent});
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

    loadGpuAnalyticRegion(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask) {
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
        ? this.loadGpuShapeTiles(sessionId, regionBatch, longEdge, geometrySignature, `${signature}:region`, isCurrent, proxy, retainMask)
        : this.loadGpuLinearGradientTiles(sessionId, regionBatch, longEdge, geometrySignature, `${signature}:region`, isCurrent, proxy, retainMask);
      if (!result) return null;
      const entry = result.entries.get("region");
      if (!entry) return { localIndex: batch.localIndex, entries: new Map() };
      entry.wholeFrame = true;
      entry.frameRect = [rect.x / proxy.width, rect.y / proxy.height,
        rect.width / proxy.width, rect.height / proxy.height];
      return { localIndex: batch.localIndex, entries: new Map(batch.tiles.map(tile => [tile.key, entry])) };
    }

    loadGpuLinearGradientTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask) {
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
        }
        retainMask?.(entry);
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

    loadGpuShapeTiles(sessionId, batch, longEdge, geometrySignature, signature, isCurrent, proxy, retainMask) {
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
        }
        retainMask?.(entry);
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
        if (protectedKeys.has(key) || entry.allocatorEntry?.pins) continue;
        this.evictGpuCacheEntry("mask-tile", key);
        bytes -= entry.byteSize;
      }
      return bytes;
    }

    retainPresentedTiles(maskKeys = [], denoiseKeys = [], lensGlowFrameKey = null) {
      const masks = new Set(maskKeys);
      const denoise = new Set(denoiseKeys);
      // A frame change can make tiles reclaimable without changing held bytes.
      if ([...(this.presentedMaskKeys || [])].some(key => !masks.has(key))
        || [...(this.presentedDenoiseTileKeys || [])].some(key => !denoise.has(key))
        || this.presentedLensGlowTileFrameKey !== lensGlowFrameKey) {
        this.emptyGrainReclaimBytes = null;
      }
      this.presentedMaskKeys = masks;
      this.presentedDenoiseTileKeys = denoise;
      this.presentedLensGlowTileFrameKey = lensGlowFrameKey;
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
            if (this.resourceRenderCount > 0 || this.activeScopeCount > 0) {
              resolve(trimWhenIdle());
              return;
            }
            this.trimDetailBandTiles();
            this.trimMaskTiles();
            this.trimDenoiseTiles();
            this.gpuAllocator?.enforceBudget();
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
      let analysisTileParams = null;
      const newLensGlowTiles = new Map();
      const maskPins = new Set();
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
      const detailScratch = detailActive || localDetailActive || !options.gradePreview;
      writeClarityPlan(params, proxy.width, proxy.height, params[GPU_PARAMS.CLARITY_RADIUS]);
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
      const adaptiveDenoise = !options.originalSource && this.adaptiveDenoiseFor(proxy);
      const denoiseActive = adaptiveDenoise || (!options.originalSource && Boolean(
        denoiseSelector?.cache && denoiseSelector.original
        && denoiseSelector.selected === "resolved"
        && (denoiseSelector.identity === proxy.identity || (options.analysisMasks && denoiseSelector.original.sessionId === proxy.sessionId && denoiseSelector.original.geometrySignature === proxy.geometrySignature))
        && denoiseSelector.original.width === proxy.width
        && denoiseSelector.original.height === proxy.height,
      ));
      const denoiseSource = adaptiveDenoise ? proxy : null;
      const denoiseControls = denoiseSelector?.controls
        || { amount: 0.75, luminance: 0.5, colorNoise: 0.75, detailRecovery: 0.5 };
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
      const draftGrain = HDRWebGPUPreview.usesDraftGrain(options);
      const grainIdentity = draftGrain && params[GPU_PARAMS.GRAIN_ENABLED] > 0.5 && params[GPU_PARAMS.GRAIN_AMOUNT] > 0
        ? `|draft-grain:${window.HDRWebGPUShaders.GRAIN_SAMPLE_COUNTS.draft}` : "";
      const gradeTileParams = options.gradePreview && !activeLocals.length && !denoiseActive
        ? new Float32Array(params) : null;
      const previous = this.lastPresentedFrame;
      // Saving an optimistic Grade edit leaves the picture's generation
      // unchanged when the backend confirms it verbatim. Keep the retained
      // tiles at that generation if the finish parameters also agree. Local
      // and Denoise inputs can depend on backend assets at the new revision.
      const tileRevision = gradeTileParams && (options.roiCatchUp || options.panPass)
        && this.retainedTiledFrame(options.sessionId, lane, options.geometrySignature || "{}", surface.format)
        && previous.width === proxy.width && previous.height === proxy.height
        && previous.applicationGeneration === Number(options.applicationGeneration ?? 0)
        && previous?.gradeTileParams?.every((value, index) => Object.is(value, gradeTileParams[index]))
        ? previous.tileRevision : editRevision;
      const identity = `${proxy.identity}|${tileRevision}|${surface.format}${noiseView ? "|noise" : ""}${denoiseIdentity}${grainIdentity}`;
      const nodes = ["geometry"];
      if (denoiseActive) nodes.push({ id: "denoise", halo });
      nodes.push("exposure", "white-balance", "curves", "color", "grading");
      // Every neighbourhood node declares the composed reach, because each of
      // them has to be correct over the tile plus whatever the stages after it
      // will read. Detail runs first, so its own reach is the largest.
      if (graphScaleContract().blackAndWhiteGuideReach(params) > 0) nodes.push({ id: "black-and-white", halo });
      if (graphScaleContract().hslSelectionReach(params) > 0) nodes.push({ id: "hsl-selection", halo });
      if (detailActive || localDetailActive) nodes.push({ id: "detail", halo });
      if (activeLocals.length) nodes.push({ id: "mask-feather", halo });
      if (params[GPU_PARAMS.HALATION_ENABLED] > 0.5) nodes.push({ id: "halation", halo });
      if (params[GPU_PARAMS.LENS_FILTER] > 0.5 && params[GPU_PARAMS.LENS_SCATTER] > 0) nodes.push({ id: "lens-filter", halo });
      if (filmNeighbourhoodActive && !spatialActive) nodes.push({ id: "softness", halo });
      if (params[GPU_PARAMS.VIGNETTE_ENABLED] > 0.5 && params[GPU_PARAMS.VIGNETTE_AMOUNT] !== 0) nodes.push("vignette");
      if (params[GPU_PARAMS.FILM_LOOK_ENABLED] > 0.5 && params[GPU_PARAMS.FILM_FINISH_STRENGTH] > 0) nodes.push("grain");
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
      const foregroundRegion = viewport ? viewportRequest.roi : null;
      const pictureRegion = options.boundedPresentation ? viewportRequest.roi : null;
      const pictureWidth = pictureRegion?.width || proxy.width;
      const pictureHeight = pictureRegion?.height || proxy.height;
      const spatialGrid = spatialGridScale(proxy.width, proxy.height);
      // Pad the request by a fraction of itself before selecting foreground
      // tiles. Without the padding a small pan exposes the previous pass's
      // boundary as a seam inside the viewport, because the newly visible strip
      // was never refined. The padding is a mitigation, not a fix: an edit that
      // moves the view further than the padding, or leaves the frame at all,
      // still needs progressive catch-up before the rest of the image matches.
      // Whether the target behind this pass still holds the accepted frame at
      // this exact size, identity and format. This is about the frame, not the
      // request: a whole-frame catch-up retains too, it just has no region to
      // answer from the pan cache. The signature string must be the one this
      // pass stored, never the global helper of the same name.
      const retainedFrame = (measureOnly
        || this.presentationTargetMatches(this.presentationTarget, pictureWidth, pictureHeight, surface.format, pictureRegion))
        && this.retainedTiledFrame(options.sessionId, lane, options.geometrySignature || "{}", surface.format);
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
      const preparedGrain = adaptiveDenoise ? denoiseSelector.cache.grain : null;
      if (options.boundedPresentation && preparedGrain?.token && foregroundTiles.length > 1
          && proxy.width === preparedGrain.width && proxy.height === preparedGrain.height
          && Object.entries(preparedGrainControls(preparedGrain.controls)).every(([key, value]) => denoiseControls[key] === value)) {
        // GPU encoding reads one tile at a time. Send the visible rectangle
        // ahead without downloading any extra pixels, so all of its CPU tiles
        // can run together before unrelated background tiles fill the queue.
        const rects = foregroundTiles.map(tile => tile.haloRect);
        const x = Math.min(...rects.map(rect => rect.x));
        const y = Math.min(...rects.map(rect => rect.y));
        const width = Math.max(...rects.map(rect => rect.x + rect.width)) - x;
        const height = Math.max(...rects.map(rect => rect.y + rect.height)) - y;
        const viewport = { x, y, width, height };
        if (!globalThis.HDRViewportRequest?.covers(preparedGrain.warmedRegion, viewport)) {
          const start = performance.now();
          await this.requestPreparedGrain(preparedGrain, viewport, proxy, options.signal, true);
          preparedGrain.warmedRegion = viewport;
          this.recordStage("denoise_grain_region_ready", { area: "denoise", route: "cpu", reason: "visible_tiles_ready",
            duration_ms: performance.now() - start, width_px: width, height_px: height });
        }
        if (options.isCurrent?.() === false) return { rendered: false, refusals: ["superseded during Grain warmup"] };
      }
      // Grain warmup can await backend work. Check its resulting memory
      // footprint before either presentation or graph allocation.
      if (options.gradeMemory && !measureOnly) {
        const fits = await this.admitGradeMemory("tiled-preview", () => {
          const existing = this.presentationTarget;
          const targetGrowth = this.presentationTargetMatches(existing, pictureWidth, pictureHeight, surface.format, pictureRegion)
            ? 0 : pictureWidth * pictureHeight * (surface.format === "rgba16float" ? 8 : 4);
          const graph = this.tileGraph;
          const graphGrowth = this.tileGraphMatches(graph, workWidth, workHeight, surface.format, proxy.pixelFormat,
            spatialActive, denoiseActive, spatialGrid, detailScratch) ? 0
              : this.tileGraphBytes(workWidth, workHeight, proxy.pixelFormat, spatialActive, denoiseActive, spatialGrid, detailScratch);
          // A batch can hold up to four packed Grain tiles even with no free
          // tile-cache space. The existing graph has its own one-tile resolve.
          const grainScratch = adaptiveDenoise && denoiseSelector.cache.grain && !options.fineGrainReduced
            ? workWidth * workHeight * 16 * 4 : 0;
          const clarityGrowth = !noiseView && foregroundTiles.length && !surround?.global && graphScaleContract().clarityActive(params)
            ? this.gradeClarityMapGrowth("frame", proxy.width, proxy.height, [params[GPU_PARAMS.CLARITY_RADIUS]]) : 0;
          return targetGrowth + graphGrowth + grainScratch + clarityGrowth
            + this.gradeCanvasSwapGrowth(canvas, pictureWidth, pictureHeight, surface.format);
        }, options.isCurrent, options.action);
        if (options.isCurrent?.() === false) return { rendered: false, refusals: ["superseded-before-presentation"] };
        if (!fits) return { rendered: false, appMemoryRefused: true };
      }
      // The retained target holds the accepted frame between generations, so a
      // viewport pass can load it and process only its foreground tiles.
      const presentationTarget = measureOnly
        ? null
        : this.ensurePresentationTarget(pictureWidth, pictureHeight, surface.format, pictureRegion);
      let cancelled = false;
      let lensTileFrameKey = null;
      const graph = this.ensureTileGraph(
        workWidth, workHeight, surface.format, proxy.pixelFormat, spatialActive, denoiseActive,
        spatialGrid, Boolean(options.analysisPatch), detailScratch,
      );
      if (!graph) return { rendered: false, refusals: ["tile graph allocation failed"] };

      const isCurrent = options.isCurrent || (() => true);
      // Parameter buffers the reconstruction encoded against. They must outlive
      // the submission that reads them, so they are freed alongside the local
      // buffers once it has gone through.
      const denoiseParamBuffers = [];
      const cleanGrainTransientTextures = [];
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
      const gpuGrain = adaptiveDenoise && denoiseSelector.cache.grain?.gpu;
      const colourMargin = gpuGrain ? cleanGrainMargin(denoiseControls) : 0;
      const micro = adaptiveDenoise && denoiseSelector.cache.grain?.micro && !options.microQuick;
      const microControls = micro ? denoiseSelector.controls : null;
      const cacheGrainEndpoints = gpuGrain && !denoiseSelector.cache.grain?.micro && options.boundedPresentation && !noiseView;
      const cacheColourDelta = cacheGrainEndpoints && colourMargin > 0;
      const denoiseTileControls = cacheGrainEndpoints ? fineGrainPixelControls(denoiseControls, true) : denoiseControls;
      const denoiseTileIdentity = adaptiveDenoise && !noiseView && !measureOnly
        ? `${cacheGrainEndpoints || micro ? `${denoiseSelector.cache.grain.fitKey}|${proxy.width}x${proxy.height}|${proxy.workingSpace}`
          : denoiseSelector.cache.identity}|${JSON.stringify(denoiseTileControls)}${options.quickCpuGrain ? "|quick" : ""}`
        : null;
      const denoiseStateSeen = denoiseTileIdentity !== null && this.denoiseTileIdentity === denoiseTileIdentity;
      if (denoiseTileIdentity !== null && !denoiseStateSeen) {
        const grainToken = denoiseSelector.cache.grain?.token;
        this.dropDenoiseTiles([...this.denoiseTiles].filter(([, entry]) => (
          (!entry.grainToken || entry.grainToken !== grainToken) && !entry.endpoints
        )).map(([key]) => key));
        this.denoiseTileIdentity = denoiseTileIdentity;
      }
      const denoiseTilePrefix = denoiseStateSeen || cacheGrainEndpoints || micro ? denoiseTileIdentity : null;
      const denoiseHeld = proxy.region || { x: 0, y: 0, width: proxy.width, height: proxy.height };
      const denoiseTileKey = (region) => {
        if (!denoiseTilePrefix) return null;
        const margin = ADAPTIVE_DENOISE_MARGIN + colourMargin;
        const reaches = (start, size, heldStart, heldSize, frameSize) => (
          Math.max(0, start - margin) >= heldStart
          && Math.min(frameSize, start + size + margin) <= heldStart + heldSize
        );
        if (!micro && (!reaches(region.x, region.width, denoiseHeld.x, denoiseHeld.width, proxy.width)
          || !reaches(region.y, region.height, denoiseHeld.y, denoiseHeld.height, proxy.height))) return null;
        return `${denoiseTilePrefix}|${region.x},${region.y},${region.width},${region.height}`;
      };
      // Tiles this pass created, and those whose fill is still in an encoder
      // that has not been submitted: a pass that stops early must not leave a
      // tile behind that was never written.
      const denoiseTilesCreated = [];
      const denoiseTilesUnsubmitted = [];
      const denoiseTilesUsed = [];
      let denoiseTileHits = 0;
      const microBands = new Map();
      const microBandSources = new Map();
      if (micro && pictureRegion && !options.panPass) {
        for (const { haloRect } of foregroundTiles) {
          const { x, y, width, height } = haloRect;
          const band = microBands.get(y);
          const left = Math.min(x, band?.x ?? x);
          microBands.set(y, { x: left, y, width: Math.max(x + width, band ? band.x + band.width : 0) - left,
            height: Math.max(height, band?.height ?? 0) });
        }
      }
      // Tiles are grouped by local and sent as bounded batches: one HTTP
      // request and one coordinator slot per batch, and one mask identity per
      // batch for the backend to compile once.
      const shareMasks = Boolean(options.viewport && !options.analysisMasks && longEdge > SOFT_MASK_MAX_EDGE);
      const uniqueLocals = [], maskIndices = [], indicesBySignature = new Map();
      activeLocals.forEach((local, index) => {
        const signature = shareMasks && !maskHasHueLeaf(local.mask) ? gpuMaskIdentity(local.mask) : null;
        let owner = signature === null ? undefined : indicesBySignature.get(signature);
        if (owner === undefined) {
          owner = uniqueLocals.length;
          if (signature !== null) indicesBySignature.set(signature, owner);
          uniqueLocals.push(local);
          maskIndices.push([]);
        }
        maskIndices[owner].push(index);
      });
      const maskBatches = uniqueLocals.length && foregroundTiles.length && this.maskTileBatch
        ? this.maskTileBatch.plan({ locals: uniqueLocals, tiles: foregroundTiles,
          maxRegionEdge: shareMasks ? Math.min(8192, this.device.limits.maxTextureDimension2D) : 0 })
        : [];
      const sceneMaskSource = options.analysisMasks ? null : await this.loadSceneMaskRegion(
        options.sessionId, proxy, foregroundTiles, activeLocals, longEdge, editRevision,
        options.geometrySignature || "{}", isCurrent, options.requestSignal || this.sourceAbortSignal(), options.nativeGeometryViewport);
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
              const retainMask = (entry) => {
                if (signal.aborted || !isCurrent()) return;
                const allocation = entry?.allocatorEntry;
                if (allocation?.kind === "mask-tile" && !maskPins.has(allocation)) {
                  maskPins.add(this.gpuAllocator.pin(allocation));
                }
              };
              if (options.analysisMasks) {
                const mask = (options.analysisNativeLuma
                  && this.analysisLumaMask(batch.local, proxy, options.geometrySignature || "{}"))
                  || await this.loadEditingMask(options.sessionId, batch.local, editRevision,
                    options.geometrySignature || "{}", proxy, options.sourceSize, isCurrent, signal);
                const entry = mask ? {...mask, wholeFrame:true} : null;
                return {localIndex:batch.localIndex, entries:new Map(batch.tiles.map(tile => [tile.key,entry]))};
              }
              const loaded = options.backendLumaMasks && maskUsesLuminance(batch.local.mask) && !maskHasHueLeaf(batch.local.mask)
                ? await maskLoader().loadCpuMaskTiles(this, { sessionId: options.sessionId, batch, longEdge, editRevision,
                  geometrySignature: options.geometrySignature || "{}", maskSignature: gpuMaskIdentity(batch.local.mask),
                  boundedGeometry: options.nativeGeometryViewport, sourceEpoch: proxy.sourceEpoch, isCurrent, signal, retainMask })
                : await this.loadLocalMaskTiles(options.sessionId, batch, longEdge, editRevision,
                  options.geometrySignature || "{}", isCurrent, signal, proxy, sceneMaskSource,
                  { lane: options.lane, params, proxy }, options.nativeGeometryViewport, retainMask);
              loaded.entries.forEach(retainMask);
              return loaded;
            },
            isCurrent,
            options.requestSignal,
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
            if (tileIndex !== undefined) {
              for (const index of maskIndices[loaded.localIndex]) maskMatrix[tileIndex][index] = entry;
            }
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
          identity: this.clarityFrameInputIdentity(params, proxy, denoiseActive ? denoiseControls : null),
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
      const compositeStart = plan.tileCount + clarityChunks;
      const required = stride * (compositeStart + (pictureRegion ? foregroundTiles.length : 0));
      const tileParamsDescriptor = {
        size: required, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      };
      if (options.analysisPatch) {
        // Peak measurement can run while Grade is waiting for prepared
        // Grain tiles. Keep its coordinates out of the visible tile buffer.
        analysisTileParams = this.device.createBuffer(tileParamsDescriptor);
      } else if (!this.tileCompositeParamBuffer || this.tileCompositeParamBuffer.size < required) {
        this.tileCompositeParamBuffer?.destroy();
        this.tileCompositeParamBuffer = this.device.createBuffer(tileParamsDescriptor);
      }
      const tileParams = analysisTileParams || this.tileCompositeParamBuffer;
      const slots = new Float32Array(required / 4);
      // The Clarity pre-pass's regions take the slots after the tiles'.
      (clarityFrame?.chunks || []).forEach(({ region }, index) => {
        const base = (plan.tileCount + index) * (stride / 4);
        slots.set(params, base);
        slots[base + GPU_PARAMS.TILE_ORIGIN_X] = region.x;
        slots[base + GPU_PARAMS.TILE_ORIGIN_Y] = region.y;
        slots[base + GPU_PARAMS.TILE_VALID_WIDTH] = region.width;
        slots[base + GPU_PARAMS.TILE_VALID_HEIGHT] = region.height;
        slots[base + GPU_PARAMS.FRAME_WIDTH] = proxy.width;
        slots[base + GPU_PARAMS.FRAME_HEIGHT] = proxy.height;
      });
      plan.tiles.forEach((tile, index) => {
        const base = index * (stride / 4);
        slots.set(params, base);
        slots[base + GPU_PARAMS.TILE_ORIGIN_X] = tile.haloRect.x;
        slots[base + GPU_PARAMS.TILE_ORIGIN_Y] = tile.haloRect.y;
        slots[base + GPU_PARAMS.TILE_VALID_WIDTH] = tile.haloRect.width;
        slots[base + GPU_PARAMS.TILE_VALID_HEIGHT] = tile.haloRect.height;
        slots[base + GPU_PARAMS.FRAME_WIDTH] = proxy.width;
        slots[base + GPU_PARAMS.FRAME_HEIGHT] = proxy.height;
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
        slots[base + GPU_PARAMS.SCOPE_WIDTH] = SCOPE_PEAK_GRID;
        slots[base + GPU_PARAMS.SCOPE_HEIGHT] = SCOPE_PEAK_GRID;
      });
      const planIndexOf = new Map(plan.tiles.map((tile, index) => [tile, index]));
      if (pictureRegion) foregroundTiles.forEach((tile, index) => {
        const source = planIndexOf.get(tile) * stride / 4;
        const destination = (compositeStart + index) * stride / 4;
        slots.copyWithin(destination, source, source + stride / 4);
        slots[destination + GPU_PARAMS.TILE_ORIGIN_X] -= pictureRegion.x;
        slots[destination + GPU_PARAMS.TILE_ORIGIN_Y] -= pictureRegion.y;
      });
      this.device.queue.writeBuffer(tileParams, 0, slots);

      const tiledLocalState = buildTiledLocalState(
        proxy.identity, params, activeLocals, lane, options.sourcePixelScale || 1,this.localCurveOffsets,
      );
      const localBandReads = tiledLocalState.map(({ params }) => graphScaleContract().localDetailReadsPackedBands(params));
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
          values[offset + GPU_PARAMS.TILE_ORIGIN_X] = tile.haloRect.x;
          values[offset + GPU_PARAMS.TILE_ORIGIN_Y] = tile.haloRect.y;
          values[offset + GPU_PARAMS.TILE_VALID_WIDTH] = tile.haloRect.width;
          values[offset + GPU_PARAMS.TILE_VALID_HEIGHT] = tile.haloRect.height;
          values[offset + GPU_PARAMS.FRAME_WIDTH] = proxy.width;
          values[offset + GPU_PARAMS.FRAME_HEIGHT] = proxy.height;
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
      const scratchView = graph.detailScratchTexture?.createView();
      const detailResultView = graph.detailResultTexture?.createView();
      const filmView = graph.filmTexture.createView();
      const finishView = graph.finishTexture.createView();
      // No finished picture exists in the noise view, so there is no peak to
      // measure, and reading back an unwritten grid would report a stale one.
      // Neutral's ideal paper may exceed half-float before the HDR shoulder.
      // Keep its anchor maximum in the existing float32 reduction buffer.
      const floatPeak = options.neutralPaperAnchor === true;
      const sharedPeakReadback = floatPeak ? options.peakReadback : null;
      const floatPeakPipeline = floatPeak ? await this.ensurePeakReductionPipeline("scaledFilmPeakReductionMain") : null;
      const peakBytes = (1 + PEAK_HISTOGRAM_BINS) * 4;
      const floatPeakResult = floatPeak ? this.device.createBuffer({size:peakBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}) : null;
      const floatPeakRead = floatPeak && !sharedPeakReadback ? this.device.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}) : null;
      if (floatPeak) {
        this.device.queue.writeBuffer(floatPeakResult,0,new Uint32Array(1+PEAK_HISTOGRAM_BINS));
        localBuffers.push({buffer:floatPeakResult});
      }
      const peakTarget = noiseView || floatPeak ? null : this.ensureScopePeakTarget();
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
          )
          : { current: () => true, release: () => {} };
        if (!presentation) {
          localBuffers.forEach((entry) => entry.buffer.destroy());
          if (peakTarget) peakTarget.busy = false;
          this.recordStage("tiled-refused", { lane, longEdge, refusals: ["superseded-before-presentation"] });
          return { rendered: false, refusals: ["superseded-before-presentation"] };
        }
      }
      // Tiles never reuse a selection: each recomputes over its own halo. The
      // scratch is sized once for the largest region, so it never grows while
      // earlier tiles' commands still wait in the encoder.
      const hslTileEngine = this.hslSelectionEngine(canvas, "tiled");
      const hslTileChannels = hslTileEngine ? this.hslSelectionChannels(params).length : 0;
      if (hslTileChannels) {
        const regions = [...plan.tiles.map((tile) => tile.haloRect), ...(clarityFrame?.chunks || []).map(({ region }) => region)];
        hslTileEngine.ensure(Math.max(1, ...regions.map((r) => r.width)), Math.max(1, ...regions.map((r) => r.height)),
          Math.ceil(hslTileChannels / 4), globalThis.HDRHslSelectionGpu.geometry(params[GPU_PARAMS.SOURCE_PIXEL_SCALE] || 1).cell);
        // An earlier, superseded generation may still hold outgrown textures.
        if (hslTileEngine.retired.length) this.destroyAfterActiveRenders(() => hslTileEngine.dropRetired());
      }
      let encodeError = null;
      const viewerTiles = (canvas === this.canvas || pictureRegion)
        && !measureOnly && !options.delivery && !options.underlayerOnly;
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
      if (!measureOnly) this.scopeSources.delete(pictureRegion ? this.canvas : canvas);
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
        if (cleanGrainTransientTextures.length) {
          const submitted = cleanGrainTransientTextures.splice(0);
          return this.device.queue.onSubmittedWorkDone().finally(() => {
            submitted.forEach(texture => texture.destroy());
          });
        }
      };
      // The denoised picture for one region, left in the graph's source
      // texture: copied from a kept tile, or reconstructed and kept.
      const denoiseInto = async (region) => {
        if (denoiseSelector !== this.denoiseSourceSelector) {
          throw new DOMException("Denoise draw cancelled.", "AbortError");
        }
        if (options.fineGrainReduced) {
          encoder.copyTextureToTexture({ texture: options.fineGrainReduced.texture, origin: region }, {
            texture: noiseView ? graph.denoiseResolvedTexture : graph.sourceTexture,
          }, { width: region.width, height: region.height });
          return;
        }
        const key = denoiseTileKey(region);
        const kept = key ? this.denoiseTile(key, region.width, region.height, cacheGrainEndpoints, cacheColourDelta) : null;
        const extent = { width: region.width, height: region.height, depthOrArrayLayers: 1 };
        const origin = { x: 0, y: 0, z: 0 };
        const blend = () => {
          const params = cacheColourDelta
            ? this.encodePreparedDenoise(encoder, kept, region, { texture: graph.denoiseResolvedTexture },
              region, denoiseControls.colorSplotches).paramBuffer
            : this.encodeFineGrainMix(encoder, kept.texture, graph.denoiseResolvedTexture, region, denoiseControls.grainEvenness);
          denoiseParamBuffers.push(params);
          encoder.copyTextureToTexture({ texture: graph.denoiseResolvedTexture, origin }, { texture: graph.sourceTexture, origin }, extent);
        };
        if (kept?.transient) cleanGrainTransientTextures.push(kept.texture);
        else if (kept) denoiseTilesUsed.push(key);
        if (kept?.hit) {
          denoiseTileHits += 1;
          if (cacheGrainEndpoints) return blend();
          encoder.copyTextureToTexture({ texture: kept.texture, origin }, { texture: graph.sourceTexture, origin }, extent);
          return;
        }
        if (kept && !kept.transient) {
          denoiseTilesCreated.push(key);
          denoiseTilesUnsubmitted.push(key);
        }
        if (micro) {
          const texture = graph.denoiseResolvedTexture;
          const current = () => isCurrent() && denoiseSelector === this.denoiseSourceSelector
            && microControls === denoiseSelector.controls;
          const band = microBands.get(region.y);
          let prepared = microBandSources.get(region.y);
          if (!prepared && band && band.width > region.width
              && (band.width + 2 * MICRO_GRAIN_MARGIN) * (band.height + 2 * MICRO_GRAIN_MARGIN) <= 3000000
              && !window.HDRMicroGrainGpu.regionLimit(this.device, this.microGrainSourceRegion(denoiseSelector, band))) {
            prepared = await this.developMicroGrainRegion(denoiseSelector, band, options.editRevision, current, true, null, options.action);
            microBandSources.set(region.y, prepared);
          }
          const encoded = await this.writeMicroGrainRegion(denoiseSelector, region, { texture }, region,
            options.editRevision, current, encoder, prepared, !measureOnly, options.action);
          denoiseParamBuffers.push(encoded.paramBuffer);
          if (!prepared) cleanGrainTransientTextures.push(encoded.source);
          if (!noiseView) encoder.copyTextureToTexture({ texture, origin }, { texture: graph.sourceTexture, origin }, extent);
          if (kept) encoder.copyTextureToTexture({ texture, origin }, { texture: kept.texture, origin }, extent);
          denoiseTileResolves += 1;
          return;
        }
        // Reconstruct only this region, into a texture the size of one tile,
        // and into the same encoder so the generation stays one submission.
        // The reconstruction reads the original at its true frame position,
        // so the pixels are the ones the whole-frame resolve would produce.
        const resolved = await this.resolveDenoiseProxy(denoiseControls, {
          isCurrent, signal: options.signal, quickCpuGrain: options.quickCpuGrain,
          region: { ...region },
          destination: {
            texture: kept && cacheGrainEndpoints ? kept.texture : graph.denoiseResolvedTexture,
            width: graph.width,
            height: graph.height,
            byteSize: graph.width * graph.height * 8,
            grainEndpoints: Boolean(kept && cacheGrainEndpoints && !cacheColourDelta),
            cleanGrainDelta: Boolean(kept && cacheColourDelta),
          },
          encoder,
          source: denoiseSource,
        });
        if (resolved?.paramBuffer) denoiseParamBuffers.push(resolved.paramBuffer);
        if (resolved?.cleanGrainTransient) cleanGrainTransientTextures.push(resolved.cleanGrainTransient);
        denoiseTileResolves += 1;
        if (kept && cacheGrainEndpoints) return blend();
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
        const placeholder = options.allowPlaceholder && !noiseView && !pictureRegion
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
            buffer: tileParams, offset: (plan.tileCount + chunkIndex) * stride, size: params.byteLength,
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
          const chunkSelection = this.encodeHslSelection(hslTileEngine, encoder, pipelines, bindWith(sourceView, binding), {
            width: region.width, height: region.height, originX: region.x, originY: region.y, params,
          });
          pass(baseView, pipelines.base, chunkSelection
            ? this.bindGraphResources(sourceView, sourceView, binding, sourceView, chunkSelection.view)
            : bindWith(sourceView, binding), region.width, region.height);
          this.encodeClarityPass(encoder, reduced.createView(), pipelines.clarityReduce, bindWith(baseView, binding), texels, true);
          batchTiles += 1;
          if (batchTiles >= tileBatchSize) {
          const grainSubmitted = flushTiles();
          if (grainSubmitted) await grainSubmitted;
          if (options.beforeDeliverySubmit) {
            await this.waitForSubmittedWork();
            await options.beforeDeliverySubmit();
          }
        }
        }
        if (!cancelled) {
          // Any slot carries the frame size and the map's plan, which is all
          // the level and blur passes read from it.
          const binding = { buffer: tileParams, offset: 0, size: params.byteLength };
          const finished = clarityFrame.textures[1];
          if (clarityFrame.reblur) {
            this.encodeClarityLevels(encoder, pipelines, (view) => bindWith(view, binding),
              clarityFrame.textures, clarityFrame.extents);
          }
          clarityFrame.commit();
          clarityMapView = finished.createView();
        }
      }

      if (viewerTiles && !cancelled && !foregroundTiles.length && retainedFrame) {
        lensTileFrameKey = this.presentedLensGlowTileFrameKey;
      }
      if (viewerTiles && !cancelled && foregroundTiles.length) {
        const lensGlowRecipe = !noiseView && !surround && !this.disableLensGlowCache
          && (!clarityFrame || clarityFrame.state === this.clarityFrameMap)
          && lensGlowActive(params) && options.lensGlowRecipe;
        if (lensGlowRecipe) {
          const preparedSource = denoiseActive && options.fineGrainReduced;
          const reconstruction = denoiseActive && !preparedSource
            ? this.lensGlowDenoiseKey(denoiseSelector, denoiseControls, options)
            : null;
          lensTileFrameKey = this.lensGlowCacheKey(preparedSource || proxy, lane, lensGlowRecipe, activeLocals, params,
            [reconstruction, tileSize, halo, clarityFrame?.state.version], !denoiseActive);
        }
        this.setLensGlowTileFrameKey(lensTileFrameKey);
      }

      // Denoise reconstructs into the same encoder, one tile at a time, so this
      // loop has to be able to wait for it. Command order is call order, and
      // every tile is reconstructed before the copy that reads it.
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
          buffer: tileParams, offset: index * stride, size: params.byteLength,
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
        // Each tile selects over its halo rectangle; the halo covers the
        // selection's reach, so the kept interior matches the whole frame.
        const tileSelection = noiseView ? null : this.encodeHslSelection(hslTileEngine, encoder, pipelines, bind(sourceView), {
          width, height, originX: tile.haloRect.x, originY: tile.haloRect.y, params,
        });
        pass(baseView, pipelines.base, noiseView && denoiseActive
          ? bind(sourceView, sourceView, graph.denoiseResolvedTexture.createView())
          : (tileSelection
            ? this.bindGraphResources(sourceView, sourceView, parameterBinding, sourceView, tileSelection.view)
            : bind(sourceView)), width, height);
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
              ? this.encodeSurroundClarityMap(encoder, pipelines, surround, surround.global, params[GPU_PARAMS.CLARITY_RADIUS], proxy, tile.haloRect).createView()
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
              let packedBandsView = finishView;
              if (localBandReads[localIndex]) {
                packedBandsView = detailResultView;
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
              }
              // A local's Clarity map is built here, from this tile's candidate.
              // The halo carries the map's whole reach, so every texel the
              // tile's own pixels read is the one the whole-frame map holds.
              let localClarityView = packedBandsView;
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
                bind(finishView, packedBandsView, localClarityView, localBinding), width, height);
              pass(targetView, pipelines.localDetailMix,
                bind(localSource.createView(), maskView, scratchView, localBinding), width, height);
            } else {
              pass(targetView, pipelines.local,
                bind(localSource.createView(), maskView, maskView, localBinding), width, height);
            }
            localSource = target;
          });

          const lensGlowTile = this.lensGlowTileFor(
            lensTileFrameKey, tile.haloRect, graph.spatialGrid, maskMatrix[index], newLensGlowTiles,
          );
          this.encodeFilmChain(encoder, pipelines, graph, localSource.createView(),
            (source, spatial, original) => bind(source, spatial, original), params, width, height,
            { interactive: draftGrain, pruneGrain: options.gradePreview, lensGlowTile, parameterBinding });
        }
        if (options.delivery) {
          encoder.copyTextureToTexture(
            {texture:graph.finishTexture, origin:[tile.rect.x-tile.haloRect.x,tile.rect.y-tile.haloRect.y]},
            {texture:options.delivery.texture, origin:[tile.rect.x,tile.rect.y]},
            [tile.rect.width,tile.rect.height]);
          options.delivery.params = new Float32Array(params);
        }
        // The finished tile is measured before it is composited, because the
        // composite encodes for the display and this has to read the picture.
        // On a measurement pass this is the only thing the tile is for.
        if (peakTarget || floatPeak) {
          let peakTexture = graph.finishTexture;
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
            patchValues[GPU_PARAMS.TILE_ORIGIN_X] = tile.rect.x;
            patchValues[GPU_PARAMS.TILE_ORIGIN_Y] = tile.rect.y;
            patchValues[GPU_PARAMS.TILE_VALID_WIDTH] = tile.rect.width;
            patchValues[GPU_PARAMS.TILE_VALID_HEIGHT] = tile.rect.height;
            const patchBuffer = this.createStorageBuffer(patchValues);
            this.device.queue.writeBuffer(patchBuffer, 0, patchValues);
            peakTexture = patchTexture;
            const patchView = patchTexture.createView();
            peakBindGroup = this.bindGraphResources(patchView, patchView, { buffer: patchBuffer }, patchView);
            this.destroyAfterActiveRenders(() => { patchTexture.destroy(); patchBuffer.destroy(); });
          }
          if (floatPeak) {
            const reduction=encoder.beginComputePass();
            reduction.setPipeline(floatPeakPipeline);
            reduction.setBindGroup(0,this.device.createBindGroup({layout:floatPeakPipeline.getBindGroupLayout(0),entries:[
              {binding:0,resource:peakTexture.createView()},
              {binding:1,resource:parameterBinding},
              {binding:2,resource:{buffer:floatPeakResult}},
            ]}));
            reduction.dispatchWorkgroups(Math.ceil(Math.min(width,peakTexture.width)/8),Math.ceil(Math.min(height,peakTexture.height)/8));
            reduction.end();
          } else {
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
        }
        if (!measureOnly) {
          const overlayView = options.overlayIndex >= 0
            ? maskMatrix[index][options.overlayIndex].texture.createView()
            : sourceView;
          const binding = pictureRegion ? {
            buffer: tileParams, offset: (compositeStart + position) * stride, size: params.byteLength,
          } : parameterBinding;
          const compositeBind = bind(noiseView ? baseView : finishView, sourceView, overlayView, binding);
          const compositePass = encoder.beginRenderPass({
            colorAttachments: [{
              view: canvasView,
              // A retained ROI pass loads the accepted frame and overwrites
              // only the tiles it processed; the first full pass clears.
              loadOp: position === 0 && !retainedFrame && !regionOnly ? "clear" : "load",
              clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
            }],
          });
          const rect = pictureRegion ? intersect(tile.rect, pictureRegion) : tile.rect;
          compositePass.setScissorRect(rect.x - (pictureRegion?.x || 0), rect.y - (pictureRegion?.y || 0),
            rect.width, rect.height);
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
        if (batchTiles >= tileBatchSize) {
          const grainSubmitted = flushTiles();
          if (grainSubmitted) await grainSubmitted;
          // Catch-up paints offscreen tiles after the visible region is ready.
          // Keep only one batch on the device so a zoom/pan/edit can cancel it
          // at the next tile boundary. Queueing the entire native frame here
          // made the next foreground view wait seconds behind obsolete grain.
          // Delivery and measurement retain their existing submission policy.
          if (options.roiCatchUp && !measureOnly) await this.waitForSubmittedWork();
          if (options.beforeDeliverySubmit) {
            await this.waitForSubmittedWork(); await options.beforeDeliverySubmit();
          }
        }
      }

      // A superseded generation stops before the next batch is submitted: the
      // batches already submitted finish, and nothing further is encoded or
      // presented.
      if (!cancelled) {
        const grainSubmitted = flushTiles();
        if (grainSubmitted) await grainSubmitted;
        cancelled = Boolean(presentationTarget && (!presentation.current() || !isCurrent()));
      }
      if (!cancelled && pictureRegion) {
        validationScopeOpen = false;
        validationError = await this.device.popErrorScope();
        cancelled = !presentation.current() || !isCurrent()
          || options.coversViewport?.(pictureRegion, proxy.width, proxy.height) === false;
        if (validationError && !cancelled) {
          floatPeakRead?.destroy();
          this.dropDenoiseTiles(denoiseTilesCreated);
          if (peakTarget) peakTarget.busy = false;
          return { rendered: false, refusals: [`validation: ${validationError.message}`] };
        }
      }
      if (cancelled) {
        floatPeakRead?.destroy();
        // Some of the map's pre-pass may never be submitted, so its record of
        // what it holds cannot be trusted.
        if (clarityFrame) this.clarityFrameMap = null;
        this.recordStage("tiled-cancelled", {
          lane, processedTiles, foregroundTiles: foregroundTiles.length, submissions,
        });
        return { rendered: false, refusals: ["superseded-during-encode"] };
      }
      if (presentationTarget) {
        const { width, height } = presentationTarget;
        canvas.hdrFrameRegion = pictureRegion ? { ...pictureRegion, frameWidth: proxy.width, frameHeight: proxy.height } : null;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        this.configureSurface(canvas, context, lane === "hdr");
        // One copy hands the completed frame to the canvas: the swap chain is
        // never presented cleared or half-written, whatever the pass did to
        // the target.
        encoder.copyTextureToTexture(
          { texture: presentationTarget.texture },
          { texture: context.getCurrentTexture() },
          { width, height },
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
      if (floatPeak) encoder.copyBufferToBuffer(floatPeakResult, 0,
        sharedPeakReadback?.buffer || floatPeakRead, sharedPeakReadback?.offset ?? 0, 4);
      submissions += 1;
      this.device.queue.submit([encoder.finish()]);
      if (presentationTarget && options.gradeMemory) this.noteGradeCanvasSwap(canvas, surface.format);
      if (presentationTarget) options.onFrameSubmitted?.(canvas.hdrFrameRegion, surface.hdr);
      denoiseTilesUnsubmitted.length = 0;
      this.recordSubmission(lane, options, 0);
      } catch (error) {
        encodeError = error;
      } finally {
        presentation?.release();
        if (hslTileEngine?.retired.length) this.destroyAfterActiveRenders(() => hslTileEngine.dropRetired());
        localBuffers.forEach((entry) => entry.buffer.destroy());
        denoiseParamBuffers.forEach((buffer) => buffer.destroy());
        cleanGrainTransientTextures.forEach(texture => texture.destroy());
        for (const source of microBandSources.values()) source.texture.destroy();
        // A cancelled or failed pass never submitted its last encoder.
        this.dropDenoiseTiles(denoiseTilesUnsubmitted);
        if (cancelled || encodeError) {
          if (peakTarget) peakTarget.busy = false;
        }
        if (validationScopeOpen) validationError = await this.device.popErrorScope();
      }
      if (encodeError) {
        floatPeakRead?.destroy();
        if (clarityFrame) this.clarityFrameMap = null;
        throw encodeError;
      }
      if (validationError) {
        floatPeakRead?.destroy();
        if (clarityFrame) this.clarityFrameMap = null;
        this.dropDenoiseTiles(denoiseTilesCreated);
        if (peakTarget) peakTarget.busy = false;
        this.recordStage("tiled-validation-error", { message: validationError.message });
        return { rendered: false, refusals: [`validation: ${validationError.message}`] };
      }
      for (const entry of newLensGlowTiles.values()) entry.ready = true;
      newLensGlowTiles.clear();
      if (viewerTiles) {
        const keptDenoise = denoiseActive && !options.fineGrainReduced
          ? reusedTiles.map(tile => denoiseTileKey(tile.haloRect)).filter(Boolean) : [];
        this.retainPresentedTiles(pinnedMasks, [...denoiseTilesUsed, ...keptDenoise], lensTileFrameKey);
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
          // source identity and working space to plan a fetch after the proxy is retired.
          sourceIdentity: proxy.sourceIdentity,
          workingSpace: proxy.workingSpace,
          applicationGeneration: Number(options.applicationGeneration ?? 0),
          gradeTileParams,
          tileRevision,
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
      if (floatPeakRead) {
        try {
          await floatPeakRead.mapAsync(GPUMapMode.READ);
          measuredPeak = new Float32Array(floatPeakRead.getMappedRange())[0];
        } finally { if(floatPeakRead.mapState === "mapped") floatPeakRead.unmap(); floatPeakRead.destroy(); }
      }
      if (peakTarget) {
        if (processedTiles > 0) measuredPeak = await this.readScopePeak(peakTarget);
        else peakTarget.busy = false;
      }
      if (measuredPeak !== null && !measureOnly && !grainIdentity) {
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
        detailBandStacks: (detailActive ? 1 : 0) + localBandReads.filter(Boolean).length,
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
        approximate: Boolean(grainIdentity),
        hdr: surface.hdr, proxyFormat: proxy.pixelFormat,
        sourceSerial: proxy.sourceSerial ?? null, execution: "tiled", metrics,
      };
      } finally {
        analysisTileParams?.destroy();
        for (const pin of maskPins) this.gpuAllocator.unpin(pin);
        for (const [key, entry] of newLensGlowTiles) {
          if (this.lensGlowTiles.get(key) === entry) this.evictGpuCacheEntry("lens-glow-tile", key);
        }
        this.scheduleTileCacheTrim();
      }
    }

    /** Record why a render declined, so a falsy result is diagnosable. */
    refuseRender(reason, backgroundUnderlayer = false) {
      if (!backgroundUnderlayer) this.lastRenderRefusal = { reason, at: performance.now() };
      this.recordStage("render-refused", { reason, backgroundUnderlayer });
      return false;
    }

    // A lane switch can keep the image the viewer already rendered before
    // the other lane takes over the single Denoise selector. Use the same
    // compositor/format as the original, not a tone-mapped canvas screenshot.
    async copyComparisonPicture(canvas, {sessionId, lane, generation, geometry, sourceSerial, maxLongEdge, isCurrent}) {
      const primary = this.canvas;
      const frame = this.lastPresentedFrame;
      if (!this.available || primary.hdrFrameRegion || frame?.sessionId !== sessionId
        || frame.lane !== lane || frame.applicationGeneration !== generation || frame.geometrySignature !== geometry
        || primary.width !== frame.width || primary.height !== frame.height
        || Math.max(frame.width, frame.height) > maxLongEdge) return null;
      const source = this.scopeSources.get(primary);
      const direct = frame.execution === "direct" && source?.serial === sourceSerial
        && source?.comparisonComposite && source.applicationGeneration === generation;
      const target = frame.execution === "tiled" && this.presentationTarget;
      const tiled = target?.valid && !target.region && target.width === frame.width
        && target.height === frame.height && target.format === frame.format;
      if (!direct && !tiled) return null;
      const current = () => isCurrent() && this.lastPresentedFrame === frame
        && this.scopeSources.get(primary) === source && (!tiled || this.presentationTarget === target);
      const {width, height, format} = frame;
      if (!await this.admitGradeMemory("comparison-picture", () => this.gradeCanvasSwapGrowth(canvas, width, height, format), current)
        || !current()) return null;
      const context = canvas.getContext("webgpu");
      if (!context) return null;
      const probe = this.surfaceProbeCanvas();
      const surface = this.configureSurface(probe, probe.getContext("webgpu"), lane === "hdr");
      if (surface.format !== format) return null;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      this.configureSurface(canvas, context, lane === "hdr");
      const texture = context.getCurrentTexture();
      const encoder = this.device.createCommandEncoder();
      if (tiled) {
        encoder.copyTextureToTexture({texture: target.texture}, {texture}, {width, height});
      } else {
        const pass = encoder.beginRenderPass({colorAttachments: [{
          view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: {r: 0, g: 0, b: 0, a: 1},
        }]});
        pass.setPipeline(this.pipelineFor(format).composite);
        pass.setBindGroup(0, source.comparisonComposite);
        pass.draw(3);
        pass.end();
      }
      this.device.queue.submit([encoder.finish()]);
      this.noteGradeCanvasSwap(canvas, format);
      return { width, height, resourceGeneration: this.resourceGeneration };
    }

    async renderTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203, sourceSize = null, sourceOptions = null) {
      while (this.denoiseRetirement) await this.denoiseRetirement;
      const renderFrame = () => this.renderToFrame(canvas, sessionId, lane, adjustments, curveSampler, longEdge,
        localAdjustments, editRevision, maskOverlay, referenceWhiteNits, sourceSize, sourceOptions);
      if (!sourceOptions?.backgroundUnderlayer) {
        if (this.geometryUnderlayerRender) await this.stopGeometryUnderlayerRender();
        return renderFrame();
      }
      if (this.geometryUnderlayerRender || this.activeRenderCount || this.activeScopeCount
        || this.deliveryWaitingCount || sourceOptions.isCurrent?.() === false) return false;
      let release;
      const unwound = new Promise((resolve) => { release = resolve; });
      this.geometryUnderlayerRender = { cancel: sourceOptions.cancelUnderlayer, unwound };
      try {
        return await renderFrame();
      } finally {
        this.geometryUnderlayerRender = null;
        release();
      }
    }

    async renderToFrame(canvas, sessionId, lane, adjustments, curveSampler, longEdge, localAdjustments, editRevision, maskOverlay, referenceWhiteNits, sourceSize, sourceOptions) {
      const backgroundUnderlayer = Boolean(sourceOptions?.backgroundUnderlayer);
      const backgroundSignal = backgroundUnderlayer ? sourceOptions.signal : null;
      const refuse = (reason) => this.refuseRender(reason, backgroundUnderlayer);
      const gradeMemory = this.observeGradeMemory && !sourceOptions?.delivery && !sourceOptions?.measureOnly
        && !sourceOptions?.scopeAnalysis && !sourceOptions?.frameAnchor && !sourceOptions?.gradeLibraryPicture;
      if (!this.available || !sessionId) return refuse("unavailable-or-no-session");
      if (lane === "sdr" && adjustments.sdr.linked_to_hdr) {
        localAdjustments = localAdjustments.map(local => ({ ...local, sdr_grade: local.hdr_grade }));
      }
      const activeLocals = activeGpuLocals(lane, localAdjustments);
      // Eligibility is deliberately checked before resetting a session or
      // requesting a proxy. Unsupported local modules use the CPU renderer,
      // and must not first pay for a WebGPU proxy that cannot be presented.
      if (!activeLocals.every((local) => gpuLocalSupported(local[`${lane}_grade`]))) return refuse("unsupported-local-adjustment");
      const renderStartedAt = performance.now();
      this.activeRenderCount += 1;
      let proxyPin = null;
      let replacementProxyPin = null;
      const canvasPin = this.gpuAllocator?.pin(canvas.hdrGrainLayer?.entry);
      let draftPresentation = null;
      let cleanGrainBlend = null;
      let reducedGrain = null;
      let draftReturned = false;
      let lensGlowKey = null;
      try {
      if (this.deliveryActivityTimer && !backgroundUnderlayer) await this.acquireForegroundDeliveryBudget();
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      if (sourceSize) this.maskSourceSize = {sessionId,...sourceSize};
      const resourceGeneration = this.resourceGeneration;
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      this.renderSerials.set(canvas, serial);
      const currentRender = () => resourceGeneration === this.resourceGeneration && serial === this.renderSerials.get(canvas)
        && sourceOptions?.isCurrent?.() !== false;
      // Physical paper/scan variants must arrive before this recipe is drawn.
      const filmRecipe = adjustments[lane === "sdr" && adjustments.sdr.linked_to_hdr ? "hdr" : lane]?.film_look || {};
      await this.waitForUnderlayerPreparation(window.HDRFilmStocks?.request(filmRecipe.film_stock || "none", filmRecipe), backgroundSignal);
      if (resourceGeneration !== this.resourceGeneration || serial !== this.renderSerials.get(canvas)
        || sourceOptions?.isCurrent?.() === false) return refuse("superseded-before-stock");
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
      const coarseFetchSignal = (sourceOptions?.cancelCoarseFetches || backgroundUnderlayer) && sourceOptions.signal
        ? AbortSignal.any([sourceOptions.signal, this.sourceAbortSignal()]) : undefined;
      // A Match candidate grades the scene picture as SDR whatever the SDR
      // lane's own source is, so it names the lane its source comes from.
      const sourceLane = sourceOptions?.sourceLane || lane;
      const requireRegion = region?.requireRegion || (sourceOptions?.nativeGeometryViewport && (Boolean(region)
        || !this.wholeSourceResident(sessionId, sourceLane, longEdge, geometrySignature, sourceIdentity)));
      if (requireRegion && !region) return refuse("required-source-region-unavailable");
      const gateSource = (requestedRegion) => this.admitGradeMemory("source-proxy",
        () => this.gradeSourceGrowth(sessionId, sourceLane, longEdge, geometrySignature, sourceIdentity,
          requestedRegion, sourceOptions?.frameSize, sourceSize), currentRender, sourceOptions?.action);
      if (gradeMemory) {
        const fits = await gateSource(region);
        if (!currentRender()) return refuse("superseded-before-proxy");
        if (!fits) return refuse("app-memory-ceiling");
      }
      this.prefetchZoomMasks(canvas, sessionId, activeLocals, editRevision, geometrySignature, sourceOptions, serial, longEdge, coarseFetchSignal);
      const sourceStartedAt = performance.now();
      const loadSource = (region, requireRegion = false) => this.loadProxy(
        sessionId,
        sourceLane,
        longEdge,
        geometrySignature,
        editRevision,
        sourceIdentity,
        {
          isCurrent: () => this.sourceLoadIsCurrent(canvas, serial, resourceGeneration, sourceOptions),
          signal: coarseFetchSignal,
          scopeRequest: Boolean(sourceOptions?.scopeAnalysis && coarseFetchSignal),
          backgroundUnderlayer,
          headers: sourceOptions?.action ? globalThis.HDRDiagnostics?.headers?.(sourceOptions.action) : undefined,
          onProgress: sourceOptions?.onSourceProgress,
          region,
          requireRegion,
          reuseRegionOverlap: this.adaptiveDenoiseSelected()
            && this.denoiseSourceSelector.cache.grain?.gpu
            && this.denoiseSourceSelector.controls.method === "clean_grain",
        },
      );
      // The transport can fall through from a regional miss to a whole
      // upload. Do not fund that bigger allocation with the region estimate.
      let proxy = await loadSource(region, requireRegion || Boolean(gradeMemory && region));
      if (!proxy && gradeMemory && region && !requireRegion && currentRender()) {
        const fits = await gateSource(null);
        if (!currentRender()) return refuse("superseded-before-proxy");
        if (!fits) return refuse("app-memory-ceiling");
        proxy = await loadSource(null);
      }
      const proxyReadyAt = performance.now();
      if (sourceOptions?.action && sourceOptions.fineGrainGrade) {
        globalThis.HDRDiagnostics?.event?.("denoise", "grain_source_ready", {
          lane, long_edge_px: longEdge, duration_ms: proxyReadyAt - sourceStartedAt, bounded: Boolean(proxy?.region),
        }, sourceOptions.action);
      }
      if (resourceGeneration !== this.resourceGeneration
        || serial !== this.renderSerials.get(canvas)
        || sourceOptions?.isCurrent?.() === false) return refuse("superseded-before-proxy");
      if (!proxy) return refuse(requireRegion ? "required-source-region-unavailable" : "superseded-before-proxy");
      let sourceProxy = this.selectedDenoiseSource(proxy);
      // Export's Match analysis reads the source as decoded, not a reconstruction.
      // So does the Before view, which shows the picture without Denoise.
      if (sourceOptions?.frameAnchor || sourceOptions?.originalSource) sourceProxy = proxy;
      proxyPin = this.gpuAllocator && proxy.allocatorEntry ? this.gpuAllocator.pin(proxy.allocatorEntry) : null;
      let masks = [];
      let masksReadyAt = proxyReadyAt;

      // A lane switch can change swap-chain format. Probe on a one-pixel
      // canvas while the mounted whole-photo layer still shows the old frame.
      const surfaceCanvas = gradeMemory || sourceOptions?.deferSurface ? this.surfaceProbeCanvas() : canvas;
      const surfaceContext = surfaceCanvas === canvas ? context : surfaceCanvas.getContext("webgpu");
      const wantsHdr = lane === "hdr" && !sourceOptions?.forceSdrSurface;
      let surface = this.configureSurface(surfaceCanvas, surfaceContext, wantsHdr);
      if (this.prepareLibraryPipelines) await this.prepareLibraryPipelines(surface.format);
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
      const releaseGradeScratch = this.committedGradeScratch(sourceOptions, params, activeLocals, lane,
        detailActive, localDetailActive, spatialActive);
      const retainedIntermediate = this.intermediates.get(canvas);
      const lensGlowCache = !releaseGradeScratch?.spatial && Boolean((retainedIntermediate?.width === proxy.width
          && retainedIntermediate?.height === proxy.height && retainedIntermediate?.lensGlowTexture)
        || (!sourceOptions?.delivery && !sourceOptions?.measureOnly
          && params[GPU_PARAMS.FILM_RESPONSE_ENABLED] >= 0.5 && params[GPU_PARAMS.FILM_LOOK_STRENGTH] > 0
          && params[GPU_PARAMS.LENS_FILTER] > 0.5 && params[GPU_PARAMS.LENS_SCATTER] > 0));
      // Admission runs against the graph this render is about to build, so the
      // plan and the decision describe real work rather than a generic guess.
      // Stale levels leave before admission, so the plan charges what the
      // device will actually hold for this render.
      if (!sourceOptions?.scopeAnalysis && !sourceOptions?.keepProxies) this.evictStaleProxies({ sessionId, lane, geometrySignature, sourceIdentity, keep: proxy.identity });
      const cleanGrain = this.adaptiveDenoiseFor(proxy) ? this.denoiseSourceSelector.cache.grain : null;
      const quickCpuGrain = Boolean(cleanGrain?.token && sourceOptions?.fineGrainUnderlayer);
      const useMicro = cleanGrain?.micro && !sourceOptions?.originalSource;
      const microNative = useMicro && proxy.width === cleanGrain.width && proxy.height === cleanGrain.height;
      const microQuick = useMicro && !microNative && (sourceOptions?.microQuick || sourceOptions?.fineGrainUnderlayer
        || sourceOptions?.tier === "interactive" || sourceOptions?.measureOnly || sourceOptions?.scopeAnalysis);
      const plan = this.planRender(proxy.width, proxy.height, {
        executionOverride: microNative ? "tiled" : this.executionOverrideFor(sourceOptions),
        // A region proxy covers only the visible area; if Direct is admitted
        // the whole frame is loaded below, so admission charges it now.
        pendingSourceBytes: proxy.region ? proxy.width * proxy.height * (proxy.pixelFormat === "rgba16float" ? 8 : 16) : 0,
        cleanGrain: Boolean(cleanGrain?.token && !quickCpuGrain),
        detailActive: detailActive || localDetailActive,
        spatialActive,
        lensGlowCache,
        lensKernelActive: lensGlowActive(params),
        // Without this the tiled model sizes its working set to a bare tile
        // while the encoder builds one tile plus its halo, and admission would
        // be decided against a working set nobody allocates. A spatial graph
        // makes the gap large: a 256 tile with a 136 halo is 528 on a side.
        halo: this.composedTileHalo(proxy.width, proxy.height, params, activeLocals, lane).halo,
        sourceBytesPerPixel: proxy.pixelFormat === "rgba16float" ? 8 : 16,
        tier: sourceOptions?.tier ?? null,
        hslSelectionChannels: this.hslSelectionTemplate ? this.hslSelectionChannels(params).length : 0,
        backgroundUnderlayer,
      });
      if (backgroundUnderlayer && plan.decision.mode !== "direct") return null;
      // A region source belongs to the tiled route. When admission chooses
      // Direct for a viewport request, Direct executes every active node over
      // the whole frame, so it needs the whole-frame source: load it here.
      if (proxy.region && plan.decision.mode !== "tiled") {
        if (gradeMemory) {
          const fits = await gateSource(null);
          if (!currentRender()) return refuse("superseded-before-proxy");
          if (!fits) return refuse("app-memory-ceiling");
        }
        const whole = await loadSource(null);
        if (whole) {
          proxy = whole;
          replacementProxyPin = this.gpuAllocator?.pin(whole.allocatorEntry);
          sourceProxy = sourceOptions?.originalSource ? proxy : this.selectedDenoiseSource(proxy);
        }
      }
      // Direct grades one whole-frame texture, so adaptive Denoise fills its
      // reconstruction here, the first time this frame is drawn that way.
      if (gradeMemory && plan.decision.mode !== "tiled") {
        const fits = await this.admitGradeMemory("direct-preview", () => {
          const resident = retainedIntermediate?.width === proxy.width && retainedIntermediate?.height === proxy.height
            ? retainedIntermediate : null;
          const { width, height } = proxy;
          const pixels = width * height;
          const spatialGrid = spatialGridScale(width, height);
          const spatialBytes = Math.ceil(width / spatialGrid) * Math.ceil(height / spatialGrid) * 8;
          const clarityRadii = activeLocals.filter(local => graphScaleContract().localClarityActive(local[`${lane}_grade`]))
            .map(local => Number(local[`${lane}_grade`].detail.clarity_radius_percent) || 0.75);
          if (graphScaleContract().clarityActive(params)) clarityRadii.push(params[GPU_PARAMS.CLARITY_RADIUS]);
          const clarityGrowth = sourceOptions?.noiseView ? 0 : this.gradeClarityMapGrowth("work", width, height, clarityRadii);
          return this.gradeCanvasSwapGrowth(canvas, width, height, surface.format) + clarityGrowth
            + (resident ? 0 : pixels * 8 * 4)
            + ((detailActive || localDetailActive) && !resident?.detailATexture ? pixels * 8 * 2 : 0)
            + (spatialActive && !resident?.spatialATexture ? spatialBytes * 2 : 0)
            + (lensGlowCache && !resident?.lensGlowTexture ? spatialBytes : 0);
        }, currentRender, sourceOptions?.action);
        if (!currentRender()) return refuse("superseded-before-intermediate");
        if (!fits) return refuse("app-memory-ceiling");
      }
      const reduceGrain = !microQuick && !sourceOptions?.fineGrainUnderlayer && !sourceOptions?.originalSource
        && !sourceOptions?.delivery && !sourceOptions?.frameAnchor && !sourceOptions?.measureOnly;
      reducedGrain = reduceGrain
        ? await this.ensureFineGrainReduced(proxy, editRevision, currentRender, sourceOptions?.tier === "interactive", sourceOptions?.signal, sourceOptions?.action) : null;
      if (!currentRender()) return refuse("superseded-before-grain-blend");
      if (reducedGrain?.cleanGrainDelta) {
        const strength = this.denoiseSourceSelector.controls.colorSplotches;
        cleanGrainBlend = this.blendReducedCleanGrain(reducedGrain, strength);
      }
      const fineGrainReduced = cleanGrainBlend || reducedGrain;
      const approximateDenoise = Boolean(reduceGrain && sourceOptions?.tier === "interactive"
        && cleanGrain?.gpu && !fineGrainReduced
        && (proxy.width !== cleanGrain.width || proxy.height !== cleanGrain.height));
      if (fineGrainReduced && plan.decision.mode !== "tiled") sourceProxy = fineGrainReduced;
      else if (!sourceOptions?.originalSource && plan.decision.mode !== "tiled"
        && await this.ensureDenoiseResolved(proxy, currentRender, sourceOptions?.signal, quickCpuGrain)) {
        if (resourceGeneration !== this.resourceGeneration
          || serial !== this.renderSerials.get(canvas)
          || sourceOptions?.isCurrent?.() === false) return refuse("superseded-before-proxy");
        sourceProxy = sourceOptions?.frameAnchor || sourceOptions?.originalSource ? proxy : this.selectedDenoiseSource(proxy);
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
      const finishedSdrAnchor = anchor && lane === "sdr" && plan.decision.mode !== "tiled"
        && (sourceOptions?.tier !== "interactive" || sourceOptions?.frameAnchor || this.liveMode);
      if (backgroundUnderlayer && anchor && !finishedSdrAnchor) {
        params[GPU_PARAMS.HIGHLIGHT_ANCHOR] = this.peakReductionCache.get(anchor.key) ?? anchor.cached
          ?? this.carriedHighlightAnchor(lane, sourceProxy, params) ?? params[GPU_PARAMS.HIGHLIGHT_ANCHOR];
      } else if (anchor && !finishedSdrAnchor) {
        const interactive = sourceOptions?.tier === "interactive";
        // An interactive frame that stopped for a whole-image reduction would
        // miss its deadline, so it carries the last measurement instead and
        // the skipped measurement runs afterwards.
        params[GPU_PARAMS.HIGHLIGHT_ANCHOR] = await this.resolveHighlightAnchor(anchor, sourceProxy, params, { interactive, lane });
        if (!interactive && anchor.cached === undefined) {
          if (resourceGeneration !== this.resourceGeneration) return refuse("peak:resource-generation");
          if (serial !== this.renderSerials.get(canvas)) return refuse("peak:newer-render-started");
          if (sourceOptions?.isCurrent?.() === false) return refuse("peak:application-not-current");
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
          backgroundUnderlayer,
          measureOnly: sourceOptions?.measureOnly,
          remember: !sourceOptions?.measureOnly || Boolean(sourceOptions?.scopeAnalysis),
          hue: { lane, params: new Float32Array(params), proxy: sourceProxy },
          requestSignal: coarseFetchSignal,
        });
        masks = loadedMasks.results;
        masksReadyAt = performance.now();
        if (!loadedMasks.current || !isMaskCurrent()
          || masks.some((mask) => !mask)
        ) return refuse("superseded-after-masks");
      }
      const measuredPeak = params[GPU_PARAMS.HIGHLIGHT_ANCHOR];
      // The resize happens at presentation time, not here. Resizing a visible
      // canvas clears its presented frame, and this generation still has an
      // intermediate graph to build and passes to encode; clearing before then
      // would leave the viewer with nothing if the encode failed or was
      // superseded. The presentation gate below is the only place that resizes.
      const presentationSurface = this.configureSurface(surfaceCanvas, surfaceContext, wantsHdr);
      if (presentationSurface.format !== surface.format || presentationSurface.hdr !== surface.hdr) {
        surface = presentationSurface;
        if (this.prepareLibraryPipelines) await this.prepareLibraryPipelines(surface.format);
        pipelines = this.pipelineFor(surface.format);
        params = buildParams(
          lane,
          adjustments,
          proxy.workingSpace,
          surface.hdr,
          referenceWhiteNits,
          sourcePixelScale,
        );
        params[GPU_PARAMS.HIGHLIGHT_ANCHOR] = measuredPeak;
      }
      if (sourceOptions?.fineGrainGrade && lane === "hdr" && params[GPU_PARAMS.HIGHLIGHT_MODE] > 0) {
        params[GPU_PARAMS.HIGHLIGHT_TARGET_NITS] *= FINE_GRAIN_HDR_NITS_ROUNDING_GUARD;
      }
      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayMask = overlayIndex >= 0;
      const overlayLocal = overlayIndex >= 0 ? activeLocals[overlayIndex] : null;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[GPU_PARAMS.OVERLAY_ENABLED] = overlayMask && !noiseView ? 1 : 0;
      params[GPU_PARAMS.OVERLAY_OPACITY] = overlayLocal ? gpuMaskInfluenceOpacity(overlayLocal.mask) : 0;
      params[GPU_PARAMS.OVERLAY_RED] = Number(overlayColor[0]) || 0;
      params[GPU_PARAMS.OVERLAY_GREEN] = Number(overlayColor[1]) || 0;
      params[GPU_PARAMS.OVERLAY_BLUE] = Number(overlayColor[2]) || 0;
      // Direct reads a whole-frame resolved source; Tiled re-derives this per
      // generation from whether it reconstructs tiles.
      params[NOISE_VIEW_INDEX] = noiseView ? (sourceProxy !== proxy ? 1 : 2) : 0;
      writeMaskRect(params, 0, overlayIndex >= 0 ? masks[overlayIndex] : null, proxy.width, proxy.height);
      writeClarityPlan(params, proxy.width, proxy.height, params[GPU_PARAMS.CLARITY_RADIUS]);
      // Direct's frame is every intermediate's size, which is what the shader
      // falls back to. The Clarity map passes read map-sized textures, so the
      // frame is stated rather than inferred.
      params[GPU_PARAMS.FRAME_WIDTH] = proxy.width;
      params[GPU_PARAMS.FRAME_HEIGHT] = proxy.height;
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
          return refuse(`tiled-refused:${refusals.join(",")}`);
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
        const tiledSource = noiseView || cleanGrain?.token ? proxy : sourceProxy;
        const tiled = await this.encodeTiledGeneration(canvas, context, tiledSource, surface, pipelines, params, {
          fineGrainReduced,
          microQuick,
          quickCpuGrain,
          gradeMemory,
          signal: sourceOptions?.signal,
          action: sourceOptions?.action,
          originalSource: sourceOptions?.originalSource,
          gradePreview: sourceOptions?.gradePreview,
          lensGlowRecipe: sourceOptions?.gradePreview ? adjustments : null,
          requestSignal: coarseFetchSignal,
          delivery: sourceOptions?.delivery,
          beforeDeliverySubmit: sourceOptions?.beforeDeliverySubmit,
          tileBatchSize: sourceOptions?.delivery ? 4 : undefined,
          tileSize: sourceOptions?.tileSize,
          minimumRoiFraction: sourceOptions?.minimumRoiFraction,
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
          boundedPresentation: sourceOptions?.boundedPresentation,
          underlayerOnly: sourceOptions?.underlayerOnly,
          backendLumaMasks: region?.backendLumaMasks,
          nativeGeometryViewport: sourceOptions?.nativeGeometryViewport,
          coversViewport: sourceOptions?.coversViewport,
          onFrameSubmitted: sourceOptions?.onFrameSubmitted,
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
          if (tiled?.appMemoryRefused) return refuse("app-memory-ceiling");
          return refuse(`tiled-encode-failed:${(tiled?.refusals || []).join(",")}`);
        }
        // The resolution this generation was processed at, which is not the
        // size of the picture it produced: geometry trims the frame. The
        // viewer needs the former to decide whether the selected tier has
        // been reached.
        this.retireInactiveGradeScratch(releaseGradeScratch, currentRender);
        return { ...tiled, approximate: tiled.approximate || approximateDenoise, sourceSerial: serial, processedLongEdge: proxy.longEdge };
      }
      const intermediate = this.ensureIntermediate(
        canvas,
        proxy.width,
        proxy.height,
        spatialActive,
        detailActive || localDetailActive,
        lensGlowCache,
        !backgroundUnderlayer,
      );
      if (!intermediate) {
        if (backgroundUnderlayer) return refuse("underlayer-scratch-allocation-failed");
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
        return refuse("intermediate-allocation-failed");
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
      const spatialSource = releaseGradeScratch?.spatial ? null : intermediate.spatialATexture;
      const spatialAView = spatialSource?.createView() || fallbackSpatialView;
      // Show noise binds the original as the source and the resolved picture
      // in the overlay slot, so the base pass can difference the two.
      let baseBindGroup = params[NOISE_VIEW_INDEX] === 1
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
      let encoder = this.device.createCommandEncoder();
      // Global HSL's selection reads the HSL stage input over the whole frame,
      // and is reused while nothing above HSL changes.
      const hslEngine = noiseView ? null : this.hslSelectionEngine(canvas, "direct");
      const hslSelection = this.encodeHslSelection(hslEngine, encoder, pipelines, baseBindGroup, {
        width: proxy.width, height: proxy.height, params,
        prepareKey: this.hslPrepareKey(sourceProxy.texture, params, proxy.width, proxy.height),
      });
      if (hslSelection) {
        baseBindGroup = this.bindGraphResources(sourceProxy.texture.createView(), spatialAView,
          { buffer: this.paramBuffer }, spatialAView, hslSelection.view);
      }
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
          const localBuffer = this.localParamBuffer(local, lane, sourcePixelScale, proxy.width, proxy.height, masks[index], params);
          if (gpuLocalDetailActive(local[`${lane}_grade`])) {
            // Preserve the pre-local source until the final mask mix. The normal
            // ping-pong target holds the unmasked candidate, while the two Detail
            // scratch textures are reused serially for every local adjustment.
            const candidateView = target.createView();
            const candidateBindGroup = makeBindGroup(localSource.createView(), localSource.createView(), localBuffer);
            const candidatePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: candidateView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
              }],
            });
            candidatePass.setPipeline(pipelines.localCandidate);
            candidatePass.setBindGroup(0, candidateBindGroup);
            candidatePass.draw(3);
            candidatePass.end();

            const values = this.localParamValues.get(`${local.id}:${lane}`);
            const scratchView = intermediate.detailATexture.createView();
            let packedBandsView = candidateView;
            if (graphScaleContract().localDetailReadsPackedBands(values)) {
              packedBandsView = intermediate.detailBTexture.createView();
              const horizontalBindGroup = makeBindGroup(candidateView, candidateView, localBuffer);
              const horizontalPass = encoder.beginRenderPass({
                colorAttachments: [{
                  view: scratchView,
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: "clear",
                  storeOp: "store",
                }],
              });
              horizontalPass.setPipeline(pipelines.localDetailHorizontal);
              horizontalPass.setBindGroup(0, horizontalBindGroup);
              horizontalPass.draw(3);
              horizontalPass.end();

              const verticalBindGroup = makeBindGroup(scratchView, scratchView, localBuffer);
              const verticalPass = encoder.beginRenderPass({
                colorAttachments: [{
                  view: packedBandsView,
                  clearValue: { r: 0, g: 0, b: 0, a: 0 },
                  loadOp: "clear",
                  storeOp: "store",
                }],
              });
              verticalPass.setPipeline(pipelines.localDetailVertical);
              verticalPass.setBindGroup(0, verticalBindGroup);
              verticalPass.draw(3);
              verticalPass.end();
            }

            let clarityMapView = packedBandsView;
            if (graphScaleContract().localClarityActive(local[`${lane}_grade`])) {
              const extents = clarityMapExtents({
                scale: values[CLARITY_MAP_SCALE_INDEX], baseScale: values[CLARITY_BASE_SCALE_INDEX],
              }, 0, 0, proxy.width, proxy.height);
              const maps = this.clarityMapTextures("work", extents.baseWidth, extents.baseHeight);
              const map = this.encodeClarityMap(
                encoder, pipelines, (view) => makeBindGroup(view, view, localBuffer, view),
                candidateView, maps.textures, extents,
              );
              sourceOptions?.captureClarity?.locals.set(local.id, this.captureClarityMap(encoder, map, extents));
              clarityMapView = map.createView();
            }
            const detailCompositeBindGroup = makeBindGroup(
              candidateView,
              packedBandsView,
              localBuffer,
              clarityMapView,
            );
            const detailCompositePass = encoder.beginRenderPass({
              colorAttachments: [{
                view: scratchView,
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
              scratchView,
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
        lensGlowKey = lensGlowCache && !this.disableLensGlowCache && !sourceOptions?.delivery && !sourceOptions?.measureOnly
          ? this.lensGlowCacheKey(sourceProxy, lane, adjustments, activeLocals, params, this.lensMaskKey(masks)) : null;
        const glowEncoded = this.encodeFilmChain(encoder, pipelines, intermediate, localSource.createView(),
          (source, spatial, original) => makeBindGroup(source, spatial, this.paramBuffer, original),
          params, proxy.width, proxy.height,
          { interactive: HDRWebGPUPreview.usesDraftGrain(sourceOptions || {}),
            pruneGrain: sourceOptions?.gradePreview && !sourceOptions?.delivery && !sourceOptions?.measureOnly,
            lensGlowKey, parameterBinding: { buffer: this.paramBuffer } });
        if (!glowEncoded) lensGlowKey = null;
      }
      if (finishedSdrAnchor && !sourceOptions?.delivery) {
        this.device.queue.submit([encoder.finish()]);
        const pipeline = await this.waitForUnderlayerPreparation(
          this.ensurePeakReductionPipeline("scaledFilmPeakReductionMain"), backgroundSignal);
        const key = `frame:${serial}:${anchor.key}`;
        params[GPU_PARAMS.HIGHLIGHT_ANCHOR] = await this.runPeakReduction(pipeline,
          intermediate.finishTexture, proxy.width, proxy.height, params, anchor.measurement, key, backgroundSignal);
        this.peakReductionCache.delete(key);
        if (resourceGeneration !== this.resourceGeneration || serial !== this.renderSerials.get(canvas)
          || sourceOptions?.isCurrent?.() === false) return refuse("peak:superseded");
        if (!backgroundUnderlayer) this.noteHighlightMeasurement(lane, sourceProxy, params, params[GPU_PARAMS.HIGHLIGHT_ANCHOR]);
        this.device.queue.writeBuffer(this.paramBuffer, 0, params);
        encoder = this.device.createCommandEncoder();
      }
      if (sourceOptions?.delivery) {
        encoder.copyTextureToTexture({texture:intermediate.finishTexture},
          {texture:sourceOptions.delivery.texture}, [proxy.width,proxy.height]);
        sourceOptions.delivery.params = new Float32Array(params);
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
            if (backgroundUnderlayer) return;
            canvas.hdrFrameRegion = null;
            if (canvas.width !== proxy.width) canvas.width = proxy.width;
            if (canvas.height !== proxy.height) canvas.height = proxy.height;
          },
        )
        : { current: () => true, release: () => {} };
      if (!presentation?.current()) {
        presentation?.release();
        return refuse("superseded-before-presentation");
      }
      if (backgroundUnderlayer) {
        if (canvas.width !== proxy.width) canvas.width = proxy.width;
        if (canvas.height !== proxy.height) canvas.height = proxy.height;
      }
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
      if ((canvas === this.canvas || sourceOptions?.boundedPresentation)
        && !sourceOptions?.measureOnly && !sourceOptions?.delivery && !backgroundUnderlayer && !sourceOptions?.underlayerOnly) {
        this.retainPresentedTiles();
        this.setLensGlowTileFrameKey(null);
      }
      if (lensGlowKey) intermediate.lensGlowKey = lensGlowKey;
      sourceOptions?.onPresented?.(context.getCurrentTexture());
      if (gradeMemory && !draftPresentation) this.noteGradeCanvasSwap(canvas, surface.format);
      if (!sourceOptions?.measureOnly) sourceOptions?.onFrameSubmitted?.(null, presentationSurface.hdr);
      if (hslSelection) {
        hslEngine.commit(hslSelection.token);
        if (hslEngine.retired.length) this.destroyAfterActiveRenders(() => hslEngine.dropRetired());
      }
      } finally {
        presentation.release();
      }
      // Direct composites straight to the canvas, so there is no retained
      // target behind this frame and a later tiled pass must redraw it whole.
      if (!sourceOptions?.measureOnly && !backgroundUnderlayer) {
      this.lastPresentedFrame = {
        sessionId,
        lane,
        geometrySignature,
        width: proxy.width,
        height: proxy.height,
        execution: "direct",
        longEdge: proxy.longEdge,
        sourceIdentity: proxy.sourceIdentity,
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
      if (noiseView || backgroundUnderlayer) this.scopeSources.delete(canvas);
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
        spatialTexture: spatialSource || intermediate.finishTexture,
        params: new Float32Array(params),
        sessionId,
        comparisonComposite: canvas === this.canvas && overlayIndex < 0 ? compositeBindGroup : null,
      });
      this.retireInactiveGradeScratch(releaseGradeScratch, currentRender);
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
        approximate: approximateDenoise || Boolean(HDRWebGPUPreview.usesDraftGrain(sourceOptions || {})
          && params[GPU_PARAMS.GRAIN_ENABLED] > 0.5 && params[GPU_PARAMS.GRAIN_AMOUNT] > 0),
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
        if (cleanGrainBlend) this.destroyAfterActiveRenders(() => cleanGrainBlend.texture.destroy());
        reducedGrain?.releaseAfterRender?.();
        if (proxyPin) this.gpuAllocator.unpin(proxyPin);
        this.gpuAllocator?.unpin(replacementProxyPin);
        this.gpuAllocator?.unpin(canvasPin);
        const underlayer = backgroundUnderlayer ? this.geometryUnderlayerRender : null;
        if (underlayer?.intermediate) {
          this.destroyIntermediate(underlayer.intermediate);
          underlayer.intermediate = null;
        }
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
    async ensureDenoiseResolved(proxy, isCurrent, signal, quickCpuGrain = false) {
      if (!proxy || proxy.region || !this.adaptiveDenoiseFor(proxy)) return false;
      const selector = this.denoiseSourceSelector;
      if (selector.identity !== proxy.identity) return false;
      if (selector.original !== proxy) selector.original = proxy;
      if (selector.resolved && selector.resolvedFor === JSON.stringify(selector.controls || {})
          && Boolean(selector.resolvedQuickCpuGrain) === quickCpuGrain) return false;
      await this.resolveDenoiseProxy(selector.controls || {}, { source: proxy, isCurrent, signal, quickCpuGrain });
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
    async analyzeDenoiseProxy(sessionId, lane, adjustments, longEdge, editRevision = 0, sourceIdentity = "source", controls = {}, refresh = 0, nativeEdge = null, options = {}) {
      if (!this.available || !sessionId) return false;
      const generation = ++this.denoiseSelectorGeneration;
      this.denoisePreparationController?.abort();
      const controller = new AbortController();
      this.denoisePreparationController = controller;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const frame = { identity: `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}`, sourceIdentity };
      try {
        while (this.denoiseRetirement) await this.denoiseRetirement;
        if (controller.signal.aborted || options.signal?.aborted || options.isCurrent?.() === false) return false;
        const settings = {
          amount: controls.amount ?? 0.75,
          luminance: controls.luminance ?? 0.5,
          colorNoise: controls.colorNoise ?? controls.color_noise ?? 0.75,
          detailRecovery: controls.detailRecovery ?? controls.detail_recovery ?? 0.5,
          finestNoise: controls.finestNoise ?? controls.finest_noise ?? 0.5,
          fineNoise: controls.fineNoise ?? controls.fine_noise ?? 0.5,
          mediumNoise: controls.mediumNoise ?? controls.medium_noise ?? 0.5,
          coarseNoise: controls.coarseNoise ?? controls.coarse_noise ?? 0.5,
          method: controls.method ?? "standard",
          grainEvenness: controls.grainEvenness ?? controls.grain_evenness ?? 1,
          cleanSplotches: (controls.cleanSplotches ?? controls.clean_splotches) !== false,
          cleanFringes: (controls.cleanFringes ?? controls.clean_fringes) !== false,
          protectColorEdges: (controls.protectColorEdges ?? controls.protect_color_edges) === true,
          colorSplotches: (controls.cleanSplotches ?? controls.clean_splotches) === false
            ? 0 : (controls.colorSplotches ?? controls.color_splotches ?? 1),
          splotchSize: controls.splotchSize ?? controls.splotch_size ?? "small",
          microLuminance: controls.microLuminance ?? controls.micro_luminance ?? 0.5,
          microColor: controls.microColor ?? controls.micro_color ?? 0.5,
          microDetail: controls.microDetail ?? controls.micro_detail ?? 0.5,
        };
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        return await this.analyzeAdaptiveDenoise(sessionId, lane, frame, longEdge, editRevision, geometrySignature,
          generation, settings, refresh, nativeEdge, { ...options, signal });
      } finally {
        if (this.denoisePreparationController === controller) this.denoisePreparationController = null;
      }
    }

    async ensureAdaptiveDenoisePipelines(beforeNext = null) {
      if (this.adaptiveDenoisePipelines) return this.adaptiveDenoisePipelines;
      // Library warms piecemeal so foreground pictures can take over. Grade
      // and its idle task both use the shared foreground compilation.
      if (beforeNext) return this.compileAdaptiveDenoisePipelines(this.device, beforeNext);
      if (!this.adaptiveDenoiseCompilation) {
        const pending = this.compileAdaptiveDenoisePipelines(this.device).finally(() => {
          if (this.adaptiveDenoiseCompilation === pending) this.adaptiveDenoiseCompilation = null;
        });
        this.adaptiveDenoiseCompilation = pending;
      }
      return this.adaptiveDenoiseCompilation;
    }

    async compileAdaptiveDenoisePipelines(device, beforeNext = null) {
      const module = device.createShaderModule({ code: ADAPTIVE_DENOISE_SHADER_SOURCE });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
      const compute = GPUShaderStage.COMPUTE;
      const sampled = { sampleType: "unfilterable-float" };
      // One explicit layout for every entry point, so a pass binds the same
      // eight slots and fills the ones it does not read with dummies.
      const layout = device.createBindGroupLayout({
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
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const names = ["Load", "Blur", "Noise", "EnergyHorizontal", "EnergyVertical", "Accumulate", "Final"];
      const create = name => device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: `adaptive${name}Main` },
      });
      const checkDevice = () => {
        if (this.device !== device || this.deviceLost) {
          throw new DOMException("The Denoise device was replaced.", "AbortError");
        }
      };
      const created = [];
      if (beforeNext) {
        for (const name of names) {
          await beforeNext();
          checkDevice();
          if (this.adaptiveDenoisePipelines) return this.adaptiveDenoisePipelines;
          created.push(await create(name));
        }
      } else {
        created.push(...await Promise.all(names.map(create)));
      }
      checkDevice();
      if (this.adaptiveDenoisePipelines) return this.adaptiveDenoisePipelines;
      const dummy = (format, usage) => device.createTexture({ size: { width: 1, height: 1 }, format, usage });
      this.adaptiveDenoisePipelines = {
        device,
        layout,
        ...Object.fromEntries(names.map((name, index) => [name[0].toLowerCase() + name.slice(1), created[index]])),
        dummySampled: dummy("rgba32float", GPUTextureUsage.TEXTURE_BINDING),
        dummyStorage32: dummy("rgba32float", GPUTextureUsage.STORAGE_BINDING),
        dummyStorage16: dummy("rgba16float", GPUTextureUsage.STORAGE_BINDING),
      };
      return this.adaptiveDenoisePipelines;
    }

    async ensureGrainPipelines() {
      const pipelines = await this.ensureAdaptiveDenoisePipelines();
      const { device } = pipelines;
      if (device !== this.device) throw new DOMException("The Denoise device was replaced.", "AbortError");
      if (!pipelines.grainPipelines) {
        const module = device.createShaderModule({ code: GRAIN_DENOISE_SHADER_SOURCE });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [pipelines.layout] });
        const compute = GPUShaderStage.COMPUTE;
        const preparedLayout = device.createBindGroupLayout({ entries: [
          { binding: 5, visibility: compute, storageTexture: { format: "rgba16float" } },
          { binding: 6, visibility: compute, buffer: { type: "uniform" } },
          { binding: 8, visibility: compute, texture: { sampleType: "uint" } },
        ] });
        const names = ["grainGain", "grainBox", "grainAccumulate", "grainEndpoints"];
        pipelines.grainPipelines = Promise.all([
          ...names.map(async (name) => {
            pipelines[name] = await device.createComputePipelineAsync({
              layout, compute: { module, entryPoint: `adaptive${name[0].toUpperCase()}${name.slice(1)}Main` },
            });
          }),
          device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [preparedLayout] }),
            compute: { module, entryPoint: "adaptivePreparedMain" },
          }).then(pipeline => {
            pipelines.prepared = pipeline;
            pipelines.preparedLayout = preparedLayout;
          }),
        ]).catch(error => {
          pipelines.grainPipelines = null;
          throw error;
        });
      }
      await pipelines.grainPipelines;
      if (device !== this.device) throw new DOMException("The Denoise device was replaced.", "AbortError");
      return pipelines;
    }

    async ensureCleanGrainPipelines() {
      const adaptive = await this.ensureGrainPipelines();
      if (adaptive.device !== this.device) throw new DOMException("The Denoise device was replaced.", "AbortError");
      if (!adaptive.cleanGrainPipelines) {
        const device = this.device;
        const module = device.createShaderModule({ code: CLEAN_GRAIN_SHADER_SOURCE });
        const shared = device.createPipelineLayout({ bindGroupLayouts: [adaptive.layout] });
        const names = ["Base", "Luma", "Box", "Normalize", "ChromaResidual", "Context", "Texture",
          "Max", "Guides", "Taps", "Pairs", "Relative", "Repair", "Fringe", "Output", "Pack"];
        const compile = async (name) => {
          // Pack writes integer bits using its own smaller layout.
          const layout = name !== "Pack" ? shared : device.createPipelineLayout({
            bindGroupLayouts: [device.createBindGroupLayout({ entries: [
              ...[0, 1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } })),
              { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
              { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: "rgba32uint" } },
            ] })],
          });
          const pipeline = await device.createComputePipelineAsync({
            layout, compute: { module, entryPoint: `clean${name}Main` },
          });
          return [name[0].toLowerCase() + name.slice(1), pipeline];
        };
        adaptive.cleanGrainPipelines = Promise.all(names.map(compile)).then(pairs => {
          adaptive.clean = Object.fromEntries(pairs);
        }).catch(error => {
          adaptive.cleanGrainPipelines = null;
          throw error;
        });
      }
      await adaptive.cleanGrainPipelines;
    }

    async ensureMicroGrainPipelines() {
      await this.ensureCleanGrainPipelines();
      await window.HDRMicroGrainGpu.ahdPipelines(this.device);
      const adaptive = this.adaptiveDenoisePipelines;
      if (!adaptive.microGrainPipelines) {
        const { device } = this;
        const module = device.createShaderModule({ code: window.HDRWebGPUShaders.MICRO_GRAIN_SHADER_SOURCE });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [adaptive.layout] });
        const names = { accumulate: "Accumulate", gate: "Gate", base: "Base",
          colourDelta: "ColourDelta", output: "Output" };
        adaptive.microGrainPipelines = Promise.all(Object.entries(names).map(async ([key, name]) => [
          key, await device.createComputePipelineAsync({ layout, compute: { module, entryPoint: `micro${name}Main` } }),
        ])).then(pairs => { adaptive.micro = Object.fromEntries(pairs); })
          .catch(error => { adaptive.microGrainPipelines = null; throw error; });
      }
      await adaptive.microGrainPipelines;
    }

    async ensureGrainFitPipeline() {
      const pipelines = await this.ensureGrainPipelines();
      if (pipelines.device !== this.device) throw new DOMException("The Denoise device was replaced.", "AbortError");
      if (!pipelines.grainFitPipeline) {
        const device = this.device;
        const module = device.createShaderModule({ code: GRAIN_DENOISE_SHADER_SOURCE });
        const narrowNoise = device.createShaderModule({
          code: ADAPTIVE_DENOISE_SHADER_SOURCE.replace("texture_storage_2d<rgba32float", "texture_storage_2d<r32float"),
        });
        const visibility = GPUShaderStage.COMPUTE;
        const group = this.device.createBindGroupLayout({ entries: [
          ...[0, 1, 2, 3].map(binding => ({ binding, visibility, texture: { sampleType: "unfilterable-float" } })),
          { binding: 6, visibility, buffer: { type: "uniform" } },
          { binding: 9, visibility, buffer: { type: "storage" } },
        ] });
        pipelines.grainFitPipeline = Promise.all([
          this.device.createComputePipelineAsync({
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [group] }),
            compute: { module, entryPoint: "adaptiveGrainFitMain" },
          }),
          device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "adaptiveGrainMixMain" } }),
          device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [
              { binding: 0, visibility, texture: { sampleType: "unfilterable-float" } },
              { binding: 4, visibility, storageTexture: { format: "r32float" } },
              { binding: 6, visibility, buffer: { type: "uniform" } },
            ] })] }),
            compute: { module: narrowNoise, entryPoint: "adaptiveNoiseMain" },
          }).catch(() => null),
        ]).then(([fit, mix, measurementNoise]) => {
          pipelines.grainMix = mix;
          pipelines.measurementNoise = measurementNoise;
          return fit;
        }).catch(error => {
          pipelines.grainFitPipeline = null;
          throw error;
        });
      }
      return pipelines.grainFitPipeline;
    }

    encodeFineGrainMix(encoder, packed, target, region, evenness) {
      const pipeline = this.adaptiveDenoisePipelines.grainMix;
      const params = new Float32Array(28);
      params.set([0, 0, region.width, region.height, evenness], 8);
      const buffer = this.device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(buffer, 0, params);
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: packed.createView() },
        { binding: 5, resource: target.createView() },
        { binding: 6, resource: { buffer } },
      ] }));
      pass.dispatchWorkgroups(Math.ceil(region.width / 8), Math.ceil(region.height / 8));
      pass.end();
      return buffer;
    }

    async ensureFineGrainResizePipelines(clean) {
      const key = clean ? "cleanGrainResizePipelines" : "fineGrainResizePipelines";
      if (!this[key]) {
        const device = this.device;
        const module = device.createShaderModule({ code: clean ? CLEAN_GRAIN_RESIZE_SHADER_SOURCE : GRAIN_RESIZE_SHADER_SOURCE });
        const visibility = GPUShaderStage.COMPUTE;
        const uniform = { binding: 0, visibility, buffer: { type: "uniform" } };
        const sample = binding => ({ binding, visibility, texture: { sampleType: "unfilterable-float" } });
        const write = (binding, format) => ({ binding, visibility, storageTexture: { format } });
        const make = (axis, entries) => device.createComputePipelineAsync({
          layout: device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [uniform, ...entries] })] }),
          compute: { module, entryPoint: `fineGrainResize${axis}` },
        });
        const pending = module.getCompilationInfo().then(info => {
          const errors = info.messages.filter(message => message.type === "error");
          if (errors.length) throw new Error(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join("; "));
          const verticalSamples = [sample(1), sample(2), sample(3)];
          return Promise.all([
            make("Horizontal", [
              clean ? { binding: 8, visibility, texture: { sampleType: "uint" } } : sample(1),
              ...[4, 5, 6].map(binding => write(binding, "rgba32float")),
            ]),
            make("Vertical", [...verticalSamples, ...(clean ? [sample(10), write(7, "rgba32uint")] : [write(7, "rgba16float")])]),
            ...(clean ? [make("Base", [...verticalSamples, write(9, "rgba32float")])] : []),
          ]);
        }).then(pipelines => {
          if (device !== this.device || this.deviceLost) {
            throw new DOMException("The Denoise device was replaced.", "AbortError");
          }
          return pipelines;
        }).catch(error => {
          if (this[key] === pending) this[key] = null;
          throw error;
        });
        this[key] = pending;
      }
      return this[key];
    }

    releaseFineGrainReduced(key) {
      const cache = this.fineGrainReduced;
      for (const id of key === undefined ? [...(cache?.keys() || [])] : [key]) {
        this.evictGpuCacheEntry("fine-grain-reduced", id);
      }
    }

    fineGrainReducedBytes() {
      return [...(this.fineGrainReduced?.values() || [])].reduce((total, entry) => total + entry.byteSize, 0);
    }

    blendReducedCleanGrain(entry, strength) {
      const { width, height } = entry;
      const target = this.createDenoiseTexture(width, height, "clean-grain-fit-blend");
      const encoder = this.device.createCommandEncoder();
      const origin = { x: 0, y: 0 };
      let params;
      try {
        params = this.encodePreparedDenoise(encoder, entry, { ...origin, width, height }, target, origin, strength);
        this.device.queue.submit([encoder.finish()]);
        return { ...entry, ...target, cleanGrainDelta: false,
          lensGlowInput: [this.lensTextureToken(entry.texture), strength] };
      } catch (error) {
        target.texture.destroy();
        throw error;
      } finally {
        params?.paramBuffer.destroy();
      }
    }

    reducedGrainKey(proxy, selector) {
      const { controls } = selector;
      return JSON.stringify([selector.cache.grain.fitKey, proxy.width, proxy.height, proxy.workingSpace,
        selector.cache.grain.micro ? [controls.microLuminance, controls.microColor, controls.microDetail]
          : fineGrainPixelControls(controls, Boolean(cleanGrainMargin(controls)))]);
    }

    hasReducedMicroGrain(width, height) {
      const selector = this.denoiseSourceSelector;
      const proxy = selector?.original;
      return Boolean(proxy && proxy.width === width && proxy.height === height && selector.cache?.grain?.micro
        && this.fineGrainReduced.has(this.reducedGrainKey(proxy, selector)));
    }

    hasReducedCleanGrain() {
      const selector = this.denoiseSourceSelector;
      const proxy = selector?.original;
      return Boolean(proxy && selector.cache?.grain?.gpu && cleanGrainMargin(selector.controls)
        && this.fineGrainReduced.has(this.reducedGrainKey(proxy, selector)));
    }

    async ensureFineGrainReduced(proxy, revision, isCurrent, interactive, signal, action) {
      if (!this.adaptiveDenoiseFor(proxy)) return null;
      const selector = this.denoiseSourceSelector;
      const grain = selector.cache.grain;
      if (!grain?.gpu || (proxy.width === grain.width && proxy.height === grain.height)) return null;
      const controls = selector.controls;
      const clean = Boolean(cleanGrainMargin(controls));
      if (interactive && !clean) return null;
      const key = this.reducedGrainKey(proxy, selector);
      const cached = this.fineGrainReduced.get(key);
      if (cached) {
        this.fineGrainReduced.delete(key);
        this.fineGrainReduced.set(key, cached);
        this.gpuAllocator?.touch(cached.allocatorEntry);
        this.recordStage("fine-grain-reduced-hit", { lane: proxy.lane, width: proxy.width, height: proxy.height });
        globalThis.HDRDiagnostics?.event?.("denoise", "grain_reduced_cache", { hit: true, lane: proxy.lane, long_edge_px: proxy.longEdge }, action);
        return { ...proxy, ...cached, bindGroups: new Map() };
      }
      if (interactive) return null;
      this.recordStage("fine-grain-reduced-miss", { lane: proxy.lane, width: proxy.width, height: proxy.height });
      globalThis.HDRDiagnostics?.event?.("denoise", "grain_reduced_cache", { hit: false, lane: proxy.lane, long_edge_px: proxy.longEdge }, action);
      const current = () => !signal?.aborted && isCurrent()
        && selector === this.denoiseSourceSelector && selector.controls === controls;
      return this.resizeNativeFineGrain(proxy, revision, selector, current, key, signal, action);
    }

    get grainFailures() {
      return this._grainFailures ||= new globalThis.HDRGrainRoute.Failures();
    }

    acceptGrainMemorySample(value) {
      if (!value) return;
      if (this.grainMemorySample && value.sampleId < this.grainMemorySample.sampleId) return;
      if (value.sampleId !== this.grainMemorySample?.sampleId || !this.grainMemorySample) {
        const { resident_bytes, allocator_bytes } = this.grainMemorySnapshot();
        this.grainMemorySample = { ...value, gpuBytes: Math.max(resident_bytes, allocator_bytes), receivedAt: performance.now() };
      } else {
        // The process census can stay the same across polls while reservations,
        // system pressure and the configured limit change.
        Object.assign(this.grainMemorySample, value);
      }
      const reclaimPressure = value.gradePressure || value.pressure || "none";
      if (reclaimPressure !== this.grainReclaimPressure) {
        this.grainReclaimPressure = reclaimPressure;
        this.emptyGrainReclaimBytes = null;
      }
      if (value.grainReclaim) {
        this.pendingGrainReclaim = true;
        this.flushDeferredDestroy();
      }
    }

    async refreshGrainMemorySample() {
      try {
        const response = await fetch("/api/library/memory?fresh=true", { signal: AbortSignal.timeout(1500) });
        if (response.ok) this.acceptGrainMemorySample(await response.json());
      } catch {
        // If the census is busy, retain the last completed sample.
      }
    }

    gradeSourceGrowth(sessionId, lane, longEdge, geometry, identity, region, exactSize, sourceSize) {
      if (!region && this.wholeSourceResident(sessionId, lane, longEdge, geometry, identity)) return 0;
      if (region && [...this.proxies.values()].some(proxy => {
        const held = proxy.region;
        return held && ((proxy.regionTransport && !proxy.identity?.includes(":analysis:"))
          || (held.x === region.x && held.y === region.y && held.width === region.width && held.height === region.height))
          && proxy.sessionId === sessionId && proxy.lane === lane && proxy.longEdge === longEdge
          && proxy.geometrySignature === geometry && proxy.sourceIdentity === identity
          && held.x % (region.alignment || 1) === 0 && held.y % (region.alignment || 1) === 0
          && held.x <= region.x && held.y <= region.y
          && held.x + held.width >= region.x + region.width && held.y + held.height >= region.y + region.height;
      })) return 0;
      const edge = Math.max(256, longEdge);
      const size = region || exactSize || (geometry === "{}" ? sourceSize : null);
      const scale = region || exactSize ? 1 : Math.min(1, edge / Math.max(size?.width || edge, size?.height || edge));
      // Half is preferred but the source can require full float. Transport
      // buffers can overlap the GPU copy; four bounded upload slots already
      // exist and no image-sized staging allocation is assumed.
      const width = Math.ceil((size?.width || edge) * scale);
      const height = Math.ceil((size?.height || edge) * scale);
      const texture = width * height * 16;
      const staging = Math.ceil(width * 16 / 256) * 256 * height;
      return texture + Math.min(staging, this.maxSourceChunkBytes * 4);
    }

    async admitGradeMemory(stage, requestedBytes, isCurrent = () => true, action = null) {
      const sample = this.grainMemorySample;
      if (!(sample?.unifiedMemory ?? this.unifiedGrainMemory)) return true;
      if (!isCurrent()) return false;
      if (!sample || performance.now() - sample.receivedAt >= 5000) await this.refreshGrainMemorySample();
      if (!isCurrent()) return false;
      let snapshot = this.grainMemorySnapshot(requestedBytes());
      const fitsSample = ({ requested_bytes, app_headroom_bytes, app_ram_bytes, app_budget_bytes }) =>
        requested_bytes <= (app_headroom_bytes ?? Infinity) && !(app_ram_bytes > app_budget_bytes);
      if (fitsSample(snapshot)) return true;
      // This generation has not encoded its graph. With no other encoder or
      // scope active, it can reclaim unused inputs and parked (never active)
      // canvases. Release only destruction work added by this reclaim.
      const canReclaim = this.resourceRenderCount === 1 && !this.activeScopeCount;
      const previous = this.deferredDestroy.length;
      if (canReclaim) this.reclaimGrainResources(snapshot, action, true, true);
      const retired = canReclaim ? this.deferredDestroy.splice(previous) : [];
      try {
        await this.waitForSubmittedWork();
      } finally {
        retired.forEach(destroy => destroy());
      }
      // Even an empty reclaim may coincide with backend work finishing.
      // Get a new OS census before a final refusal, not the cached high mark.
      await this.refreshGrainMemorySample();
      if (!isCurrent()) return false;
      snapshot = this.grainMemorySnapshot(requestedBytes());
      const fits = fitsSample(snapshot);
      this.recordStage("grade-memory-admission", { stage, fits, ...snapshot });
      if (!fits) {
        globalThis.HDRDiagnostics?.event?.("grade", "preview_memory_refused", {
          route: "refused", reason: "app_memory_ceiling", stage, ...snapshot,
        }, action);
      }
      return fits;
    }

    grainMemorySnapshot(requestedBytes = null) {
      const { resident, transient } = this.resourceMemorySnapshot();
      const { categories } = resident;
      const totalBytes = resident.totalBytes + transient.totalBytes;
      // Parked Grain layers already have a cache entry. Active canvases do
      // not, so include just those on the allocator side of the same ledger.
      const allocatorBytes = (this.gpuAllocator?.usedBytes() || 0)
        + this.gradeCanvasSwapBytes({ unregisteredOnly: true });
      const sample = this.grainMemorySample;
      // On Apple Silicon the process footprint already includes graphics
      // memory. Charge GPU growth after the census without adding it twice.
      // For the PC test profile the discrete GPU is outside the RAM census,
      // so charge the full ledger rather than only growth after the sample.
      const sampledGpu = sample?.measurement === "proportional-resident" ? 0 : (sample?.gpuBytes || 0);
      const unified = sample?.unifiedMemory ?? this.unifiedGrainMemory;
      const currentSample = sample && performance.now() - sample.receivedAt < 5000;
      const appHeadroom = !unified ? null : currentSample ? Math.max(0, sample.ceilingBytes - sample.totalBytes
        - sample.reservedBytes - Math.max(0, Math.max(totalBytes, allocatorBytes) - sampledGpu)) : 0;
      return { requested_bytes: requestedBytes, budget_bytes: this.memoryBudgetBytes(),
        reservation_limit_bytes: 0.9 * this.memoryBudgetBytes(), resident_bytes: totalBytes,
        allocator_bytes: allocatorBytes, resident_by_kind: categories, app_headroom_bytes: appHeadroom,
        app_ram_bytes: sample?.totalBytes, app_budget_bytes: sample?.ceilingBytes,
        pressure_level: sample?.gradePressure };
    }

    grainEvent(event, route, reason, context, fields = {}) {
      if (!context || !globalThis.HDRDiagnostics?.event) return;
      const { snapshot = this.grainMemorySnapshot(), ...detail } = fields;
      globalThis.HDRDiagnostics?.event?.("denoise", event, { route, reason, ...snapshot, ...detail }, context);
    }

    async runGrainAttempt(key, action, current, run) {
      const previous = this.grainFailures.get(key);
      if (previous && !this.startGrainRetry(key, action)) {
        this.grainEvent?.("grain_gpu_skipped", "cpu", "prior_failure_latched", action,
          { prior_reason: previous.reason, temporary: previous.temporary, retry_used: previous.retried });
        return null;
      }
      while (current()) {
        try { return await run(); }
        catch (error) {
          if (!current()) {
            this.grainEvent?.("grain_cancelled", "refused", "superseded", action);
            throw error;
          }
          const failure = this.noteGrainFailure(key, error, action);
          if (!failure) throw error;
          if (!await this.recoverGrainFailure(key, failure, current, action)) return null;
        }
      }
      return null;
    }

    grainFailureCanRun(key) {
      const entry = this.grainFailures?.get(key);
      return !entry || this.grainFailures.canRetry(entry, this.grainMemorySnapshot(), this.device, this.available);
    }

    noteGrainFailure(key, error, context) {
      const reason = HDRGrainRoute.failureReason(error, this.deviceLost);
      const snapshot = error.grainSnapshot || this.grainMemorySnapshot();
      const failure = this.grainFailures.record(key, reason, snapshot, this.device);
      this.grainEvent?.(failure ? "grain_gpu_refused" : "grain_cancelled", "refused", reason, context, {
        snapshot, level: failure ? "warn" : "info", stage: error.grainStage,
        error_name: error.name, error_message: error.message, ...error.grainDetails,
        temporary: failure?.temporary, retry_used: failure?.retried,
      });
      return failure;
    }

    startGrainRetry(key, context) {
      const failure = this.grainFailures.get(key);
      if (!failure) return false;
      const snapshot = this.grainMemorySnapshot(failure.snapshot.requested_bytes);
      if (!this.grainFailures.takeRetry(key, snapshot, this.device, this.available)) return false;
      this.grainEvent?.("grain_retry", "gpu", failure.reason, context, { snapshot, attempt: 2 });
      return true;
    }

    async recoverGrainFailure(key, failure, current, context) {
      if (!failure?.temporary || failure.retried || !current()) return false;
      if (failure.reason === "transport_timeout") {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, failure.retryAt - Date.now())));
      }
      if (failure.reason === "gpu_budget_exceeded" || failure.reason === "gpu_allocation_pressure") {
        const snapshot = this.grainMemorySnapshot(failure.snapshot.requested_bytes);
        if (this.reclaimGrainResources(snapshot, context)) await this.waitForSubmittedWork();
      }
      return current() && this.startGrainRetry(key, context);
    }

    reclaimGrainResources(before, context, reservation = false, previewPreflight = false) {
      const busy = this.resourceRenderCount || this.activeScopeCount;
      // Source proxies and active mask tiles are pinned. Other entries can
      // still be held by a render or a scope outside the ledger.
      if (busy && (!reservation || this.activeScopeCount || this.resourceRenderCount > 1)) return false;
      const visible = this.lastPresentedFrame;
      const selector = this.denoiseSourceSelector;
      const reclaimable = new Set(["source-proxy", "detail-band-tile", "mask-tile", "scene-luminance", "lens-glow-tile",
        "local-mask", "oriented-luminance", "fine-grain-reduced", "denoise-tile", "grain-preview-layer"]);
      const allocator = this.gpuAllocator;
      let count = 0;
      let released = 0;
      // A live proxy lookup touches the allocator LRU. Take a snapshot so
      // protected entries neither change order nor get re-visited here.
      const proxies = new Map(this.proxies);
      const presentation = this.presentationTarget;
      const evictedByKind = {};
      const requested = before.requested_bytes;
      const appAlreadyOver = previewPreflight && before.app_ram_bytes > before.app_budget_bytes;
      if (!appAlreadyOver && requested != null && HDRGrainRoute.headroom(before) >= requested) return false;
      const protectActive = requested == null
        && before.pressure_level !== "critical" && this.grainReclaimPressure !== "critical";
      const activeGrainSelector = selector?.selected === "resolved" && selector.cache?.grain?.gpu ? selector : null;
      const activeClean = activeGrainSelector?.controls?.method === "clean_grain";
      const reducedKey = activeGrainSelector?.original ? this.reducedGrainKey(selector.original, selector) : null;
      const activeGlow = this.lensGlowTileFrameKey && this.lensGlowTileFrameKey === this.presentedLensGlowTileFrameKey;
      const entries = [], activeGrain = [], presentedMasks = [];
      for (const entry of allocator?.entries.values() || []) {
        if (entry.kind === "mask-tile" && this.presentedMaskKeys?.has(entry.key)) presentedMasks.push(entry);
        else if (entry.kind === "grain-preview-layer" || (entry.kind === "fine-grain-reduced" && (entry.key === reducedKey || (activeClean
          && this.fineGrainReduced?.get(entry.key)?.sourceFrame
          && entry.key === this.reducedGrainKey(this.fineGrainReduced.get(entry.key).sourceFrame, selector))))
          || (entry.kind === "denoise-tile" && this.presentedDenoiseTileKeys?.has(entry.key))
          || (entry.kind === "lens-glow-tile" && activeGlow)) activeGrain.push(entry);
        else entries.push(entry);
      }
      if (!protectActive) entries.push(...activeGrain);
      if (requested != null) entries.push(...presentedMasks);
      for (const entry of entries) {
        if (entry.pins || !entry.evict || !reclaimable.has(entry.kind)
            || (busy && !previewPreflight && entry.kind !== "source-proxy" && entry.kind !== "mask-tile")) continue;
        if (entry.kind === "source-proxy") {
          const proxy = proxies.get(entry.key);
          if (this.proxyInflight.size || !proxy || proxy === selector?.original || (proxy.lane === visible?.lane
              && proxy.longEdge === visible.longEdge && proxy.geometrySignature === visible.geometrySignature)) continue;
        }
        if (busy && !previewPreflight) this.evictGpuCacheEntry(entry.kind, entry.key, true);
        else entry.evict();
        allocator.unregister(entry);
        count++;
        released += entry.bytes;
        evictedByKind[entry.kind] = (evictedByKind[entry.kind] || 0) + entry.bytes;
        if (!appAlreadyOver && requested != null) {
          const projected = this.grainMemorySnapshot();
          const retiring = this.pendingGpuRetireBytes;
          projected.resident_bytes = Math.max(0, projected.resident_bytes - retiring);
          projected.allocator_bytes = Math.max(0, projected.allocator_bytes - retiring);
          if (HDRGrainRoute.headroom(projected) >= requested) break;
        }
      }
      this.grainEvent?.("grain_eviction", count ? "gpu" : "refused",
        count ? "rebuildable_cache_released" : "no_reclaimable_resources", context, {
          snapshot: this.grainMemorySnapshot(before.requested_bytes), evicted_count: count, evicted_bytes: released,
          before_resident_bytes: before.resident_bytes, before_allocator_bytes: before.allocator_bytes,
          evicted_bytes_by_kind: evictedByKind,
          presentation_kept: Boolean(visible) && this.lastPresentedFrame === visible && this.presentationTarget === presentation,
        });
      return count > 0;
    }

    async reserveFineGrain(kind, allocations, context = null) {
      const bytes = Object.values(allocations).reduce((total, value) => total + value, 0);
      if (this.observeGradeMemory && (!this.grainMemorySample
          || (this.grainMemorySample.unifiedMemory && performance.now() - this.grainMemorySample.receivedAt >= 5000))) {
        await this.refreshGrainMemorySample();
      }
      let snapshot = this.grainMemorySnapshot(bytes);
      if (HDRGrainRoute.headroom(snapshot) < bytes && (context || this.observeGradeMemory)) {
        const generation = this.resourceGeneration;
        if (this.reclaimGrainResources(snapshot, context, true)) {
          await this.waitForSubmittedWork();
          if (snapshot.app_headroom_bytes != null && snapshot.app_headroom_bytes < bytes) {
            await this.refreshGrainMemorySample();
          }
        }
        if (generation !== this.resourceGeneration) throw new DOMException("Grain reservation was replaced.", "AbortError");
        snapshot = this.grainMemorySnapshot(bytes);
      }
      if (HDRGrainRoute.headroom(snapshot) < bytes) {
        throw Object.assign(new Error(`Insufficient graphics memory for ${kind}.`), {
          grainReason: bytes > snapshot.reservation_limit_bytes && bytes > 0.9 * this.configuredGpuBudgetBytes()
            ? "gpu_request_too_large" : snapshot.app_headroom_bytes != null && snapshot.app_headroom_bytes < bytes
              ? "app_memory_ceiling" : "gpu_budget_exceeded",
          grainSnapshot: snapshot, grainStage: kind, grainDetails: { allocations_bytes: allocations },
        });
      }
      this.recordStage("fine-grain-reservation", { kind, bytes, allocations, resident: snapshot.resident_by_kind });
      const reservation = this.gpuAllocator?.reserve({ kind, bytes });
      this.grainEvent?.("grain_gpu_reserved", "gpu", "gpu_reservation_granted", context, {
        snapshot, stage: kind, allocations_bytes: allocations,
      });
      return reservation;
    }

    async releaseFineGrainStrip(upload) {
      await sourceTransport().releaseStaging(upload.device, upload.ring, upload.retired);
      upload.texture?.destroy();
    }

    microGrainSourceRegion(selector, core) {
      const { grain } = selector.cache;
      const x = Math.max(0, core.x - MICRO_GRAIN_MARGIN);
      const y = Math.max(0, core.y - MICRO_GRAIN_MARGIN);
      return { x, y,
        width: Math.min(grain.width, core.x + core.width + MICRO_GRAIN_MARGIN) - x,
        height: Math.min(grain.height, core.y + core.height + MICRO_GRAIN_MARGIN) - y };
    }

    async developMicroGrainRegion(selector, core, revision, current, retain, bayer = null, action) {
      const { grain } = selector.cache;
      const region = this.microGrainSourceRegion(selector, core);
      const gpu = window.HDRMicroGrainGpu;
      const limit = gpu.regionLimit(this.device, region);
      if (limit) throw grainWorkRefused(limit.reason, "Micro Grain Bayer region exceeds its GPU or source limit.", limit);
      const reservation = await this.reserveFineGrain("micro-grain-region", {
        bayer: (region.width + gpu.BAYER_PADDING) * (region.height + gpu.BAYER_PADDING) * 36,
      }, action);
      try {
        if (this.injectMicroGrainFailure) {
          this.injectMicroGrainFailure = false;
          throw new Error("Injected Micro Grain GPU failure.");
        }
        const body = bayer || await gpu.readBayer(grain, region, selector.controls, revision, current, retain, undefined, action);
        return await gpu.develop(this.device, grain, region, body, current);
      } catch (error) {
        if (error.grainLimit) {
          throw grainWorkRefused(error.grainLimit.reason, error.message, error.grainLimit);
        }
        throw error;
      } finally {
        if (reservation) this.gpuAllocator.releaseReservation(reservation);
      }
    }

    async writeMicroGrainRegion(selector, core, candidate, destination, revision, current, sharedEncoder = null, prepared = null,
      retainSource = Boolean(sharedEncoder), action) {
      const start = performance.now();
      const { grain } = selector.cache;
      const controls = selector.controls;
      let source, encoded, retained = false;
      try {
        source = prepared || await this.developMicroGrainRegion(selector, core, revision, current, retainSource, null, action);
        const encoder = sharedEncoder || this.device.createCommandEncoder();
        const { device } = this;
        device.pushErrorScope("validation");
        try {
          encoded = this.encodeAdaptiveDenoise(encoder, selector, [], controls, core, candidate, destination, source, null, {
            luminance: controls.microLuminance, color: controls.microColor, detail: controls.microDetail, gain: grain.gain,
          });
          if (!sharedEncoder) device.queue.submit([encoder.finish()]);
        } finally {
          const fault = await device.popErrorScope();
          if (fault) throw new Error(fault.message);
        }
        if (!sharedEncoder) await device.queue.onSubmittedWorkDone();
        if (!current()) throw new DOMException("Micro Grain was replaced.", "AbortError");
        retained = Boolean(sharedEncoder);
        this.recordStage("micro-grain-region", { durationMs: performance.now() - start, ...core });
        return { ...encoded, source: source.texture };
      } finally {
        if (!retained) {
          encoded?.paramBuffer.destroy();
          if (!prepared) source?.texture.destroy();
        }
      }
    }

    async resizeNativeFineGrain(proxy, revision, selector, current, key, signal, action) {
      const start = performance.now();
      const controls = selector.controls;
      const clean = Boolean(cleanGrainMargin(controls));
      const micro = selector.cache.grain.micro;
      const [horizontal, vertical, baseVertical] = await this.ensureFineGrainResizePipelines(clean);
      if (!current()) throw new DOMException("Grain resize was replaced.", "AbortError");
      const device = this.device;
      const grain = selector.cache.grain;
      const { width, height } = grain;
      const textureLimit = device.limits.maxTextureDimension2D;
      const dispatchEdge = 8 * device.limits.maxComputeWorkgroupsPerDimension;
      const workEdge = Math.min(textureLimit, dispatchEdge);
      const rowRatio = height / proxy.height;
      const columnRatio = width / proxy.width;
      const box = Math.ceil(Math.max(1, rowRatio, columnRatio));
      const resizeMargin = 3 * box + 1;
      const margin = micro ? MICRO_GRAIN_MARGIN : ADAPTIVE_DENOISE_MARGIN + cleanGrainMargin(controls);
      const sourceReach = 2 * resizeMargin + 2;
      const nativeExtent = (count, ratio, extent) => Math.min(extent, Math.ceil(count * ratio) + sourceReach);
      // Keep the original strip when it fits; otherwise use output-column
      // bands. Their source rectangles overlap by the Lanczos/range support
      // plus the native reconstruction margin, with full-frame tap positions.
      const workCount = (ratio, extent, output, preferred, limit) => {
        if (nativeExtent(preferred, ratio, extent) <= limit) return Math.min(output, preferred);
        return Math.min(output, Math.max(1, Math.floor((limit - sourceReach) / ratio)));
      };
      const stride = workCount(rowRatio, height, proxy.height,
        Math.max(1, Math.floor(ADAPTIVE_DENOISE_TILE / rowRatio)), workEdge - 2 * margin);
      const fullWidth = width <= Math.min(workEdge, sourceTransport().SOURCE_TILE_REQUEST_EDGE);
      const columns = workCount(columnRatio, width, proxy.width, proxy.width,
        fullWidth ? workEdge : Math.min(4096, workEdge - 2 * margin));
      const maxRows = nativeExtent(stride, rowRatio, height);
      const maxWidth = nativeExtent(columns, columnRatio, width);
      const stripUpload = fineGrainStripUpload(device, Math.min(width, maxWidth + 2 * margin), Math.min(height, maxRows + 2 * margin));
      if (Math.max(proxy.width, proxy.height, stripUpload.maxWidth, stripUpload.maxRows) > textureLimit
          || Math.max(columns, maxRows, stride) > dispatchEdge) {
        throw grainWorkRefused("source_too_large", "Grain reduction exceeds the device's working dimensions.", {
          width_px: proxy.width, height_px: proxy.height, max_texture_dimension_px: textureLimit,
        });
      }
      const microCoreWidth = 768;
      const microBandWidth = Math.min(maxWidth, 2 * microCoreWidth);
      const microRequest = { width: Math.min(width, microBandWidth + 2 * margin), height: stripUpload.maxRows };
      const microGpu = micro ? window.HDRMicroGrainGpu : null;
      const microBandFits = micro && !microGpu.regionLimit(device, microRequest);
      const reservation = await this.reserveFineGrain("fine-grain-resize", {
        sourceStrip: micro ? 0 : stripUpload.maxWidth * stripUpload.maxRows * 8,
        filteredStrip: maxWidth * maxRows * (clean ? 16 : 8),
        resizeScratch: columns * (maxRows * 48 + (clean ? stride * 16 : 0)),
        reducedPicture: proxy.width * proxy.height * (clean ? 24 : 8),
        uploadAndResponses: micro ? (microRequest.width + microGpu.BAYER_PADDING) * (microRequest.height + microGpu.BAYER_PADDING) * 6
          : 2 * stripUpload.slots * stripUpload.chunkBytes,
      }, action);
      const weights = [controls.amount, controls.luminance, controls.colorNoise, controls.detailRecovery];
      const sizes = adaptiveResolveOptions(controls);
      const owned = [];
      const own = resource => { owned.push(resource); return resource; };
      const scratch = (label, rows = maxRows) => own(device.createTexture({ label, size: [columns, rows], format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }));
      const packed = (width, height, label) => ({
        width, height, byteSize: width * height * 16, cleanGrainDelta: true,
        texture: device.createTexture({ label, size: [width, height], format: "rgba32uint",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }),
      });
      const assertCurrent = () => {
        if (!current()) throw new DOMException("Grain reduction was replaced.", "AbortError");
      };
      const inFlight = [];
      try {
        assertCurrent();
        const makePicture = clean ? packed : this.createDenoiseTexture.bind(this);
        const result = makePicture(proxy.width, proxy.height, "grain-reduced");
        own(result.texture);
        const native = makePicture(maxWidth, maxRows, "grain-resize-strip");
        own(native.texture);
        const [samples, low, high] = ["lanczos", "low", "high"].map(name => scratch(`fine-grain-resize-${name}`));
        const baseStrip = clean ? scratch("clean-grain-resize-base", stride) : null;
        const newParams = () => own(device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        const params = newParams();
        const deltaParams = clean ? newParams() : null;
        const encode = (encoder, pipeline, bindings, cols, rows, uniforms = params) => {
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: uniforms } },
            ...bindings.map(([binding, texture]) => ({ binding, resource: texture.createView() })),
          ] }));
          pass.dispatchWorkgroups(Math.ceil(cols / 8), Math.ceil(rows / 8));
          pass.end();
        };
        for (let row = 0; row < proxy.height; row += stride) {
          const count = Math.min(stride, proxy.height - row);
          const y = Math.max(0, Math.floor(row * rowRatio) - resizeMargin);
          const bottom = Math.min(height, Math.ceil((row + count) * rowRatio) + resizeMargin);
          for (let column = 0; column < proxy.width; column += columns) {
            assertCurrent();
            const cols = Math.min(columns, proxy.width - column);
            const x = Math.max(0, Math.floor(column * columnRatio) - resizeMargin);
            const right = Math.min(width, Math.ceil((column + cols) * columnRatio) + resizeMargin);
            const target = { x, y, width: right - x, height: bottom - y };
            if (micro) {
              const bandWidth = microBandFits ? microBandWidth : Math.min(microBandWidth, microCoreWidth);
              const bandFor = left => ({ ...target, x: left, width: Math.min(bandWidth, right - left) });
              const fetchBand = async left => {
                const region = this.microGrainSourceRegion(selector, bandFor(left));
                const limit = microGpu.regionLimit(device, region);
                if (limit) throw grainWorkRefused(limit.reason, "Micro Grain Fit band exceeds its GPU or source limit.", limit);
                return microGpu.readBayer(grain, region, controls, revision, current, false, denoiseDeadline(signal, 15000), action);
              };
              // Prefetch one response while the current band is on the GPU.
              const fetchNext = left => fetchBand(left).then(body => ({ body }), error => ({ error }));
              let pending = fetchNext(x);
              try {
                for (let left = x; left < right; left += bandWidth) {
                  const { body, error } = await pending;
                  pending = null;
                  if (error) throw error;
                  assertCurrent();
                  if (left + bandWidth < right) pending = fetchNext(left + bandWidth);
                  const band = bandFor(left);
                  const prepared = await this.developMicroGrainRegion(selector, band, revision, current, false, body, action);
                  // Both cores use the same developed Bayer band. Each
                  // encode has its own uniforms and the passes reuse scratch
                  // in queue order, so one submission can finish the band.
                  const buffers = [];
                  try {
                    device.pushErrorScope("validation");
                    let validation;
                    try {
                      const encoder = device.createCommandEncoder();
                      for (let coreX = left; coreX < left + band.width; coreX += microCoreWidth) {
                        const core = { ...target, x: coreX, width: Math.min(microCoreWidth, left + band.width - coreX) };
                        const encoded = await this.writeMicroGrainRegion(selector, core, native, target, revision, current, encoder,
                          prepared, false, action);
                        buffers.push(encoded.paramBuffer);
                      }
                      device.queue.submit([encoder.finish()]);
                    } finally {
                      validation = device.popErrorScope();
                    }
                    const error = await validation;
                    if (error) throw Error(error.message);
                    await device.queue.onSubmittedWorkDone();
                  } finally {
                    buffers.forEach(buffer => buffer.destroy());
                    prepared.texture.destroy();
                  }
                }
              } finally {
                await pending;
              }
            }
            const left = Math.max(0, x - margin);
            const top = Math.max(0, y - margin);
            const sourceRect = { x: left, y: top, width: Math.min(width, right + margin) - left,
              height: Math.min(height, bottom + margin) - top };
            const source = micro ? null : await this.loadProxyRegion(proxy.sessionId, proxy.lane, grain.nativeEdge,
              proxy.geometrySignature, revision, proxy.sourceIdentity, null, sourceRect,
              { signal: denoiseDeadline(signal, 15000), isCurrent: current, transient: true, stripUpload,
                headers: globalThis.HDRDiagnostics?.headers?.(action) });
            if (!micro && (!source || source.width !== width || source.height !== height
                || source.region.x !== sourceRect.x || source.region.y !== sourceRect.y
                || source.region.width !== sourceRect.width || source.region.height !== sourceRect.height)) {
              throw grainWorkRefused("gpu_validation_error", "Incomplete native Grain source for reduction.", {
                width_px: sourceRect.width, height_px: sourceRect.height,
              });
            }
            let encoded;
            try {
              assertCurrent();
              device.pushErrorScope("validation");
              let validation;
              try {
                const encoder = device.createCommandEncoder();
                if (source) encoded = this.encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, native, target, source);
                const dimensions = [width, height, proxy.width, proxy.height, y, target.height, row, count, box];
                const uniforms = delta => new Float32Array([...dimensions, delta, column, cols, x, 0, 0, 0]);
                device.queue.writeBuffer(params, 0, uniforms(0));
                const horizontalBindings = [[clean ? 8 : 1, native.texture], [4, samples], [5, low], [6, high]];
                const verticalBindings = [[1, samples], [2, low], [3, high]];
                encode(encoder, horizontal, horizontalBindings, cols, target.height);
                if (clean) {
                  // Limit RGB and colour correction independently, then apply the live strength.
                  encode(encoder, baseVertical, [...verticalBindings, [9, baseStrip]], cols, count);
                  device.queue.writeBuffer(deltaParams, 0, uniforms(1));
                  encode(encoder, horizontal, horizontalBindings, cols, target.height, deltaParams);
                }
                encode(encoder, vertical, [...verticalBindings, [7, result.texture], ...(clean ? [[10, baseStrip]] : [])], cols, count);
                device.queue.submit([encoder.finish()]);
                // Start fetching or preparing the next rectangle while
                // this one reduces. Queue order protects the shared strip,
                // including its texture uploads and uniform writes.
                inFlight.push(device.queue.onSubmittedWorkDone().then(() => null, error => error));
              } finally {
                validation = device.popErrorScope();
              }
              const error = await validation;
              if (error) throw Error(error.message);
              if (inFlight.length === 2) {
                const fault = await inFlight.shift();
                if (fault) throw fault;
              }
            } finally {
              encoded?.paramBuffer.destroy();
            }
          }
        }
        const completion = inFlight.shift();
        const fault = await completion;
        if (fault) throw fault;
        assertCurrent();
        const entry = { ...result, sourceFrame: { width: proxy.width, height: proxy.height, workingSpace: proxy.workingSpace } };
        const budget = this.denoiseTileBudget();
        if (entry.byteSize <= budget) {
          while (this.fineGrainReduced.size && (this.fineGrainReduced.size >= FINE_GRAIN_REDUCED_CACHE_SIZE
            || this.fineGrainReducedBytes() + entry.byteSize > budget)) {
            this.releaseFineGrainReduced(this.fineGrainReduced.keys().next().value);
          }
          entry.allocatorEntry = this.gpuAllocator?.register({ kind: "fine-grain-reduced", key, bytes: entry.byteSize,
            evict: () => this.releaseFineGrainReduced(key) });
          this.fineGrainReduced.set(key, entry);
        } else {
          // The exact pixels are still usable by this draw, but must not
          // displace warm entries or exceed the reduced-picture cache cap.
          entry.allocatorEntry = this.gpuAllocator?.register({ kind: "fine-grain-reduced-transient",
            bytes: entry.byteSize, pinned: true });
          this.fineGrainTransientBytes += entry.byteSize;
          entry.releaseAfterRender = () => {
            this.fineGrainTransientBytes -= entry.byteSize;
            this.gpuCacheRelease(entry);
            this.releaseGpuCacheValue("fine-grain-reduced", entry);
          };
        }
        owned.shift();
        this.recordStage(micro ? "micro-grain-fit-exact" : "fine-grain-reduced", { durationMs: performance.now() - start, width, height });
        if (action && !micro) globalThis.HDRDiagnostics?.event?.("denoise", "grain_reduced_work", {
          lane: proxy.lane, long_edge_px: proxy.longEdge, duration_ms: performance.now() - start,
        }, action);
        if (columns < proxy.width) this.grainEvent?.("grain_reduction_chunked", "gpu", "bounded_working_set", action, {
          duration_ms: performance.now() - start,
          width_px: width, height_px: height, chunk_width_px: maxWidth, chunk_height_px: maxRows,
        });
        return { ...proxy, ...entry, bindGroups: new Map() };
      } finally {
        await Promise.all(inFlight);
        owned.forEach(resource => resource.destroy());
        await this.releaseFineGrainStrip(stripUpload);
        if (reservation) this.gpuAllocator.releaseReservation(reservation);
      }
    }

    async measureFineGrain(sessionId, lane, native, geometry, revision, sourceIdentity, model, controls, signal, current,
      { residentSource, beforeSubmit, action } = {}) {
      const started = performance.now();
      const grainFit = await this.ensureGrainFitPipeline();
      if (!current()) throw new DOMException("Grain fit was replaced.", "AbortError");
      const device = this.device;
      const margin = 17 + GRAIN_DENOISE_RADIUS;
      const rows = ADAPTIVE_DENOISE_TILE;
      const textureLimit = device.limits.maxTextureDimension2D;
      // The resident-source delivery route has its own qualification. The
      // larger-photo route here is for Grade's streamed source.
      if (residentSource && native > 8192) {
        throw grainWorkRefused("source_too_large", "Grain calibration exceeds the supported delivery source size.", {
          source_edge_px: native, max_source_edge_px: 8192,
        });
      }
      const fitBufferLimit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
      const bytesPerTile = GRAIN_DENOISE_BANDS.length * (rows / GRAIN_FIT_BLOCK) ** 2 * 16;
      // Keep the existing tile boundaries and summation order. Each partial
      // reduces just one 32×32 block in a core; overlapping halos never vote.
      const textureTiles = residentSource ? Infinity : Math.floor((textureLimit - 2 * margin) / rows);
      const maxTiles = Math.min(textureTiles, Math.floor(fitBufferLimit / bytesPerTile), residentSource ? Infinity : 8);
      const chunkWidth = Math.min(native, maxTiles * rows);
      if (textureLimit < rows + 2 * margin || chunkWidth <= 0) {
        throw grainWorkRefused("source_too_large", "Grain calibration cannot fit one GPU tile.", {
          requested_bytes: bytesPerTile, max_buffer_bytes: fitBufferLimit, max_texture_dimension_px: textureLimit,
        });
      }
      const stripUpload = fineGrainStripUpload(device, Math.min(native, chunkWidth + 2 * margin),
        Math.min(native, rows + 2 * margin));
      const partialBytes = GRAIN_DENOISE_BANDS.length * Math.ceil(chunkWidth / GRAIN_FIT_BLOCK)
        * Math.ceil(Math.min(rows, native) / GRAIN_FIT_BLOCK) * 16;
      const maxChunks = Math.ceil(native / rows) * Math.ceil(native / chunkWidth);
      if (partialBytes * maxChunks > device.limits.maxBufferSize) {
        throw grainWorkRefused("source_too_large", "Grain calibration readback exceeds the GPU buffer limit.", {
          requested_bytes: partialBytes * maxChunks, max_buffer_bytes: device.limits.maxBufferSize,
        });
      }
      const reservation = await this.reserveFineGrain("fine-grain-fit", {
        measurementScratch: (rows + 2 * margin) ** 2 * (this.adaptiveDenoisePipelines?.measurementNoise ? 84 : 96),
        sourceStrip: residentSource ? 0 : stripUpload.maxWidth * stripUpload.maxRows * 8,
        uploadAndResponses: residentSource ? 0 : 2 * stripUpload.slots * stripUpload.chunkBytes,
        partialsAndReadback: partialBytes * (1 + maxChunks),
      }, action);
      let adaptiveScratch;
      const weights = [controls.amount, controls.luminance, controls.colorNoise, controls.detailRecovery];
      const sizes = adaptiveResolveOptions(controls);
      const totals = GRAIN_DENOISE_BANDS.map(() => [0, 0, 0, 0]);
      const assertCurrent = () => {
        if (!current()) throw new DOMException("Grain calibration was replaced.", "AbortError");
      };
      let { width, height } = residentSource || {};
      let stripCount = 0;
      let fetchMs = 0;
      let gpuWaitMs = 0;
      let partials, readback, pending;
      const strides = [];
      const transfer = new AbortController();
      const transferSignal = signal ? AbortSignal.any([signal, transfer.signal]) : transfer.signal;
      const load = async (x, y) => {
        const left = Math.max(0, x - margin);
        const top = Math.max(0, y - margin);
        const right = Math.min(width ?? native, x + chunkWidth + margin);
        const bottom = Math.min(height ?? native, y + rows + margin);
        const requestStarted = performance.now();
        const source = residentSource || await this.loadProxyRegion(sessionId, lane, native, geometry, revision, sourceIdentity, null,
          { x: left, y: top, width: right - left, height: bottom - top },
          { signal: denoiseDeadline(transferSignal, 15000), isCurrent: current, transient: true, stripUpload,
            headers: globalThis.HDRDiagnostics?.headers?.(action) });
        if (!residentSource) fetchMs += performance.now() - requestStarted;
        if (!source || Math.max(source.width, source.height) > native
            || (width !== undefined && (source.width !== width || source.height !== height))) {
          throw grainWorkRefused("gpu_validation_error", "The native Grain calibration source is unavailable or changed dimensions.", {
            source_edge_px: native, width_px: source?.width, height_px: source?.height,
          });
        }
        if (source.region && (source.region.x !== left || source.region.y !== top
            || source.region.width !== Math.min(source.width, right) - left
            || source.region.height !== Math.min(source.height, bottom) - top)) {
          throw grainWorkRefused("gpu_validation_error", "Incomplete Grain calibration chunk.", {
            width_px: right - left, height_px: bottom - top,
          });
        }
        return source;
      };
      try {
        const first = await load(0, 0);
        ({ width, height } = first);
        const chunkCount = Math.ceil(height / rows) * Math.ceil(width / chunkWidth);
        partials = device.createBuffer({ size: partialBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        readback = device.createBuffer({ size: chunkCount * partialBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        pending = Promise.resolve(first);
        adaptiveScratch = this.createAdaptiveDenoiseScratch(margin, true);
        const selector = { cache: { model, adaptiveScratch } };
        for (let y = 0; y < height; y += rows) {
          for (let x = 0; x < width; x += chunkWidth) {
            const source = await pending;
            assertCurrent();
            const target = { x, y, width: Math.min(chunkWidth, width - x), height: Math.min(rows, height - y) };
            let encoded;
            try {
              await beforeSubmit?.();
              assertCurrent();
              const stride = Math.ceil(target.width / GRAIN_FIT_BLOCK) * Math.ceil(target.height / GRAIN_FIT_BLOCK);
              const size = totals.length * stride * 16;
              device.pushErrorScope("validation");
              let validation;
              try {
                const encoder = device.createCommandEncoder();
                encoded = this.encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, null,
                  target, source, { grainFit, partials, stride, margin });
                encoder.copyBufferToBuffer(partials, 0, readback, stripCount * partialBytes, size);
                device.queue.submit([encoder.finish()]);
              } finally {
                validation = device.popErrorScope();
              }
              // The next upload is queued after this dispatch's reads of the
              // shared source strip. Its network requests overlap GPU work.
              const nextX = x + chunkWidth < width ? x + chunkWidth : 0;
              const nextY = nextX ? y : y + rows;
              pending = nextY < height ? load(nextX, nextY) : null;
              pending?.catch(() => {});
              const validationStarted = performance.now();
              const error = await validation;
              gpuWaitMs += performance.now() - validationStarted;
              if (error) throw Error(error.message);
              strides.push(stride);
              stripCount++;
            } finally {
              encoded?.paramBuffer.destroy();
            }
          }
        }
        assertCurrent();
        const readStarted = performance.now();
        await readback.mapAsync(GPUMapMode.READ);
        gpuWaitMs += performance.now() - readStarted;
        assertCurrent();
        const values = new Float32Array(readback.getMappedRange());
        for (const [strip, stride] of strides.entries()) {
          const offset = strip * partialBytes / 4;
          for (const [index, sum] of totals.entries()) {
            for (let block = 0; block < stride; block++) {
              for (let term = 0; term < 4; term++) sum[term] += values[offset + (index * stride + block) * 4 + term];
            }
          }
        }
        const fit = totals.map(([retained, averaged, mixed, square]) => {
          if (![retained, averaged, mixed, square].every(value => Number.isFinite(value) && value >= 0)) {
            throw grainWorkRefused("gpu_validation_error", "Invalid GPU Grain statistics.", { width_px: width, height_px: height });
          }
          const linear = 2 * mixed;
          const increase = Math.max(retained - averaged, 0);
          const offset = 2 * increase / Math.max(linear + Math.sqrt(linear ** 2 + 4 * square * increase), 1e-30);
          const scale = Math.min(1, Math.sqrt(retained / Math.max(averaged, 1e-30))) * (1 - offset);
          if (offset > 1 || scale < 0 || !Number.isFinite(scale)) {
            throw grainWorkRefused("gpu_validation_error", "Invalid GPU Grain coefficients.", { width_px: width, height_px: height });
          }
          return [Math.fround(scale), Math.fround(offset)];
        });
        this.recordStage("fine-grain-fit", { durationMs: performance.now() - started, width, height, stripCount, fit });
        globalThis.HDRDiagnostics?.event?.("denoise", "grain_fit_work", {
          lane, duration_ms: performance.now() - started, fetch_upload_ms: fetchMs, gpu_wait_ms: gpuWaitMs, strip_count: stripCount,
        }, action);
        if (chunkWidth < width) this.grainEvent?.("grain_calibration_chunked", "gpu", "bounded_working_set", action, {
          duration_ms: performance.now() - started,
          width_px: width, height_px: height, chunk_width_px: chunkWidth, chunk_height_px: rows,
        });
        return { fit, width, height, nativeEdge: native };
      } finally {
        transfer.abort();
        await pending?.catch(() => {});
        readback?.destroy();
        partials?.destroy();
        Object.values(adaptiveScratch?.textures || {}).forEach(texture => texture.destroy());
        await this.releaseFineGrainStrip(stripUpload);
        if (reservation) this.gpuAllocator.releaseReservation(reservation);
      }
    }

    /** One tile's worth of scratch, reused by every tile of every resolve. */
    createAdaptiveDenoiseScratch(margin = ADAPTIVE_DENOISE_MARGIN, measurementOnly = false) {
      const size = ADAPTIVE_DENOISE_TILE + 2 * margin;
      const measurementNoise = measurementOnly && this.adaptiveDenoisePipelines?.measurementNoise;
      const make = (name) => this.device.createTexture({
        label: `adaptive-denoise-${name}`,
        size: { width: size, height: size },
        format: measurementNoise && name === "noise" ? "r32float" : "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      const names = ["current", "next", "blur", "energyRow", "energy", "noise"];
      if (!measurementOnly) names.push("sumA", "sumB");
      const textures = Object.fromEntries(names.map(name => [name, make(name)]));
      return { textures, margin, byteSize: size * size * (names.length * 16 - (measurementNoise ? 12 : 0)),
        textureCount: names.length, measurementNoise };
    }

    warmDenoiseModel(sessionId, lane, native) {
      if (this.deferDenoiseWarm) return Promise.resolve(false);
      if (!(native >= 256 && native <= 16384)) return Promise.resolve(false);
      const key = `${sessionId}:${lane}:${native}`;
      if (this.denoiseModelWarm?.key === key) return this.denoiseModelWarm.promise;
      const warm = { key, promise: null };
      warm.promise = this.fetchDenoiseModel(`/api/session/${sessionId}/denoise-model/${lane}?long_edge=${native}`,
        { signal: this.sourceAbortSignal() })
        .then(async () => {
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
    async fetchDenoiseModel(url, { allowCpuFallback = true, signal, action } = {}) {
      const headers = initial => globalThis.HDRDiagnostics?.headers(action, initial) ?? initial;
      const measurementURL = url.replace("/denoise-model/", "/denoise-measurement/");
      const started = performance.now();
      const waiting = denoiseDeadline(signal, 30000);
      const cached = await fetch(measurementURL, { signal: waiting, headers: headers() });
      if (cached.status === 200) return cached.json();
      if (cached.status === 409) throw new DOMException("Denoise preparation was replaced.", "AbortError");
      if (!cached.ok) throw new Error(`Denoise measurement request failed (${cached.status}).`);
      const device = this.device;
      const key = JSON.stringify([measurementURL, allowCpuFallback]);
      return HDRDenoiseMeasurement.acquire(device, key, waiting, async signal => {
        let description;
        try {
          const response = await fetch(measurementURL + (measurementURL.includes("?") ? "&" : "?") + "source=true", { signal, headers: headers() });
          if (response.status === 409) throw new DOMException("Denoise preparation was replaced.", "AbortError");
          if (!response.ok) throw Error(`Denoise source request failed (${response.status}).`);
          if (response.headers.get("content-type")?.includes("application/json")) return response.json();
          const body = await response.arrayBuffer(), length = new DataView(body).getUint32(0, true);
          description = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, length)));
          if (!this.available || this.device !== device || this.deviceLost || this.adapterInfo?.fallback) throw Error("No usable graphics card.");
          const pixels = new Float32Array(body, 4 + length);
          const snapshot = this.resourceMemorySnapshot();
          const budget = Math.max(0, this.memoryBudgetBytes() - snapshot.totals.peakLogicalBytes);
          const owner = { byteSize: 0, allocatorEntry: null };
          const result = await HDRDenoiseMeasurement.measure(device, description, pixels, budget, signal, bytes => {
            this.denoiseMeasurementBytes += bytes - owner.byteSize;
            owner.byteSize = bytes;
            if (!bytes) this.gpuCacheRelease(owner);
            else if (owner.allocatorEntry) this.syncGpuCacheBytes(owner);
            else owner.allocatorEntry = this.gpuAllocator?.register({ kind: "denoise-measurement", bytes, pinned: true });
          });
          signal.throwIfAborted();
          const stored = await fetch(measurementURL, { method: "POST", signal, headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ...result, key: description.key, width: description.source_width,
              height: description.source_height, gpu_ms: result.duration_ms, duration_ms: performance.now() - started }) });
          if (stored.status === 409) throw new DOMException("Denoise preparation was replaced.", "AbortError");
          if (!stored.ok) throw Error(`Denoise measurement publication failed (${stored.status}).`);
          return stored.json();
        } catch (error) {
          signal.throwIfAborted();
          if (!allowCpuFallback || error.name === "AbortError" || /request failed|publication failed|source request/.test(error.message)) throw error;
          if (action) this.grainEvent?.("noise_measurement_cpu_fallback", "cpu", HDRGrainRoute.failureReason(error, this.deviceLost), action);
          const response = await fetch(url + (url.includes("?") ? "&" : "?") + "fallback_reason=" + encodeURIComponent(error.message), { signal, headers: headers() });
          if (response.status === 409) throw new DOMException("Denoise preparation was replaced.", "AbortError");
          if (!response.ok) throw new Error(`Denoise CPU fallback failed (${response.status}).`);
          const model = await response.json();
          if (description) {
            const stored = await fetch(measurementURL, { method: "POST", signal, headers: headers({ "Content-Type": "application/json" }),
              body: JSON.stringify({ model, key: description.key, version: description.version, route: "CPU fallback",
                width: description.source_width, height: description.source_height,
                measured_pixels: Math.min(description.source_width * description.source_height, 4 * 1024 * 1024),
                duration_ms: performance.now() - started, reason: error.message }) });
            if (stored.status === 409) throw new DOMException("Denoise preparation was replaced.", "AbortError");
            if (!stored.ok) throw Error(`Denoise fallback publication failed (${stored.status}).`);
          }
          return model;
        }
      });
    }

    grainSourceKey(sessionId, geometry, sourceIdentity, generation, method) {
      return JSON.stringify([sessionId, geometry, sourceIdentity === "authored-sdr", generation, method]);
    }

    async analyzeAdaptiveDenoise(sessionId, lane, frame, longEdge, editRevision, geometrySignature, generation, controls, refresh, nativeEdge,
      { signal, isCurrent, onGrain, gradeGpuGrain, repairGeneration, deliveryGrainSource, beforeDeliverySubmit,
        libraryApproximation, action, onCpuWork } = {}) {
      const startedAt = performance.now();
      this.denoiseCounters.analysisCalls += 1;
      this.recordStage("denoise-analysis", { state: "started", generation, longEdge, algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION });
      const apiEdge = Math.min(longEdge, 16384);
      const query = `long_edge=${apiEdge}&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}`;
      const experimental = controls.method === "clean_grain"
        && (cleanGrainMargin(controls) || controls.grainEvenness !== 0);
      const sourceKey = this.grainSourceKey(sessionId, geometrySignature, frame.sourceIdentity, repairGeneration, controls.method);
      const gpuFine = (gradeGpuGrain || deliveryGrainSource)
        && experimental
        && controls.amount > 0 && (controls.luminance > 0 || controls.colorNoise > 0);
      // Grade can start analysis before the first render sets maskSourceSize.
      // Measure the native source the Grain preparation will actually use.
      const native = (experimental || gpuFine ? nativeEdge : null) ?? (this.maskSourceSize?.sessionId === sessionId
        ? Math.max(256, this.maskSourceSize.width, this.maskSourceSize.height) : longEdge);
      const modelQuery = (experimental || gpuFine) && native <= 16384 ? query.replace(`long_edge=${apiEdge}`, `long_edge=${native}`) : query;
      const current = () => !signal?.aborted && isCurrent?.() !== false && generation === this.denoiseSelectorGeneration;
      if (!current()) return false;
      let grain = null;
      let model;
      const headers = initial => globalThis.HDRDiagnostics?.headers(action, initial) ?? initial;
      const micro = controls.method === "micro_grain";
      if (micro && !libraryApproximation) {
        if (!gradeGpuGrain) throw Object.assign(new Error("Micro Grain uses the CPU for this source."), {
          grainReason: "unsupported_grain_source",
        });
        const url = `/api/session/${sessionId}/denoise-micro`;
        const prepared = await this.runGrainAttempt(sourceKey, action, current, async () => {
          if (!window.HDRGeometryMath.geometryTransformIsNeutral(JSON.parse(geometrySignature))) {
            throw new Error("Micro Grain uses the CPU with a crop or geometry adjustment.");
          }
          const response = await fetch(url, { signal: denoiseDeadline(signal, 30000), headers: headers() });
          if (response.status === 409) throw new DOMException("Micro Grain preparation was replaced.", "AbortError");
          if (!response.ok) throw Object.assign(
            new Error((await response.json().catch(() => null))?.detail || "Micro Grain preparation failed."),
            { status: response.status });
          const result = await response.json();
          if (current()) await this.ensureMicroGrainPipelines();
          return result;
        });
        if (!current()) return false;
        if (!prepared) throw Object.assign(new Error("Micro Grain uses the CPU for this source."), {
          grainSourceKey: sourceKey, grainReason: this.grainFailures.get(sourceKey)?.reason,
        });
        const { width, height, gain, model: measured } = prepared;
        grain = { gpu: true, micro: true, fitKey: `${sessionId}|micro|${repairGeneration}|${refresh}`, sourceKey,
          width, height, gain, url, nativeEdge: Math.max(width, height) };
        model = measured;
      } else {
        model = await this.fetchDenoiseModel(`/api/session/${sessionId}/denoise-model/${lane}?${modelQuery}`,
          { signal, action, allowCpuFallback: !deliveryGrainSource });
      }
      if (!current()) return false;
      if (gpuFine) {
        const needsFit = controls.grainEvenness !== 0;
        const fitKey = JSON.stringify([sessionId, geometrySignature, frame.sourceIdentity === "authored-sdr", native,
          repairGeneration, refresh, model, controls.amount, controls.luminance, controls.detailRecovery,
          controls.fineNoise, controls.mediumNoise, needsFit]);
        const fit = async () => {
          if (cleanGrainMargin(controls)) await this.ensureCleanGrainPipelines();
          if (!current()) return null;
          const cached = this.fineGrainFits.get(fitKey);
          globalThis.HDRDiagnostics?.event?.("denoise", "grain_fit_cache", { lane, hit: Boolean(cached), needed: needsFit }, action);
          if (cached) {
            this.recordStage("fine-grain-fit-hit", { lane });
            return cached;
          }
          if (!needsFit) {
            const size = deliveryGrainSource || await this.loadProxyRegion(sessionId, lane, native, geometrySignature,
              editRevision, frame.sourceIdentity, null, { x: 0, y: 0, width: 1, height: 1 },
              { probeOnly: true, signal, isCurrent: current, headers: headers() });
            if (!size) throw grainWorkRefused("gpu_validation_error", "The native Grain source dimensions are unavailable.");
            return { fit: null, width: size.width, height: size.height, nativeEdge: native };
          }
          if (!deliveryGrainSource && longEdge === native && this.canvas.hdrFrameRegion == null) {
            await this.retireDenoiseZoomResources(sessionId, lane, longEdge, true);
          }
          if (!current()) return null;
          return this.measureFineGrain(sessionId, lane, native, geometrySignature, editRevision,
            frame.sourceIdentity, model, controls, signal, current,
            { residentSource: deliveryGrainSource, beforeSubmit: beforeDeliverySubmit, action });
        };
        const calibration = deliveryGrainSource ? await fit() : await this.runGrainAttempt(sourceKey, action, current, fit);
        if (!current()) return false;
        if (calibration) {
          this.fineGrainFits.delete(fitKey);
          this.fineGrainFits.set(fitKey, calibration);
          if (this.fineGrainFits.size > FINE_GRAIN_FIT_CACHE_SIZE) this.fineGrainFits.delete(this.fineGrainFits.keys().next().value);
          grain = { gpu: true, fitKey, sourceKey, ...calibration };
        }
      }
      let grainFallbackReason = null;
      if (experimental && !grain) {
        if (deliveryGrainSource) throw new Error("GPU Grain delivery could not prepare this rendition.");
        const url = `/api/session/${sessionId}/denoise-grain/${lane}`;
        grainFallbackReason = this._grainFailures?.get(sourceKey)?.reason || "gpu_grain_not_selected";
        this.grainEvent?.("grain_cpu_prepare_started", "cpu", grainFallbackReason, action, { lane, method: controls.method });
        const prepare = async () => {
          const response = await fetch(`${url}?${query}&refresh=${refresh}`, {
            method: "POST", signal, headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              method: controls.method, amount: controls.amount, luminance: controls.luminance,
              color_noise: controls.colorNoise, detail_recovery: controls.detailRecovery,
              finest_noise: controls.finestNoise, fine_noise: controls.fineNoise,
              medium_noise: controls.mediumNoise, coarse_noise: controls.coarseNoise,
              grain_evenness: controls.grainEvenness, clean_splotches: controls.cleanSplotches,
              clean_fringes: controls.cleanFringes, protect_color_edges: controls.protectColorEdges === true,
              splotch_size: controls.splotchSize,
            }),
          });
          if (response.status === 409) throw new DOMException("Grain preparation was replaced.", "AbortError");
          if (!response.ok) {
            this.grainEvent?.("grain_cpu_prepare_failed", "refused", response.status === 507 ? "cpu_scratch_refused" : "cpu_preparation_failed", action,
              { level: "error", status: response.status, lane, method: controls.method });
            const detail = response.status === 507 ? (await response.json().catch(() => null))?.detail : null;
            throw new Error(typeof detail === "string" ? detail : `Denoise preparation failed (${response.status}).`);
          }
          return { ...await response.json(), url, controls: preparedGrainControls(controls) };
        };
        grain = await (onCpuWork ? onCpuWork(prepare) : prepare());
        onGrain?.(grain);
        if (!current()) return false;
        await this.ensureGrainPipelines();
      }
      const fallback = !grain?.gpu && this._grainFailures?.get(sourceKey);
      if (action) this.grainEvent?.("grain_route", grain?.gpu || !grain ? "gpu" : "cpu",
        grain?.gpu ? "gpu_grain_selected" : fallback?.reason || (grain ? "gpu_grain_not_selected" : "gpu_adaptive_selected"),
        action, { lane, method: controls.method, long_edge_px: longEdge });
      // The full-size model is one measurement per source, about a second on a
      // 42 MP frame. Asking for it now, from a smaller view, means the first
      // zoom to 100% finds it already made.
      if (!grain?.gpu && native > longEdge && native <= 16384 && current()) void this.warmDenoiseModel(sessionId, lane, native);
      if (!current() || this.sessionId !== sessionId) {
        this.recordStage("denoise-analysis", { state: "stale", generation });
        return false;
      }
      const previous = this.denoiseSourceSelector;
      if (previous?.cache?.grain?.token !== grain?.token) {
        this.dropDenoiseTiles([...this.denoiseTiles].filter(([, entry]) => entry.grainToken).map(([key]) => key));
      }
      const preparedFrame = JSON.stringify([sessionId, lane, geometrySignature, frame.sourceIdentity]);
      const setupIdentity=this.denoiseSetupIdentity?.(lane,longEdge,geometrySignature) || frame.identity;
      const cacheIdentity = `${frame.identity}|${ADAPTIVE_DENOISE_ALGORITHM_VERSION}|${JSON.stringify(model)}${grain ? "|" + JSON.stringify(grain) : ""}`;
      const cleanMargin = micro ? MICRO_GRAIN_MARGIN : grain?.gpu && cleanGrainMargin(controls)
        ? ADAPTIVE_DENOISE_MARGIN + cleanGrainMargin({ ...controls, splotchSize: "large" }) : undefined;
      if (this.reuseDenoiseSetup && previous?.setupIdentity === setupIdentity
          && (!cleanMargin || previous.cache?.adaptiveScratch?.margin >= cleanMargin)
          && previous.cache?.algorithmVersion === ADAPTIVE_DENOISE_ALGORITHM_VERSION
          && JSON.stringify(previous.cache.model) === JSON.stringify(model)) {
        // Identity includes source, rendition, scale and geometry. Controls
        // change reconstruction, never the source measurement or scratch.
        previous.identity = frame.identity;
        if (previous.cache.identity !== cacheIdentity) previous.resolvedFor = null;
        previous.cache.identity = cacheIdentity;
        previous.cache.grain = grain;
        previous.cache.grainFallbackKey = fallback ? sourceKey : null;
        previous.cache.grainFallbackReason = grainFallbackReason;
        previous.cache.preparedFrame = preparedFrame;
        previous.original = this.proxies.get(frame.identity) || null;
        previous.generation = generation;
        previous.selected = "resolved";
        this.setDenoiseControls(controls);
        this.recordStage("denoise-analysis", { state: "reused", generation, durationMs: performance.now() - startedAt });
        return true;
      }
      await this.ensureAdaptiveDenoisePipelines();
      if (!current()) return false;
      const settings = { name: "Adaptive", algorithm: ADAPTIVE_DENOISE_ALGORITHM_VERSION, levels: 1 };
      const scratch = this.createAdaptiveDenoiseScratch(cleanMargin);
      const cache = {
        algorithmVersion: ADAPTIVE_DENOISE_ALGORITHM_VERSION,
        settings,
        model,
        identity: cacheIdentity,
        grain,
        grainFallbackKey: fallback ? sourceKey : null,
        grainFallbackReason,
        preparedFrame,
        tiles: [],
        levels: [],
        resolveScratch: [],
        adaptiveScratch: scratch,
        byteSize: scratch.byteSize,
        textureCount: scratch.textureCount,
      };
      this.denoiseSourceSelector = {
        identity: frame.identity,
        setupIdentity,
        // Adopted by the first Direct render of this frame; a tiled render
        // never needs it.
        original: this.proxies.get(frame.identity) || null,
        resolved: null,
        selected: "resolved",
        cache,
        generation,
      };
      this.setDenoiseControls(controls);
      this.destroyAfterActiveRenders(() => this.destroyDenoiseSelector(previous));
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

    retargetPreparedDenoise(sessionId, lane, longEdge, geometrySignature, sourceIdentity) {
      const selector = this.denoiseSourceSelector;
      const grain = selector?.cache?.grain;
      if (!(grain?.token || grain?.gpu) || grain.stale || selector.cache.preparedFrame
          !== JSON.stringify([sessionId, lane, geometrySignature, sourceIdentity])) return false;
      const identity = `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}`;
      if (selector.identity !== identity) {
        const resolved = selector.resolved;
        if (resolved) this.destroyAfterActiveRenders(() => resolved.texture.destroy());
        selector.resolved = null;
        selector.resolvedFor = null;
        selector.identity = identity;
        selector.cache.identity = `${identity}|grain:${grain.token || grain.fitKey}`;
        selector.original = this.proxies.get(identity) || null;
      }
      selector.selected = "resolved";
      return true;
    }

    encodePreparedDenoise(encoder, prepared, target, candidate, origin, strength) {
      const { preparedLayout, prepared: pipeline } = this.adaptiveDenoisePipelines;
      const paramBuffer = this.device.createBuffer({
        size: ADAPTIVE_DENOISE_SLOT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(paramBuffer, 0, new Float32Array([
        0, 0, 0, 0, // scratch
        0, 0, 0, 0, // frame
        target.x, target.y, target.width, target.height,
        origin.x, origin.y, 0, 0,
        0, 0, 0, 0, // model
        strength, 0, 0, 0,
        0, 0, 0, 0, // sigma
      ]));
      const bindGroup = this.device.createBindGroup({ layout: preparedLayout, entries: [
        { binding: 5, resource: candidate.texture.createView() },
        { binding: 6, resource: { buffer: paramBuffer, size: 112 } },
        { binding: 8, resource: prepared.texture.createView() },
      ] });
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8));
      pass.end();
      return { paramBuffer, dispatches: 1, tiles: 1 };
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
    encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, candidate, destinationOrigin, source, reduction = null, micro = null) {
      const pipelines = this.adaptiveDenoisePipelines;
      const { model, grain } = selector.cache;
      const { textures: scratch, measurementNoise } = selector.cache.adaptiveScratch;
      const frameWidth = source.width;
      const frameHeight = source.height;
      // What of the frame the source texture holds. A region source is fetched
      // wide enough for every margin; clamping to it is the guard for one that
      // was not, and then only the outermost margin is short.
      const held = source.region || { x: 0, y: 0, width: frameWidth, height: frameHeight };
      const strengths = adaptiveDenoiseStrengths({
        amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes,
        ...(sizes.method === "micro_grain" && !micro ? { amount: .75, luminance: .4 * sizes.microLuminance,
          colorNoise: .8 * sizes.microColor, detailRecovery: sizes.microDetail } : {}),
      });
      const tiles = [];
      const colourMargin = !reduction && grain?.gpu ? cleanGrainMargin(sizes) : 0;
      const clean = pipelines.clean;
      const margin = micro ? MICRO_GRAIN_MARGIN : reduction?.margin ?? ADAPTIVE_DENOISE_MARGIN + colourMargin;
      const tileSize = ADAPTIVE_DENOISE_TILE;
      for (let y = target.y; y < target.y + target.height; y += tileSize) {
        for (let x = target.x; x < target.x + target.width; x += tileSize) {
          const width = Math.min(tileSize, target.x + target.width - x);
          const height = Math.min(tileSize, target.y + target.height - y);
          const x0 = Math.max(held.x, x - margin);
          const y0 = Math.max(held.y, y - margin);
          const x1 = Math.min(held.x + held.width, x + width + margin);
          const y1 = Math.min(held.y + held.height, y + height + margin);
          tiles.push({ tile: { x, y, width, height }, scratch: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        }
      }
      const endpoints = Boolean(candidate?.grainEndpoints);
      const evenness = grain?.fit ? (endpoints ? -1 : sizes.grainEvenness) : 0;
      // The colour passes replace the final wavelet write with the base,
      // then encode the guides, Small repair and output. Large adds five passes.
      const colourDispatches = colourMargin ? 18
        + (sizes.cleanSplotches !== false ? (sizes.splotchSize === "large" ? 10 : 5) : 0)
        + (sizes.cleanFringes !== false ? 1 : 0) : 0;
      const dispatchesPerTile = 1 + 5 + ADAPTIVE_DENOISE_LEVELS * 5 + 1
        + (evenness ? 6 : 0) + (micro ? 30 : colourDispatches);
      const paramBytes = Math.max(ADAPTIVE_DENOISE_SLOT, tiles.length * dispatchesPerTile * ADAPTIVE_DENOISE_SLOT);
      const maxBufferBytes = this.device.limits?.maxBufferSize ?? Infinity;
      if (paramBytes > maxBufferBytes) {
        throw grainWorkRefused("source_too_large", "Denoise tile parameters exceed the device's buffer limit.", {
          requested_bytes: paramBytes, max_buffer_bytes: maxBufferBytes,
        });
      }
      const paramBuffer = this.device.createBuffer({
        size: paramBytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const slots = new Float32Array(paramBuffer.size / 4);
      let slot = 0;
      const originalView = source.texture.createView();
      const dispatch = (pipeline, binding, values, { width, height }, partials = null) => {
        slots.set(values, slot * (ADAPTIVE_DENOISE_SLOT / 4));
        const view = (texture) => texture.createView();
        const entries = [
            { binding: 0, resource: binding.src || view(pipelines.dummySampled) },
            { binding: 1, resource: binding.aux ? view(binding.aux) : view(pipelines.dummySampled) },
            { binding: 2, resource: binding.aux2 ? view(binding.aux2) : view(pipelines.dummySampled) },
            { binding: 3, resource: binding.aux3 ? view(binding.aux3) : view(pipelines.dummySampled) },
            { binding: 4, resource: binding.dst ? view(binding.dst) : view(pipelines.dummyStorage32) },
            { binding: 5, resource: binding.out ? view(binding.out) : view(pipelines.dummyStorage16) },
            { binding: 6, resource: { buffer: paramBuffer, offset: slot * ADAPTIVE_DENOISE_SLOT, size: 112 } },
            { binding: 7, resource: binding.sum ? view(binding.sum) : view(pipelines.dummySampled) },
        ];
        const narrow = pipeline === measurementNoise && !!measurementNoise;
        const bindGroup = this.device.createBindGroup({
          layout: partials || binding.packed || narrow ? pipeline.getBindGroupLayout(0) : pipelines.layout,
          entries: partials ? entries.filter(entry => entry.binding < 4 || entry.binding === 6)
            .concat({ binding: 9, resource: { buffer: partials } })
            : binding.packed ? entries.filter(entry => entry.binding < 4 || entry.binding === 6)
              .concat({ binding: 8, resource: view(binding.packed) })
              : narrow ? entries.filter(entry => [0, 4, 6].includes(entry.binding)) : entries,
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        const block = partials ? GRAIN_FIT_BLOCK : 8;
        pass.dispatchWorkgroups(Math.ceil(width / block), Math.ceil(height / block));
        pass.end();
        slot += 1;
      };
      let partialOffset = 0;
      for (const { tile, scratch: region } of tiles) {
        const common = (level, axis, sigmas = [0, 0, 0], {
          origin = [destinationOrigin.x, destinationOrigin.y, held.x, held.y],
          weights = micro ? [.6 * micro.luminance, 5.4 * micro.color, .52 - .20 * micro.detail, .85 + .30 * micro.detail]
            : [strengths.luma, strengths.chroma, strengths.fineMultiplier, strengths.fineFloor],
          scale = 0, offset = 0,
        } = {}) => [
          region.x, region.y, region.width, region.height,
          frameWidth, frameHeight, level, axis,
          tile.x, tile.y, tile.width, tile.height,
          ...origin, model.a, model.b, model.c, scale, ...weights, ...sigmas, offset,
        ];
        const blur = (level, from, to) => {
          dispatch(pipelines.blur, { src: from.createView(), dst: scratch.blur }, common(level, 0), region);
          dispatch(pipelines.blur, { src: scratch.blur.createView(), dst: to }, common(level, 1), region);
        };
        dispatch(pipelines.load, { src: originalView, dst: scratch.current }, common(0, 0), region);
        // The noise map reads luminance smoothed by bands 0 and 1, carried in
        // alpha through the same blur the bands use.
        blur(0, scratch.current, scratch.next);
        const noiseLowpass = micro ? scratch.sumA : scratch.energyRow;
        blur(1, scratch.next, noiseLowpass);
        dispatch(measurementNoise || pipelines.noise, { src: noiseLowpass.createView(), dst: scratch.noise }, common(0, 0), region);
        let current = scratch.current;
        let next = scratch.next;
        let sum = scratch.sumA;
        let nextSum = scratch.sumB;
        const levels = reduction ? GRAIN_DENOISE_BANDS.at(-1) + 1 : ADAPTIVE_DENOISE_LEVELS;
        for (let level = 0; level < levels; level += 1) {
          // A size multiplier scales this band's noise the way strength does.
          const sigmas = [0, 1, 2].map((component) => (
            (Number(model.band_sigmas[component][level]) || 0) * strengths.sizeMultiplier(level)
          ));
          if (!micro || level >= 2) blur(level, current, next);
          const grainBand = GRAIN_DENOISE_BANDS.indexOf(level);
          if (reduction && grainBand < 0) {
            [current, next] = [next, current];
            continue;
          }
          dispatch(pipelines.energyHorizontal, { src: current.createView(), aux: next, dst: scratch.energyRow }, common(level, 0), region);
          dispatch(pipelines.energyVertical, { src: scratch.energyRow.createView(), dst: scratch.energy }, common(level, 1), region);
          if ((reduction || evenness) && grainBand >= 0) {
            dispatch(pipelines.grainGain, { aux2: scratch.energy, aux3: scratch.noise, dst: scratch.energyRow }, common(level, 0, sigmas), region);
            dispatch(pipelines.grainBox, { src: scratch.energyRow.createView(), dst: scratch.blur }, common(level, 0), region);
            dispatch(pipelines.grainBox, { src: scratch.blur.createView(), dst: scratch.energy }, common(level, 1), region);
            const inputs = { src: current.createView(), aux: next, aux2: scratch.energyRow, aux3: scratch.energy };
            if (reduction) {
              dispatch(reduction.grainFit, inputs, common(level, 0, sigmas, {
                origin: [grainBand * reduction.stride + partialOffset, 0, 0, 0],
              }), tile, reduction.partials);
            } else {
              const [scale, offset] = grain.fit[grainBand];
              dispatch(pipelines.grainAccumulate, { ...inputs, sum, dst: nextSum },
                common(level, 0, sigmas, { origin: [evenness, 0, 0, 0], scale, offset }), region);
            }
          } else {
            dispatch(micro ? pipelines.micro.accumulate : pipelines.accumulate, {
              src: current.createView(), aux: next, aux2: scratch.energy, aux3: scratch.noise, sum: level > 0 ? sum : null, dst: nextSum,
            }, common(level, 0, sigmas), region);
          }
          [sum, nextSum] = [nextSum, sum];
          if (micro && level === 0) {
            [current, next] = [next, noiseLowpass];
            nextSum = scratch.current;
          } else {
            [current, next] = [next, current];
          }
        }
        if (reduction) {
          partialOffset += Math.ceil(tile.width / GRAIN_FIT_BLOCK) * Math.ceil(tile.height / GRAIN_FIT_BLOCK);
        } else if (micro) {
          this.encodeMicroGrain(dispatch, pipelines, scratch, region, tile, destinationOrigin,
            { width: frameWidth, height: frameHeight }, source.texture, sum, candidate, micro, common(0, 0));
        } else if (colourMargin) {
          const x = Math.max(held.x, tile.x - colourMargin);
          const y = Math.max(held.y, tile.y - colourMargin);
          const area = { x, y, width: Math.min(held.x + held.width, tile.x + tile.width + colourMargin) - x,
            height: Math.min(held.y + held.height, tile.y + tile.height + colourMargin) - y };
          const base = scratch.blur;
          const baseParams = common(0, 0);
          baseParams.splice(8, 4, area.x, area.y, area.width, area.height);
          dispatch(clean.base, { src: sum.createView(), aux: current, dst: base }, baseParams, area);
          this.encodeCleanGrain(dispatch, clean, scratch, area, tile, destinationOrigin,
            { width: frameWidth, height: frameHeight }, candidate, sizes);
        } else {
          const output = { src: sum.createView(), aux: current, out: candidate.texture };
          dispatch(endpoints ? pipelines.grainEndpoints : pipelines.final, output, common(0, 0), endpoints ? tile : region);
        }
      }
      this.device.queue.writeBuffer(paramBuffer, 0, slots);
      return { paramBuffer, dispatches: slot, tiles: tiles.length };
    }

    encodeMicroGrain(dispatch, pipelines, scratch, area, tile, destination,
      frame, source, sum, candidate, controls, params) {
      const { micro, clean } = pipelines;
      const box = (src, intermediate, dst) => {
        const values = [...params];
        values[6] = 32;
        dispatch(clean.box, { src: src.createView(), dst: intermediate }, values,
          { width: Math.ceil(area.width / 16), height: area.height });
        const vertical = [...values];
        vertical[7] = 1;
        dispatch(clean.box, { src: intermediate.createView(), dst }, vertical,
          { width: area.width, height: Math.ceil(area.height / 16) });
      };
      dispatch(micro.gate, { src: sum.createView(), aux: source, dst: scratch.energy }, params, area);
      box(scratch.energy, scratch.energyRow, scratch.noise);
      const base = scratch.blur;
      dispatch(micro.base, { src: source.createView(), aux: scratch.energy, aux2: scratch.noise, dst: base }, params, area);
      if (controls.color > 0) {
        this.encodeCleanGrain(dispatch, clean, scratch, area, tile, destination, frame, candidate,
          { splotchSize: "small", colorSplotches: 2 * controls.color }, micro.colourDelta);
        box(scratch.energy, scratch.next, scratch.current);
      }
      const outputParams = [...params];
      outputParams[20] = 2 * controls.color;
      outputParams[21] = controls.gain;
      const correction = controls.color > 0 ? { aux: scratch.energy, aux2: scratch.current }
        : { aux: pipelines.dummySampled, aux2: pipelines.dummySampled };
      dispatch(micro.output, { src: base.createView(), ...correction, out: candidate.texture }, outputParams, tile);
    }

    encodeCleanGrain(dispatch, clean, scratch, area, tile, destination, frame, candidate, controls, microDelta = null) {
      const { blur: base, energyRow: luma, noise: normalized, current: row, next: column,
        energy: context, sumA: grain, sumB: guides } = scratch;
      const splotches = microDelta || controls.cleanSplotches !== false;
      const fringes = microDelta || controls.cleanFringes !== false;
      const run = (pipeline, src, dst, inputs = {}, radius = 0, axis = 0, size = area, domain = area) => {
        const params = [
          area.x, area.y, area.width, area.height,
          frame.width, frame.height, radius, axis,
          tile.x, tile.y, tile.width, tile.height,
          destination.x, destination.y, 0, 0,
          domain.x - area.x, domain.y - area.y, domain.width, domain.height,
          controls.colorSplotches, window.HDRDenoiseQuality?.colourReference ?? 0,
          splotches && !microDelta ? 1 : 0, fringes ? 1 : 0,
          controls.protectColorEdges === true ? 1 : 0, 0, 0, 0,
        ];
        dispatch(pipeline, { src: src.createView(), dst, ...inputs }, params, size);
      };
      const box = (src, dst, radius) => {
        run(clean.box, src, row, {}, radius, 0, { width: Math.ceil(area.width / 16), height: area.height });
        run(clean.box, row, dst, {}, radius, 1, { width: area.width, height: Math.ceil(area.height / 16) });
      };
      const expand = (rect, horizontal, vertical = horizontal) => {
        const x = Math.max(area.x, rect.x - horizontal);
        const y = Math.max(area.y, rect.y - vertical);
        return { x, y, width: Math.min(area.x + area.width, rect.x + rect.width + horizontal) - x,
          height: Math.min(area.y + area.height, rect.y + rect.height + vertical) - y };
      };
      run(clean.luma, base, luma);
      box(luma, column, 16);
      run(clean.normalize, base, normalized, { aux: luma, aux2: column });
      box(normalized, column, 2);
      run(clean.chromaResidual, normalized, context, { aux: column });
      box(context, grain, 16);
      run(clean.context, luma, row);
      run(clean.context, row, column, {}, 0, 1);
      run(clean.texture, luma, context, { aux: column });
      box(context, column, 4);
      run(clean.max, luma, row, {}, 20, 0, { width: Math.ceil(area.width / 16), height: area.height });
      // The chroma pass will reuse this intermediate once the guides are ready.
      run(clean.max, row, guides, {}, 20, 1, { width: area.width, height: Math.ceil(area.height / 16) });
      run(clean.guides, luma, row, { aux: normalized, aux2: context, aux3: column, sum: guides });

      const repair = (input, output, reach, tap, outputRect) => {
        const relative = expand(outputRect, 3);
        const taps = expand(relative, reach);
        const rows = expand(taps, 0, tap);
        run(clean.taps, input, column, {}, tap, 0, rows, rows);
        run(clean.taps, column, context, {}, tap, 1, taps, taps);
        run(clean.pairs, input, column, { aux: context, aux2: grain, aux3: row }, reach, 0, relative, relative);
        run(clean.relative, input, guides, { aux: column, aux2: grain }, 0, 0, relative, relative);
        run(clean.repair, input, output, { aux: column, aux2: guides, aux3: row, sum: grain }, reach, 0, outputRect, outputRect);
      };
      const large = splotches && controls.splotchSize === "large";
      if (splotches) repair(normalized, luma, 12, 2, microDelta ? area : large ? expand(tile, 3 + 28 + 4) : tile);
      if (large) repair(luma, context, 28, 4, tile);
      const color = { aux: large ? context : luma, aux2: normalized };
      if (microDelta) run(microDelta, base, context, color);
      else {
        if (fringes) run(clean.fringe, normalized, column, { aux3: row, sum: grain }, 0, 0, tile, tile);
        const inputs = { ...color, ...(fringes ? { aux3: column } : {}) };
        if (candidate.cleanGrainDelta) run(clean.pack, base, null, { ...inputs, packed: candidate.texture }, 0, 0, tile);
        else run(clean.output, base, null, { ...inputs, out: candidate.texture }, 0, 0, tile);
      }
    }

    async resolveAdaptiveDenoise(selector, weights, sizes, generation, startedAt, region, destination, sharedEncoder, source, isCurrent, signal, quickCpuGrain) {
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
      let cleanGrainTransient = null;
      try {
        const grain = selector.cache.grain;
        const live = { amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes };
        // A drag can give immediate wavelet feedback before release commits
        // a new native preparation. Color Splotches only changes the blend.
        const matches = !quickCpuGrain && grain?.token && Object.entries(preparedGrainControls(grain.controls))
          .every(([key, value]) => live[key] === value);
        const current = () => isCurrent?.() !== false && selector === this.denoiseSourceSelector
          && (sharedEncoder || generation === this.denoiseSelectorGeneration);
        const prepared = matches ? await this.preparedGrainTile(grain, target, source, current, signal) : null;
        if (prepared?.transient) cleanGrainTransient = prepared.texture;
        if (!current()) throw new DOMException("Denoise draw cancelled.", "AbortError");
        const encoder = sharedEncoder || this.device.createCommandEncoder();
        const encoded = prepared
          ? this.encodePreparedDenoise(encoder, prepared, target, candidate, destinationOrigin, sizes.colorSplotches)
          : this.encodeAdaptiveDenoise(encoder, selector, weights, sizes, target, candidate, destinationOrigin, source);
        paramBuffer = encoded.paramBuffer;
        this.denoiseCounters.resolveDispatches += encoded.dispatches;
        this.denoiseCounters.resolveTiles += encoded.tiles;
        if (sharedEncoder) {
          const buffer = paramBuffer;
          const transient = cleanGrainTransient;
          paramBuffer = null;
          cleanGrainTransient = null;
          return { encoded: true, dispatches: encoded.dispatches, tiles: encoded.tiles, paramBuffer: buffer, cleanGrainTransient: transient };
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
        selector.resolvedQuickCpuGrain = quickCpuGrain;
        selector.resolvedRegion = region ? target : null;
        selector.resolved.sourceEpoch = source.sourceEpoch;
        this.denoiseCounters.atomicSwaps += 1;
        this.recordStage("denoise-resolve", stage);
        return true;
      } catch (error) {
        if (candidateIsNew) candidate.texture.destroy();
        this.recordStage("denoise-resolve", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      } finally {
        paramBuffer?.destroy();
        cleanGrainTransient?.destroy();
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
        const value = Number(controls[name] ?? (name === "amount" || name === "colorNoise" ? 0.75 : 0.5));
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      const sizes = adaptiveResolveOptions(controls);
      selector.controls = {
        amount: weights[0], luminance: weights[1], colorNoise: weights[2], detailRecovery: weights[3], ...sizes,
      };
      return true;
    }

    async resolveDenoiseProxy(controls = {}, { region = null, destination = null, encoder: sharedEncoder = null, source = null, isCurrent, signal, quickCpuGrain = false } = {}) {
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
        const value = Number(controls[name] ?? (name === "amount" || name === "colorNoise" ? 0.75 : 0.5));
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      return this.resolveAdaptiveDenoise(
        selector, weights, adaptiveResolveOptions(controls), generation, startedAt, region, destination, sharedEncoder,
        source || selector.original, isCurrent, signal, quickCpuGrain,
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
      if (!enabled && this.denoiseSourceSelector.selected === "resolved") this.emptyGrainReclaimBytes = null;
      this.denoiseSourceSelector.selected = enabled ? "resolved" : "original";
      this.denoiseCounters.toggles += 1;
      this.recordStage("selector-toggle", { source: this.denoiseSourceSelector.selected });
      return true;
    }

    cancelDenoiseProcessing({ selectOriginal = true, replaceMethod = false } = {}) {
      const generation = ++this.denoiseSelectorGeneration;
      this.denoisePreparationController?.abort();
      const selector = this.denoiseSourceSelector;
      if (selectOriginal && !replaceMethod && selector) {
        // Bypass keeps the one committed Denoise picture so turning Denoise
        // back on is instant. Memory stays bounded: a method change below
        // retires it, and only one method's picture is ever kept.
        if (selector.selected === "resolved") this.emptyGrainReclaimBytes = null;
        selector.selected = "original";
      } else if ((selectOriginal || replaceMethod) && (selector || this.denoiseTiles.size || this.fineGrainReduced?.size)) {
        this.emptyGrainReclaimBytes = null;
        this.denoiseSourceSelector = null;
        this.denoiseTileIdentity = null;
        this.dropDenoiseTiles();
        this.releaseFineGrainReduced();
        this.denoiseCounters.resolveScratchBytes = 0;
        const queue = this.device?.queue;
        // Detached owners cannot be picked up by the next render. Existing
        // encoders may still hold them, so let those unwind before fencing
        // the submissions and allowing the next Grade admission.
        const selectorBytes = (selector?.cache?.byteSize || 0) + (selector?.resolved?.byteSize || 0);
        const retired = new Promise(resolve => this.retireGpuResource(selectorBytes, () => {
          this.destroyDenoiseSelector(selector);
          resolve();
        })).then(async () => {
          if (this.gpuRetireFences.has(queue)) await Promise.resolve();
          await queue?.onSubmittedWorkDone();
        }).catch(() => {});
        const pending = Promise.all([this.denoiseRetirement, retired]).finally(() => {
          if (this.denoiseRetirement === pending) this.denoiseRetirement = null;
        });
        this.denoiseRetirement = pending;
      }
      this.recordStage("denoise-cancel", {
        generation,
        source: this.denoiseSourceSelector?.selected || "none",
      });
      return Boolean(selector);
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
      const originX = Math.min(Math.max(0, Math.trunc(Number(x) || 0) - (target.region?.x || 0)), target.width - 1);
      const originY = Math.min(Math.max(0, Math.trunc(Number(y) || 0) - (target.region?.y || 0)), target.height - 1);
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
          slots[GPU_PARAMS.TILE_ORIGIN_X] = piece.origin.x;
          slots[GPU_PARAMS.TILE_ORIGIN_Y] = piece.origin.y;
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
            const placement = slots[GPU_PARAMS.MASK_RECT_WIDTH] > 0
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

    async renderScopeProxy(...args) {
      while(this.scopeProxyFlight)await this.scopeProxyFlight.catch(()=>{});
      const options=args[9];
      if(options?.isCurrent?.()===false)return null;
      const work=this.renderScopeProxyFrame(...args);
      this.scopeProxyFlight=work;
      try{return await work;}
      finally{if(this.scopeProxyFlight===work)this.scopeProxyFlight=null;}
    }

    async renderScopeProxyFrame(sessionId, lane, adjustments, curveSampler, longEdge, locals, revision, white, sourceSize, options) {
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
      if (candidate.sdr.linked_to_hdr) candidate.hdr.film_look = { ...candidate.hdr.film_look, grain_amount: 0 };
      const rendered = await this.renderTo(canvas, sessionId, "sdr", candidate, curveSampler,
        longEdge, locals, revision, null, white, sourceSize,
        { measureOnly: true, scopeAnalysis: true, forceSdrSurface: true, frameAnchor: true,
          sourceLane: candidate.sdr.use_authored_base && !candidate.sdr.linked_to_hdr ? "sdr" : "hdr" });
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

    async analyzeScope(canvas, { width = 256, height = 128, generation = 0, tier = "interactive", raw = false, snapshot = false, transient = false } = {}) {
      if (!this.available) return null;
      const source = this.scopeSources.get(canvas);
      if (!source) return null;
      const resource = this.acquireScopeResource(width, height);
      if (!resource) return null;
      const startedAt = performance.now();
      resource.busy = true;
      this.activeScopeCount += 1;
      try {
        const params = new Float32Array(source.params);
        params[GPU_PARAMS.SCOPE_WIDTH] = width;
        params[GPU_PARAMS.SCOPE_HEIGHT] = height;
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
            { binding: 6, resource: this.filmStockBinding() },
            { binding: 7, resource: this.hslSelectionPlaceholderView },
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
          startedAt, encodedAt, submittedAt, halfToFloat, raw, snapshot, transient,
        });
      } catch (error) {
        scopeReadback().releaseAnalysis(this, resource, width, height, transient);
        throw error;
      }
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
      };
      try {
        resource.texture = this.device.createTexture({
          size: { width, height },
          format: "rgba16float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        resource.readBuffer = this.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        resource.paramBuffer = this.device.createBuffer({
          size: PARAM_COUNT * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      } catch (error) {
        resource.texture?.destroy();
        resource.readBuffer?.destroy();
        resource.paramBuffer?.destroy();
        if (!pool.length) this.scopeResources.delete(key);
        throw error;
      }
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

    surfaceProbeCanvas() {
      this.surfaceProbe ??= new OffscreenCanvas(1, 1);
      return this.surfaceProbe;
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
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
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
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
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
    presentationTargetMatches(target, width, height, format, region) {
      return target && target.width === width && target.height === height && target.format === format
        && target.region?.x === region?.x && target.region?.y === region?.y;
    }

    ensurePresentationTarget(width, height, format, region) {
      const existing = this.presentationTarget;
      if (this.presentationTargetMatches(existing, width, height, format, region)) {
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
        region,
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

    createMaskPipeline(entryPoint, asynchronous = false) {
      return this.device[asynchronous ? "createRenderPipelineAsync" : "createRenderPipeline"]({
        layout: this.maskPipelineLayout,
        vertex: { module: this.maskModule, entryPoint: "vertexMain" },
        fragment: { module: this.maskModule, entryPoint, targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
    }

    clearLensGlowTiles() {
      for (const key of this.lensGlowTiles.keys()) this.evictGpuCacheEntry("lens-glow-tile", key);
      this.lensGlowTileFrameKey = null;
    }

    setLensGlowTileFrameKey(key) {
      if (key === this.lensGlowTileFrameKey) return;
      this.clearLensGlowTiles();
      this.lensGlowTileFrameKey = key;
    }

    lensGlowTileFor(frameKey, { x, y, width, height }, grid, masks, pending) {
      if (!frameKey || this.lensGlowTileFrameKey !== frameKey) return null;
      const key = `${x},${y},${width},${height}`;
      const maskKey = this.lensMaskKey(masks);
      const cached = this.lensGlowTiles.get(key);
      if (cached && cached.maskKey === maskKey) return cached.ready ? cached : null;
      if (cached) this.evictGpuCacheEntry("lens-glow-tile", key);
      const spatialWidth = Math.ceil(width / grid);
      const spatialHeight = Math.ceil(height / grid);
      const byteSize = spatialWidth * spatialHeight * 8;
      const resident = this.resourceMemorySnapshot().resident.totalBytes;
      if (byteSize + Math.max(resident, this.gpuAllocator?.usedBytes() || 0) > this.memoryBudgetBytes() * 0.9) return null;
      const texture = this.device.createTexture({
        label: "lens-glow-tile", size: [spatialWidth, spatialHeight], format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const entry = { texture, byteSize, maskKey, ready: false };
      this.lensGlowTiles.set(key, entry);
      pending.set(key, entry);
      return entry;
    }

    lensTextureToken(texture) {
      let token = this.lensTextureIds.get(texture);
      if (!token) this.lensTextureIds.set(texture, token = ++this.nextLensTextureId);
      return token;
    }

    lensMaskKey(masks) {
      return masks.length ? JSON.stringify(masks.map(entry => [
        this.lensTextureToken(entry.texture), entry.key, entry.wholeFrame, entry.soft, entry.frameRect,
      ])) : null;
    }

    lensGlowDenoiseKey(selector, controls, { microQuick, quickCpuGrain }) {
      return [selector.cache.identity, selector.cache.grain?.fitKey, controls, Boolean(microQuick), Boolean(quickCpuGrain)];
    }

    lensGlowSourceKey(proxy, reuseRegion) {
      if (proxy.lensGlowInput) return proxy.lensGlowInput;
      if (reuseRegion && proxy.regionTransport && proxy.region && Number.isSafeInteger(proxy.sourceEpoch)) {
        return [proxy.sessionId, proxy.lane, proxy.longEdge, proxy.geometrySignature, proxy.sourceIdentity];
      }
      const selector = this.denoiseSourceSelector;
      const resolved = proxy === selector?.resolved
        ? [selector.resolvedVersion, Boolean(selector.resolvedQuickCpuGrain)] : null;
      return [this.lensTextureToken(proxy.texture), proxy.identity, proxy.region, resolved];
    }

    lensGlowCacheKey(proxy, lane, adjustments, locals, params, extra, reuseRegion = false) {
      // Mist reads the stored base/Detail/local result, working scale, gate
      // and lens, before film response, resolution loss, halation or grain.
      const branch = adjustments[lane === "sdr" && adjustments.sdr.linked_to_hdr ? "hdr" : lane];
      const {
        film_look, film_look_section_enabled, vignette, vignette_section_enabled, output_exposure,
        highlight_section_enabled, detail: detailRecipe, ...grade
      } = branch;
      const { softness, microcontrast, ...detail } = detailRecipe || {};
      // The HDR ceiling also feeds the Tone stage. Its pre-Mist values
      // are read from the packed Tone slots below.
      const baseGrade = Object.entries(grade).filter(([name]) => !name.startsWith("highlight_compression_"));
      return JSON.stringify([
        this.resourceGeneration, this.lensGlowSourceKey(proxy, reuseRegion), proxy.sourceEpoch,
        lane, proxy.width, proxy.height, proxy.pixelFormat, proxy.workingSpace, adjustments.shared?.geometry,
        baseGrade, detail, locals, extra,
        params[GPU_PARAMS.HDR_LANE], params[GPU_PARAMS.SOURCE_LINEAR_SRGB],
        params[GPU_PARAMS.LINKED_SDR], params[GPU_PARAMS.PROJECT_REFERENCE_WHITE_NITS],
        params[GPU_PARAMS.TONE_PEAK], params[GPU_PARAMS.TONE_KNEE], params[GPU_PARAMS.TONE_LIMITER],
        params[GPU_PARAMS.SOURCE_PIXEL_SCALE], params[GPU_PARAMS.LENS_FILTER], params[GPU_PARAMS.LENS_SIZE],
        params[GPU_PARAMS.FILM_GATE_WIDTH_MM], params[GPU_PARAMS.FILM_GATE_HEIGHT_MM], params[GPU_PARAMS.FILM_GATE_AXIS],
        params[GPU_PARAMS.HSL_SHARED_SELECTION],
      ]);
    }

    lensKernelBytes() {
      const [width, height] = window.HDRWebGPUShaders.LENS_KERNEL_SIZE;
      return width * height * 4;
    }

    ensureLensKernel() {
      if (!this.lensKernel) {
        const texture = this.device.createTexture({
          label: "film Mist Gaussian weights", size: window.HDRWebGPUShaders.LENS_KERNEL_SIZE, format: "r32float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        const view = texture.createView();
        const group = this.device.createBindGroup({
          layout: this.lensKernelLayout, entries: [{ binding: 0, resource: view }],
        });
        this.lensKernel = { texture, view, group, bytes: this.lensKernelBytes() };
      }
      return this.lensKernel;
    }

    encodeFilmChain(encoder, pipelines, graph, originalView, bind, params, width, height, options = {}) {
      const filmView = graph.filmTexture.createView();
      const finishView = graph.finishTexture.createView();
      const fallback = originalView;
      const a = graph.spatialATexture?.createView() || fallback;
      const b = graph.spatialBTexture?.createView() || fallback;
      const glowTexture = options.lensGlowTile?.texture || (options.lensGlowKey && graph.lensGlowTexture);
      const glow = glowTexture?.createView();
      const glowHit = options.lensGlowTile ? options.lensGlowTile.ready
        : Boolean(glow && graph.lensGlowKey === options.lensGlowKey);
      const pass = (view, pipeline, group, w = width, h = height, instance = 0, accumulate = false, kernel = null) => {
        const render = encoder.beginRenderPass({ colorAttachments: [{
          view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: accumulate ? "load" : "clear", storeOp: "store",
        }] });
        render.setViewport(0, 0, w, h, 0, 1);
        render.setScissorRect(0, 0, w, h);
        render.setPipeline(pipeline);
        render.setBindGroup(0, group);
        if (kernel) render.setBindGroup(1, kernel);
        render.draw(3,1,0,instance);
        render.end();
      };
      const detailPass = (name, source, target) => {
        const pipeline = pipelines[name];
        const entries = [
          { binding: 0, resource: source },
          { binding: 1, resource: options.parameterBinding ?? { buffer: this.paramBuffer } },
          { binding: 8, resource: target },
        ];
        if (name === "structure") entries.push({ binding: 6, resource: this.filmStockBinding() });
        const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
        const block = window.HDRWebGPUShaders.FILM_DETAIL_BLOCK;
        const compute = encoder.beginComputePass({ label: `film-detail-${name}` });
        compute.setPipeline(pipeline);
        compute.setBindGroup(0, group);
        compute.dispatchWorkgroups(Math.ceil(width / block.width), Math.ceil(height / block.height));
        compute.end();
      };
      const active = params[GPU_PARAMS.FILM_RESPONSE_ENABLED] >= 0.5 && params[GPU_PARAMS.FILM_LOOK_STRENGTH] > 0;
      const bloom = lensGlowActive(params);
      const halation = active && params[GPU_PARAMS.HALATION_ENABLED] > 0.5;
      const scatter = active && params[GPU_PARAMS.FILM_RESOLUTION] < 1;
      // The base, Detail and local targets already hold RGBA16F pixels. Reuse
      // the stored input, not the shader that produced it, so no film stage
      // loses the half-float boundary at which its input was rounded.
      let filmInput = originalView;
      const spatial = () => {
        const grid = graph.spatialGrid || spatialGridScale(width, height);
        const sw = Math.ceil(width / grid), sh = Math.ceil(height / grid);
        pass(a, pipelines.extract, bind(filmInput, b, originalView), sw, sh);
        pass(b, pipelines.blurHorizontal, bind(filmInput, a, originalView), sw, sh);
        pass(a, pipelines.blurVertical, bind(filmInput, b, originalView), sw, sh);
      };
      if (bloom || scatter) {
        if (bloom) {
          const grid = graph.spatialGrid || spatialGridScale(width, height);
          const sw = Math.ceil(width / grid), sh = Math.ceil(height / grid);
          if (!glowHit) {
            if (options.lensGlowKey) graph.lensGlowKey = null;
            const [taps, components] = window.HDRWebGPUShaders.LENS_KERNEL_SIZE;
            const kernel = this.ensureLensKernel();
            const extractionInput = bind(originalView, fallback, originalView);
            // Regenerate in the same command stream that consumes it. A tile
            // or generation can abort without leaving a cached kernel marked ready.
            pass(kernel.view, pipelines.lensWeights, extractionInput, taps, components);
            pass(finishView, pipelines.lensExtract, extractionInput, sw, sh);
            const horizontalInput = bind(originalView, finishView, originalView);
            const verticalInput = bind(originalView, a, originalView);
            for (let component = 0; component < components; component++) {
              pass(a, pipelines.lensHorizontal, horizontalInput, sw, sh, component, false, kernel.group);
              pass(b, pipelines.lensVertical, verticalInput, sw, sh, component, component > 0, kernel.group);
            }
            if (glow) encoder.copyTextureToTexture({ texture: graph.spatialBTexture }, { texture: glowTexture }, [sw, sh]);
            this.recordStage("lens-glow", { reused: false, width, height });
          } else this.recordStage("lens-glow", { reused: true, width, height });
        }
        // On a lens-only frame the mixed picture already belongs in the
        // half-float film input. Scatter still needs its own separate store.
        pass(scatter ? finishView : filmView, pipelines.lens, bind(originalView, glow || b, originalView));
        if (scatter) detailPass("scatter", finishView, filmView);
        filmInput = filmView;
      }
      if (halation) spatial();
      const finish = options.interactive ? pipelines.finishInteractive
        : options.pruneGrain ? pipelines.finishPrunedGrain : pipelines.finish;
      const structure = params[GPU_PARAMS.STRUCTURE_ENABLED] > 0.5
        && (Math.abs(params[GPU_PARAMS.STRUCTURE_SOFTNESS]) > 0.000001 || Math.abs(params[GPU_PARAMS.STRUCTURE_MICROCONTRAST]) > 0.000001);
      const map = active && ((halation && params[GPU_PARAMS.HALATION_VIEW_MAP] > 0.5)
        || (params[GPU_PARAMS.GRAIN_ENABLED] > 0.5 && params[GPU_PARAMS.GRAIN_VIEW_MAP] > 0.5));
      if (filmInput === originalView && !(structure && !map)) {
        // When no lens/scatter occupies filmView, scan can store directly in
        // the final target without sampling and writing the same texture.
        pass(filmView, finish, bind(filmInput, a, originalView));
        pass(finishView, pipelines.scan, bind(filmView, fallback, originalView));
      } else {
        pass(finishView, finish, bind(filmInput, a, originalView));
        pass(filmView, pipelines.scan, bind(finishView, fallback, originalView));
        if (structure && !map) {
          detailPass("structure", filmView, finishView);
        } else {
          pass(finishView, pipelines.response, bind(filmView, fallback, originalView));
        }
      }
      return Boolean(bloom && glow);
    }

    pipelineFor(format, factory = null) {
      const create = factory || (descriptor => descriptor.compute
        ? this.device.createComputePipeline(descriptor) : this.device.createRenderPipeline(descriptor));
      if (this.pipelines.has(format)) return this.pipelines.get(format);
      const base = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "baseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const hslFields = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "hslFieldsFragmentMain", targets: [{ format: "rgba32float" }] },
        primitive: { topology: "triangle-list" },
      });
      const hslMask = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "hslMaskFragmentMain", targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const response = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "filmResponseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const local = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localAdjustmentFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localCandidate = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localCandidateFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailHorizontal = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailVertical = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailComposite = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const localDetailMix = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localDetailMixFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailHorizontal = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailVertical = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const detailComposite = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "detailCompositeFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const clarityPipeline = (entryPoint) => create({
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
      const extract =create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialExtractFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurHorizontal = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurVertical = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const finish = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "finishFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const finishPrunedGrain = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "finishFragmentMain", constants: { pruneGrain: true }, targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const finishInteractive = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "finishFragmentMain", constants: { grainSampleLimit: window.HDRWebGPUShaders.GRAIN_SAMPLE_COUNTS.draft }, targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const composite = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const placeholder = create({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "placeholderFragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      // Max blending is what lets every tile accumulate into one grid without
      // a readback each. `one`/`one` with operation `max` is a plain maximum:
      // the factors are ignored for min and max operations.
      const scopePeakTile = create({
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
      const lensExtract = create({
        layout:this.pipelineLayout, vertex:{module:this.module,entryPoint:"vertexMain"},
        fragment:{module:this.module,entryPoint:"lensExtractFragmentMain",targets:[{format:"rgba16float"}]},
        primitive:{topology:"triangle-list"},
      });
      if (!this.lensBlurLayout) {
        this.lensKernelLayout = this.device.createBindGroupLayout({ entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        ] });
        this.lensBlurLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout, this.lensKernelLayout] });
      }
      const lensWeights = create({
        layout:this.pipelineLayout, vertex:{module:this.module,entryPoint:"vertexMain"},
        fragment:{module:this.module,entryPoint:"lensWeightsFragmentMain",targets:[{format:"r32float"}]},
        primitive:{topology:"triangle-list"},
      });
      const lensHorizontal = create({
        layout:this.lensBlurLayout, vertex:{module:this.module,entryPoint:"vertexMain"},
        fragment:{module:this.module,entryPoint:"lensHorizontalFragmentMain",targets:[{format:"rgba16float"}]},
        primitive:{topology:"triangle-list"},
      });
      const lensVertical = create({
        layout:this.lensBlurLayout, vertex:{module:this.module,entryPoint:"vertexMain"},
        fragment:{module:this.module,entryPoint:"lensVerticalFragmentMain",targets:[{format:"rgba16float",
          blend:{color:{operation:"add",srcFactor:"one",dstFactor:"one"},alpha:{operation:"add",srcFactor:"one",dstFactor:"one"}}}]},
        primitive:{topology:"triangle-list"},
      });
      const pipelines = {
        lensExtract, lensWeights, lensHorizontal, lensVertical,
        peakCandidateLocal: create({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "peakCandidateLocalFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        }),
        ...Object.fromEntries(["lens", "scan"].map((name) => [name, create({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: `${name}FragmentMain`, targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        })])),
        ...Object.fromEntries(["scatter", "structure"].map((name) => [name, create({
          layout: "auto",
          compute: { module: this.module, entryPoint: `${name}ComputeMain` },
        })])),
        base,
        hslFields,
        hslMask,
        finish,
        finishPrunedGrain,
        finishInteractive,
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
      if (!factory) this.pipelines.set(format, pipelines);
      return pipelines;
    }

    async warmPipelines(format, beforeNext) {
      if (window.HDRDenoiseMeasurement) {
        await beforeNext();
        await window.HDRDenoiseMeasurement.warm(this.device);
      }
      if (this.pipelines.has(format)) return;
      const pending = [];
      const staged = this.pipelineFor(format, descriptor => {
        const token = {}; pending.push([token, descriptor]); return token;
      });
      const compiled = new Map();
      for (const [token, descriptor] of pending) {
        await beforeNext();
        if (this.pipelines.has(format)) return; // Foreground already needed it.
        compiled.set(token, await (descriptor.compute
          ? this.device.createComputePipelineAsync(descriptor) : this.device.createRenderPipelineAsync(descriptor)));
      }
      if (!this.pipelines.has(format)) this.pipelines.set(format,
        Object.fromEntries(Object.entries(staged).map(([name, token]) => [name, compiled.get(token)])));
    }

    destroyIntermediate(intermediate) {
      for (const resource of Object.values(intermediate)) resource?.destroy?.();
    }

    ensureIntermediate(canvas, width, height, spatialActive = false, detailActive = false, lensGlowCache = false, retain = true) {
      const current = retain ? this.intermediates.get(canvas) : null;
      const spatialGrid = spatialGridScale(width, height);
      const spatialWidth = Math.max(1, Math.ceil(width / spatialGrid));
      const spatialHeight = Math.max(1, Math.ceil(height / spatialGrid));
      const createSpatialTexture = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      });
      const createTexture = (extraUsage = 0) => this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | extraUsage,
      });
      const createFilmTexture = () => createTexture(GPUTextureUsage.STORAGE_BINDING);
      // PRD 4.3: an allocation failure records a durable backoff. This render
      // retains the last valid presentation; the next plan selects Tiled. The
      // selected preview resolution is never reduced.
      const guard = (create, kind) => {
        try {
          return create();
        } catch (error) {
          if (retain) this.recordAllocationFailure(kind, error, { width, height });
          throw error;
        }
      };
      if (current?.width === width && current?.height === height) {
        if (lensGlowCache && !current.lensGlowTexture) {
          try { current.lensGlowTexture = guard(createSpatialTexture, "lens-glow"); }
          catch { return null; }
          this.recordAllocation("lens-glow", spatialWidth * spatialHeight * 8, { width, height });
        }
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
      if (current) {
        this.intermediates.delete(canvas);
        this.destroyAfterActiveRenders(() => this.destroyIntermediate(current));
      }
      let intermediate;
      const allocated = [];
      const allocate = (create, kind) => {
        const texture = guard(create, kind);
        allocated.push(texture);
        return texture;
      };
      try {
        intermediate = {
          baseTexture: allocate(createTexture, "grading-base"),
          filmTexture: allocate(createFilmTexture, "grading-film"),
          // Film Look, Vignette and grain resolve here so the output limiter can
          // measure the finished picture instead of predicting it, and so the
          // scope pass reads that result instead of computing it a second time.
          finishTexture: allocate(createFilmTexture, "grading-finish"),
          localTexture: allocate(createTexture, "grading-local"),
          detailATexture: detailActive ? allocate(createTexture, "grading-detail-a") : null,
          detailBTexture: detailActive ? allocate(createTexture, "grading-detail-b") : null,
          spatialATexture: spatialActive ? allocate(createSpatialTexture, "spatial-a") : null,
          spatialBTexture: spatialActive ? allocate(createSpatialTexture, "spatial-b") : null,
          lensGlowTexture: lensGlowCache ? allocate(createSpatialTexture, "lens-glow") : null,
          spatialActive,
          width,
          height,
        };
      } catch {
        for (const texture of allocated) texture.destroy();
        // The backoff is already recorded. Returning null abandons this render
        // and leaves the previous accepted presentation on screen.
        return null;
      }
      if (retain) this.intermediates.set(canvas, intermediate);
      else if (this.geometryUnderlayerRender) this.geometryUnderlayerRender.intermediate = intermediate;
      this.recordAllocation(
        "grading-intermediates",
        width * height * 8 * (4 + (detailActive ? 2 : 0)) + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0)
          + (lensGlowCache ? spatialWidth * spatialHeight * 8 : 0),
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
      const scaledFilm = entryPoint === "scaledFilmPeakReductionMain";
      const moduleKey = scaledFilm ? "scaledFilmPeakReductionModule" : "peakReductionModule";
      if (!this[moduleKey]) {
        const code = scaledFilm ? window.HDRWebGPUShaders.SCALED_FILM_PEAK_REDUCTION_SHADER_SOURCE : PEAK_REDUCTION_SHADER_SOURCE;
        const module = this.device.createShaderModule({code});
        const compilation = await module.getCompilationInfo();
        const errors = compilation.messages.filter(message => message.type === "error");
        if(errors.length) throw new Error(errors.map(message => message.message).join("; "));
        this[moduleKey] = module;
      }
      const pipeline = await this.device.createComputePipelineAsync({
        layout: "auto",
        compute: { module: this[moduleKey], entryPoint },
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

    waitForUnderlayerPreparation(work, signal) {
      if (!signal) return work;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    }

    async runPeakReduction(pipeline, texture, width, height, params, measurement, cacheKey, signal) {
      signal?.throwIfAborted();
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
        await this.waitForUnderlayerPreparation(readBuffer.mapAsync(GPUMapMode.READ), signal);
        signal?.throwIfAborted();
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
        this.cachePeakReduction(cacheKey, measured);
        return measured;
      } finally {
        if (readBuffer.mapState === "mapped") readBuffer.unmap();
        resultBuffer.destroy();
        readBuffer.destroy();
        parameterBuffer.destroy();
      }
    }

    cachePeakReduction(key, peak) {
      const cache = this.peakReductionCache;
      cache.set(key, peak);
      while (cache.size > 32) cache.delete(cache.keys().next().value);
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

    /**
     * Keep the whole frame's source on the device so a pan copies its region
     * instead of fetching it (PAN-FETCH-01). Only when it fits beside what is
     * already held with room to spare: a store that pushed out the tiles and
     * masks on screen would cost more than the fetch it saves. Resolves to
     * whether the store is resident.
     */
    async holdSourceForPanning(sessionId, lane, longEdge, geometrySignature, editRevision, frame, options = {}) {
      const transport = sourceTransport();
      const sourceIdentity = options.identity || "source";
      if (this.proxies.has(transport.panStoreKey(sessionId, lane, longEdge, geometrySignature, sourceIdentity))) return true;
      // The whole frame under its own key already serves every region.
      if (this.wholeSourceResident(sessionId, lane, longEdge, geometrySignature, sourceIdentity)) return false;
      const bytes = Math.max(0, Number(frame?.width) || 0) * Math.max(0, Number(frame?.height) || 0) * 8;
      if (!this.gpuAllocator || !bytes
        || this.gpuAllocator.usedBytes() + bytes > this.memoryBudgetBytes() * this.panStoreBudgetShare) {
        this.recordStage("pan-store-skipped", { lane, longEdge, bytes });
        return false;
      }
      return Boolean(await transport.loadPanStore(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, options,
      }));
    }

    async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", editRevision = 0, sourceIdentity = "source", options = {}) {
      return sourceTransport().loadProxy(this, {
        sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, options,
      });
    }

    async loadDirectMasks({
      generation, sessionId, activeLocals, longEdge, editRevision, geometrySignature, isCurrent = () => true,
      remember = true, hue = null, requestSignal, backgroundUnderlayer = false, measureOnly = false,
    }) {
      const tasks = Array.from(activeLocals || []);
      if (!tasks.length) return { results: [], current: isCurrent() };
      const coordinator = backgroundUnderlayer || measureOnly ? this.backgroundMaskRequestCoordinator : this.maskRequestCoordinator;
      if (!coordinator) {
        const results = [];
        for (const local of tasks) {
          if (!isCurrent()) break;
          results.push(await this.loadLocalMask(
            sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, requestSignal, remember, hue,
          ));
        }
        while (results.length < tasks.length) results.push(null);
        return { results, current: isCurrent() };
      }
      return coordinator.run(
        generation,
        tasks,
        (local, _index, signal) => this.loadLocalMask(
          sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, signal, remember, hue,
        ),
        isCurrent,
        requestSignal,
      );
    }

    async loadLocalMask(
      sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true, signal = undefined,
      remember = true, hue = null,
    ) {
      if (local.mask?.operator !== "leaf") {
        // A combination with a hue leaf is composed from GPU-made leaves of
        // this lane's picture; the source-space route has no hue producer.
        if (hue && maskHasHueLeaf(local.mask)) {
          return this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, signal,
            remember, null, hue);
        }
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
        hue,
      );
    }

    async loadMaskLeaf(
      sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature,
      isCurrent = () => true, signal = undefined, allowSoft = true, remember = true, hue = null,
    ) {
      if (signal?.aborted || !isCurrent()) return null;
      if (hue && expression?.operator === "leaf" && expression.leaf?.type === "hue_range") {
        const leafEntry = await this.loadGpuHueLeaf(sessionId, expression, hue, longEdge, isCurrent, null, !remember);
        if (leafEntry) return leafEntry;
      }
      if (this.gpuAnalyticMasksEnabled) {
        const resampled = await this.loadGpuResampledLeaf(sessionId, expression, longEdge, geometrySignature, isCurrent, signal);
        if (resampled) return resampled;
        if (signal?.aborted || !isCurrent()) return null;
      }
      const leafLocal = { ...local, id: maskPath ? `${local.id}:${maskPath}` : local.id, mask: expression };
      if ((longEdge <= SOFT_MASK_MAX_EDGE || hue) && this.gpuAnalyticMasksEnabled) {
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
      if (expression?.operator !== "leaf" || ["luminance_range", "hue_range"].includes(expression.leaf?.type)) return null;
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
      hue = null,
      retainMask,
    ) {
      const startedAt = performance.now();
      const layoutIdentity = gpuMaskGraphLayoutIdentity(local.mask);
      const hueIdentity = maskHasHueLeaf(local.mask) ? (hue ? this.hueContextIdentity(hue, sourceOverride || hue.proxy) : "cpu") : "";
      const key = `${sessionId}:${local.id}:${longEdge}:${geometrySignature}:gpu-mask-graph:${layoutIdentity}`
        + (sourceOverride?.region ? `:region:${JSON.stringify(sourceOverride.region)}` : "") + (hueIdentity ? `:hue:${hue?.lane}` : "");
      let entry = this.localMasks.get(key);
      const influenceIdentity = JSON.stringify(gpuMaskRenderPayload(local.mask)) + hueIdentity;
      if (entry?.influenceIdentity === influenceIdentity) {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
        entry.lastUseSerial = this.maskUseSerial;
        return entry;
      }

      const resolveNode = async (expression, path) => {
        if (expression.operator === "leaf") {
          if (hue && expression.leaf?.type === "hue_range") {
            const leafEntry = await this.loadGpuHueLeaf(sessionId, expression, hue, longEdge, isCurrent, sourceOverride, !remember);
            return leafEntry ? { expression, leafEntry, children: [] } : null;
          }
          if (sourceOverride?.region) {
            const leafLocal = { ...local, id: `${local.id}:${path}`, mask: expression };
            const leafEntry = isGpuLumaMask(expression)
              ? await this.loadGpuLumaMask(sessionId, leafLocal, longEdge, editRevision,
                geometrySignature, isCurrent, signal, false, sourceOverride)
              : this.loadGpuAnalyticRegion(sessionId, { localIndex: 0, local: leafLocal,
                tiles: [{ key: "region", rect: sourceOverride.region, haloRect: sourceOverride.region, halo: 0 }] },
                longEdge, geometrySignature, gpuMaskIdentity(expression), isCurrent, sourceOverride, retainMask)?.entries.get("region");
            return leafEntry ? { expression, leafEntry, children: [] } : null;
          }
          // A combination is built texel for texel from its leaves, so each
          // leaf is loaded at the frame's own size, never as a small bitmap.
          const leafEntry = await this.loadMaskLeaf(
            sessionId, local, expression, path, longEdge, editRevision, geometrySignature, isCurrent, signal, false, remember,
            hue,
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
          const values = new Float32Array(PASS_LAYOUTS.record("COMBINE", { OPERATOR: gpuMaskOperatorCode(node.expression.operator), LEFT_OPACITY: result.opacity, RIGHT_OPACITY: right.opacity, INVERT: finalChild && node.expression.inverted ? 1 : 0 }));
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
          this.evictGpuCacheEntry("scene-luminance", staleKey);
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
          PASS_LAYOUTS.record("DOWNSAMPLE", { FACTOR: plan.factor, AXIS: 0, RESERVED_2: 0, RESERVED_3: 0 }),
          PASS_LAYOUTS.record("DOWNSAMPLE", { FACTOR: plan.factor, AXIS: 1, RESERVED_2: 0, RESERVED_3: 0 }),
          lumaBlurParams(plan,0,false),
          lumaBlurParams(plan,1,false),
          PASS_LAYOUTS.record("UPSAMPLE", { FACTOR: plan.factor, INVERT: inverted ? 1 : 0, RESERVED_2: 0, RESERVED_3: 0 }),
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
            let size=textureDimensions(source); let vertical=params[${MASK_PARAMS.LUMA_BOX.AXIS}]>.5;
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
            let vertical=params[${MASK_PARAMS.LUMA_BOX.AXIS}]>.5; let length=i32(select(size.x,size.y,vertical));
            let position=i32(select(id.x,id.y,vertical)); let row=select(id.y,id.x,vertical);
            let radius=i32(params[${MASK_PARAMS.LUMA_BOX.RADIUS}]); let left=max(0,position-radius); let right=min(length-1,position+radius);
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
        device.queue.writeBuffer(buffer,0,new Float32Array(PASS_LAYOUTS.record("LUMA_BOX", { AXIS: axis, RADIUS: radius, RESERVED_2: 0, RESERVED_3: 0 })));
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
      device.queue.writeBuffer(entry.verticalBuffer,0,new Float32Array(PASS_LAYOUTS.record("FEATHER", { SIGMA: 0, TAP_COUNT: 0, AXIS: 0, INVERT: inverted?1:0 })));
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
        this.evictGpuCacheEntry("local-mask", key);
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
      const make = () => this.device.createTexture({
        size: { width: grownWidth, height: grownHeight },
        format: CLARITY_MAP_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const textures = [];
      try {
        for (let i = 0; i < 3; i++) textures.push(make());
      } catch (error) {
        textures.forEach(texture => texture.destroy());
        throw error;
      }
      if (existing) this.retireClarityTextures(existing);
      const byteSize = grownWidth * grownHeight * 4 * textures.length;
      const entry = { width: grownWidth, height: grownHeight, textures, byteSize,
        allocatorEntry: this.gpuAllocator?.register({ kind: "clarity-map", key, bytes: byteSize, pinned: true }) };
      this.clarityMaps.set(key, entry);
      this.recordAllocation("clarity-map", byteSize, { key, width: grownWidth, height: grownHeight });
      return entry;
    }

    gradeClarityMapGrowth(key, width, height, radii) {
      if (!radii.length) return 0;
      const existing = this.clarityMaps?.get(key);
      let columns = existing?.width || 0, rows = existing?.height || 0;
      const params = new Float32Array(PARAM_COUNT);
      for (const radius of radii) {
        const plan = writeClarityPlan(params, width, height, radius);
        const extents = clarityMapExtents(plan, 0, 0, width, height);
        columns = Math.max(columns, extents.baseWidth);
        rows = Math.max(rows, extents.baseHeight);
      }
      return columns !== existing?.width || rows !== existing?.height ? columns * rows * 12 : 0;
    }

    retireClarityTextures(entry) {
      this.gpuCacheRelease(entry);
      this.retireGpuResource(entry.byteSize, () => entry.textures.forEach(texture => texture.destroy()));
    }

    releaseClarityMaps() {
      const maps = this.clarityMaps;
      this.clarityMaps = new Map();
      this.clarityFrameMap = null;
      this.analysisClarityFrameMap = null;
      maps?.forEach(entry => this.retireClarityTextures(entry));
    }

    clarityFrameInputIdentity(params, proxy, denoiseControls) {
      const baseParams = params.slice();
      CLARITY_IGNORED_FILM_PARAMS.forEach((index) => { baseParams[index] = 0; });
      return `${detailBandIdentity(baseParams, proxy.identity, "global")}|${proxy.sourceEpoch}|${JSON.stringify(denoiseControls)}`;
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
      const plan = writeClarityPlan(new Float32Array(PARAM_COUNT), proxy.width, proxy.height, params[GPU_PARAMS.CLARITY_RADIUS]);
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
      const reblur = chunks.length > 0 || state.blurKey !== blurKey;
      return {
        plan, extents, state, chunks, columns, rows, blurKey,
        textures: entry.textures,
        reblur,
        // Recorded as filled only once the work that fills them is encoded;
        // a generation that stops early discards the whole map instead.
        commit: () => {
          chunks.forEach(({ texels }) => {
            for (let y = texels.y; y < texels.y + texels.height; y += 1) {
              state.covered.fill(1, y * columns + texels.x, y * columns + texels.x + texels.width);
            }
          });
          state.blurKey = blurKey;
          if (reblur) state.version = ++this.clarityFrameMapVersion;
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
      const byteSize = extents.width * extents.height * 4;
      const entry = { texture, textures: [texture], scale: extents.scale, byteSize,
        allocatorEntry: this.gpuAllocator?.register({ kind: "clarity-surround", bytes: byteSize, pinned: true }) };
      this.claritySurroundEntries.add(entry);
      return entry;
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
      values[GPU_PARAMS.FRAME_WIDTH] = proxy.width;
      values[GPU_PARAMS.FRAME_HEIGHT] = proxy.height;
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
      for (const entry of [surround.global, ...surround.locals.values()]) {
        if (this.claritySurroundEntries.delete(entry)) this.retireClarityTextures(entry);
      }
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
      if (lane === "sdr" && adjustments.sdr.linked_to_hdr) {
        locals = locals.map(local => ({ ...local, sdr_grade: local.hdr_grade }));
      }
      const isCurrent = () => !options.signal?.aborted && options.isCurrent?.() !== false;
      const key = JSON.stringify([sessionId, lane, revision, adjustments.shared?.geometry || {}, adjustments[lane],
        lane === "sdr" && adjustments.sdr.linked_to_hdr ? adjustments.hdr : null, locals,
        white, options.identity || "source", this.highlightSourceToken({})]);
      // The Peak readout and the highlight anchor are measured side by side
      // for one edit. They share one render: two on the same canvas would
      // each supersede the other's source load.
      while (isCurrent()) {
        const kept = this.claritySurround;
        if (kept?.key === key && kept.generation === this.resourceGeneration) return kept;
        const flight = this.claritySurroundInflight;
        if (!flight) break;
        if (flight.key === key && flight.generation === this.resourceGeneration
            && (!flight.signal || flight.signal === options.signal)) {
          flight.current.push(isCurrent);
          const result = await flight.promise;
          return isCurrent() && flight.generation === this.resourceGeneration ? result : null;
        }
        await flight.promise.catch(() => null);
      }
      if (!isCurrent()) return null;
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
          revision, null, white, sourceSize, { isCurrent: anyCurrent, measureOnly: true, captureClarity: surround,
            signal: options.signal, cancelCoarseFetches: Boolean(options.signal) });
        if (!rendered?.width || !surround.frameWidth || !anyCurrent() || surround.generation !== this.resourceGeneration) {
          this.releaseClaritySurround(surround);
          return null;
        }
        this.releaseClaritySurround(this.claritySurround);
        this.claritySurround = surround;
        return surround;
      })();
      const record = { key, generation: this.resourceGeneration, current, promise, signal: options.signal };
      this.claritySurroundInflight = record;
      try {
        const result = await promise;
        return isCurrent() && record.generation === this.resourceGeneration ? result : null;
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

    localParamBuffer(local, lane, sourcePixelScale, frameWidth = 0, frameHeight = 0, maskEntry = null, globalParams = null) {
      const key = `${local.id}:${lane}`;
      let buffer = this.localParamBuffers.get(key);
      const values = buildLocalParams(local, lane, sourcePixelScale,this.localCurveOffsets?.get(local.id) || 0, globalParams);
      if (frameWidth > 0 && frameHeight > 0) {
        writeClarityPlan(values, frameWidth, frameHeight, values[MASK_PARAMS.LOCAL.CLARITY_RADIUS]);
        values[GPU_PARAMS.FRAME_WIDTH] = frameWidth;
        values[GPU_PARAMS.FRAME_HEIGHT] = frameHeight;
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

  HDRWebGPUPreview.spatialMaskSignature = spatialMaskSignature;
  window.HDRWebGPUPreview = HDRWebGPUPreview;

})();
