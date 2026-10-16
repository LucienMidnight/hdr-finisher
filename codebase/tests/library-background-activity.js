/* Activity controls and Stage C conflict attention, disposable photo copies only. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-background-activity");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
for (let i = 0; i < 3; i++) fs.copyFileSync(path.join(root, "tests", "fixtures", "sdr_gradient.png"), path.join(folder, `photo-${i}.png`));
(async () => {
 const browser = await chromium.launch({ headless: true, channel: "msedge" });
 try {
  const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
  const library = page.frame({ url: /\/library(?:\?|$)/ });
  await library.waitForFunction(() => window.HDRLibrary);
  await library.evaluate(folder => HDRLibrary.browse(folder), folder);
  await library.waitForSelector("#grid-space canvas[data-picture-key]");
  const api = (route, body) => library.evaluate(async ({route, body}) => {
   const response = await fetch(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
   if (!response.ok) throw new Error(await response.text()); return response.json();
  }, {route, body});
  await api("/api/library/writer", {action: "pause"});
  await library.locator("#grid-space .library-cell").first().click();
  await page.keyboard.press("Control+a"); await page.keyboard.press("4");
  await library.waitForFunction(() => document.querySelector("#library-status").textContent === "Rated 3 photos");
  assert.equal(await library.locator("#library-undo").isVisible(), true);
  await library.waitForFunction(() => document.querySelector("#index-status").textContent.includes("Writing settings paused"));
  await library.locator("#index-status").click();
  assert.equal(await library.locator("#library-activity").isVisible(), true);
  assert.equal(await library.locator("#library-activity").getByRole("button", {name: "Cancel", exact: true}).count(), 0);
  await api("/api/library-worker/pause", {reason: "manual", paused: true});
  await api("/api/library/pins", {paths: [folder]});
  await library.waitForFunction(() => document.querySelector("#index-status").textContent.includes("+1"));
  await library.locator("#library-activity").getByRole("button", {name: "Pause indexing", exact: true}).click();
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Indexing paused"));
  await library.locator("#library-activity").getByRole("button", {name: "Resume indexing", exact: true}).click();
  await library.locator("#library-activity").getByRole("button", {name: "Re-scan pinned folders now", exact: true}).click();
  await page.keyboard.press("Tab");
  assert.equal(await library.evaluate(() => !!document.activeElement.closest("#library-activity")), true);
  const corrupt = path.join(folder, "photo-0.png.hdrf"); fs.writeFileSync(corrupt, "broken settings");
  await library.locator("#library-activity").getByRole("button", {name: "Resume writing", exact: true}).click();
  await api("/api/library-worker/pause", {reason: "manual", paused: false});
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("cannot be read and was left untouched"));
  await page.screenshot({ path: path.join(output, "needs-attention.png") });
  assert.equal(fs.readFileSync(corrupt, "utf8"), "broken settings");
  await library.locator("#library-activity").getByRole("button", {name: "Pause writing", exact: true}).click();
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Writing settings paused"));
  await library.locator("#library-activity").getByRole("button", {name: "Try again", exact: true}).click();
  assert.ok((await library.locator("#library-activity").textContent()).includes("cannot be read"));
  // Repair only this deliberately malformed fixture; original photos remain intact.
  fs.unlinkSync(corrupt);
  await library.locator("#library-activity").getByRole("button", {name: "Resume writing", exact: true}).click();
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Nothing needs attention."));
  assert.equal(JSON.parse(fs.readFileSync(corrupt, "utf8")).marks.rating, 4);
  await library.locator("#library-activity").getByRole("button", {name: "Turn background indexing off", exact: true}).click();
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Background indexing is off"));
  await library.locator("#library-activity").getByRole("button", {name: "Turn background indexing on", exact: true}).click();
  await page.keyboard.press("Escape");
  assert.equal(await library.locator("#library-activity").isVisible(), false);
  await library.locator("#library-undo").click();
  await library.waitForFunction(() => HDRLibrary.getSnapshot().marks.rating === 0);
  assert.equal(await library.locator("#library-undo").isVisible(), false);
  assert.deepEqual(errors, []);
  await library.locator("#index-status").click();
  // Finish Undo before creating the external conflict fixture.
  const saveDeadline = Date.now() + 30000;
  for (;;) {
   const status = await library.evaluate(async () => (await fetch("/api/library/settings-status")).json());
   if (status.waiting === 0 && !status.busy) break;
   assert.ok(Date.now() < saveDeadline, "Undo settings writer did not finish");
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(JSON.parse(fs.readFileSync(corrupt, "utf8")).marks.rating, 0);
  const conflict = path.join(folder, "photo-0.png (sync conflicted copy).hdrf");
  fs.copyFileSync(corrupt, conflict);
  const copiesBefore = [fs.readFileSync(corrupt, "utf8"), fs.readFileSync(conflict, "utf8")];
  await api("/api/library/scan", {path: folder});
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("More than one settings file"));
  const attention = await library.locator("#library-activity").textContent();
  assert.ok(attention.includes("photo-0.png.hdrf") && attention.includes(path.basename(conflict)));
  assert.deepEqual([fs.readFileSync(corrupt, "utf8"), fs.readFileSync(conflict, "utf8")], copiesBefore);
  await page.screenshot({ path: path.join(output, "stage-c-conflict.png") });
  fs.unlinkSync(conflict); // Remove only our deliberately created conflict fixture.
  await api("/api/library/scan", {path: folder});
  await library.waitForFunction(() => document.querySelector("#library-activity").textContent.includes("Nothing needs attention."));
  console.log("PASS: conflict detection shows both names, leaves both files untouched, clears on re-scan; Activity progress, writer Pause/Resume, grouped unreadable settings and Try again, automatic attention clearing, indexing controls, Escape and bulk Undo.");
 } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
