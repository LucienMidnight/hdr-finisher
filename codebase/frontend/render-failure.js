(function () {
  /**
   * Failure taxonomy for the preview renderer (sprint PRD Section 5.8), under
   * the GPU failure rule (master PRD philosophy 3, November 6, 2026): one GPU
   * attempt, and at most one retry, only for a temporary cause outside the
   * work (contention timeout or network, memory that other work may hold, a
   * lost device).
   *
   * Errors are classified as superseded/cancelled, transport (timeouts and
   * network), allocation pressure (out of memory), card limits (too large for
   * the adapter), unsupported graph, shader/validation defect, device loss,
   * unknown, or permanent initialization failure. Card limits, validation,
   * unsupported graphs and unknown errors repeat with the same input, so they
   * are not retried: that render uses the CPU fallback.
   *
   * Only permanent initialization failure disables WebGPU for the whole
   * session. Repeated validation failure disables it only for the work it
   * happened in (one photo's preview); other photos keep the GPU. The CPU
   * preview is slow and refuses some graphs, so a single validation failure
   * does not switch a whole photo to it.
   */
  const VALIDATION_DISABLE_THRESHOLD = 3;

  const KINDS = {
    superseded: { recoverable: true, retry: false, disables: false },
    transport: { recoverable: true, retry: true, disables: false },
    allocation: { recoverable: true, retry: true, disables: false },
    limits: { recoverable: true, retry: false, disables: false },
    unsupported: { recoverable: true, retry: false, disables: false },
    validation: { recoverable: true, retry: false, disables: "repeated" },
    "device-lost": { recoverable: true, retry: true, disables: false },
    unknown: { recoverable: true, retry: false, disables: false },
    init: { recoverable: false, retry: false, disables: true },
  };

  function detailOf(error) {
    return String(error?.message || error || "").trim() || "Unknown render failure";
  }

  function classify(error, context = {}) {
    const name = String(error?.name || "");
    const message = detailOf(error);
    const lower = message.toLowerCase();
    let kind = "unknown";
    if (context.superseded || error?.superseded || name === "AbortError"
      || /superseded|aborted|cancelled|canceled|deferred/.test(lower)) {
      kind = "superseded";
    } else if (context.init) {
      kind = "init";
    } else if (context.deviceLost || /device lost|device_lost/.test(lower)) {
      kind = "device-lost";
    } else if (context.validation || /validation|not contained in the render area|invalid value|invalid usage/i.test(message)) {
      kind = "validation";
    } else if (/maxbuffersize|max texture dimension|maxtexturedimension|too large|exceeds? (the )?(adapter |device )?limit|limit exceeded/i.test(lower)) {
      kind = "limits";
    } else if (/out of memory|\boom\b|allocation|failed to allocate/i.test(lower)) {
      kind = "allocation";
    } else if (/unsupported|not supported|refused/i.test(lower)) {
      kind = "unsupported";
    } else if (/timeout|timed out|failed to fetch|fetch failed|network|not responding|stalled?\b/i.test(lower)) {
      kind = "transport";
    }
    return { kind, detail: message, ...KINDS[kind] };
  }

  /**
   * Tracks failures across renders and decides what may be disabled.
   *
   * `work` names the piece of work a failure belongs to (the Grade session of
   * one photo). Validation failures are counted per work; a render of that
   * work that presents resets its count. Reaching the threshold disables the
   * GPU for that work only. Initialization failure disables it everywhere.
   */
  class HDRRenderFailurePolicy {
    constructor(options = {}) {
      this.validationThreshold = Math.max(1, Number(options.validationThreshold) || VALIDATION_DISABLE_THRESHOLD);
      this.consecutiveValidation = 0;
      this.validationByWork = new Map();
      this.disabledWork = new Set();
      this.disabled = false;
      this.records = [];
    }

    record(error, context = {}) {
      const failure = classify(error, context);
      const work = context.work ?? null;
      if (failure.kind === "validation") {
        this.consecutiveValidation = (this.validationByWork.get(work) || 0) + 1;
        this.validationByWork.set(work, this.consecutiveValidation);
      } else if (failure.kind !== "superseded") {
        this.validationByWork.delete(work);
        this.consecutiveValidation = 0;
      }
      if (failure.kind === "init") this.disabled = true;
      if (failure.kind === "validation" && this.consecutiveValidation >= this.validationThreshold) {
        this.disabledWork.add(work);
      }
      const workDisabled = this.disabledFor(work);
      this.records.push({ kind: failure.kind, detail: failure.detail, work, at: Date.now() });
      if (this.records.length > 40) this.records.shift();
      return {
        ...failure,
        disabled: this.disabled,
        workDisabled,
        retryable: failure.retry && !workDisabled,
        counts: {
          consecutiveValidation: this.consecutiveValidation,
          validationThreshold: this.validationThreshold,
        },
      };
    }

    noteSuccess(work = null) {
      this.validationByWork.delete(work);
      this.consecutiveValidation = 0;
    }

    disabledFor(work = null) {
      return this.disabled || this.disabledWork.has(work);
    }

    snapshot() {
      return {
        disabled: this.disabled,
        disabledWork: [...this.disabledWork],
        consecutiveValidation: this.consecutiveValidation,
        validationThreshold: this.validationThreshold,
        records: this.records.slice(),
      };
    }
  }

  HDRRenderFailurePolicy.VALIDATION_DISABLE_THRESHOLD = VALIDATION_DISABLE_THRESHOLD;
  HDRRenderFailurePolicy.classify = classify;

  if (typeof window !== "undefined") {
    window.HDRRenderFailure = { classify, KINDS };
    window.HDRRenderFailurePolicy = HDRRenderFailurePolicy;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { HDRRenderFailure: { classify, KINDS }, HDRRenderFailurePolicy };
  }
})();
