(function () {
  const DEFAULTS = {
    interactiveScopeMs: 60,
    settleMs: 110,
    refinementMs: 520,
  };

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
      this.interacting = false;
      this.lastScopeStartedAt = -Infinity;
      this.metrics = {
        inputCount: 0,
        frameCount: 0,
        staleResults: 0,
        coalescedFrames: 0,
        coalescedScopes: 0,
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

    scheduleInactive(lane, applicationGeneration) {
      const generation = ++this.generations.inactive;
      const task = { lane, applicationGeneration, generation };
      const run = () => {
        this.idleHandle = null;
        if (generation !== this.generations.inactive || this.interacting) return;
        this.callbacks.onInactive?.(task);
      };
      if (window.requestIdleCallback) this.idleHandle = window.requestIdleCallback(run, { timeout: 1200 });
      else this.idleHandle = window.setTimeout(run, 300);
    }

    cancel() {
      this.current = null;
      this.generations.image += 1;
      this.generations.scope += 1;
      this.generations.refinement += 1;
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.framePending = false;
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
      this.frame = requestAnimationFrame(async () => {
        this.frame = null;
        const current = this.current;
        if (!current) return;
        const started = performance.now();
        this.recordMetric("queueDelayMs", started - current.inputAt);
        this.frameInFlight = true;
        try {
          await this.measure("renderMs", () => this.callbacks.onFrame?.(current));
          this.metrics.frameCount += 1;
        } finally {
          this.frameInFlight = false;
          if (this.framePending) {
            this.framePending = false;
            if (this.current) this.requestFrame(this.current);
          }
        }
      });
    }

    armInteractiveScope(task) {
      window.clearTimeout(this.scopeTimer);
      const elapsed = performance.now() - this.lastScopeStartedAt;
      const delay = Math.max(0, this.timings.interactiveScopeMs - elapsed);
      this.scopeTimer = window.setTimeout(async () => {
        if (this.current !== task) return;
        this.lastScopeStartedAt = performance.now();
        await this.runScope({ task, tier: "interactive" });
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
        if (window.cancelIdleCallback) window.cancelIdleCallback(this.idleHandle);
        else window.clearTimeout(this.idleHandle);
      }
      this.idleHandle = null;
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
