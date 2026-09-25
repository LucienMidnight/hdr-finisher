(function () {
  const DEFAULTS = {
    // P6 (Preview Responsiveness Tuning Sprint): live scopes during a drag at
    // most every 100 ms, and never while a preview frame is on the GPU.
    interactiveScopeMs: 100,
    settleMs: 110,
    refinementMs: 520,
    // P6, owner decision Q3: drag frames are capped at 60 fps whatever the
    // display's refresh rate, so a 144-165 Hz monitor does not drive the GPU
    // two or three times as hard for no visible gain.
    maxInteractiveFps: 60,
  };
  // Vsync timestamps jitter; a frame due a little early still counts as due,
  // or a 60 Hz display would drop to 30 fps.
  const FRAME_PACING_TOLERANCE_MS = 2.5;

  // Phase 5 item 5: how long to wait before retrying deferred inactive work
  // once the editor reports it is no longer busy.
  const INACTIVE_RETRY_MS = 400;

  class HDRPreviewScheduler {
    constructor(callbacks, timings = {}) {
      this.callbacks = callbacks;
      this.timings = { ...DEFAULTS, ...timings };
      this.generations = { image: 0, scope: 0, refinement: 0, inactive: 0 };
      this.current = null;
      this.frame = null;
      this.frameInFlight = false;
      this.framePending = false;
      this.scopeTimer = null;
      this.scopeInFlight = false;
      this.scopePending = null;
      this.settleTimer = null;
      this.refinementTimer = null;
      this.idleHandle = null;
      this.idleKind = null;
      this.interacting = false;
      this.lastScopeStartedAt = -Infinity;
      this.lastFrameStartedAt = -Infinity;
      this.scopeAfterFrame = null;
      this.metrics = {
        inputCount: 0,
        frameCount: 0,
        staleResults: 0,
        coalescedFrames: 0,
        coalescedScopes: 0,
        inactiveDeferred: 0,
        queueDelayMs: [],
        renderMs: [],
        scopeMs: [],
        settleMs: [],
      };
    }

    beginInteraction() {
      this.interacting = true;
      this.cancelIdleWork();
    }

    recordStaleResult() {
      this.metrics.staleResults += 1;
    }

    endInteraction() {
      this.interacting = false;
      if (this.current) this.armSettle(this.current);
    }

    schedule(lane, applicationGeneration) {
      const inputAt = performance.now();
      const task = {
        lane,
        applicationGeneration,
        imageGeneration: ++this.generations.image,
        scopeGeneration: ++this.generations.scope,
        refinementGeneration: ++this.generations.refinement,
        inputAt,
      };
      this.current = task;
      this.metrics.inputCount += 1;
      this.cancelIdleWork();
      this.requestFrame(task);
      this.armInteractiveScope(task);
      this.armSettle(task);
      return task;
    }

    /**
     * Prepare the inactive lane, but only when it cannot compete with work
     * the user is looking at.
     *
     * `requestIdleCallback` only reports a gap in the browser's event loop; it
     * has no idea a settled render, a queued follow-up or a caught-up pan is
     * still holding the GPU. Phase 5 item 5 keeps that lane's whole-frame
     * upload off the foreground by asking `canRun` again at the moment the
     * idle callback fires and retrying later if the editor is still busy. An
     * explicit comparison gesture bypasses this and calls the preload
     * directly.
     */
    scheduleInactive(lane, applicationGeneration, canRun = null) {
      const generation = ++this.generations.inactive;
      const task = { lane, applicationGeneration, generation };
      const arm = () => {
        this.idleHandle = null;
        if (generation !== this.generations.inactive || this.interacting) return;
        if (window.requestIdleCallback) {
          this.idleKind = "idle";
          this.idleHandle = window.requestIdleCallback(run, { timeout: 1200 });
        } else {
          this.idleKind = "timer";
          this.idleHandle = window.setTimeout(run, 300);
        }
      };
      const run = () => {
        this.idleHandle = null;
        if (generation !== this.generations.inactive || this.interacting) return;
        if (canRun && !canRun()) {
          this.metrics.inactiveDeferred += 1;
          this.idleKind = "timer";
          this.idleHandle = window.setTimeout(arm, INACTIVE_RETRY_MS);
          return;
        }
        this.callbacks.onInactive?.(task);
      };
      arm();
    }

    cancel() {
      this.current = null;
      this.generations.image += 1;
      this.generations.scope += 1;
      this.generations.refinement += 1;
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.framePending = false;
      this.scopeAfterFrame = null;
      if (this.scopePending) this.scopePending.resolve(false);
      this.scopePending = null;
      window.clearTimeout(this.scopeTimer);
      window.clearTimeout(this.settleTimer);
      this.scopeTimer = null;
      this.settleTimer = null;
      this.cancelIdleWork();
    }

    snapshot() {
      return JSON.parse(JSON.stringify(this.metrics));
    }

    isCurrent(task, generationKey) {
      return this.current === task && task[generationKey] === this.generations[generationKey.replace("Generation", "")];
    }

    requestFrame(task) {
      if (this.frameInFlight) {
        this.framePending = true;
        this.metrics.coalescedFrames += 1;
        return;
      }
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(async (vsync) => {
        this.frame = null;
        const current = this.current;
        if (!current) return;
        const now = Number.isFinite(vsync) ? vsync : performance.now();
        const minimumInterval = 1000 / Math.max(1, this.timings.maxInteractiveFps) - FRAME_PACING_TOLERANCE_MS;
        if (now - this.lastFrameStartedAt < minimumInterval) {
          // Too soon for the cap: wait for a later vsync with the latest task.
          this.requestFrame(this.current);
          return;
        }
        this.lastFrameStartedAt = now;
        const started = performance.now();
        this.recordMetric("queueDelayMs", started - current.inputAt);
        this.frameInFlight = true;
        try {
          await this.measure("renderMs", () => this.callbacks.onFrame?.(current));
          this.metrics.frameCount += 1;
        } finally {
          this.frameInFlight = false;
          const deferredScope = this.scopeAfterFrame;
          this.scopeAfterFrame = null;
          if (deferredScope && this.current === deferredScope) this.startInteractiveScope(deferredScope);
          if (this.framePending) {
            this.framePending = false;
            if (this.current) this.requestFrame(this.current);
          }
        }
      });
    }

    startInteractiveScope(task) {
      // A scope readback competes with the preview for the GPU. While a frame
      // is in flight it waits for that frame, then runs in the gap.
      if (this.frameInFlight) {
        this.scopeAfterFrame = task;
        return;
      }
      this.lastScopeStartedAt = performance.now();
      this.runScope({ task, tier: "interactive" });
    }

    armInteractiveScope(task) {
      window.clearTimeout(this.scopeTimer);
      const elapsed = performance.now() - this.lastScopeStartedAt;
      const delay = Math.max(0, this.timings.interactiveScopeMs - elapsed);
      this.scopeTimer = window.setTimeout(async () => {
        if (this.current !== task) return;
        this.startInteractiveScope(task);
      }, delay);
    }

    armSettle(task) {
      window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(async () => {
        if (this.current !== task) return;
        const started = performance.now();
        await this.callbacks.onSettle?.({ ...task, tier: "settled" });
        if (this.current !== task) return;
        await this.runScope({ task, tier: "settled" });
        this.recordMetric("settleMs", performance.now() - started);
        this.armRefinement(task);
      }, this.timings.settleMs);
    }

    armRefinement(task) {
      if (!this.callbacks.highQuality?.()) return;
      window.clearTimeout(this.refinementTimer);
      this.refinementTimer = window.setTimeout(async () => {
        if (this.current !== task || this.interacting) return;
        await this.callbacks.onRefine?.({ ...task, tier: "refinement" });
        if (this.current !== task || this.interacting) return;
        await this.runScope({ task, tier: "refinement" });
      }, this.timings.refinementMs);
    }

    cancelIdleWork() {
      window.clearTimeout(this.refinementTimer);
      this.refinementTimer = null;
      if (this.idleHandle !== null) {
        if (this.idleKind === "idle" && window.cancelIdleCallback) window.cancelIdleCallback(this.idleHandle);
        else window.clearTimeout(this.idleHandle);
      }
      this.idleHandle = null;
      this.idleKind = null;
      this.generations.inactive += 1;
    }

    async measure(bucket, callback) {
      const started = performance.now();
      try {
        return await callback?.();
      } finally {
        this.recordMetric(bucket, performance.now() - started);
      }
    }

    runScope(scopeRequest) {
      return new Promise((resolve, reject) => {
        const request = { ...scopeRequest, resolve, reject };
        if (this.scopeInFlight) {
          if (this.scopePending) this.scopePending.resolve(false);
          this.scopePending = request;
          this.metrics.coalescedScopes += 1;
          return;
        }
        this.executeScope(request);
      });
    }

    async executeScope(request) {
      this.scopeInFlight = true;
      try {
        const result = await this.measure("scopeMs", () => this.callbacks.onScope?.({
          ...request.task,
          tier: request.tier,
        }));
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      } finally {
        this.scopeInFlight = false;
        const pending = this.scopePending;
        this.scopePending = null;
        if (pending) {
          if (this.current === pending.task) this.executeScope(pending);
          else pending.resolve(false);
        }
      }
    }

    recordMetric(bucket, value) {
      const values = this.metrics[bucket];
      values.push(value);
      if (values.length > 240) values.shift();
    }
  }

  window.HDRPreviewScheduler = HDRPreviewScheduler;
})();
