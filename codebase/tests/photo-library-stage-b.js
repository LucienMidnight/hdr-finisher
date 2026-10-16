/* Stage B exercises only disposable copies, never the owner's photo folders. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-stage-b");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let i = 0; i < 24; i++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(i).padStart(2, "0")}.png`));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const library = page.frame({ url: /\/library(?:\?|$)/ }); assert.ok(library);
    await library.waitForFunction(() => window.HDRLibrary);
    // Tag suggestions count Library members, so pin these disposable photos.
    await library.evaluate(async folder => {
      await fetch("/api/library/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [folder] }) });
      await HDRLibrary.browse(folder);
    }, folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]");
    assert.equal(fs.readdirSync(folder).length, 24, "Browsing must not create sidecars");
    const cells = library.locator("#grid-space .library-cell");
    await cells.nth(0).click(); await cells.nth(1).click({ modifiers: ["Control"] });
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().selection.length), 2);
    await page.keyboard.press("4");
    await library.waitForFunction(() => document.querySelectorAll("#grid-space .library-stars").length > 0 && [...document.querySelectorAll('#grid-space .library-cell[aria-selected="true"] .library-stars')].every(star => star.textContent === "★★★★"));
    const first = path.join(folder, "photo-00.png"), second = path.join(folder, "photo-01.png");
    const document = source => JSON.parse(fs.readFileSync(source + ".hdrf", "utf8"));
    // Marks reach disk through the background settings writer.
    const persisted = async check => {
      const deadline = Date.now() + 30000;
      for (;;) {
        try { check(); return; } catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };
    await persisted(() => { assert.equal(document(first).marks.rating, 4); assert.equal(document(second).marks.rating, 4); });
    await page.keyboard.press("p");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.pick === "pick");
    await page.keyboard.press("6");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.label === "red");
    await page.keyboard.press("6");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.label === "");
    await page.keyboard.press("t");
    await library.locator("#library-tag-input").fill("Family"); await page.keyboard.press("Enter");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.tags.includes("Family"));
    await persisted(() => { assert.deepEqual(document(first).marks.tags, ["Family"]); });
    await library.locator("#library-tag-input").fill("Fam");
    await library.waitForSelector("#library-tag-suggestions [role=option]");
    assert.equal(await library.locator("#library-tag-suggestions [role=option]").first().textContent(), "Family (2)");
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
    await library.waitForFunction(() => document.getElementById("library-tag-input").value === "");
    await page.keyboard.press("Escape");
    await cells.nth(0).click();
    await page.keyboard.press("x"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.pick === "reject");
    await page.keyboard.press("Control+z"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.pick === "pick");
    await cells.nth(2).click({ modifiers: ["Shift"] });
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().selection.length), 3);
    assert.equal(await library.locator(".library-tag-chip.partial").count(), 1);
    await library.locator('.library-tag-chip.partial button').first().click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.tags.includes("Family"));
    await persisted(() => { assert.equal(document(path.join(folder, "photo-02.png")).marks.tags[0], "Family"); });
    await library.locator('[aria-label="Remove tag Family"]').click();
    await library.waitForFunction(() => !HDRLibrary.getSnapshot().marks.tags.includes("Family"));
    await cells.nth(0).click(); await page.keyboard.press("Control+a");
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().selection.length), 24);
    await page.keyboard.press("2");
    await library.waitForFunction(() => [...document.querySelectorAll("#grid-space .library-stars")].every(star => star.textContent === "★★"));
    await persisted(() => { assert.equal(fs.readdirSync(folder).filter(name => name.endsWith(".hdrf")).length, 24); });
    await page.keyboard.press("Control+z");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 4);
    await persisted(() => { assert.equal(document(first).marks.rating, 4); assert.equal(document(path.join(folder, "photo-23.png")).marks.rating, 0); });
    const colour = await library.evaluate(() => {
      const star = document.querySelector(".library-stars"); return { actual: getComputedStyle(star).color, expected: getComputedStyle(document.documentElement).getPropertyValue("--star").trim() };
    });
    assert.equal(colour.actual, "rgb(242, 201, 76)"); assert.equal(colour.expected, "#f2c94c");
    // Start in the grid's empty margin and drag across two rows of virtual cells.
    const grid = await library.locator("#library-grid").boundingBox();
    await page.mouse.move(grid.x + 2, grid.y + 2); await page.mouse.down();
    await page.mouse.move(grid.x + 400, grid.y + 260, { steps: 8 }); await page.mouse.up();
    assert.ok(await library.evaluate(() => HDRLibrary.getSnapshot().selection.length) > 1);
    await page.screenshot({ path: path.join(output, "culling.png") });
    await cells.nth(0).click(); await library.locator("#single-view").click();
    await library.waitForSelector("#single-picture[data-picture-key]");
    await page.keyboard.press("9"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.label === "blue");
    await page.keyboard.press("f"); await library.waitForFunction(() => HDRLibrary.getSnapshot().review);
    await page.keyboard.press("5"); await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 5);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "networkidle" });
    const restored = page.frame({ url: /\/library(?:\?|$)/ });
    await restored.waitForFunction(() => window.HDRLibrary);
    await restored.evaluate(folder => HDRLibrary.browse(folder), folder);
    assert.equal(await restored.evaluate(() => HDRLibrary.getSnapshot().marks.rating), 5);
    assert.equal(await restored.evaluate(() => HDRLibrary.getSnapshot().marks.label), "blue");
    for (let i = 0; i < 24; i++) assert.deepEqual(fs.readFileSync(path.join(folder, `photo-${String(i).padStart(2, "0")}.png`)), fs.readFileSync(fixture));
    assert.deepEqual(errors, []);
    console.log("Stage B passed: bulk marks/undo, labels, tags/suggestions/partial tags, Ctrl/Shift/all/box selection, single/review, reload persistence; original copies unchanged.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
