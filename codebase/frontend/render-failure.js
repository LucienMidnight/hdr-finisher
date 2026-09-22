(function () {
  /**
   * Failure taxonomy for the preview renderer (sprint PRD Section 5.8).
   *
   * Errors are classified as superseded/cancelled, recoverable transport
   * failure, recoverable allocation pressure, unsupported graph,
   * shader/validation defect, device loss, or permanent initialization
   * failure. Only permanent initialization failure or repeated unrecoverable
   * validation failure may disable WebGPU for the session. Everything else
   * keeps the device and the accepted frame: allocation pressure backs off,
   * device loss rebuilds, and transport retries within a bounded budget.
   */
  const VALIDATION_DISABLE_THRESHOLD = 3;

  const KINDS = {
    superseded: { recoverable: true, retry: false, disables: false },
    transport: { recoverable: true, retry: true, disables: false },
    allocation: { recoverable: true, retry: true, disables: false },
    unsupported: { recoverable: true, retry: false, disables: false },
    validation: { recoverable: true, retry: false, disables: "repeated" },
    "device-lost": { recoverable: true, retry: true, disables: false },
    init: { recoverable: false, retry: false, disables: true },
  };

  function detailOf(error) {
    return String(error?.message || error || "").trim() || "Unknown render failure";
  }

  function classify(error, context = {}) {
    const name = String(error?.name || "");
    const message = detailOf(error);
    const lower = message.toLowerCase();
    let kind = "transport";
    if (context.superseded || error?.superseded || name === "AbortError"
      || /superseded|aborted|cancelled|canceled|deferred/.test(lower)) {
      kind = "superseded";
    } else if (context.init) {
      kind = "init";
    } else if (context.deviceLost || /device lost|device_lost/.test(lower)) {
      kind = "device-lost";
    } else if (context.validation || /validation|not contained in the render area|invalid value|invalid usage/i.test(message)) {
      kind = "validation";
    } else if (/out of memory|\boom\b|allocation|failed to allocate|maxbuffersize|max texture dimension|too large/i.test(lower)) {
      kind = "allocation";
    } else if (/unsupported|not supported|refused/i.test(lower)) {
      kind = "unsupported";
    }
    return { kind, detail: message, ...KINDS[kind] };
  }

  /**
   * Tracks failures across renders and decides whether WebGPU may be disabled.
   *
   * The only sticky decision is the one Section 5.8 permits: permanent
   * initialization failure, or validation failure repeated without a single
   * successful render in between. `noteSuccess` is what makes the count
   * "consecutive"; a render that presents resets it.
   */
  class HDRRenderFailurePolicy {
    constructor(options = {}) {
      this.validationThreshold = Math.max(1, Number(options.validationThreshold) || VALIDATION_DISABLE_THRESHOLD);
      this.consecutiveValidation = 0;
      this.disabled = false;
      this.records = [];
    }

    record(error, context = {}) {
      const failure = classify(error, context);
      if (failure.kind === "validation") {
        this.consecutiveValidation += 1;
      } else if (failure.kind !== "superseded") {
        this.consecutiveValidation = 0;
      }
      if (failure.kind === "init") this.disabled = true;
      if (failure.kind === "validation" && this.consecutiveValidation >= this.validationThreshold) {
        this.disabled = true;
      }
      this.records.push({ kind: failure.kind, detail: failure.detail, at: Date.now() });
      if (this.records.length > 40) this.records.shift();
      return {
        ...failure,
        disabled: this.disabled,
        retryable: failure.retry && !this.disabled,
        counts: {
          consecutiveValidation: this.consecutiveValidation,
          validationThreshold: this.validationThreshold,
        },
      };
    }

    noteSuccess() {
      this.consecutiveValidation = 0;
    }

    snapshot() {
      return {
        disabled: this.disabled,
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
