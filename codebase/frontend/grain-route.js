/* Grade Grain route and retry state. Delivery uses its own job policy. */
(function (root) {
  const renderFailure = root.HDRRenderFailure ??
    (typeof module === "object" ? require("./render-failure").HDRRenderFailure : null);
  const TEMPORARY = new Set(["gpu_budget_exceeded", "app_memory_ceiling", "gpu_allocation_pressure", "transport_timeout", "device_lost"]);
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
    return Math.min(snapshot.app_headroom_bytes ?? Infinity,
      MARGIN * snapshot.budget_bytes - Math.max(snapshot.resident_bytes, snapshot.allocator_bytes));
  }

  function microFallback(previous, error, action) {
    return {
      key: error?.grainSourceKey ?? previous?.key,
      reason: error ? failureReason(error) : previous?.reason || "grain_gpu_error",
      action: action ?? previous?.action,
    };
  }

  function gpuPreferred(method, renderer, microUnavailable, microBackup) {
    if (method === "micro_grain") return !microUnavailable && !microBackup;
    return method === "clean_grain" && renderer.enableGradeCleanGrainGpu !== false;
  }

  const REASONS = {
    unsupported_lens_correction: "lens correction is on",
    unsupported_grain_source: "the source or its geometry needs CPU processing",
    gpu_grain_not_selected: "GPU Denoise is turned off",
    user_selected_cpu: "CPU rendering is selected",
    gpu_unavailable: "the GPU is unavailable",
    device_lost: "the GPU stopped responding",
    gpu_budget_exceeded: "graphics memory was short",
    app_memory_ceiling: "the app was short of shared memory",
    gpu_allocation_pressure: "graphics memory was short",
    gpu_allocation_failed: "graphics memory was short",
    gpu_request_too_large: "this photo needs more graphics memory than is available",
    source_too_large: "this photo is too large for GPU Denoise",
    transport_timeout: "the GPU preparation request timed out",
    gpu_validation_error: "the GPU result failed a validity check",
  };
  const METHODS = { micro_grain: "Micro Grain", clean_grain: "Clean Grain" };

  function describe({ method, enabled, original, unavailable, error, frame, cpuBusy, canRetry, retryNote }) {
    // Steve, Nov 21: say nothing while the GPU does its job. One line
    // appears only when the slower CPU route is in use (and why), or when
    // the method cannot run.
    if (!METHODS[method]) return null;
    if (!enabled || original) return { message: "" };
    if (unavailable || (error && frame?.route !== "cpu")) return { message: unavailable || error };
    if (!frame) return { message: cpuBusy ? "Preparing the denoised preview on the CPU…" : "" };
    const progress = cpuBusy ? "Preparing the next preview on the CPU…" : "";
    if (frame.route !== "cpu") return { message: progress };
    const action = canRetry ? "Retry on GPU" : method === "micro_grain" ? "Switch to Clean Grain" : null;
    const reason = REASONS[frame.reason] || "the GPU preview could not be used";
    const size = frame.reducedEdge ? ` Preview limited to ${frame.reducedEdge.toLocaleString()} px. Export is full size.`
      : " Export is unchanged.";
    return {
      message: [`${METHODS[method]} is using the slower CPU because ${reason}.${size}`, error, retryNote, progress]
        .filter(Boolean).join(" "),
      action,
    };
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
      if (!available || !this.canOfferRetry(failure)) return false;
      if (device && device !== failure.device) return true;
      switch (failure.reason) {
        case "transport_timeout": return this.now() >= failure.retryAt;
        case "app_memory_ceiling":
        case "gpu_budget_exceeded":
          return headroom(snapshot) > headroom(failure.snapshot) && headroom(snapshot) >= failure.snapshot.requested_bytes;
        case "gpu_allocation_pressure":
          return headroom(snapshot) > headroom(failure.snapshot);
        default: return false;
      }
    }

    canOfferRetry(failure) {
      return Boolean(failure?.temporary && !failure.retried);
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

  const api = { failureReason, headroom, microFallback, gpuPreferred, describe, Failures };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HDRGrainRoute = api;
})(globalThis);
