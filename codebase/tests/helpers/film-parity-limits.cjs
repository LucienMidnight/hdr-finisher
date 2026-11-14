// Steve, 2026-11-14: only measured Mac byte-mean misses may use tight
// perceptual limits. Identical policy on PC and Mac; never select by adapter
// or by whether today's strict check happens to fail. Calibration in progress.
const LENS_PERCEPTUAL_LIMITS = Object.freeze({});
const VELVIA_SDR_PERCEPTUAL_LIMITS = Object.freeze({});
const LENS_PERCEPTUAL_CASES = new Set([]);

function limitsFor(driver, edge, lane, label, { extremeHdr = false, inputPath = null } = {}) {
  if (extremeHdr || inputPath) return null;
  if (driver === 'lens' && LENS_PERCEPTUAL_CASES.has(`${edge}/${lane}/${label}`)) return LENS_PERCEPTUAL_LIMITS[lane];
  if (driver === 'film' && edge === 1200 && lane === 'sdr' && label === 'Velvia physical chain') return VELVIA_SDR_PERCEPTUAL_LIMITS.sdr || null;
  return null;
}

function assessParity({ context, mean, p999, colour, limits }) {
  const failures = [];
  if (p999 > 2 || !Number.isFinite(p999)) failures.push(`added byte p99.9 ${p999} exceeds 2 levels by ${p999 - 2}`);
  if (limits) {
    for (const key of ['mean', 'p999']) {
      const value = colour?.[key], limit = limits[key];
      if (!Number.isFinite(value) || value > limit) failures.push(`${colour?.metric || 'Delta E'} ${key === 'p999' ? 'p99.9' : 'mean'} ${value} exceeds ${limit} by ${value - limit}`);
    }
  } else if (!Number.isFinite(mean) || mean > .1) {
    failures.push(`added byte mean ${mean} exceeds 0.1 levels by ${mean - .1}`);
  }
  return { passed: failures.length === 0, message: failures.length ? `${context} out of sync: ${failures.join('; ')}` : null };
}
module.exports = { LENS_PERCEPTUAL_LIMITS, VELVIA_SDR_PERCEPTUAL_LIMITS, LENS_PERCEPTUAL_CASES, limitsFor, assessParity };
