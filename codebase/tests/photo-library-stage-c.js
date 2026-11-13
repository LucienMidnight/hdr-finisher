/* Disposable sources only. Stage C sort/filter/HDR and loading regression. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const { photosPath } = require("./helpers/photos-root.cjs");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-stage-c");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const fixture = path.join(output, "native-pattern.png");
require("node:child_process").execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(), ["-c", "from PIL import Image; import numpy as np,sys; y,x=np.indices((1800,3000)); a=np.stack([(x%256),(y%256),(((x+y)%2)*255)],axis=2).astype(np.uint8); Image.fromarray(a).save(sys.argv[1])", fixture]);
for (let i = 0; i < 12; i++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(i).padStart(2, "0")}.png`));
fs.mkdirSync(path.join(folder, "z-subfolder"));
(async () => {
 const browser = await chromium.launch({ headless: true, channel: "msedge" });
 try {
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
  page.on("response", async response => {
   if (response.url().endsWith("/api/library/live-plan")) {
    const plan = await response.json().catch(() => null);
    if (plan?.detail_memory && !plan.detail_memory.available) {
     const memory = await page.request.get(new URL("/api/library/memory", response.url()).href).then(r=>r.json());
     console.log("Detail refusal accounting:", JSON.stringify({plan:plan.detail_memory,memory}));
    }
   }
  });
  await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
  const library = page.frame({ url: /\/library(?:\?|$)/ });
  await library.waitForFunction(() => window.HDRLibrary);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/library/folder-stream", async route => { await gate; await route.continue(); });
  const browsing = library.evaluate(folder => HDRLibrary.browse(folder), folder);
  await library.waitForFunction(() => HDRLibrary.getSnapshot().reading);
  assert.equal(await library.locator("#empty-message").textContent(), "Reading folder…");
  release(); await browsing; await page.unroute("**/api/library/folder-stream");
  // Switching rendition while pictures are still arriving must settle without blank cells.
  await library.locator("#hdr-button").click(); await library.locator("#hdr-button").click();
  await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas[data-picture-key]").length === 12);
  await library.locator("#sort-button").click(); await library.locator('#sort-menu [data-sort="name"]').click();
  await library.locator("#sort-dir").click();
  assert.ok((await library.evaluate(() => HDRLibrary.getSnapshot().paths[0])).endsWith("photo-11.png"));
  await library.locator("#sort-dir").click();
  await library.locator("#grid-space .library-cell").filter({ hasText: "photo-00.png" }).click();
  await page.keyboard.press("4");
  await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 4);
  await page.keyboard.press("p"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.pick === "pick");
  await page.keyboard.press("9"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.label === "blue");
  await page.keyboard.press("t"); await library.locator("#library-tag-input").fill("Family"); await page.keyboard.press("Enter");
  await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.tags.includes("Family"));
  await library.locator("#filter-button").click();
  await library.getByRole("button",{name:"3 stars",exact:true}).click();
  await library.locator("#filter-pick button[data-value=pick]").click();
  await library.locator("#filter-label button[data-value=blue]").click();
  await library.locator("#filter-search").fill("family");
  assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().count), 1);
  await library.locator("#filter-search").fill("no matching tag");
  assert.equal(await library.locator("#empty-message").textContent(), "No photos match these filters.");
  await library.locator("#filter-clear").click();
  // The RAW-only toggle was replaced by the RAW-first default and Show all files (November 3).
  assert.equal(await library.locator("#raw-only").count(), 0, "No separate RAW toggle");
  await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas[data-picture-key]").length === 12);
  let nativeRequests = 0;
  page.on("request", request => { if (request.url().endsWith("/api/library/native")) nativeRequests++; });
  assert.equal(nativeRequests, 0);
  let pictureRequests = 0;
  const count = request => { if (request.url().endsWith("/api/library/picture")) pictureRequests++; };
  page.on("request", count);
  await library.locator("#hdr-button").click();
  // Unedited SDR originals are drawn directly and have no HDR version (November 3):
  // HDR turns on, the pictures stay SDR and nothing is decoded again.
  await library.waitForFunction(() => HDRLibrary.getSnapshot().hdr && [...document.querySelectorAll("#grid-space canvas[data-picture-key]")].every(canvas => canvas.dataset.rendition === "sdr"));
  assert.equal(pictureRequests, 0, "HDR toggle reuses scene pictures without requesting a decode");
  await library.locator("#grid-space .library-cell").first().click(); await library.locator("#single-view").click();
  await library.waitForFunction(() => { const picture = document.getElementById("single-picture"); return picture.dataset.picturePath === HDRLibrary.getSnapshot().selected && picture.dataset.rendition === "sdr"; });
  await page.keyboard.press("h");
  await library.waitForFunction(() => !HDRLibrary.getSnapshot().hdr);
  assert.equal(nativeRequests, 0, "Fit browsing never requests native pixels");
  await page.keyboard.press("z");
  await library.waitForFunction(() => HDRLibrary.getSnapshot().native && !HDRLibrary.getSnapshot().nativeLoading);
  assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().native.width), 3000);
  const stage = await library.locator("#single-stage").boundingBox();
  const centerBefore = await library.evaluate(() => HDRLibrary.getSnapshot().zoomCenter);
  // Each draw stamps data-rendition. A draw into the shown 100% canvas would show the
  // new crop at the old crop's place for a frame: the flicker after a pan.
  await library.evaluate(() => {
    window.nativeDrawsOnScreen = [];
    window.nativeDrawWatch = new MutationObserver(records => { for (const record of records) if (!record.target.hidden) window.nativeDrawsOnScreen.push(record.target.id); });
    for (const canvas of document.querySelectorAll(".native-picture")) window.nativeDrawWatch.observe(canvas, { attributes: true, attributeFilter: ["data-rendition"] });
  });
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2); await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 100, stage.y + stage.height / 2 + 80, { steps: 6 }); await page.mouse.up();
  await library.waitForFunction(before => HDRLibrary.getSnapshot().native && !HDRLibrary.getSnapshot().nativeLoading && HDRLibrary.getSnapshot().zoomCenter[0] < before[0], centerBefore);
  assert.deepEqual(await library.evaluate(() => { window.nativeDrawWatch.disconnect(); return window.nativeDrawsOnScreen; }), [], "A new 100% crop is never drawn into the canvas on screen");
  const movedCenter = await library.evaluate(() => HDRLibrary.getSnapshot().zoomCenter);
  const previous = await library.evaluate(() => HDRLibrary.getSnapshot().selected);
  await page.keyboard.press("ArrowRight");
  await library.waitForFunction(previous => document.getElementById("native-picture").dataset.picturePath !== previous && HDRLibrary.getSnapshot().native, previous);
  assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().zoom), true);
  assert.deepEqual(await library.evaluate(() => HDRLibrary.getSnapshot().zoomCenter), movedCenter);
  await page.keyboard.press("z");
  assert.equal(await library.locator("#native-picture").isVisible(), false);
  await library.locator("#single-stage").click({ position: { x: stage.width * .65, y: stage.height * .5 } });
  await library.waitForFunction(() => HDRLibrary.getSnapshot().native && !HDRLibrary.getSnapshot().nativeLoading && HDRLibrary.getSnapshot().zoom);
  await page.screenshot({ path: path.join(output, "native-zoom.png") });
  await page.keyboard.press("f"); await page.keyboard.press("h");
  await library.waitForFunction(() => HDRLibrary.getSnapshot().hdr);
  // Fullscreen entry resets to Fit (Library PRD 5c, November 4), so Z after
  // Escape is needed only if the view is still zoomed.
  await page.keyboard.press("Escape");
  if (await library.evaluate(() => HDRLibrary.getSnapshot().zoom)) await page.keyboard.press("z");
  assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().zoom), false);
  await library.locator("#grid-view").click();
  await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas[data-picture-key]").length === 12);
  await page.screenshot({ path: path.join(output, "find-and-hdr.png") });
  await library.locator("#add-folder").click();
  await library.waitForFunction(() => document.querySelector("#picker-list .directory-browser-entry"));
  assert.ok(await library.locator("#picker-list .directory-browser-entry").first().evaluate(element => element.classList.contains("directory")), "Subfolders appear before files");
  await library.locator("#picker-cancel").click();
  const samples = [require('./helpers/photos-root.cjs').photosPath("D:/Photos/HDR Test Images/DSC00264.ARW"), require('./helpers/photos-root.cjs').photosPath("D:/Photos/HDR Test Images/DJI Samples/DSC00264_DxO-optical-corr-only.dng"), require('./helpers/photos-root.cjs').photosPath("D:/Photos/HDR Test Images/Test Suite Images/iphone_16_pro_IMG_3324.HEIC")].map(file => photosPath(file));
  if (samples.every(source => fs.existsSync(source))) {
   const copied = path.join(root,"output","test-photos","stage-c");
   const reusable = copied;
   fs.mkdirSync(reusable,{recursive:true});
   samples.forEach(source => {
    const photo = path.join(reusable,path.basename(source));
    if(!fs.existsSync(photo))fs.copyFileSync(source,photo);
   });
   // Library stage events, printed only if a native format never arrives.
   await library.evaluate(() => { const inherited = window.HDRLibraryStopwatch; window.stageCLog = []; window.HDRLibraryStopwatch = (stage, fields = {}) => { window.stageCLog.push([stage, (fields.path || "").split(/[\/]/).pop(), fields.route || fields.reason || fields.picture_source || ""].join(" ")); return inherited(stage, fields); }; });
   await library.evaluate(folder => HDRLibrary.browse(folder), copied);
   await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas[data-picture-key]").length === 3);
   await library.locator("#grid-space .library-cell").first().click(); await library.locator("#single-view").click();
   await library.waitForFunction(() => document.getElementById("single-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected);
   if (!await library.evaluate(() => HDRLibrary.getSnapshot().zoom)) await page.keyboard.press("z");
   for (let i = 0; i < 3; i++) {
    await library.waitForFunction(() => HDRLibrary.getSnapshot().native && !HDRLibrary.getSnapshot().nativeLoading && document.getElementById("native-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected, null, { timeout: 90000 })
     .catch(async error => { throw new Error(error.message + " " + JSON.stringify(await library.evaluate(() => { const s = HDRLibrary.getSnapshot(); return { selected: s.selected, zoom: s.zoom, native: !!s.native, nativeLoading: s.nativeLoading, status: document.querySelector("#library-status")?.textContent, shown: document.getElementById("native-picture").dataset.picturePath, stages: window.stageCLog.filter(line => !/^picture_(window|trace)/.test(line)).slice(-40) }; }))); });
    const snap = await library.evaluate(() => HDRLibrary.getSnapshot());
    assert.ok(snap.native.width > 2560 || snap.native.height > 2560, "Native source retains original dimensions");
    console.log("Native format passed:", path.extname(snap.selected), snap.native.width, snap.native.height);
    if (i < 2) await page.keyboard.press("ArrowRight");
   }
  }
  for (let i = 0; i < 12; i++) assert.deepEqual(fs.readFileSync(path.join(folder, `photo-${String(i).padStart(2, "0")}.png`)), fs.readFileSync(fixture));
  assert.deepEqual(errors, []);
  console.log("Stage C sort/filter/HDR/native zoom and pan passed; reading-folder message and folder-first picker passed; originals unchanged.");
 } catch (error) { console.error("Stage C failed:", error); throw error; } finally { await browser.close(); fs.rmSync(folder,{recursive:true,force:true}); fs.rmSync(fixture,{force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
