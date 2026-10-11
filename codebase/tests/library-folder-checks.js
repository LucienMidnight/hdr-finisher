/* One focused Electron check, disposable intake folders only. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-folder-checks");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "intake-"));
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let i = 0; i < 120; i++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(i).padStart(3, "0")}.png`));
(async () => {
 const browser = await chromium.launch({headless: true, channel: "msedge"});
 try {
  const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.HDR_FINISHER_URL, {waitUntil: "networkidle"});
  const library = page.frame({url: /\/library(?:\?|$)/});
  await library.waitForFunction(() => window.HDRLibrary);
  await library.evaluate(folder => HDRLibrary.browse(folder), folder);
  // Pin through the existing menu so the tree and backend agree.
  await library.locator("#folders").click({button: "right", position: {x: 5, y: 5}});
  await page.keyboard.press("Escape");
  const api = (route, body) => library.evaluate(async ({route, body}) => {
   const response = await fetch(route, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
   if (!response.ok) throw new Error(await response.text()); return response.json();
  }, {route, body});
  await api("/api/library/pins", {paths: [folder]});
  // Reload uses the real pin tree and preserves no test-only scheduler state.
  await library.goto(new URL("/library", process.env.HDR_FINISHER_URL).href);
  await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 120);
  await library.locator("#sort-button").click(); await library.locator('#sort-menu [data-sort="name"]').click();
  await library.evaluate(() => { document.querySelector("#library-grid").scrollTop = 950; });
  await library.locator("#grid-space .library-cell").first().click();
  const before = await library.evaluate(() => ({selected: HDRLibrary.getSnapshot().selected, selection: HDRLibrary.getSnapshot().selection, top: document.querySelector("#library-grid").scrollTop}));
  fs.copyFileSync(fixture, path.join(folder, "z-arrived.png"));
  await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 121, null, {timeout: 45000});
  const after = await library.evaluate(() => ({selected: HDRLibrary.getSnapshot().selected, selection: HDRLibrary.getSnapshot().selection, top: document.querySelector("#library-grid").scrollTop}));
  assert.deepEqual(after, before, "timed arrival keeps selection and scroll");
  await library.locator("#more-button").click(); await library.locator("#check-photos").click();
  await library.waitForFunction(() => document.querySelector("#library-status").textContent.includes("no new photos"));
  fs.copyFileSync(fixture, path.join(folder, "z-menu.png"));
  const row = library.locator(".library-folder-row").filter({hasText: path.basename(folder)}).first();
  for (let i = 0; i < 2; i++) {
   await row.click({button: "right"});
   await library.getByRole("menuitem", {name: "Check for new photos", exact: true}).click();
   await library.waitForFunction(() => document.querySelector("#library-status").textContent.includes("photos still arriving") || HDRLibrary.getSnapshot().count === 122);
  }
  await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 122);
  assert.equal((await library.evaluate(() => HDRLibrary.getSnapshot().selected)), before.selected);
  await library.locator("#single-view").click();
  const single = await library.evaluate(() => ({selected: HDRLibrary.getSnapshot().selected, left: document.querySelector("#filmstrip").scrollLeft}));
  fs.copyFileSync(fixture, path.join(folder, "z-single.png"));
  await api("/api/library/checks", {paths: [folder]});
  await library.waitForFunction(() => document.querySelector("#library-status").textContent.includes("photos still arriving"));
  await library.locator("#more-button").click(); await library.locator("#check-photos").click();
  await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 123);
  assert.deepEqual(await library.evaluate(() => ({selected: HDRLibrary.getSnapshot().selected, left: document.querySelector("#filmstrip").scrollLeft})), single);
  fs.unlinkSync(single.selected);
  await library.locator("#more-button").click(); await library.locator("#check-photos").click();
  await library.waitForFunction(old => HDRLibrary.getSnapshot().selected !== old && HDRLibrary.getSnapshot().count === 122, single.selected);
  assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().view), "single");
  await page.screenshot({path: path.join(output, "folder-checks.png")});
  assert.deepEqual(errors, []);
  console.log("PASS: timed intake arrival, stable grid selection/scroll, toolbar and folder menu checks, stable single/filmstrip, and quiet selected-photo removal.");
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
