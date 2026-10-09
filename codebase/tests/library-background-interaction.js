const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

(async () => {
  const codebase = path.resolve(__dirname, "..");
  const output = path.join(codebase, "output", "library-background");
  fs.mkdirSync(output, { recursive: true });
  const option = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const corpus = option("--corpus");
  let photos;
  if (corpus) {
    const rows = JSON.parse(fs.readFileSync(corpus, "utf8")).rows;
    const groups = new Map();
    for (const row of rows) {
      if (!row.embedded_preview?.size || row.error || row.excluded) continue;
      const suffix = path.extname(row.path).toLowerCase();
      const group = groups.get(suffix) || [];
      if (group.length < 2) group.push(row.path);
      groups.set(suffix, group);
    }
    photos = [...groups.values()].flat();
    assert.ok(photos.length >= 5, "The corpus must contain several previewable camera formats");
  } else {
    const folder = fs.mkdtempSync(path.join(output, "photos-"));
    const python = path.join(codebase, ".venv", "Scripts", "python.exe");
    execFileSync(python, ["-c", "from PIL import Image; import numpy as np,sys; Image.fromarray(np.random.default_rng(42).integers(0,256,(1000,1500,3),dtype=np.uint8)).save(sys.argv[1])", path.join(folder, "photo-0.png")]);
    photos = Array.from({ length: 12 }, (_, i) => path.join(folder, `photo-${i}.png`));
    for (const photo of photos.slice(1)) fs.copyFileSync(photos[0], photo);
  }
  const gradeSource = option("--grade-source") || path.join(codebase, "tests", "fixtures", "sdr_gradient.png");
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    await page.evaluate(async (source) => {
      const selection = await desktop.grantSourcePath(source);
      await openDesktopSelection({ kind: "source", ...selection });
    }, gradeSource);
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready", null, { timeout: 60000 });
    await page.evaluate(() => {
      window.thumbnailRetries = 0;
      window.loadTestThumbnail = async (path, size) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const response = await fetch(`/api/media-browser/thumbnail?path=${encodeURIComponent(path)}&size=${size}`);
          if (response.status === 202) {
            window.thumbnailRetries += 1;
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }
          if (!response.ok) throw new Error(`Thumbnail HTTP ${response.status}`);
          return (await response.blob()).size;
        }
        throw new Error("Thumbnail retry timeout");
      };
    });
    const before = await page.evaluate(() => state.acceptedPresentation.generation);
    console.log("[library] grade ready; queueing paused thumbnails");
    const helper = await page.evaluate(async (paths) => {
      const pause = await fetch("/api/library-worker/pause", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual", paused: true }) });
      if (!pause.ok) throw new Error("Could not pause helper");
      window.thumbnailResults = Promise.all(paths.map(path => window.loadTestThumbnail(path, 128)));
      return (await fetch("/api/library-worker/status")).json();
    }, photos);
    console.log("[library] helper", helper);
    assert.equal(helper.decode_workers, 1);
    assert.ok(helper.running && helper.paused);
    await page.waitForFunction(() => window.thumbnailRetries > 0);
    console.log("[library] thumbnails queued; adjusting grade");
    await page.evaluate(() => {
      const control = document.querySelector("#hdr-exposure");
      control.value = "0.5";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction((before) => state.acceptedPresentation?.generation > before
      && state.acceptedPresentation.exact && viewerState().status === "ready", before, { timeout: 60000 });
    await page.evaluate(async () => {
      await fetch("/api/library-worker/pause", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual", paused: false }) });
    });
    const sizes = await page.evaluate(() => window.thumbnailResults);
    assert.ok(sizes.every(size => size > 0));
    // Now let uncached thumbnail work run alongside further grading.
    await page.evaluate((paths) => {
      window.thumbnailResults = Promise.all(paths.map(path => window.loadTestThumbnail(path, 256)));
      document.querySelector("#hdr-exposure").value = "0.75";
      document.querySelector("#hdr-exposure").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#hdr-exposure").dispatchEvent(new Event("change", { bubbles: true }));
    }, photos);
    assert.ok((await page.evaluate(() => window.thumbnailResults)).every(size => size > 0));
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready", null, { timeout: 60000 });
    console.log(JSON.stringify({ helperPid: helper.pid, priority: helper.priority, thumbnails: sizes.length,
      gradingWhilePaused: true, concurrentThumbnails: true, gradeSource, photoFormats: [...new Set(photos.map(photo => path.extname(photo).toLowerCase()))] }));
    await page.evaluate(() => { state.documentDirty = false; syncDesktopDocumentState(); });
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
