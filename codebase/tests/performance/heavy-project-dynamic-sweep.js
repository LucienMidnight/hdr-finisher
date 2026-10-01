/** Measurement-only dynamic controls, local masks, scopes, and viewer tasks. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback = "") => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const projectPath = path.resolve(option("--project"));
const outputPath = path.resolve(option("--output", "output/performance/review/dynamic-sweep.json"));
const samples = Math.max(1, Number(option("--samples", "10")));
const batch = option("--batch", "dynamic");
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";
const edgeFallback = args.includes("--edge");

const cases = {
  dynamic: [
    ["Curves", "luma point commit (not pointer drag)", "curve-luma", ["hdr", "sdr"]],
    ["Curves", "RGB point commit (not pointer drag)", "curve-red", ["hdr", "sdr"]],
    ["Exposure Bands", "node amount", "band-amount", ["hdr", "sdr"]],
    ["Exposure Bands", "node position", "band-position", ["hdr", "sdr"]],
    ["Exposure Bands", "add/remove node", "band-structure", ["hdr", "sdr"]],
  ],
  locals: [
    ["Local Adjustments", "brush grade-only", "local-brush-grade", ["hdr", "sdr"]],
    ["Local Adjustments", "brush mask feather", "local-brush-mask", ["hdr"]],
    ["Local Adjustments", "gradient mask edit with fixture geometry", "local-gradient-mask", ["hdr"]],
    ["Local Adjustments", "luminance mask edit with fixture geometry", "local-luma-mask", ["hdr"]],
  ],
  "local-grades": [
    ["Local Adjustments", "WB matrix commit", "local-brush-wb", ["hdr", "sdr"]],
    ["Local Adjustments", "chroma scalar commit", "local-brush-saturation", ["hdr", "sdr"]],
    ["Local Adjustments", "qualified tone commit", "local-brush-pivot", ["hdr", "sdr"]],
    ["Local Adjustments", "luma LUT commit", "local-brush-luma", ["hdr", "sdr"]],
    ["Local Adjustments", "RGB LUT commit", "local-brush-red", ["hdr", "sdr"]],
    ["Local Adjustments", "multiscale detail commit", "local-brush-detail", ["hdr", "sdr"]],
    ["Local Adjustments", "opacity composite commit", "local-brush-opacity", ["hdr", "sdr"]],
  ],
  denoise: [
    ["Denoise", "live reconstruction control", "denoise-live", ["hdr", "sdr"]],
    ["Denoise", "analysis recalculate", "denoise-recalculate", ["hdr", "sdr"]],
  ],
};

function percentile(values, f) { const s = values.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) * f)] ?? null; }
function summarize(rows) { const v = rows.map((x) => x.totalMs); return { samples: v.length, medianMs: percentile(v, .5), p95Ms: percentile(v, .95), maximumMs: Math.max(...v) }; }

async function waitStable(page, timeout = 120000) {
  await page.waitForFunction(() => {
    const lane = state.currentView; const generation = state.previewGeneration[lane];
    return viewerState().status === "ready" && !state.gpuDraftInFlight
      && state.acceptedPresentation?.lane === lane && state.acceptedPresentation?.generation === generation
      && state.acceptedPresentation?.exact === true
      && !document.querySelector("#scope-freshness")?.classList.contains("updating");
  }, null, { timeout });
}

async function mutate(page, action, direction) {
  return page.evaluate(async ({ actionName, delta }) => {
    const lane = state.currentView;
    if (actionName.startsWith("curve-")) {
      const key = actionName === "curve-luma" ? "luma_curve" : "red_curve";
      const value = structuredClone(state.adjustments[lane][key]);
      value[2][1] = Math.max(0.01, Math.min(0.99, value[2][1] + delta * .002));
      commitAdjustmentValue(`${lane}.${key}`, value, { manual: true });
    } else if (actionName.startsWith("band-")) {
      const key = `${lane}.tone_equalizer_nodes`; const value = structuredClone(state.adjustments[lane].tone_equalizer_nodes);
      if (actionName === "band-amount") value[Math.floor(value.length / 2)].adjustment_ev += delta * .01;
      if (actionName === "band-position") value[Math.floor(value.length / 2)].input_ev += delta * .01;
      if (actionName === "band-structure") {
        if (delta > 0) value.splice(value.length - 1, 0, { input_ev: -1.5, adjustment_ev: .01 });
        else value.splice(-2, 1);
      }
      commitAdjustmentValue(key, value, { manual: true });
    } else if (actionName.startsWith("local-")) {
      const wanted = actionName.includes("brush") ? "brush" : actionName.includes("gradient") ? "linear_gradient" : actionName.includes("luma") ? "luminance_range" : "brush";
      const local = state.editDocument.local_adjustments.find((item) => item.mask?.leaf?.type === wanted);
      if (!local) throw new Error(`No ${wanted} local in fixture`);
      state.selectedLocalId = local.id;
      if (!actionName.endsWith("mask")) {
        const grade = local[`${lane}_grade`];
        const field = actionName.split("-").at(-1);
        if (field === "grade") grade.exposure += delta * .01;
        else if (field === "wb") grade.white_balance_kelvin += delta * 10;
        else if (field === "saturation") grade.saturation += delta * .01;
        else if (field === "pivot") grade.contrast_pivot += delta * .002;
        else if (field === "luma" || field === "red") grade[`${field}_curve`][2][1] += delta * .002;
        else if (field === "detail") grade.detail.clarity_amount += delta * .01;
        else if (field === "opacity") local.opacity = Math.max(0, Math.min(1, local.opacity - delta * .005));
        scheduleLocalPreview();
      } else {
        const leaf = local.mask.leaf;
        if (wanted === "linear_gradient") leaf.gradient_fan += delta * .005;
        else if (wanted === "luminance_range") leaf.full_end_ev += delta * .01;
        else leaf.mask_feather = Math.max(0, leaf.mask_feather + delta * .0005);
        scheduleSpatialMaskPreview(local);
      }
      await commitSelectedLocal({ refreshPreview: false });
    } else if (actionName === "denoise-live") {
      if (!state.denoise[lane].enabled) await setDenoiseEnabled(true);
      await updateLiveDenoiseControl("amount", Math.max(0, Math.min(1, state.denoise[lane].controls.amount + delta * .01)));
      await persistDenoiseSettings();
    } else if (actionName === "denoise-recalculate") {
      if (!state.denoise[lane].enabled) await setDenoiseEnabled(true);
      state.denoiseRuntime[lane].dirty = true;
      await recalculateDenoise(lane);
    }
  }, { actionName: action, delta: direction });
}

async function main() {
  if (!fs.existsSync(projectPath)) throw new Error(`Project missing: ${projectPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch(edgeFallback ? { headless: false, channel: "msedge", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"] } : { headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const network = [];
  const requests = new Map();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    const entry = { path: url.pathname, query: url.search, method: request.method(), startedAt: Date.now() };
    requests.set(request, entry); network.push(entry);
  });
  page.on("response", async (response) => {
    const entry = requests.get(response.request()); if (!entry) return;
    entry.status = response.status();
    const headers = await response.allHeaders();
    entry.cpuMaskMs = Number(headers["x-cpu-mask-ms"]) || null;
  });
  page.on("requestfinished", (request) => { const entry = requests.get(request); if (entry) entry.durationMs = Date.now() - entry.startedAt; });
  page.on("requestfailed", (request) => { const entry = requests.get(request); if (entry) { entry.durationMs = Date.now() - entry.startedAt; entry.failure = request.failure()?.errorText || "request failed"; } });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available, null, { timeout: 180000 });
    await page.evaluate(() => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      window.__dynamicProbe = { previews: [], scopes: [] };
      // The app currently emits preview-presented only for WebGPU. Observe
      // CPU acceptance followed by a frame in this test process without
      // modifying the renderer or fallback policy.
      const originalAcceptPresentation = acceptPresentation;
      acceptPresentation = function (...values) {
        const result = originalAcceptPresentation(...values);
        if (values[4] !== "WebGPU") {
          const accepted = structuredClone(state.acceptedPresentation);
          requestAnimationFrame(() => {
            if (state.acceptedPresentation?.generation === accepted.generation && state.currentView === accepted.lane) {
              window.__dynamicProbe.previews.push({ at: performance.now(), lane: accepted.lane, generation: accepted.generation, transport: accepted.transport, observation: "CPU acceptance plus animation-frame callback" });
            }
          });
        }
        return result;
      };
      addEventListener("hdrfinisher:preview-presented", (event) => window.__dynamicProbe.previews.push({ at: performance.now(), ...structuredClone(event.detail || {}) }));
      addEventListener("hdrfinisher:scope-presented", (event) => window.__dynamicProbe.scopes.push({ at: performance.now(), ...structuredClone(event.detail || {}) }));
    });
    await page.evaluate(async (target) => {
      if (desktop?.grantProjectPath) {
        await openProjectFromPath(await desktop.grantProjectPath(target, "project-open"));
        return;
      }
      const { response, payload } = await projectIo.openPathProject(fetch, { path: target });
      if (!response.ok) throw new Error(payload?.detail || "open failed");
      await activateDesktopSession(payload.session, target);
    }, projectPath);
    await waitStable(page);
    if (args.includes("--manual-anchors")) {
      for (const active of ["hdr", "sdr"]) {
        if (await page.evaluate(() => state.currentView) !== active) { await page.evaluate((x) => switchLane(x), active); await waitStable(page); }
        await page.evaluate(async (x) => { commitAdjustmentValue(`${x}.highlight_compression_peak_measurement`, "manual", { manual: true }); await settlePreview(x, {}); }, active);
        await waitStable(page);
      }
    }
    const rows = [];
    const selectedActions = option("--actions").split(",").filter(Boolean);
    for (const [module, family, action, lanes] of (cases[batch] || []).filter((row) => !selectedActions.length || selectedActions.includes(row[2]))) {
      for (const lane of lanes) {
        if (await page.evaluate(() => state.currentView) !== lane) { await page.evaluate((x) => switchLane(x), lane); await waitStable(page); }
        const localBaseline = batch === "local-grades" ? await page.evaluate(() => structuredClone(state.editDocument.local_adjustments)) : null;
        const observations = [];
        if (action.startsWith("denoise-")) {
          await page.evaluate(async () => { if (!state.denoise[state.currentView].enabled) await setDenoiseEnabled(true); });
          await waitStable(page);
        }
        const count = action === "denoise-recalculate" ? Math.min(3, samples) : samples;
        for (let i = 0; i < count; i += 1) {
          const before = await page.evaluate(() => ({ at: performance.now(), generation: state.previewGeneration[state.currentView], previewIndex: window.__dynamicProbe.previews.length, scopeIndex: window.__dynamicProbe.scopes.length }));
          const networkIndex = network.length;
          await mutate(page, action, i % 2 === 0 ? 1 : -1);
          try { await page.waitForFunction((start) => {
            const lane = state.currentView;
            return window.__dynamicProbe.previews.slice(start.previewIndex).some((event) => event.lane === lane && event.generation === state.previewGeneration[lane])
              && window.__dynamicProbe.scopes.slice(start.scopeIndex).some((event) => event.lane === lane);
          }, before, { timeout: 120000 }); } catch (error) {
            const failure = await page.evaluate(() => ({ lane: state.currentView, viewer: viewerState(), accepted: state.acceptedPresentation, generation: state.previewGeneration[state.currentView], runtime: state.denoiseRuntime, denoise: state.gpuPreview?.diagnosticsSnapshot?.().denoise, refusal: state.lastGpuDraftRefusal, gpu: window.HDRFinisherPerformance.gpuSnapshot(), events: window.__dynamicProbe }));
            fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 2, projectPath, batch, rows, failed: { module, family, lane, sample: i + 1, before, error: String(error), failure } }, null, 2)}\n`);
            throw error;
          }
          await waitStable(page);
          const after = await page.evaluate((start) => ({
            totalMs: performance.now() - start.at,
            firstPreviewMs: window.__dynamicProbe.previews.slice(start.previewIndex)[0]?.at - start.at,
            finalScopeMs: window.__dynamicProbe.scopes.slice(start.scopeIndex).at(-1)?.at - start.at,
            accepted: structuredClone(state.acceptedPresentation),
            gpu: { renders: window.HDRFinisherPerformance.gpuSnapshot().renders.slice(-3), allocator: window.HDRFinisherPerformance.gpuSnapshot().resources?.memory?.allocator || null },
            denoise: state.gpuPreview?.diagnosticsSnapshot?.().denoise || null,
          }), before);
          observations.push({ index: i + 1, ...after, network: network.slice(networkIndex) });
          await page.waitForTimeout(75);
        }
        const row = { module, family, action, lane, summary: summarize(observations), observations };
        rows.push(row);
        fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 2, projectPath, host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron", isolation: args.includes("--manual-anchors") ? "Manual highlight anchors" : "Fixture highlight anchors", batch, rows }, null, 2)}\n`);
        process.stdout.write(`${module} / ${family} / ${lane}: ${JSON.stringify(row.summary)}\n`);
        if (localBaseline) {
          await page.evaluate(async (saved) => {
            const local = saved.find((item) => item.id === state.selectedLocalId);
            const index = state.editDocument.local_adjustments.findIndex((item) => item.id === local.id);
            state.editDocument.local_adjustments[index] = local;
            await commitSelectedLocal();
          }, localBaseline);
          await waitStable(page);
        }
      }
    }
  } finally { await browser.close(); }
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
