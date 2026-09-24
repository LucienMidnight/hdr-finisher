/**
 * Phase 5 item 2: calibrate the Auto GPU budget from verified device
 * information, validate it with a bounded allocation probe, and keep the
 * stated policy value as the conservative fallback.
 *
 * WebGPU does not report physical VRAM, so nothing here may claim to know it.
 * What can be verified is the adapter's own identity and its limits, and what
 * can be tested is whether an allocation of the candidate size actually
 * succeeds on this device right now. Both are used only to *lower* the
 * candidate: PRD 5.7 says Auto must not be raised above the policy fallback
 * before ledger agreement and failure recovery pass, so the policy number is a
 * ceiling that this module never crosses and the source of every decision is
 * reported rather than inferred.
 *
 *   software adapter  -> 512 MiB candidate  (verified: isFallbackAdapter or a
 *                        software rasterizer in the adapter description)
 *   limited device    -> 1 GiB candidate    (verified: device limits below what
 *                        a full-resolution graph needs)
 *   otherwise         -> policy candidate   (the stated fallback)
 *
 * A failed probe downgrades one step and records the probe evidence. A device
 * that cannot allocate the probe at all keeps the conservative floor and says
 * so; it never silently proceeds on an unvalidated number.
 */

const HDRGPU_BUDGET_FLOOR_BYTES = 512 * 1024 * 1024;
const HDRGPU_BUDGET_SOFTWARE_BYTES = 512 * 1024 * 1024;
const HDRGPU_BUDGET_LIMITED_BYTES = 1024 * 1024 * 1024;
const HDRGPU_BUDGET_PROBE_LIMIT_BYTES = 256 * 1024 * 1024;
// Below this many 16-bit RGBA pixels the device cannot even hold one
// full-resolution intermediate class at the sprint's reference sizes.
const HDRGPU_BUDGET_MIN_TEXTURE_DIMENSION = 8192;
const HDRGPU_BUDGET_MIN_BUFFER_BYTES = 128 * 1024 * 1024;

const HDRGpuBudget = {
  calibrate({ policyBytes, adapterInfo = null, limits = null, probe = null } = {}) {
    const policy = Math.max(0, Number(policyBytes) || 0);
    const notes = [];
    let candidate = policy;
    let source = policy > 0 ? "policy-fallback" : "unavailable";

    const fallbackAdapter = Boolean(adapterInfo?.fallback);
    if (fallbackAdapter) {
      candidate = Math.min(policy || HDRGPU_BUDGET_SOFTWARE_BYTES, HDRGPU_BUDGET_SOFTWARE_BYTES);
      source = "software-adapter";
      notes.push("adapter reports software fallback");
    } else {
      const maxTextureDimension = Number(limits?.maxTextureDimension2D) || 0;
      const maxBufferSize = Number(limits?.maxBufferSize) || 0;
      const limited = (maxTextureDimension > 0 && maxTextureDimension < HDRGPU_BUDGET_MIN_TEXTURE_DIMENSION)
        || (maxBufferSize > 0 && maxBufferSize < HDRGPU_BUDGET_MIN_BUFFER_BYTES);
      if (limited) {
        candidate = Math.min(policy || HDRGPU_BUDGET_LIMITED_BYTES, HDRGPU_BUDGET_LIMITED_BYTES);
        source = "limited-device";
        notes.push(`device limits below the reference graph (maxTextureDimension2D=${maxTextureDimension || "unknown"}, maxBufferSize=${maxBufferSize || "unknown"})`);
      }
    }

    const probeRequested = Math.min(
      Math.max(HDRGPU_BUDGET_FLOOR_BYTES / 2, Math.floor(candidate / 2)),
      HDRGPU_BUDGET_PROBE_LIMIT_BYTES,
      Number(limits?.maxBufferSize) || HDRGPU_BUDGET_PROBE_LIMIT_BYTES,
    );
    const probeEvidence = { requestedBytes: probeRequested, passed: null, steps: [] };
    if (typeof probe === "function" && candidate > 0 && probeRequested > 0) {
      const passed = Boolean(probe(probeRequested));
      probeEvidence.passed = passed;
      probeEvidence.steps.push({ bytes: probeRequested, passed });
      if (!passed) {
        const downgraded = Math.min(candidate, HDRGPU_BUDGET_LIMITED_BYTES);
        if (downgraded < candidate) {
          notes.push(`allocation probe failed at ${probeRequested} bytes; Auto downgraded`);
          candidate = downgraded;
          source = "probe-downgrade";
        } else {
          candidate = Math.min(candidate, HDRGPU_BUDGET_FLOOR_BYTES);
          source = "probe-floor";
          notes.push(`allocation probe failed at ${probeRequested} bytes; conservative floor kept`);
        }
      }
    } else if (typeof probe !== "function") {
      notes.push("no allocation probe available on this surface");
    }

    const budgetBytes = Math.max(0, Math.min(candidate, policy || candidate));
    return {
      policyBytes: policy,
      ceilingBytes: policy,
      budgetBytes,
      source,
      fallback: source === "policy-fallback" || source === "unavailable",
      notes,
      probe: probeEvidence,
      adapter: adapterInfo
        ? {
          fallback: Boolean(adapterInfo.fallback),
          description: adapterInfo.description || "unknown",
          vendor: adapterInfo.vendor || "unknown",
        }
        : null,
    };
  },
};

if (typeof window !== "undefined") {
  window.HDRGpuBudget = HDRGpuBudget;
}
