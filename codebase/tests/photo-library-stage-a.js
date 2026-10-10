/* Focused Stage A check. All generated photos live in disposable test output. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "library-stage-a");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let index = 0; index < 3000; index++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(index).padStart(4,"0")}.png`));
fs.mkdirSync(path.join(folder, "nested"));
fs.copyFileSync(fixture, path.join(folder, "nested", "nested.png"));
fs.writeFileSync(path.join(folder, "broken.png"), "unreadable test file");
fs.writeFileSync(path.join(folder, "ignored.hdrf"), "sidecar stays untouched");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.log("[pageerror]", error.message); });
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof state !== "undefined" && state.activeWorkflow === "import");
    const library = page.frame({ url: /photo-library\.html/ }); assert.ok(library);
    await library.waitForFunction(() => Boolean(window.HDRLibrary));
    await library.evaluate(async folder => {
      const response = await fetch("/api/library/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [folder] }) });
      if (!response.ok) throw new Error(await response.text());
      await HDRLibrary.browse(folder);
    }, folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 60000 });
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 3001, null, { timeout: 60000 });
    let snapshot = await library.evaluate(() => HDRLibrary.getSnapshot());
    assert.ok(snapshot.visible > 0 && snapshot.visible < 150, JSON.stringify(snapshot));
    assert.equal(await page.locator(".workspace-main").isVisible(), false);
    assert.equal(await page.locator("#viewer-status-dock").isVisible(), false);
    await library.locator("#add-folder").click();
    await library.locator("#picker-path").fill(folder);
    await library.locator("#picker-go").click();
    await library.waitForFunction(() => document.querySelector("#picker-list button"));
    await page.screenshot({ path: path.join(output, "picker.png") });
    const scanned = page.waitForResponse(response => response.url().endsWith("/api/library/scan") && response.request().method() === "POST");
    await library.locator("#picker-pin").click();
    await scanned;
    await library.waitForFunction(() => !document.getElementById("folder-picker").open);
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 60000 });
    await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas").length > 0 && [...document.querySelectorAll("#grid-space canvas")].every(canvas => canvas.dataset.pictureKey), null, { timeout: 60000 });
    await page.screenshot({ path: path.join(output, "grid.png") });
    const first = await library.evaluate(() => document.querySelector("#grid-space .library-cell").dataset.path);
    const cache = await library.evaluate(async photo => {
      return (await fetch("/api/library/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: photo, edge: 512, quality: "quick" }) })).json();
    }, first);
    assert.equal(cache.cache_hit, true); assert.ok(cache.stored_bytes > 0);
    await library.evaluate(() => { const grid = document.getElementById("library-grid"); grid.scrollTop = grid.scrollHeight; });
    await library.waitForFunction(first => ![...document.querySelectorAll("#grid-space .library-cell")].some(cell => cell.dataset.path === first), first);
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 30000 });
    snapshot = await library.evaluate(() => HDRLibrary.getSnapshot()); assert.ok(snapshot.visible < 150);
    console.log("[library] virtual grid", snapshot, "thumbnail bytes", cache.stored_bytes);
    await library.locator("#single-view").click();
    await library.waitForSelector("#single-picture[data-picture-key]", { timeout: 60000 });
    const pixels = await library.evaluate(() => {
      const canvas = document.getElementById("single-picture");
      return [...canvas.getContext("2d").getImageData(Math.floor(canvas.width/2), Math.floor(canvas.height/2),1,1).data];
    });
    assert.ok(pixels.slice(0,3).some(value => value > 10), JSON.stringify(pixels));
    await page.screenshot({ path: path.join(output, "single.png") });
    const previous = await library.evaluate(() => HDRLibrary.getSnapshot().selected);
    await library.locator("#single-picture").click(); await page.keyboard.press("ArrowRight");
    await library.waitForFunction(previous => HDRLibrary.getSnapshot().selected !== previous && document.getElementById("single-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected, previous, { timeout: 30000 });
    await page.keyboard.press("f");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().review);
    await page.waitForFunction(() => document.body.classList.contains("library-review"));
    await page.screenshot({ path: path.join(output, "review.png") });
    await page.keyboard.press("Escape");
    await library.waitForFunction(() => !HDRLibrary.getSnapshot().review);
    await library.locator("#single-picture").click(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => state.session && state.activeWorkflow === "grade", null, { timeout: 60000 });
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready", null, { timeout: 60000 });
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().active), false);
    // Keep the production leave policy; supply deterministic native-dialog choices.
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = .5;
      await queueEditCommand("set_global_adjustments", { adjustments });
      window.libraryGateCount = 0;
      window.libraryGateChoice = "cancel";
      const policy = window.HDRPhotoTransition;
      window.HDRPhotoTransition = { leaveCurrentPhoto: options => {
        window.libraryGateCount++;
        return policy.leaveCurrentPhoto({ ...options, choose: async () => window.libraryGateChoice });
      } };
    });
    assert.equal(await page.evaluate(() => state.documentDirty), true);
    const currentSession = await page.evaluate(() => state.session.session_id);
    await page.evaluate(() => activateWorkflowTab("import"));
    await library.waitForFunction(() => HDRLibrary.getSnapshot().active);
    await library.locator("#single-picture").click(); await page.keyboard.press("ArrowRight");
    await library.waitForFunction(() => document.getElementById("single-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.libraryGateCount === 1);
    assert.equal(await page.evaluate(() => state.session.session_id), currentSession);
    assert.equal(await page.evaluate(() => state.activeWorkflow), "import");
    await page.evaluate(() => { window.libraryGateChoice = "discard"; });
    await library.locator("#single-picture").click(); await page.keyboard.press("Enter");
    await page.waitForFunction(old => state.activeWorkflow === "grade" && state.session.session_id !== old, currentSession, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.libraryGateCount), 2);
    assert.equal(fs.readFileSync(path.join(folder, "ignored.hdrf"), "utf8"), "sidecar stays untouched");
    assert.equal(fs.readdirSync(folder).filter(name => name.endsWith(".hdrf")).length, 1);
    // Local real-photo check: copy samples to output, never write to originals.
    const rawSources = [
      "D:/Photos/HDR Test Images/DSC00264.ARW",
      "D:/Photos/HDR Test Images/DJI Samples/DSC00264_DxO-optical-corr-only.dng",
      "D:/Photos/HDR Test Images/Test Suite Images/iphone_16_pro_IMG_3324.HEIC",
    ];
    if (rawSources.every(source => fs.existsSync(source))) {
      const rawFolder = fs.mkdtempSync(path.join(output, "formats-"));
      for (const source of rawSources) fs.copyFileSync(source, path.join(rawFolder, path.basename(source)));
      await page.evaluate(() => activateWorkflowTab("import"));
      await library.waitForFunction(() => HDRLibrary.getSnapshot().active);
      await library.evaluate(folder => HDRLibrary.browse(folder), rawFolder);
      await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas").length === 3 && [...document.querySelectorAll("#grid-space canvas")].every(canvas => canvas.dataset.pictureKey), null, { timeout: 60000 });
      assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().count), 3);
      await page.screenshot({ path: path.join(output, "real-formats.png") });
      for (const source of rawSources) {
        const cached = await library.evaluate(async photo => (await fetch("/api/library/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: photo, edge: 512, quality: /\.heic$/i.test(photo) ? "fast" : "quick" }) })).json(), path.join(rawFolder, path.basename(source)));
        assert.equal(cached.cache_hit, true);
        console.log("[library format]", path.basename(source), cached.route);
      }
    } else console.log("[library format] local real samples unavailable; synthetic route checks only");
    assert.deepEqual(errors, []);
    console.log("Stage A passed: folder picker, recursive folders, read-only browse, virtual grid/cache, single/filmstrip, arrows, review, Grade and Cancel/Discard gate.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
