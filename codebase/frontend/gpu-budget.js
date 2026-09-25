/**
 * Phase 5 item 2: calibrate the Auto GPU budget from verified device
 * information, validate it with a bounded allocation probe, and keep the
 * stated policy value as the conservative fallback.
 *
 * WebGPU does not report physical VRAM. The desktop shell can: it reads the
 * active adapter's dedicated memory from the driver (see desktop/lib/
 * video-memory.js). Failure recovery has landed (ROI sprint ledger 15.44), so
 * the Preview Responsiveness Tuning Sprint (owner decision Q2) lets Auto use
 * up to half of that detected dedicated memory. Without a detection -- a
 * browser, an unsupported platform, or integrated graphics whose dedicated
 * figure is only a small carve-out -- Auto stays at the stated policy
 * fallback. Verified adapter facts and a real allocation probe can then only
 * *lower* the candidate, and the source of every decision is reported rather
 * than inferred.
 *
 *   detected card     -> half of its dedicated video memory
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
// Below this a "dedicated" figure is an integrated GPU's carve-out, not a card:
// WebGPU on those adapters allocates from shared memory.
const HDRGPU_BUDGET_MIN_DISCRETE_BYTES = 4 * 1024 * 1024 * 1024;
const HDRGPU_GIB = 1024 * 1024 * 1024;

function formatGib(bytes) {
  const gib = bytes / HDRGPU_GIB;
  return Number.isInteger(Math.round(gib * 10) / 10) ? String(Math.round(gib)) : gib.toFixed(1);
}

const HDRGpuBudget = {
  calibrate({ policyBytes, detectedVideoMemory = null, adapterInfo = null, limits = null, probe = null } = {}) {
    const fallbackPolicy = Math.max(0, Number(policyBytes) || 0);
    const notes = [];
    const detectedBytes = Number(detectedVideoMemory?.bytes) > 0 ? Number(detectedVideoMemory.bytes) : null;
    const discrete = detectedBytes !== null && detectedBytes >= HDRGPU_BUDGET_MIN_DISCRETE_BYTES && fallbackPolicy > 0;
    const policy = discrete ? Math.floor(detectedBytes / 2) : fallbackPolicy;
    let candidate = policy;
    let source = discrete ? "detected-vram" : policy > 0 ? "policy-fallback" : "unavailable";
    if (discrete) {
      notes.push(`detected ${formatGib(detectedBytes)} GiB dedicated video memory${detectedVideoMemory.device ? ` on ${detectedVideoMemory.device}` : ""}; Auto uses half`);
    } else if (detectedBytes !== null) {
      notes.push(`detected ${formatGib(detectedBytes)} GiB dedicated memory is an integrated carve-out; the standard Auto limit applies`);
    }

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
      detectedBytes,
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

  /** The readout for Auto: the budget in use and whether it came from the card. */
  autoLabel(calibration) {
    const bytes = Number(calibration?.budgetBytes) || 0;
    const detected = Number(calibration?.detectedBytes) || 0;
    const budget = `Auto · ${formatGib(bytes)} GiB`;
    if (calibration?.source === "detected-vram") return `${budget} (detected ${formatGib(detected)} GiB)`;
    if (calibration?.source === "policy-fallback" || calibration?.source === "unavailable" || !calibration) {
      return `${budget} (not detected)`;
    }
    return `${budget} (${calibration.source.replace(/-/g, " ")})`;
  },
};

if (typeof window !== "undefined") {
  window.HDRGpuBudget = HDRGpuBudget;
}
