/** Measurement-only scopes, zoom, pan, compare, and overlay workflow timings. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const option = (name, fallback = "") => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const projectPath = path.resolve(option("--project"));
const outputPath = path.resolve(option("--output", "output/performance/review/viewer-tasks.json"));
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";
const samples = Math.max(1, Number(option("--samples", "3")));
const edgeFallback = args.includes("--edge");
function percentile(v, f) { const s = v.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) * f)] ?? null; }
function summary(v) { return { samples: v.length, medianMs: percentile(v, .5), p95Ms: percentile(v, .95), maximumMs: Math.max(...v) }; }

async function stable(page) {
  await page.waitForFunction(() => {
    const lane = state.currentView; const generation = state.previewGeneration[lane];
    return viewerState().status === "ready" && state.acceptedPresentation?.lane === lane
      && state.acceptedPresentation?.generation === generation && state.acceptedPresentation?.exact === true
      && !document.querySelector("#scope-freshness")?.classList.contains("updating");
  }, null, { timeout: 120000 });
}

async function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch(edgeFallback ? { headless: false, channel: "msedge", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] } : { headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available, null, { timeout: 180000 });
    await page.evaluate(async (target) => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      if (desktop?.grantProjectPath) { await openProjectFromPath(await desktop.grantProjectPath(target, "project-open")); return; }
      const x = await projectIo.openPathProject(fetch, { path: target }); if (!x.response.ok) throw new Error(x.payload?.detail); await activateDesktopSession(x.payload.session, target);
    }, projectPath);
    await stable(page);
    await page.evaluate(() => {
      window.__viewerTaskProbe = { previews: [], scopes: [] };
      addEventListener("hdrfinisher:preview-presented", (e) => window.__viewerTaskProbe.previews.push({ at: performance.now(), ...structuredClone(e.detail || {}) }));
      addEventListener("hdrfinisher:scope-presented", (e) => window.__viewerTaskProbe.scopes.push({ at: performance.now(), ...structuredClone(e.detail || {}) }));
    });
    const rows = [];
    async function record(name, count, action, kind = "scope", prepare = null) {
      const observations = [];
      for (let i = 0; i < count; i += 1) {
        if (prepare) { await prepare(i); await stable(page); }
        const begin = await page.evaluate(() => ({ at: performance.now(), p: window.__viewerTaskProbe.previews.length, s: window.__viewerTaskProbe.scopes.length }));
        await action(i);
        if (kind === "scope") await page.waitForFunction((b) => window.__viewerTaskProbe.scopes.length > b.s && !document.querySelector("#scope-freshness")?.classList.contains("updating"), begin, { timeout: 120000 });
        else if (kind === "preview") { await page.waitForFunction((b) => window.__viewerTaskProbe.previews.length > b.p, begin, { timeout: 120000 }); await stable(page); }
        else await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const result = await page.evaluate((b) => ({
          totalMs: performance.now() - b.at,
          firstPreviewMs: window.__viewerTaskProbe.previews.slice(b.p)[0]?.at - b.at || null,
          finalScopeMs: window.__viewerTaskProbe.scopes.slice(b.s).at(-1)?.at - b.at || null,
          lane: state.currentView, zoomMode: state.zoomMode, zoomPercent: state.zoomPercent,
          accepted: structuredClone(state.acceptedPresentation), compareLayout: state.compareLayout,
          gpu: window.HDRFinisherPerformance.gpuSnapshot().renders.slice(-3),
        }), begin);
        observations.push(result);
      }
      const row = { name, summary: summary(observations.map((x) => x.totalMs)), observations };
      rows.push(row); fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 2, projectPath, host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron", rows }, null, 2)}\n`);
      process.stdout.write(`${name}: ${JSON.stringify(row.summary)}\n`);
    }
    await record("scope mode switch histogram/waveform", 10, (i) => page.locator("#scope-mode").selectOption(i % 2 ? "histogram" : "waveform"));
    await record("scope mode switch histogram/vectorscope", 10, (i) => page.locator("#scope-mode").selectOption(i % 2 ? "histogram" : "vectorscope"));
    await record("scope channel composite/luma", 10, (i) => page.locator("#scope-channel-mode").selectOption(i % 2 ? "composite" : "luma"));
    await record("scope detail detailed/reference", 10, (i) => page.locator("#scope-detail").selectOption(i % 2 ? "detailed" : "reference"));
    await record("scope exact peak on/off", Math.min(3, samples), () => page.locator("#scope-exact-peak").click());
    await page.locator("#scope-exact-peak").uncheck(); await stable(page);
    await record("zoom Fit to 100%", samples, () => page.locator("#zoom-actual").click(), "preview", () => page.locator("#zoom-fit").click());
    await record("zoom 100% to Fit", samples, () => page.locator("#zoom-fit").click(), "preview", () => page.locator("#zoom-actual").click());
    await page.locator("#zoom-actual").click(); await stable(page);
    await record("pan at 100% compositor feedback", samples, () => page.evaluate(() => { const v = document.querySelector("#dropzone"); v.scrollLeft += v.scrollLeft > 100 ? -180 : 180; v.scrollTop += v.scrollTop > 100 ? -120 : 120; v.dispatchEvent(new Event("scroll")); }), "paint");
    await page.locator("#zoom-fit").click(); await stable(page);
    await record("compare single/side-horizontal", samples * 2, (i) => page.evaluate((layout) => setCompareLayout(layout), i % 2 ? "single" : "side-horizontal"), "preview");
    await page.evaluate(() => { state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null; renderLocalAdjustments(); });
    if (await page.locator("#grade-mode-local").getAttribute("aria-expanded") !== "true") await page.locator("#grade-mode-local").click();
    await record("local mask overlay toggle compositor feedback (not authoritative mask readiness)", 10, () => page.locator("#local-show-mask").click(), "paint");
  } finally { await browser.close(); }
}
main().catch((e) => { process.stderr.write(`${e.stack || e}\n`); process.exitCode = 1; });
