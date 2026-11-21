/* Grade-only retry state. Delivery uses its own job policy. */
(function (root) {
  const renderFailure = root.HDRRenderFailure ??
    (typeof module === "object" ? require("./render-failure").HDRRenderFailure : null);
  const TEMPORARY = new Set(["gpu_budget_exceeded", "gpu_allocation_pressure", "transport_timeout", "device_lost"]);
  const MARGIN = 0.9;

  function failureReason(error, deviceLost) {
    if (error?.name === "AbortError" || error?.status === 409) return "superseded";
    if (error?.grainReason) return error.grainReason;
    if (deviceLost) return "device_lost";
    const message = String(error?.message || "");
    if (error?.name === "TimeoutError" || error?.status === 503 || /\((502|503|504)\)/.test(message)) return "transport_timeout";
    if (/supported source size|strip.*exceeds.*limit/i.test(message)) return "source_too_large";
    if (/lens correction/i.test(message)) return "unsupported_lens_correction";
    if (/geometry adjustment|bayer|sensor data/i.test(message) && /uses the CPU|needs|unsupported|not available/i.test(message)) {
      return "unsupported_grain_source";
    }
    if (/invalid|incomplete|non.finite|compile|compilation|shader/i.test(message)) return "gpu_validation_error";
    const kind = renderFailure?.classify(error).kind;
    return ({ transport: "transport_timeout", allocation: "gpu_allocation_pressure", limits: "source_too_large",
      unsupported: "unsupported_grain_source", validation: "gpu_validation_error",
      "device-lost": "device_lost", superseded: "superseded" })[kind] || "grain_gpu_error";
  }

  function headroom(snapshot) {
    return MARGIN * snapshot.budget_bytes - Math.max(snapshot.resident_bytes, snapshot.allocator_bytes);
  }

  class Failures {
    constructor({ now = Date.now, ttlMs = 30000, transportDelayMs = 150 } = {}) {
      this.now = now;
      this.ttlMs = ttlMs;
      this.transportDelayMs = transportDelayMs;
      this.entries = new Map();
    }

    get(key) {
      const failure = this.entries.get(key);
      if (failure && this.now() >= failure.expires) {
        this.entries.delete(key);
        return null;
      }
      return failure ?? null;
    }

    record(key, reason, snapshot, device) {
      if (reason === "superseded") return null;
      const previous = this.get(key);
      const temporary = TEMPORARY.has(reason);
      const now = this.now();
      const failure = { reason, snapshot, device, temporary, retried: Boolean(previous?.retried),
        expires: temporary ? now + this.ttlMs : Infinity, retryAt: now + this.transportDelayMs };
      this.entries.set(key, failure);
      return failure;
    }

    canRetry(failure, snapshot, device, available) {
      if (!available || !failure?.temporary || failure.retried) return false;
      if (device && device !== failure.device) return true;
      switch (failure.reason) {
        case "transport_timeout": return this.now() >= failure.retryAt;
        case "gpu_budget_exceeded":
          return headroom(snapshot) > headroom(failure.snapshot) && headroom(snapshot) >= failure.snapshot.requested_bytes;
        case "gpu_allocation_pressure":
          return headroom(snapshot) > headroom(failure.snapshot);
        default: return false;
      }
    }

    takeRetry(key, snapshot, device, available) {
      const failure = this.get(key);
      if (!this.canRetry(failure, snapshot, device, available)) return false;
      failure.retried = true;
      return true;
    }

    succeeded(key) {
      this.entries.delete(key);
    }
  }

  const api = { failureReason, headroom, Failures };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HDRGrainRoute = api;
})(globalThis);
