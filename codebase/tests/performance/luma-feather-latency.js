/**
 * P7 acceptance: a feathered luma local, zoomed to 200% on the 42.4 MP
 * fixture, settles quickly after a Feather change and after a grade change.
 *
 *   node tests/run-in-electron.js tests/performance/luma-feather-latency.js
 *
 * Preview Responsiveness Tuning Sprint P7. The PRD's measured cause was a
 * whole-image CPU mask compile per zoom level (about 4 s of blur at native
 * size). Since then Direct GPU rendering covers zoomed views (P2/P3) and a
 * single luma mask is qualified and feathered on the GPU, so this driver
 * checks whether any of that wait is left, with real slider drags:
 *
 *   (a) Feather dragged on a luma local with Feather 50%, at 200%:
 *       release -> settled, cold (first after the zoom) and warm;
 *   (b) that local's Exposure dragged: release -> settled.
 *
 * "Settled" is the first sampled frame at or after the trusted pointer-up in
 * which the accepted presentation is exact at the final generation and the
 * viewer is Ready. Backend mask requests (`/local-mask`) during each stroke
 * are counted: a grade-only edit must issue none.
 *
 * Targets (PRD P7): (a) <= 1 s warm, <= 2 s cold; (b) <= 200 ms (P5's zoomed
 * target); (b) issues zero mask requests.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("../large-noisy-tiff.js");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const outputPath = path.resolve(option("--output", "output/performance/luma-feather-latency.json"));
const warmSamples = Math.max(1, Number(option("--samples", "6")));

function percentile(values, amount) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

async function idle(page) {
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 300000 });
  await page.waitForTimeout(400);
}

/** A real drag on a slider, measured from its trusted pointer-up to settled. */
async function strokeToSettled(page, selector, deltaX, maskRequests) {
  const control = page.locator(selector).first();
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  await page.evaluate(() => {
    window.__settle = { up: null, settledAt: null, trusted: null };
    window.addEventListener("pointerup", (event) => {
      window.__settle.up = event.timeStamp;
      window.__settle.trusted = event.isTrusted;
    }, { capture: true, once: true });
  });
  const requestsBefore = maskRequests.length;
  const eventsBefore = await page.evaluate(() => (state.gpuPreview.performanceMetrics.maskEvents || []).length);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(x + (deltaX * step) / 6, y);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(30);
  await page.mouse.up();
  const result = await page.evaluate(() => new Promise((resolve) => {
    const started = performance.now();
    const tick = (time) => {
      const accepted = state.acceptedPresentation;
      const settled = window.__settle.up !== null && time >= window.__settle.up
        && viewerState().status === "ready" && accepted?.exact
        && accepted.generation === state.previewGeneration[state.currentView];
      if (settled) {
        resolve({ ms: time - window.__settle.up, trusted: window.__settle.trusted,
          execution: accepted.execution ?? null });
        return;
      }
      if (performance.now() - started > 20000) { resolve({ ms: null, trusted: window.__settle.trusted, timedOut: true }); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await idle(page);
  // Every render that used the GPU luma mask logs one event; a rebuild of its
  // base (qualification) or its feather blur is marked on it.
  const events = await page.evaluate((from) => (state.gpuPreview.performanceMetrics.maskEvents || []).slice(from)
    .filter((event) => event.kind === "gpu-luma"), eventsBefore);
  return { ...result, maskUses: events.length, baseRebuilds: events.filter((event) => event.baseRegenerated).length,
    featherRebuilds: events.filter((event) => event.refinementRan).length, maskRequests: maskRequests.length - requestsBefore };
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const pageErrors = [];
  const maskRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => { if (/\/local-mask(-tile)?\//.test(request.url())) maskRequests.push(request.url()); });
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true, null, { timeout: 900000 });
    await idle(page);
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator("#local-add-adjustment").click();
    await page.locator('[data-local-tool="luminance_range"]').click();
    await created;
    // Mid-tones to highlights of the fixture, with Feather 50% and the mask
    // overlay off so the measured frames are the graded image.
    await page.evaluate(async () => {
      const leaf = firstMaskLeaf(selectedLocal().mask, "luminance_range");
      Object.assign(leaf, { fade_in_start_ev: -2.5, reference_start_ev: -2, full_start_ev: -2, full_end_ev: 1,
        reference_end_ev: 1, fade_out_end_ev: 1.75, mask_feather: 0.025 });
      // A visible grade, so the local (and its mask) is part of every render.
      selectedLocal().hdr_grade.exposure = 1;
      if (!(await commitSelectedLocal({ refreshPreview: true }))) throw new Error("The luma mask update was rejected.");
      if (document.querySelector("#local-show-mask")?.getAttribute("aria-pressed") === "true") document.querySelector("#local-show-mask").click();
    });
    await idle(page);
    await page.evaluate(() => setCustomZoom(200));
    await idle(page);

    const feather = [];
    const grade = [];
    for (let sample = 0; sample <= warmSamples; sample += 1) {
      const direction = sample % 2 === 0 ? 10 : -10;
      feather.push({ ...(await strokeToSettled(page, '[data-local-mask-param="mask_feather"]', direction, maskRequests)), cold: sample === 0 });
    }
    for (let sample = 0; sample <= warmSamples; sample += 1) {
      const direction = sample % 2 === 0 ? 10 : -10;
      grade.push({ ...(await strokeToSettled(page, '[data-local-grade="exposure"]', direction, maskRequests)), cold: sample === 0 });
    }
    const environment = await page.evaluate(() => ({
      viewport: { width: innerWidth, height: innerHeight },
      zoom: state.zoomPercent,
      feather: firstMaskLeaf(selectedLocal().mask, "luminance_range").mask_feather,
      execution: state.acceptedPresentation?.execution ?? null,
      maskKinds: [...state.gpuPreview.localMasks.values()].map((entry) => entry.kind),
    }));
    const summarize = (rows) => {
      const warm = rows.filter((row) => !row.cold).map((row) => row.ms);
      return { cold: rows.find((row) => row.cold)?.ms ?? null, warmMedian: percentile(warm, 0.5), warmP95: percentile(warm, 0.95),
        warmWorst: warm.length ? Math.max(...warm.filter(Number.isFinite)) : null,
        maskRequests: rows.reduce((sum, row) => sum + row.maskRequests, 0),
        maskUses: rows.reduce((sum, row) => sum + row.maskUses, 0),
        baseRebuilds: rows.reduce((sum, row) => sum + row.baseRebuilds, 0),
        featherRebuilds: rows.reduce((sum, row) => sum + row.featherRebuilds, 0), executions: [...new Set(rows.map((row) => row.execution))],
        untrusted: rows.filter((row) => row.trusted === false).length, timedOut: rows.filter((row) => row.timedOut).length };
    };
    const summary = { featherChange: summarize(feather), gradeChange: summarize(grade) };
    const check = (value, target, name) => {
      if (!Number.isFinite(value)) failures.push(`${name}: no measurement`);
      else if (value > target) failures.push(`${name}: ${value.toFixed(1)} ms > ${target} ms`);
    };
    check(summary.featherChange.cold, 2000, "feather change, cold");
    check(summary.featherChange.warmP95, 1000, "feather change, warm p95");
    check(summary.gradeChange.warmP95, 200, "grade change, warm p95");
    if (summary.gradeChange.maskRequests > 0) failures.push(`grade-only edits issued ${summary.gradeChange.maskRequests} backend mask requests`);
    if ([...feather, ...grade].some((row) => row.maskUses < 1)) failures.push("a stroke ran without the GPU luma mask");
    const gradeRebuilds = grade.reduce((sum, row) => sum + row.baseRebuilds + row.featherRebuilds, 0);
    if (gradeRebuilds > 0) failures.push(`grade-only edits rebuilt the luma mask ${gradeRebuilds} times`);
    if (summary.featherChange.untrusted + summary.gradeChange.untrusted > 0) failures.push("a release was not a trusted pointer-up");
    if (pageErrors.length) failures.push(`Page errors: ${pageErrors.join(" | ")}`);
    const report = { recordedAt: new Date().toISOString(), environment, summary, feather, grade, failures };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ environment, summary, failures }, null, 2));
    if (failures.length) throw new Error(`${failures.length} failure(s): ${failures.join("; ")}`);
    console.log("Luma feather latency test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
