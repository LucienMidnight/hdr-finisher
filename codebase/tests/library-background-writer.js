/* Stage A: immediate marks/Undo and Details states. Disposable photo copies only. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-background-writer");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const other = fs.mkdtempSync(path.join(output, "other-"));
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let i = 0; i < 3; i++) fs.copyFileSync(fixture, path.join(folder, `photo-${i}.png`));
fs.copyFileSync(fixture, path.join(other, "other.png"));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const library = page.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => window.HDRLibrary);
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]");
    await library.locator("#grid-space .library-cell").first().click();
    await library.locator("#facts-toggle").click();
    const pause = paused => library.evaluate(async paused => {
      const response = await fetch("/api/library-worker/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "manual", paused }) });
      if (!response.ok) throw new Error("pause failed");
    }, paused);
    await pause(true);
    await page.keyboard.press("4");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 4);
    await library.waitForFunction(() => document.querySelector("#library-facts").textContent.includes("Waiting to be written"));
    const first = await library.evaluate(() => HDRLibrary.getSnapshot().selected);
    assert.equal(fs.existsSync(first + ".hdrf"), false);
    await page.keyboard.press("Control+z");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 0);
    assert.equal(fs.existsSync(first + ".hdrf"), false);
    await page.keyboard.press("5");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 5);
    await pause(false);
    await library.waitForFunction(() => document.querySelector("#library-facts").textContent.includes("Beside the photo"));
    assert.equal(JSON.parse(fs.readFileSync(first + ".hdrf", "utf8")).marks.rating, 5);
    await page.keyboard.press("Control+z");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 0);
    // Poll an awaited request explicitly: waitForFunction's truthiness check
    // can accept a Promise before the settings-status response has arrived.
    const deadline = Date.now() + 10000;
    let written = false;
    while (Date.now() < deadline) {
      const result = await library.evaluate(async photo => (await (await fetch("/api/library/settings-status", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [photo] })
      })).json()), first);
      if (result.photos[0]?.storage === "sidecar" && result.photos[0]?.marks.rating === 0) { written = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(written, "the undone marks must finish writing");
    assert.equal(JSON.parse(fs.readFileSync(first + ".hdrf", "utf8")).marks.rating, 0);
    await library.evaluate(folder => HDRLibrary.browse(folder), other);
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().count), 1);
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.screenshot({ path: path.join(output, "stage-a.png") });
    console.log("PASS: marks and Ctrl+Z return while writer waits; no empty first file; Details updates to written; written Undo restores files; browsing stays usable.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
