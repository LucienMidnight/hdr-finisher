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
const contention = args.includes("--contention");
const sampleCount = Math.max(1, Number(option("--samples", contention ? "2" : "3")));
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";
const edgeFallback = args.includes("--edge");
const rawImportSettings = option("--raw-settings") ? JSON.parse(option("--raw-settings")) : undefined;
const hostLoad = () => ({loadAverage:require("node:os").loadavg(),cpus:require("node:os").cpus().length});

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
  let presentationAcks=0;
  if(args.includes('--fail-first-ack'))await page.route('**/api/import-jobs/presented?**',async route=>{
    presentationAcks++;
    if(presentationAcks===1)await route.fulfill({status:503,body:'Temporary acknowledgement failure'});
    else await route.continue();
  });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, { timeout: 180_000 });
    await page.evaluate(() => {
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      window.__rawImportProbe = { previews: [], scopes: [], jobs: [], libraryOpenings: [] };
      const library=document.querySelector('#library-frame')?.contentWindow;
      let opening=false;
      library?.addEventListener('library-work-changed',()=>{
        const active=!!library.HDRLibraryGrants?.snapshot().opening;
        if(active!==opening){opening=active;window.__rawImportProbe.libraryOpenings.push({at:performance.now(),active});}
      });
      window.addEventListener("hdrfinisher:preview-presented", (event) => {
        window.__rawImportProbe.previews.push({ at: performance.now(), ...structuredClone(event.detail || {}) });
      });
      window.addEventListener("hdrfinisher:scope-presented", (event) => {
        window.__rawImportProbe.scopes.push({ at: performance.now(), ...structuredClone(event.detail || {}) });
      });
    });
    if(contention)await page.evaluate(async()=>{
      const r=await fetch('/api/library/memory-setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:null})});
      if(!r.ok)throw Error('Could not reset the test memory setting to its default');
    });
    const rows = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const duringPaste = contention && index % 2 === 1;
      if (duringPaste) {
        const pasteRaw=path.resolve(option("--paste-raw"));
        if(!fs.existsSync(pasteRaw)||pasteRaw===rawPath)throw Error("--paste-raw requires a different curated RAW");
        await page.evaluate(async target=>{
          const post=(route,body)=>fetch('/api/library/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          const response=await post('grade-preparation',{});if(!response.ok)throw Error('Paste preparation token refused');
          const {token}=await response.json();
          window.__contentionPaste={token,started:performance.now(),finished:false};
          window.__contentionPaste.promise=post('grade-prepare',{path:target,token}).then(async r=>({http:r.status,body:await r.json()}))
            .then(result=>Object.assign(window.__contentionPaste,{result,finished:true}));
          await new Promise(r=>setTimeout(r,150));
          if(window.__contentionPaste.finished)throw Error('Paste finished before Grade started; contention pair not qualified: '+JSON.stringify(window.__contentionPaste.result));
        },pasteRaw);
      }
      const started = await page.evaluate(() => ({
        at: performance.now(),
        previews: window.__rawImportProbe.previews.length,
        scopes: window.__rawImportProbe.scopes.length,
        libraryOpenings: window.__rawImportProbe.libraryOpenings.length,
      }));
      const loadBefore = hostLoad();
      const backend = await page.evaluate(async ({targetPath,rawImportSettings}) => {
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
        const { response, payload } = await projectIo.createImportJob(fetch, { grant: grant.grant, rawImportSettings, openingOwner:await gradeOpening.connect() });
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
        await activateDesktopSession(session.payload.session, "", null, {openingJobId:job.job_id});
        return job;
      }, {targetPath:rawPath,rawImportSettings});
      await page.waitForFunction((begin) => {
        const lane = state.currentView;
        const generation = state.previewGeneration[lane];
        const preview = window.__rawImportProbe.previews.slice(begin.previews)
          .some((event) => event.sessionId === state.session?.session_id && event.lane === lane && event.generation === generation);
        const scope = window.__rawImportProbe.scopes.slice(begin.scopes).some((event) => event.lane === lane);
        return preview && scope && viewerState().status === "ready"
          && state.acceptedPresentation?.lane === lane
          && state.acceptedPresentation?.generation === generation
          && state.acceptedPresentation?.exact === true;
      }, started, { timeout: 600_000 });
      if(contention&&!args.includes('--before'))await page.waitForFunction(begin=>window.__rawImportProbe.libraryOpenings.slice(begin.libraryOpenings).some(event=>!event.active),started,{timeout:15000});
      const row = await page.evaluate(({ begin, job }) => {
        const ended = performance.now();
        const previews = window.__rawImportProbe.previews.slice(begin.previews).filter(event=>event.sessionId===job.session_id);
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
          libraryOpenings: window.__rawImportProbe.libraryOpenings.slice(begin.libraryOpenings).map(e=>({...e,ms:e.at-begin.at})),
          source: { width: state.session.source.width, height: state.session.source.height },
          gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        };
      }, { begin: started, job: backend });
      if(contention&&!args.includes('--before')) {
        if(!row.libraryOpenings.some(e=>e.active)||!row.libraryOpenings.some(e=>!e.active&&e.ms>=row.firstPreviewMs))
          throw Error('Library pause did not span Grade first presentation: '+JSON.stringify(row.libraryOpenings));
      }
      const sum = phases => row.phaseHistory.filter(p=>phases.includes(p.phase)).reduce((n,p)=>n+(p.duration_ms||0),0);
      row.stages = {decodeMs:sum(["developing_raw"]),coordinatesMs:sum(["lens_coordinates"]),
        vignetteMs:sum(["lens_vignette"]),remapMs:sum(["lens_remap"]),profileMs:sum(["lens_correction","lens_profile","lens_setup"]),
        backendOtherMs:row.backendReadyMs-sum(["developing_raw","lens_coordinates","lens_vignette","lens_remap","lens_correction","lens_profile","lens_setup"]),
        firstPresentationAfterBackendMs:row.firstPreviewMs-row.backendReadyMs,
        exactAndScopesAfterBackendMs:row.taskAndScopesMs-row.backendReadyMs};
      row.load = {before:loadBefore,after:hostLoad()};
      row.duringPaste=duringPaste;
      if(duringPaste)row.paste=await page.evaluate(async()=>{
        const probe=window.__contentionPaste;
        const post=(route)=>fetch('/api/library/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:probe.token})});
        await post('grade-preparation-cancel');await probe.promise;await post('grade-preparation-end');
        return {result:probe.result,started:probe.started,finished:probe.finished};
      });
      row.index = index + 1;
      rows.push(row);
      fs.writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, rawPath, rows }, null, 2)}\n`);
      process.stdout.write(`RAW import ${index + 1}: backend ${row.backendReadyMs} ms; exact+scopes ${row.taskAndScopesMs.toFixed(1)} ms\n`);
    }
    const values = rows.map((row) => row.taskAndScopesMs);
    const idle=rows.find(r=>!r.duringPaste),busy=rows.find(r=>r.duringPaste);
    const releaseWaitMs=busy?.phaseHistory.filter(p=>p.phase==='waiting_for_paste'||p.phase==='waiting_for_library').reduce((n,p)=>n+(p.duration_ms||0),0)||0;
    const comparison=contention&&idle&&busy?{idleMs:idle.firstPreviewMs,duringPasteMs:busy.firstPreviewMs,
      releaseWaitMs,addedMs:busy.firstPreviewMs-idle.firstPreviewMs,
      toleranceMs:Math.max(250,idle.firstPreviewMs*.1)}:null;
    if(comparison)comparison.pass=comparison.addedMs<=comparison.toleranceMs;
    const report = {
      schemaVersion: 1,
      purpose: "RAW import stage baseline",
      createdAt: new Date().toISOString(),
      rawPath,
      rawImportSettings,
      machine: {platform:process.platform,arch:process.arch,window:process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE},
      host: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron",
      sampleClass: process.env.HDR_FINISHER_ELECTRON_MAIN_PID
        ? "Fresh Electron/backend process: first row process-cold, later rows warm/recovery. OS filesystem cache not flushed."
        : "First row cold within the live backend; later rows warm/recovery. Not certified process-cold.",
      rows,
      comparison,
      presentationAcks,
      summary: { samples: rows.length, medianMs: percentile(values, 0.5), maximumMs: Math.max(...values) },
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    if(args.includes('--fail-first-ack')&&presentationAcks<sampleCount+1)throw Error('Presentation acknowledgement did not retry');
    if(comparison&&!comparison.pass)throw Error('Grade contention exceeds tolerance: '+JSON.stringify(comparison));
  } finally {
    await browser.close();
  }
}

module.exports = {main};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
