/** Measurement-only RAW import stage baseline. Never saves a project. */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const rawPath = path.resolve(option("--raw"));
const outputPath = path.resolve(option("--output", "output/performance/review/raw-import.json"));
const sampleCount = Math.max(1, Number(option("--samples", "3")));
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";
const edgeFallback = args.includes("--edge");

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] : null;
}

async function main() {
  if (!fs.existsSync(rawPath)) throw new Error(`RAW does not exist: ${rawPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch(edgeFallback ? {
    headless: false,
    channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  } : { headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, { timeout: 180_000 });
    await page.evaluate(() => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      window.__rawImportProbe = { previews: [], scopes: [], jobs: [] };
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        window.__rawImportProbe.previews.push({ at: performance.now(), ...structuredClone(event.detail || {}) });
      });
      window.addEventListener("hdrfinisher:scope-presented", (event) => {
        window.__rawImportProbe.scopes.push({ at: performance.now(), ...structuredClone(event.detail || {}) });
      });
    });
    const rows = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const started = await page.evaluate(() => ({
        at: performance.now(),
        previews: window.__rawImportProbe.previews.length,
        scopes: window.__rawImportProbe.scopes.length,
      }));
      const backend = await page.evaluate(async (targetPath) => {
        let grant;
        if (typeof desktop !== "undefined" && desktop?.grantSourcePath) {
          grant = await desktop.grantSourcePath(targetPath);
        } else {
        const grantResponse = await fetch("/api/desktop/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath, intent: "source-open" }),
        });
        grant = await grantResponse.json();
        if (!grantResponse.ok) throw new Error(grant.detail || "RAW grant failed");
        }
        const { response, payload } = await projectIo.createImportJob(fetch, { grant: grant.grant });
        if (!response.ok || !payload?.job_id) throw new Error(payload?.detail || "RAW import failed to start");
        let job = payload;
        while (!['ready', 'error', 'cancelled'].includes(job.state)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const poll = await projectIo.pollImportJob(fetch, job.job_id);
          if (!poll.response.ok) throw new Error(poll.payload?.detail || "RAW import poll failed");
          job = poll.payload;
        }
        if (job.state !== "ready" || !job.session_id) throw new Error(job.error || `RAW import ended ${job.state}`);
        const session = await projectIo.fetchSession(fetch, job.session_id);
        if (!session.response.ok || !session.payload?.session) throw new Error(session.payload?.detail || "Imported session unavailable");
        await activateDesktopSession(session.payload.session, "");
        return job;
      }, rawPath);
      await page.waitForFunction((begin) => {
        const lane = state.currentView;
        const generation = state.previewGeneration[lane];
        const preview = window.__rawImportProbe.previews.slice(begin.previews)
          .some((event) => event.lane === lane && event.generation === generation);
        const scope = window.__rawImportProbe.scopes.slice(begin.scopes).some((event) => event.lane === lane);
        return preview && scope && viewerState().status === "ready"
          && state.acceptedPresentation?.lane === lane
          && state.acceptedPresentation?.generation === generation
          && state.acceptedPresentation?.exact === true;
      }, started, { timeout: 600_000 });
      const row = await page.evaluate(({ begin, job }) => {
        const ended = performance.now();
        const previews = window.__rawImportProbe.previews.slice(begin.previews);
        const scopes = window.__rawImportProbe.scopes.slice(begin.scopes);
        return {
          taskAndScopesMs: ended - begin.at,
          backendReadyMs: job.elapsed_ms,
          phaseHistory: job.phase_history,
          firstPreviewMs: previews.length ? previews[0].at - begin.at : null,
          // The presentation event does not currently expose the accepted
          // tier; the wait above proves the last event belongs to the exact
          // accepted generation.
          exactPreviewMs: previews.length ? previews.at(-1).at - begin.at : null,
          settledScopeMs: scopes.length ? scopes.at(-1).at - begin.at : null,
          acceptedPresentation: structuredClone(state.acceptedPresentation),
          source: { width: state.session.source.width, height: state.session.source.height },
          gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        };
      }, { begin: started, job: backend });
      row.index = index + 1;
      rows.push(row);
      fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, rawPath, rows }, null, 2)}\n`);
      process.stdout.write(`RAW import ${index + 1}: backend ${row.backendReadyMs} ms; exact+scopes ${row.taskAndScopesMs.toFixed(1)} ms\n`);
    }
    const values = rows.map((row) => row.taskAndScopesMs);
    const report = {
      schemaVersion: 1,
      purpose: "RAW import stage baseline",
      createdAt: new Date().toISOString(),
      rawPath,
      host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron",
      sampleClass: process.env.HDR_FINISHER_ELECTRON_MAIN_PID
        ? "Fresh Electron/backend process: first row process-cold, later rows warm/recovery. OS filesystem cache not flushed."
        : "First row cold within the live backend; later rows warm/recovery. Not certified process-cold.",
      rows,
      summary: { samples: rows.length, medianMs: percentile(values, 0.5), maximumMs: Math.max(...values) },
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
