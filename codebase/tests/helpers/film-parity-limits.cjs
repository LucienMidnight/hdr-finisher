// Steve, 2026-11-14: only measured Mac byte-mean misses may use tight
// perceptual limits. Identical policy on PC and Mac; never select by adapter
// or by whether today's strict check happens to fail. Full finished SDR
// presentations in BOTH editing lanes use Delta E 2000 (not HDR ITP).
// Three-repeat worst + 0.005 mean / + 0.020 p99.9, rounded UP to 0.001.
// Exact measured case list below; all other cases retain the strict byte gate.
const STRICT_BYTE_LIMITS = Object.freeze({ mean: 0.1, p999: 2 });
const LENS_PERCEPTUAL_LIMITS = Object.freeze({
  hdr: Object.freeze({"mean": 0.161, "p999": 1.155}),
  sdr: Object.freeze({"mean": 0.248, "p999": 1.202}),
});
const VELVIA_SDR_PERCEPTUAL_LIMITS = Object.freeze({
  sdr: Object.freeze({"mean": 0.125, "p999": 1.065}),
});
const LENS_PERCEPTUAL_CASES = Object.freeze([
  "1520/hdr/black_pro_mist 2 0.25 35mm",
  "1520/hdr/black_pro_mist 2 0.25 super8",
  "1520/hdr/black_pro_mist 2 4 35mm",
  "1520/hdr/black_pro_mist 2 4 super8",
  "1520/hdr/cinebloom 2 0.25 super8",
  "1520/hdr/cinebloom 2 4 35mm",
  "1520/hdr/cinebloom 2 4 super8",
  "1520/hdr/glimmerglass 2 4 35mm",
  "1520/hdr/glimmerglass 2 4 super8",
  "1520/hdr/pro_mist 2 0.25 35mm",
  "1520/hdr/pro_mist 2 0.25 super8",
  "1520/hdr/pro_mist 2 4 35mm",
  "1520/hdr/pro_mist 2 4 super8",
  "1520/sdr/black_pro_mist 2 0.25 35mm",
  "1520/sdr/black_pro_mist 2 0.25 super8",
  "1520/sdr/black_pro_mist 2 4 35mm",
  "1520/sdr/black_pro_mist 2 4 super8",
  "1520/sdr/cinebloom 2 0.25 35mm",
  "1520/sdr/cinebloom 2 0.25 super8",
  "1520/sdr/cinebloom 2 4 35mm",
  "1520/sdr/cinebloom 2 4 super8",
  "1520/sdr/glimmerglass 2 0.25 35mm",
  "1520/sdr/glimmerglass 2 0.25 super8",
  "1520/sdr/glimmerglass 2 4 35mm",
  "1520/sdr/glimmerglass 2 4 super8",
  "1520/sdr/pro_mist 2 0.25 35mm",
  "1520/sdr/pro_mist 2 0.25 super8",
  "1520/sdr/pro_mist 2 4 35mm",
  "1520/sdr/pro_mist 2 4 super8",
  "2400/hdr/black_pro_mist 2 0.25 35mm",
  "2400/hdr/black_pro_mist 2 0.25 super8",
  "2400/hdr/black_pro_mist 2 4 35mm",
  "2400/hdr/black_pro_mist 2 4 super8",
  "2400/hdr/cinebloom 2 0.25 35mm",
  "2400/hdr/cinebloom 2 0.25 super8",
  "2400/hdr/cinebloom 2 4 35mm",
  "2400/hdr/cinebloom 2 4 super8",
  "2400/hdr/glimmerglass 2 0.25 35mm",
  "2400/hdr/glimmerglass 2 4 35mm",
  "2400/hdr/glimmerglass 2 4 super8",
  "2400/hdr/pro_mist 2 0.25 35mm",
  "2400/hdr/pro_mist 2 0.25 super8",
  "2400/hdr/pro_mist 2 4 35mm",
  "2400/hdr/pro_mist 2 4 super8",
  "2400/sdr/black_pro_mist 2 0.25 35mm",
  "2400/sdr/black_pro_mist 2 0.25 super8",
  "2400/sdr/black_pro_mist 2 4 35mm",
  "2400/sdr/black_pro_mist 2 4 super8",
  "2400/sdr/cinebloom 2 0.25 35mm",
  "2400/sdr/cinebloom 2 0.25 super8",
  "2400/sdr/cinebloom 2 4 35mm",
  "2400/sdr/cinebloom 2 4 super8",
  "2400/sdr/glimmerglass 2 0.25 35mm",
  "2400/sdr/glimmerglass 2 0.25 super8",
  "2400/sdr/glimmerglass 2 4 35mm",
  "2400/sdr/glimmerglass 2 4 super8",
  "2400/sdr/pro_mist 2 0.25 35mm",
  "2400/sdr/pro_mist 2 0.25 super8",
  "2400/sdr/pro_mist 2 4 35mm",
  "2400/sdr/pro_mist 2 4 super8",
]);
const lensPerceptualCases = new Set(LENS_PERCEPTUAL_CASES);

function limitsFor(driver, edge, lane, label, { extremeHdr = false, inputPath = null } = {}) {
  if (extremeHdr || inputPath) return null;
  if (driver === 'lens' && lensPerceptualCases.has(`${edge}/${lane}/${label}`)) return LENS_PERCEPTUAL_LIMITS[lane];
  if (driver === 'film' && edge === 1200 && lane === 'sdr' && label === 'Velvia physical chain') return VELVIA_SDR_PERCEPTUAL_LIMITS.sdr || null;
  return null;
}

function assessParity({ context, mean, p999, colour, limits }) {
  const failures = [];
  const display = value => Number(value.toPrecision(8)).toString();
  const check = (name, value, limit) => {
    if (!Number.isFinite(limit) || limit < 0) { failures.push(`${name} has an invalid limit (${limit})`); return; }
    if (!Number.isFinite(value) || value < 0) failures.push(`${name} is missing, negative or non-finite (${value})`);
    else if (value > limit) failures.push(`${name} ${display(value)} exceeds ${display(limit)} by ${display(value - limit)}`);
  };
  check('added byte p99.9 (levels)', p999, STRICT_BYTE_LIMITS.p999);
  if (limits) {
    check(`${colour?.metric || 'Delta E'} mean`, colour?.mean, limits.mean);
    check(`${colour?.metric || 'Delta E'} p99.9`, colour?.p999, limits.p999);
  } else {
    check('added byte mean (levels)', mean, STRICT_BYTE_LIMITS.mean);
  }
  return { passed: failures.length === 0, message: failures.length ? `${context} out of sync: ${failures.join('; ')}` : null };
}

module.exports = { STRICT_BYTE_LIMITS, LENS_PERCEPTUAL_LIMITS, VELVIA_SDR_PERCEPTUAL_LIMITS, LENS_PERCEPTUAL_CASES, limitsFor, assessParity };
