(function () {
  "use strict";

  /**
   * Render coordinator (sprint PRD 5.1).
   *
   * Owns what decides whether preview work is still worth doing:
   *
   * - edit, viewport, scale, source and lane generations;
   * - foreground versus background priority;
   * - one-in-flight / one-latest-pending coalescing;
   * - cancellation tokens for fetch, CPU and unsubmitted GPU batches;
   * - presentation acceptance;
   * - the coarse-to-refined follow-up lifecycle (ROI catch-up, pan follow-up);
   * - timing feedback for the latency controller.
   *
   * It is a state machine: no DOM, no GPU, no rendering. `dispatch` and
   * `present` are injected by app.js, so the same module can be unit tested
   * without an adapter and app.js is left to emit intent and present state.
   */

  const LANES = ["hdr", "sdr"];
  const DEFAULT_CATCH_UP_DELAY_MS = 700;
  const DEFAULT_PAN_DELAY_MS = 140;
  const METRIC_LIMIT = 240;

  function toInt(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function clampDelay(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeViewport(rect) {
    if (!rect) return null;
    const x = Math.max(0, toInt(rect.x, 0));
    const y = Math.max(0, toInt(rect.y, 0));
    const width = toInt(rect.width, 0);
    const height = toInt(rect.height, 0);
    if (!(width > 0 && height > 0)) return null;
    return Object.freeze({ x, y, width, height });
  }

  function sameRect(a, b) {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  class HDRRenderCoordinator {
    constructor(options = {}) {
      this.now = typeof options.now === "function" ? options.now : () => performance.now();
      this.setTimer = typeof options.setTimer === "function"
        ? options.setTimer
        : (callback, ms) => window.setTimeout(callback, ms);
      this.clearTimer = typeof options.clearTimer === "function"
        ? options.clearTimer
        : (handle) => window.clearTimeout(handle);
      this.dispatch = typeof options.dispatch === "function" ? options.dispatch : null;
      this.present = typeof options.present === "function" ? options.present : null;
      this.canPanRefine = typeof options.canPanRefine === "function" ? options.canPanRefine : null;
      this.onRefusal = typeof options.onRefusal === "function" ? options.onRefusal : null;
      this.onError = typeof options.onError === "function" ? options.onError : null;
      this.onFollowUpStart = typeof options.onFollowUpStart === "function" ? options.onFollowUpStart : null;
      this.onChange = typeof options.onChange === "function" ? options.onChange : null;
      this.catchUpDelayMs = clampDelay(options.catchUpDelayMs, DEFAULT_CATCH_UP_DELAY_MS);
      this.panDelayMs = clampDelay(options.panDelayMs, DEFAULT_PAN_DELAY_MS);

      this.roiMode = options.roiMode === "refinement" ? "refinement" : "fit";
      this.sessionId = options.sessionId ?? null;
      this.activeLane = options.activeLane || "hdr";
      this.tokenSerial = 0;
      // Monotonic per dispatch, not per submission: a coalesced intent that
      // never starts must not invalidate the presentation record of the render
      // that actually presented.
      this.dispatchSerial = 0;
      this.lanes = new Map();
      for (const lane of LANES) this.lanes.set(lane, this.freshLane(lane));
      this.metrics = {
        submits: 0,
        dispatched: 0,
        coalesced: 0,
        dropped: 0,
        cancelled: 0,
        foregroundDispatches: 0,
        backgroundDispatches: 0,
        dispatchMs: [],
        queueDelayMs: [],
      };
    }

    freshLane(lane) {
      return {
        lane,
        editGeneration: 0,
        viewportGeneration: 0,
        scaleGeneration: 0,
        sourceGeneration: 0,
        laneGeneration: 0,
        viewport: null,
        scale: { tier: null, longEdge: 0 },
        inFlight: null,
        pending: null,
        panTimer: null,
        catchUpTimer: null,
        accepted: null,
        lastRefusal: null,
      };
    }

    laneState(lane) {
      if (!this.lanes.has(lane)) this.lanes.set(lane, this.freshLane(lane));
      return this.lanes.get(lane);
    }

    // ---- generations -----------------------------------------------------

    generation(lane, kind = "edit") {
      const st = this.laneState(lane);
      const key = `${kind}Generation`;
      return Number.isFinite(st[key]) ? st[key] : 0;
    }

    generations(lane) {
      const st = this.laneState(lane);
      return {
        edit: st.editGeneration,
        viewport: st.viewportGeneration,
        scale: st.scaleGeneration,
        source: st.sourceGeneration,
        lane: st.laneGeneration,
      };
    }

    /**
     * A newer edit. Every token from before it is stale, the deferred
     * follow-ups belong to the generation it replaces, and any in-flight
     * render stops at its next boundary instead of presenting old pixels.
     */
    noteEdit(lane) {
      const st = this.laneState(lane);
      st.editGeneration += 1;
      this.cancelFollowUps(lane);
      this.cancelInFlight(lane, "superseded-by-edit");
      this.emitChange(lane, "edit");
      return st.editGeneration;
    }

    /** The visible output region the viewer is looking at, or null for Fit. */
    noteViewport(lane, rect) {
      const st = this.laneState(lane);
      const next = normalizeViewport(rect);
      if (sameRect(st.viewport, next)) return false;
      st.viewport = next;
      st.viewportGeneration += 1;
      this.emitChange(lane, "viewport");
      return true;
    }

    /** The processing scale a request will run at (tier and target edge). */
    noteScale(lane, scale = {}) {
      const st = this.laneState(lane);
      const tier = scale.tier == null ? st.scale.tier : String(scale.tier);
      const longEdge = Math.max(0, toInt(scale.longEdge, st.scale.longEdge));
      if (st.scale.tier === tier && st.scale.longEdge === longEdge) return false;
      st.scale = { tier, longEdge };
      st.scaleGeneration += 1;
      this.emitChange(lane, "scale");
      return true;
    }

    /**
     * A replacement source or session. Generations stay monotonic so work
     * already queued by the browser cannot publish into the new document, and
     * every lane's retained-frame facts are retired.
     */
    noteSource(sessionId) {
      this.sessionId = sessionId ?? null;
      for (const lane of this.lanes.keys()) {
        const st = this.laneState(lane);
        st.sourceGeneration += 1;
        this.cancelFollowUps(lane);
        this.cancelInFlight(lane, "superseded-by-source");
        this.dropPending(lane, "superseded-by-source");
        st.viewport = null;
        st.scale = { tier: null, longEdge: 0 };
        st.accepted = null;
      }
      this.emitChange(null, "source");
    }

    /** The lane the viewer currently shows. */
    noteActiveLane(lane) {
      if (this.activeLane === lane) return false;
      this.activeLane = lane;
      this.laneState(lane).laneGeneration += 1;
      this.emitChange(lane, "lane");
      return true;
    }

    /**
     * Cancel the lane's in-flight work and deferred follow-ups without
     * bumping a generation. Geometry transactions use this to stop work that
     * the transaction itself will supersede.
     */
    cancelLane(lane, reason = "cancelled") {
      this.cancelFollowUps(lane);
      this.cancelInFlight(lane, reason);
      this.dropPending(lane, reason);
    }

    setRoiMode(mode, { cancelFollowUps = true } = {}) {
      const next = mode === "refinement" ? "refinement" : "fit";
      if (this.roiMode === next) return false;
      this.roiMode = next;
      if (cancelFollowUps) {
        for (const lane of this.lanes.keys()) this.cancelFollowUps(lane);
      }
      return true;
    }

    // ---- cancellation tokens --------------------------------------------

    tokenCurrent(token) {
      if (!token || token.cancelled) return false;
      const st = this.laneState(token.lane);
      return token.generation.edit === st.editGeneration
        && token.generation.source === st.sourceGeneration;
    }

    createToken(intent, st) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const token = {
        id: ++this.tokenSerial,
        lane: intent.lane,
        tier: intent.tier,
        reason: intent.reason,
        priority: intent.priority,
        generation: {
          edit: st.editGeneration,
          viewport: st.viewportGeneration,
          scale: st.scaleGeneration,
          source: st.sourceGeneration,
          lane: st.laneGeneration,
        },
        signal: controller ? controller.signal : null,
        cancelled: false,
        cancelReason: null,
      };
      token.cancel = (reason) => {
        if (token.cancelled) return false;
        token.cancelled = true;
        token.cancelReason = reason || "cancelled";
        if (controller) controller.abort();
        this.metrics.cancelled += 1;
        return true;
      };
      token.isCurrent = () => this.tokenCurrent(token);
      return token;
    }

    cancelInFlight(lane, reason) {
      const st = this.laneState(lane);
      if (!st.inFlight) return false;
      return st.inFlight.token.cancel(reason);
    }

    dropPending(lane, reason) {
      const st = this.laneState(lane);
      if (!st.pending) return false;
      const pending = st.pending;
      st.pending = null;
      this.settleEntry(st, pending, false, reason);
      return true;
    }

    cancelFollowUps(lane) {
      this.cancelPan(lane);
      this.cancelCatchUp(lane);
    }

    // ---- admission -------------------------------------------------------

    inFlight(lane) {
      return this.laneState(lane).inFlight;
    }

    inFlightPromise(lane) {
      return this.laneState(lane).inFlight?.promise || null;
    }

    foregroundBusy() {
      for (const lane of this.lanes.keys()) {
        const st = this.laneState(lane);
        if (st.inFlight && st.inFlight.priority === "foreground") return true;
        if (st.pending && st.pending.priority === "foreground") return true;
      }
      return false;
    }

    viewportFor(intent, st) {
      if (!intent.viewport) return null;
      if (intent.catchUp) return null;
      return st.viewport;
    }

    buildEntry(intent, st) {
      const token = this.createToken(intent, st);
      const request = {
        lane: intent.lane,
        tier: intent.tier,
        longEdge: intent.longEdge,
        reason: intent.reason,
        priority: intent.priority,
        allowInactive: Boolean(intent.allowInactive),
        applicationGeneration: st.editGeneration,
        viewportGeneration: st.viewportGeneration,
        scaleGeneration: st.scaleGeneration,
        sourceGeneration: st.sourceGeneration,
        laneGeneration: st.laneGeneration,
        viewport: this.viewportFor(intent, st),
        roiCatchUp: Boolean(intent.catchUp),
        panPass: Boolean(intent.panPass),
        sessionId: this.sessionId,
        token,
        isCurrent: token.isCurrent,
      };
      let resolve = null;
      let reject = null;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // The promise is returned to the caller; rejection is handled by it.
      promise.catch(() => null);
      return {
        intent,
        request,
        token,
        promise,
        resolve,
        reject,
        priority: intent.priority,
        submittedAt: this.now(),
        settled: false,
      };
    }

    /**
     * Submit render intent. Foreground intent supersedes the in-flight render
     * (the token stops it at its next boundary) and becomes the one latest
     * pending; rapid submissions collapse onto that pending. Background intent
     * never displaces foreground work: it waits behind it, and a later
     * foreground submission replaces it.
     */
    submit(intent = {}) {
      const lane = intent.lane || this.activeLane || "hdr";
      const priority = intent.priority === "background" ? "background" : "foreground";
      const normalized = {
        lane,
        tier: intent.tier || "settled",
        longEdge: Math.max(0, toInt(intent.longEdge, 0)),
        reason: intent.reason || "render",
        priority,
        viewport: Boolean(intent.viewport),
        catchUp: Boolean(intent.catchUp),
        panPass: Boolean(intent.panPass),
        allowInactive: Boolean(intent.allowInactive),
      };
      const st = this.laneState(lane);
      this.metrics.submits += 1;
      const entry = this.buildEntry(normalized, st);

      if (!st.inFlight && st.pending) {
        const orphan = st.pending;
        st.pending = null;
        void this.runEntry(st, orphan);
      }
      if (st.inFlight) {
        if (priority === "foreground") {
          st.inFlight.token.cancel("superseded-by-newer-render");
          if (st.pending) this.settleEntry(st, st.pending, false, "coalesced-by-newer-render");
          st.pending = entry;
          this.metrics.coalesced += 1;
          return entry.promise;
        }
        if (st.pending && st.pending.priority === "foreground") {
          return this.refuseEntry(st, entry, "background-deferred");
        }
        if (st.pending) this.settleEntry(st, st.pending, false, "coalesced-by-newer-render");
        st.pending = entry;
        this.metrics.coalesced += 1;
        return entry.promise;
      }
      return this.runEntry(st, entry);
    }

    async runEntry(st, entry) {
      st.inFlight = entry;
      const startedAt = this.now();
      this.metrics.dispatched += 1;
      this.recordMetric("queueDelayMs", Math.max(0, startedAt - entry.submittedAt));
      if (entry.priority === "foreground") this.metrics.foregroundDispatches += 1;
      else this.metrics.backgroundDispatches += 1;
      entry.request.dispatchSerial = ++this.dispatchSerial;

      let result = null;
      let error = null;
      try {
        result = this.dispatch ? await this.dispatch(entry.request) : null;
      } catch (caught) {
        error = caught;
      }
      this.recordMetric("dispatchMs", Math.max(0, this.now() - startedAt));
      if (st.inFlight === entry) st.inFlight = null;

      if (!error && result && entry.token.isCurrent()) {
        let record = null;
        try {
          record = this.present ? this.present(entry.request, result) : null;
        } catch (presentError) {
          this.recordRefusal(st, entry, "presentation-failed", presentError);
        }
        if (record) st.accepted = record;
        // A viewport pass is the refinement that the whole-frame catch-up
        // exists for. The catch-up is armed only after a real presentation,
        // never after a refused one.
        if (entry.request.viewport) {
          this.armCatchUp(st.lane, {
            longEdge: entry.request.longEdge,
            generation: entry.request.applicationGeneration,
          });
        }
      }

      const pending = st.pending;
      if (pending) {
        st.pending = null;
        if (pending.token.isCurrent()) void this.runEntry(st, pending);
        else this.settleEntry(st, pending, false, "superseded-before-dispatch");
      }

      if (error) {
        this.settleEntry(st, entry, null, null, error);
        throw error;
      }
      this.settleEntry(st, entry, result, null);
      return result;
    }

    refuseEntry(st, entry, reason) {
      this.metrics.dropped += 1;
      this.settleEntry(st, entry, false, reason);
      return entry.promise;
    }

    settleEntry(st, entry, value, refusal = null, error = null) {
      if (!entry || entry.settled) return;
      entry.settled = true;
      if (refusal) this.recordRefusal(st, entry, refusal);
      if (error) entry.reject(error);
      else entry.resolve(value);
    }

    recordRefusal(st, entry, reason, detail = null) {
      st.lastRefusal = {
        reason,
        lane: st.lane,
        tier: entry.request?.tier || null,
        detail: detail ? String(detail?.message || detail) : null,
        at: this.now(),
      };
      if (this.onRefusal) this.onRefusal(st.lastRefusal);
    }

    reportError(lane, reason, error) {
      if (this.onError) this.onError(lane, reason, error);
    }

    // ---- follow-up lifecycle --------------------------------------------

    /**
     * Whether a deferred pan pass has anything to work with: a retained tiled
     * frame at the selected tier, a magnified viewport, the ROI mode on, and
     * whatever app-side facts (session, geometry) the caller requires.
     */
    panCandidate(lane) {
      if (this.roiMode !== "refinement") return false;
      const st = this.laneState(lane);
      const accepted = st.accepted;
      if (!accepted || accepted.lane !== lane) return false;
      if (accepted.transport !== "WebGPU" || accepted.execution !== "tiled") return false;
      if (accepted.exact !== true) return false;
      if (!(accepted.processedLongEdge > 0)) return false;
      if (!st.viewport) return false;
      if (this.canPanRefine && !this.canPanRefine(lane)) return false;
      return true;
    }

    notePan(lane) {
      if (this.roiMode !== "refinement") return false;
      if (!this.panCandidate(lane)) return false;
      this.cancelPan(lane);
      const st = this.laneState(lane);
      st.panTimer = this.setTimer(() => {
        st.panTimer = null;
        void this.requestPanRefinement(lane);
      }, this.panDelayMs);
      return true;
    }

    cancelPan(lane) {
      const st = this.laneState(lane);
      if (st.panTimer === null) return false;
      this.clearTimer(st.panTimer);
      st.panTimer = null;
      return true;
    }

    panPending(lane) {
      return this.laneState(lane).panTimer !== null;
    }

    /**
     * The pan follow-up is a follow-up, not a competitor: it waits for work
     * already holding the device instead of superseding it, and re-arms
     * itself while that work finishes.
     */
    async requestPanRefinement(lane) {
      if (this.roiMode !== "refinement") return false;
      if (!this.panCandidate(lane)) return false;
      const st = this.laneState(lane);
      if (this.foregroundBusy()) {
        if (st.panTimer === null) {
          st.panTimer = this.setTimer(() => {
            st.panTimer = null;
            void this.requestPanRefinement(lane);
          }, this.panDelayMs);
        }
        return false;
      }
      const longEdge = st.accepted?.processedLongEdge;
      if (!(longEdge > 0)) return false;
      if (this.onFollowUpStart) this.onFollowUpStart(lane, "pan");
      return this.submit({
        lane,
        tier: "refinement",
        longEdge,
        reason: "pan",
        priority: "foreground",
        viewport: true,
        panPass: true,
      }).catch((error) => {
        this.reportError(lane, "pan", error);
        return false;
      });
    }

    /**
     * After an ROI pass presents, bring the rest of the frame to the same
     * generation once the user pauses. Cancelled by a newer edit or a mode
     * change; skipped when the generation has moved on; the pass it starts
     * yields to newer work like any other.
     */
    armCatchUp(lane, { longEdge = 0, generation = null } = {}) {
      if (this.roiMode !== "refinement") return false;
      const st = this.laneState(lane);
      this.cancelCatchUp(lane);
      const targetGeneration = generation === null ? st.editGeneration : Number(generation);
      const targetEdge = Math.max(0, toInt(longEdge, 0));
      st.catchUpTimer = this.setTimer(() => {
        st.catchUpTimer = null;
        if (this.roiMode !== "refinement") return;
        if (this.activeLane !== lane) return;
        if (!this.sessionId) return;
        if (targetGeneration !== st.editGeneration) return;
        if (this.onFollowUpStart) this.onFollowUpStart(lane, "catch-up");
        void this.submit({
          lane,
          tier: "refinement",
          longEdge: targetEdge,
          reason: "catch-up",
          priority: "foreground",
          viewport: false,
          catchUp: true,
        }).catch((error) => this.reportError(lane, "catch-up", error));
      }, this.catchUpDelayMs);
      return true;
    }

    cancelCatchUp(lane) {
      const st = this.laneState(lane);
      if (st.catchUpTimer === null) return false;
      this.clearTimer(st.catchUpTimer);
      st.catchUpTimer = null;
      return true;
    }

    catchUpPending(lane) {
      return this.laneState(lane).catchUpTimer !== null;
    }

    // ---- presentation ----------------------------------------------------

    /**
     * Record what is on screen. The coordinator keeps the accepted frame so
     * the follow-up decisions (pan candidate, generation freshness) read one
     * source of truth instead of app.js state.
     */
    noteAccepted(record) {
      if (!record || !record.lane) return false;
      this.laneState(record.lane).accepted = record;
      return true;
    }

    accepted(lane) {
      return this.laneState(lane).accepted;
    }

    // ---- diagnostics and timing -----------------------------------------

    recordMetric(bucket, value) {
      const values = this.metrics[bucket];
      if (!values) return;
      values.push(value);
      if (values.length > METRIC_LIMIT) values.shift();
    }

    emitChange(lane, kind) {
      if (this.onChange) this.onChange(lane, kind);
    }

    state(lane = this.activeLane) {
      const st = this.laneState(lane);
      return {
        lane,
        roiMode: this.roiMode,
        sessionId: this.sessionId,
        activeLane: this.activeLane,
        generations: this.generations(lane),
        viewport: st.viewport ? { ...st.viewport } : null,
        scale: { ...st.scale },
        inFlight: st.inFlight
          ? {
            tokenId: st.inFlight.token.id,
            tier: st.inFlight.request.tier,
            reason: st.inFlight.request.reason,
            priority: st.inFlight.priority,
          }
          : null,
        pending: st.pending
          ? {
            tier: st.pending.request.tier,
            reason: st.pending.request.reason,
            priority: st.pending.priority,
          }
          : null,
        panTimerPending: st.panTimer !== null,
        catchUpTimerPending: st.catchUpTimer !== null,
        accepted: st.accepted,
        lastRefusal: st.lastRefusal,
      };
    }

    snapshot() {
      return JSON.parse(JSON.stringify({
        roiMode: this.roiMode,
        sessionId: this.sessionId,
        activeLane: this.activeLane,
        lanes: {
          hdr: this.state("hdr"),
          sdr: this.state("sdr"),
        },
        metrics: this.metrics,
      }));
    }
  }

  HDRRenderCoordinator.LANES = Object.freeze([...LANES]);
  HDRRenderCoordinator.DEFAULT_CATCH_UP_DELAY_MS = DEFAULT_CATCH_UP_DELAY_MS;
  HDRRenderCoordinator.DEFAULT_PAN_DELAY_MS = DEFAULT_PAN_DELAY_MS;

  if (typeof window !== "undefined") window.HDRRenderCoordinator = HDRRenderCoordinator;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRRenderCoordinator };
})();
