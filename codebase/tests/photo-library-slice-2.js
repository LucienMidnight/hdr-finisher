/* Slice 2: details, filter rules, tag management, albums and background indexing. Disposable copies only. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-slice-2");
fs.mkdirSync(output, { recursive: true });
const base = fs.mkdtempSync(path.join(output, "photos-"));
const folder = path.join(base, "visited"), unvisited = path.join(base, "never-opened");
fs.mkdirSync(folder); fs.mkdirSync(unvisited);
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let i = 0; i < 4; i++) fs.copyFileSync(fixture, path.join(folder, `plain-${i}.png`));
fs.copyFileSync(fixture, path.join(unvisited, "far.png"));
// Two JPEGs with camera details, written by the project's own Python.
execFileSync(path.join(root, ".venv", "Scripts", "python.exe"), ["-c", `
import sys
from PIL import Image
from PIL.TiffImagePlugin import IFDRational as R
for name, iso, lens in (("sony-a.jpg", 400, "FE 85mm F1.8"), ("sony-b.jpg", 3200, None)):
    exif = Image.Exif()
    exif[271], exif[272] = "SONY", "ILCE-7RM3"
    exif[34665] = {36867: "2024:02:03 04:05:06", 33434: R(1, 250), 33437: R(28, 10), 34855: iso, 37386: R(85, 1), **({42036: lens} if lens else {})}
    Image.new("RGB", (640, 480), (90, 120, 150)).save(sys.argv[1] + "/" + name, exif=exif)
`, folder]);
// A settings file in a folder the test never opens: only background indexing can find it.
fs.writeFileSync(path.join(unvisited, "far.png.hdrf"), JSON.stringify({ format: "HDR Finisher Photo", schema_version: 1, photo_id: "far-1",
  source: { filename: "far.png" }, contains_source_pixels: false, marks: { rating: 3, pick: "unmarked", label: "", tags: ["Sea"] }, albums: ["Trips"] }));
const originals = new Map([...fs.readdirSync(folder).map(name => path.join(folder, name)), path.join(unvisited, "far.png")].map(file => [file, fs.readFileSync(file)]));
const settings = file => JSON.parse(fs.readFileSync(file + ".hdrf", "utf8"));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const library = page.frame({ url: /\/library(?:\?|$)/ }); assert.ok(library);
    await library.waitForFunction(() => window.HDRLibrary);
    const snapshot = () => library.evaluate(() => HDRLibrary.getSnapshot());
    const menu = text => library.locator("#library-folder-menu button").filter({ hasText: text }).first();
    const answer = async (value) => {
      const dialog = library.locator("dialog.library-ask[open]").last(); await dialog.waitFor();
      if (value !== undefined) await dialog.locator("input").fill(value);
      await dialog.locator("button.button-primary").click();
    };
    // The command updates the Library immediately; disk follows the writer.
    const saved = async () => {
      const deadline = Date.now() + 30000;
      for (;;) {
        const status = await library.evaluate(async () => (await fetch("/api/library/settings-status")).json());
        if (status.waiting === 0 && !status.busy) return;
        assert.ok(Date.now() < deadline, "Settings writer did not finish");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    const cell = name => library.locator(`#grid-space .library-cell`).filter({ hasText: name });

    // Background indexing: pin both folders, open only one.
    const pinned = await library.evaluate(async paths => (await fetch("/api/library/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) })).status, [folder, unvisited]);
    assert.equal(pinned, 200);
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().indexing?.state === "idle" && HDRLibrary.getSnapshot().albums.includes("Trips"), null, { timeout: 60000 });
    assert.equal(await library.locator("#index-status").textContent(), "Activity");
    assert.equal(await library.locator('#albums .library-album-row[data-album="Trips"] .library-count').textContent(), "1");
    console.log("PASS: a pinned folder that was never opened was indexed; its album and tag were found.");

    // Details panel.
    await cell("sony-a.jpg").click();
    await library.waitForFunction(() => document.querySelector("#library-facts")?.textContent.includes("ILCE-7RM3"));
    const summary = await library.locator("#library-facts").textContent();
    for (const text of ["FE 85mm F1.8", "85 mm", "f/2.8", "1/250 s", "ISO 400"]) assert.ok(summary.includes(text), text);
    await library.locator("#facts-toggle").click();
    const all = await library.locator("#details").textContent();
    for (const text of ["File", "SONY", "Settings file", "None yet", "Location", "Not recorded", "Show less"]) assert.ok(all.includes(text), text);
    await cell("sony-b.jpg").click();
    await library.waitForFunction(() => /Lens\s*Unknown/.test(document.querySelector("#library-facts")?.innerText || ""));
    await library.locator("#facts-toggle").click();
    await cell("plain-0.png").click();
    await library.waitForFunction(() => document.querySelector("#library-facts")?.textContent.includes("Not recorded"));
    assert.deepEqual(fs.readdirSync(folder).filter(name => name.endsWith(".hdrf")), [], "Looking at details writes nothing");
    console.log("PASS: details summary, Show all, and honest Unknown / Not recorded.");

    // One chip per field; ticks within a field are OR, fields combine with AND.
    await library.locator("#filter-button").click();
    await library.locator("#filter-add").click(); await menu("Camera").click();
    await library.getByLabel("ILCE-7RM3", {exact:true}).check();
    await library.locator("#library-filter-panel button.button-primary").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 2);
    assert.equal(await library.locator("#filter-match").count(), 0);
    await library.locator("#filter-add").click(); await menu("ISO").click();
    await library.getByLabel("From ISO", {exact:true}).selectOption("3200");
    await library.locator("#library-filter-panel button.button-primary").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 1 && HDRLibrary.getSnapshot().rules === 2);
    await library.getByRole("button", {name:"Edit Camera",exact:true}).click();
    assert.ok(await library.getByLabel("ILCE-7RM3", {exact:true}).isChecked());
    await library.getByLabel("Not recorded", {exact:true}).check();
    await library.locator("#library-filter-panel button.button-primary").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 1 && HDRLibrary.getSnapshot().rules === 2);
    await library.getByRole("button", {name:"Remove ISO filter",exact:true}).click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 6);
    await library.locator("#filter-clear").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 6 && HDRLibrary.getSnapshot().rules === 0);
    await library.locator("#filter-button").click();
    console.log("PASS: tick lists, ISO range, editable unique chips, separate removal and Clear.");

    // Tag management.
    await cell("plain-0.png").click(); await cell("plain-1.png").click({ modifiers: ["Control"] });
    await page.keyboard.press("t");
    await library.locator("#library-tag-input").fill("Holiday"); await page.keyboard.press("Enter");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.tags.includes("Holiday"));
    await page.keyboard.press("Escape");
    await library.locator("#manage-tags").click();
    const row = name => library.locator(`#library-tags-list .library-tag-row[data-tag="${name}"]`);
    await row("Holiday").waitFor();
    assert.equal(await row("Holiday").locator(".library-tag-count").textContent(), "2");
    assert.equal(await row("Sea").locator(".library-tag-count").textContent(), "1");
    await row("Holiday").click(); await library.locator("#library-tags-rename").click();
    await answer("Sea");
    await library.locator("dialog.library-ask[open] h2").filter({ hasText: "Merge Tags?" }).waitFor();
    await saved();
    assert.deepEqual(settings(path.join(folder, "plain-0.png")).marks.tags, ["Holiday"], "Nothing changes before the merge is confirmed");
    await answer();
    await library.waitForFunction(() => document.querySelector('#library-tags-list [data-tag="Sea"] .library-tag-count')?.textContent === "3" && !document.querySelector('#library-tags-list [data-tag="Holiday"]'));
    await saved();
    assert.deepEqual(settings(path.join(folder, "plain-0.png")).marks.tags, ["Sea"]);
    await library.locator("#library-tags-new").click(); await answer("Portfolio");
    await row("Portfolio").waitFor();
    assert.equal(await row("Portfolio").locator(".library-tag-count").textContent(), "0");
    await library.locator("#library-tags-undo").click();
    await library.waitForFunction(() => !document.querySelector('#library-tags-list [data-tag="Portfolio"]'));
    await library.locator('#library-tags input[data-label="red"]').fill("To retouch");
    await library.locator("#library-tags-search").click();
    await library.waitForFunction(() => document.querySelector(".library-tags-note").textContent === "Label meaning saved.");
    await row("Sea").click(); await library.locator("#library-tags-show").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().collection?.kind === "tag" && HDRLibrary.getSnapshot().count === 3);
    assert.ok((await snapshot()).paths.includes(path.join(unvisited, "far.png")), "A tag reaches photos in folders never opened");
    await library.getByRole("button", { name: /To retouch.*red label/ }).click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.label === "red");
    console.log("PASS: Tags and Labels window: counts, rename-into-existing asks before merging, new tag, undo, label meaning, Show photos.");

    // Albums.
    await library.evaluate(folder => HDRLibrary.browse(folder), folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]");
    await cell("sony-a.jpg").click(); await cell("sony-b.jpg").click({ modifiers: ["Control"] });
    await library.locator("#add-album").click(); await menu("New album from 2 photos selected").click();
    await answer("Best");
    const album = name => library.locator(`#albums .library-album-row[data-album="${name}"]`);
    await library.waitForFunction(() => document.querySelector('#albums [data-album="Best"] .library-count')?.textContent === "2");
    await saved();
    assert.deepEqual(settings(path.join(folder, "sony-a.jpg")).albums, ["Best"]);
    assert.equal(settings(path.join(folder, "sony-a.jpg")).marks.rating, 0);
    await cell("plain-2.png").click({ button: "right" }); await menu("Add to Best").click();
    await library.waitForFunction(() => document.querySelector('#albums [data-album="Best"] .library-count')?.textContent === "3");
    await cell("plain-2.png").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().facts.albums.includes("Best"));
    await album("Best").locator(".folder-name").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().collection?.kind === "album" && HDRLibrary.getSnapshot().count === 3);
    await cell("plain-2.png").click({ button: "right" }); await menu("Remove from Best").click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 2);
    await saved();
    assert.deepEqual(settings(path.join(folder, "plain-2.png")).albums, []);
    assert.ok(fs.existsSync(path.join(folder, "plain-2.png")), "Removing from an album leaves the file");
    await cell("sony-a.jpg").click(); await page.keyboard.press("Control+z");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 3 && !HDRLibrary.getSnapshot().reading);
    await album("Best").click({ button: "right" }); await menu("Rename album").click(); await answer("Best of 2026");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().collection?.name === "Best of 2026" && HDRLibrary.getSnapshot().count === 3);
    await saved();
    assert.deepEqual(settings(path.join(folder, "sony-b.jpg")).albums, ["Best of 2026"]);
    await page.screenshot({ path: path.join(output, "album.png") });
    await album("Best of 2026").click({ button: "right" }); await menu("Delete album").click(); await answer();
    await library.waitForFunction(() => !HDRLibrary.getSnapshot().albums.includes("Best of 2026") && HDRLibrary.getSnapshot().collection === null && HDRLibrary.getSnapshot().count === 6);
    await saved();
    assert.deepEqual(settings(path.join(folder, "sony-b.jpg")).albums, []);
    console.log("PASS: albums from a selection, right-click add/remove, album view, undo, rename, delete; files untouched.");

    // The indexing control.
    await library.locator("#index-status").click();
    await library.locator("#library-activity").getByRole("button", { name: "Turn background indexing off", exact: true }).click();
    await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Background indexing is off"));
    await library.locator("#library-activity").getByRole("button", { name: "Turn background indexing on", exact: true }).click();
    await library.waitForFunction(() => HDRLibrary.getSnapshot().indexing?.state === "idle", null, { timeout: 60000 });
    for (const [file, bytes] of originals) assert.deepEqual(fs.readFileSync(file), bytes, `${file} must be untouched`);
    assert.deepEqual(errors, []);
    console.log("Slice 2 passed: details, filter rules, tag management, albums and background indexing; original copies unchanged.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
