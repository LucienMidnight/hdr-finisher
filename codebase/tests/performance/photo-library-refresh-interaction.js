/* External M6 scheduling trial. No app changes; equivalent-priority CPU
 * instrument, because the shipped F3 worker has no HDR-preview job yet.
 * Run sequentially through run-in-electron with 2560x1440 window size.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "output/library-measurements/remaining");
fs.mkdirSync(output, {recursive:true});
const opt = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i+1]; };
const count = Number(opt("--count") || 50);
const percentile = (values, q) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const median = values => {
  const ordered = [...values].sort((a,b)=>a-b);
  const middle = Math.floor(ordered.length/2);
  return ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
};
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  let worker;
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    await page.evaluate(async source => {
      const selection = await desktop.grantSourcePath(source);
      await openDesktopSelection({ kind: "source", ...selection });
    }, String.raw`D:\Photos\HDR Test Images\DSC00264.ARW`);
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready", null, { timeout: 120000 });
    const adapter = await page.evaluate(() => state.gpuPreview?.adapterInfo || null);
    assert.ok(adapter && !adapter.fallback, "Grade must use the real app GPU adapter");
    async function gestures() {
      const samples = [];
      await page.evaluate(() => {
        window.measureGaps = [];
        window.measureLast = performance.now();
        window.measureRAF = true;
        function tick(now) {
          if (!window.measureRAF) return;
          window.measureGaps.push(now-window.measureLast);
          window.measureLast = now;
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      for (let i = 0; i < 20; i++) {
        const before = await page.evaluate(() => state.acceptedPresentation.generation);
        const start = performance.now();
        await page.evaluate(value => {
          const control = document.querySelector("#hdr-exposure");
          control.value = String(value);
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
        }, 0.25 + (i % 5)*0.1);
        await page.waitForFunction(previous => state.acceptedPresentation?.generation > previous &&
          state.acceptedPresentation?.exact && viewerState().status === "ready", before, {timeout: 30000, polling: 16});
        samples.push(performance.now()-start);
      }
      const gaps = await page.evaluate(() => { window.measureRAF=false; return window.measureGaps; });
      return {samples_ms:samples, median_ms:median(samples), p95_ms:percentile(samples,0.95),
        raf_gap_p95_ms:percentile(gaps,0.95), raf_gap_max_ms:Math.max(...gaps), raf_samples:gaps.length};
    }
    const baseline = await gestures();
    const log = fs.openSync(path.join(output, "m6-"+count+".log"), "w");
    worker = spawn(path.join(root, ".venv/Scripts/python.exe"),
      [path.join(__dirname, "photo-library-remaining.py"), "bulk", "--count", String(count),
        "--cached", "--edited", "--result", "m6-"+count+".json"],
      {cwd:root, stdio:["ignore",log,log], windowsHide:true});
    const done = new Promise((resolve, reject) => {
      worker.once("error",reject);
      worker.once("exit", code => code===0 ? resolve() : reject(new Error("Probe exit "+code)));
    });
    const ready = path.join(output,"m6-"+count+".log");
    const deadline = Date.now()+600000;
    while (!fs.readFileSync(ready,"utf8").includes("cached sources ready:")) {
      assert.ok(Date.now()<deadline, "Cached input preparation timed out");
      assert.equal(worker.exitCode,null,"Probe exited before preparation finished");
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const concurrent = await gestures();
    assert.equal(worker.exitCode,null,"Grade sampling must overlap live preview work");
    const result = {count, adapter, baseline, concurrent, equivalent_helper:true,
      grade_source:"DSC00264.ARW", worker_pid:worker.pid};
    fs.writeFileSync(path.join(output,"m6-responsive-"+count+".json"),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    // A long paste also samples Grade later in the batch, not only at startup.
    result.later_checks = [];
    if (count >= 500) {
      while (worker.exitCode === null) {
        let timer;
        const finished = await Promise.race([done.then(() => true),
          new Promise(resolve => { timer = setTimeout(() => resolve(false), 300000); })]);
        clearTimeout(timer);
        if (finished) break;
        const sample = await gestures();
        result.later_checks.push({sampled_at: new Date().toISOString(), ...sample});
        fs.writeFileSync(path.join(output,"m6-responsive-"+count+".json"),JSON.stringify(result,null,2));
        console.log("Later Grade sample: " + JSON.stringify(sample));
      }
    }
    await done;
    fs.closeSync(log);
    await page.evaluate(() => { state.documentDirty=false; syncDesktopDocumentState(); });
  } finally {
    if (worker && worker.exitCode === null) worker.kill();
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});