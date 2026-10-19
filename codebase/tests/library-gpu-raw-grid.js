/* Camera RAW grid cells in the real app: an unedited RAW shows its camera
 * preview, then its saved thumbnail, and nothing in between; an edited RAW
 * shows its preview, then its saved-grade thumbnail, never the unedited look.
 * Photos are disposable copies; originals and their settings are only read. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-gpu-raw-grid');
const unedited = [
  'D:/Photos/Play_Raw/Zebras Crossing - thekman/DSC_3931.NEF',
  'D:/Photos/Play_Raw/Foggy morning at Dunn Lake/IMG_7723.CR3',
  'D:/Photos/Play_Raw/Lakeland landscape in dry Summer/A7R00619.ARW',
  'D:/Photos/Play_Raw/sunset over stadium roof - f22/P6200170.ORF',
].filter(p => fs.existsSync(p));
// The edited photo needs a saved-grade picture from the hidden delivery window,
// which can close the app under a test connection (release README, "The app
// window closing mid-driver"). HDR_FINISHER_GRID_EDITED=0 leaves it out.
const withEdited = process.env.HDR_FINISHER_GRID_EDITED !== '0';
const edited = 'D:/test-photos-delete-later/DSC07072.ARW';
if (unedited.length < 2 || (withEdited && (!fs.existsSync(edited) || !fs.existsSync(edited + '.hdrf')))) {
  console.log(JSON.stringify({ skipped: 'Sample camera RAWs are not on this machine.' })); process.exit(0);
}
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
for (const photo of unedited) fs.copyFileSync(photo, path.join(folder, path.basename(photo)));
const editedCopy = path.join(folder, path.basename(edited));
let sidecar = null;
if (withEdited) {
  fs.copyFileSync(edited, editedCopy);
  const grade = JSON.parse(fs.readFileSync(edited + '.hdrf', 'utf8'));
  for (const field of ['grade', 'grade_default']) if (grade[field]?.source) grade[field].source.durable_path = editedCopy;
  fs.writeFileSync(editedCopy + '.hdrf', JSON.stringify(grade));
  sidecar = fs.readFileSync(editedCopy + '.hdrf');
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => activateWorkflowTab('import'));
    const library = page.locator('#library-frame');
    const frame = page.frameLocator('#library-frame');
    await library.evaluate(element => element.contentWindow.HDRLibraryGpuRaw);
    // Record every picture each cell shows, from before the folder opens.
    await library.evaluate(element => {
      const win = element.contentWindow, log = win.__cellLog = {}, ids = new WeakMap();
      let next = 0;
      // One entry per cell element: the grid and filmstrip each count alone.
      const name = cell => `${cell.dataset.path}#${ids.get(cell) ?? (ids.set(cell, next++), ids.get(cell))}`;
      new win.MutationObserver(changes => {
        for (const change of changes) {
          const node = change.target, cell = node.closest?.('.library-cell');
          if (!cell?.dataset.path) continue;
          const entry = log[name(cell)] ||= { pictures: [], canvases: 0 };
          if (change.type === 'attributes' && node.tagName === 'IMG' && node.getAttribute('src')) {
            const src = node.getAttribute('src'), kind = src.startsWith('data:') ? 'preview' : src.includes('/thumbnail/') ? 'saved' : 'other';
            if (entry.pictures.at(-1) !== kind + ':' + src.slice(-24)) entry.pictures.push(kind + ':' + src.slice(-24));
          }
          // Overlay layers are not pictures; a picture canvas means an interim drawing.
          for (const added of change.addedNodes || []) if (added.tagName === 'CANVAS') (entry.canvasKinds ||= []).push(added.className || 'picture');
          entry.canvases = (entry.canvasKinds || []).filter(kind => kind === 'picture').length;
        }
      }).observe(win.document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    });
    const started = Date.now();
    await library.evaluate((element, folder) => element.contentWindow.HDRLibrary.browse(folder), folder);
    const names = [...unedited.map(p => path.basename(p)), ...(withEdited ? [path.basename(edited)] : [])];
    // Every cell ends on a saved thumbnail file; the edited one on its saved grade.
    const dump = async () => fs.writeFileSync(path.join(output, 'cells.json'), JSON.stringify(await library.evaluate(element => element.contentWindow.__cellLog), null, 1));
    if (withEdited) {
      try { await frame.locator('.library-cell img[data-kept="true"]').first().waitFor({ timeout: Number(process.env.HDR_FINISHER_KEPT_WAIT_MS || 180000) }); }
      catch (error) { await dump(); throw error; }
    }
    await library.evaluate(async (element, count) => {
      const win = element.contentWindow;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const settled = [...win.document.querySelectorAll('.library-cell img')].filter(img => (img.getAttribute('src') || '').includes('/thumbnail/') && !img.hidden && img.dataset.preview !== 'true');
        if (settled.length >= count) return;
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error('Not every cell reached its saved thumbnail.');
    }, names.length);
    const seconds = (Date.now() - started) / 1000;
    const log = await library.evaluate(element => element.contentWindow.__cellLog);
    fs.writeFileSync(path.join(output, 'cells.json'), JSON.stringify({ seconds, log }, null, 1));
    console.log(JSON.stringify({ seconds: Math.round(seconds), cells: Object.fromEntries(Object.entries(log).map(([k, v]) => [k, v.pictures.map(p => p.split(':')[0]).join(' > ') + (v.canvases ? ` (+${v.canvases} drawn)` : '')])) }));
    assert.deepEqual(errors, [], 'No page errors');
    for (const photo of names) {
      const cells = Object.entries(log).filter(([key]) => path.win32.basename(key.split('#')[0]) === photo).map(([, entry]) => entry);
      assert.ok(cells.length, `${photo} has a cell`);
      for (const entry of cells) {
        const kinds = entry.pictures.map(p => p.split(':')[0]);
        assert.ok(kinds.length <= 2 && kinds.filter(k => k === 'saved').length <= 1, `${photo} shows at most two stages: ${kinds.join(' > ')}`);
        assert.equal(entry.canvases, 0, `${photo} draws no interim picture`);
      }
      assert.ok(cells.some(entry => entry.pictures.at(-1)?.startsWith('saved')), `${photo} ends on its saved thumbnail`);
    }
    if (withEdited) assert.deepEqual(fs.readFileSync(editedCopy + '.hdrf'), sidecar, 'Browsing does not re-save the grade');
  } finally {
    await browser.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
