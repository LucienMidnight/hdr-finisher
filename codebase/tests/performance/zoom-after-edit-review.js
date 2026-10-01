/** Where does a zoom spend its time right after a local edit? Disposable session, never saves. */
const path = require('path'); const { chromium } = require('playwright');
const c = require('./heavy-project-review-common'); const { selectLocal } = require('./heavy-project-drag-review');
const args = process.argv.slice(2); const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const project = path.resolve(opt('--project', '')); const output = path.resolve(opt('--output', 'output/performance/review/zoom-after-edit.json'));
const zoom = Number(opt('--zoom', 200));
async function main() {
  const browser = await chromium.launch({ headless: false }); const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const report = { ...c.manifest(project), zoom, operations: [], errors: [], status: 'running' };
  const requests = c.networkProbe(page); page.on('pageerror', e => report.errors.push(String(e)));
  async function operation(name, action) {
    const start = Date.now(), n = requests.length, b = await c.mark(page); await action(); await c.stable(page, 180000);
    const end = Date.now();
    // Requests can outlive the readiness wait; give their timings a moment to land.
    await page.waitForTimeout(150);
    report.operations.push({ name, startedAt: start, totalMs: end - start, observation: await c.result(page, b, b.at), requests: requests.slice(n) }); c.write(output, report);
    console.log(name, end - start, 'ms');
  }
  const stroke = sequence => page.evaluate(async ({ sequence }) => {
    const local = structuredClone(state.editDocument.local_adjustments.find(x => x.id === state.selectedLocalId));
    const phase = (sequence * .61803398875) % 1; const x = .3 + phase * .4, y = .3 + ((sequence * .41421356237) % 1) * .4;
    local.mask.leaf.strokes = [...local.mask.leaf.strokes, { points: [{ x, y, pressure: .8 }, { x: x + .04, y: y + .03, pressure: 1 }],
      radius: .02, hardness: .5, flow: .6, opacity: .8, erase: false }];
    if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Brush edit failed');
  }, { sequence });
  const zoomIn = () => page.evaluate(z => setCustomZoom(z), zoom);
  const fit = () => page.locator('#zoom-fit').click();
  try {
    await c.open(page, project, false);
    await selectLocal(page, 'brush');
    report.lane = await page.evaluate(() => state.currentView);
    // A. The project as saved.
    await operation('A stroke', () => stroke(1));
    await operation(`A zoom ${zoom} right after stroke`, zoomIn);
    await operation('A fit', fit);
    await operation('A stroke', () => stroke(2));
    await page.waitForTimeout(6000);
    await operation(`A zoom ${zoom} 6 s after stroke`, zoomIn);
    await operation('A fit', fit);
    // B. Local Detail on two brush locals.
    await operation('B enable local detail', () => page.evaluate(async () => {
      for (const source of state.editDocument.local_adjustments.filter(x => x.mask?.leaf?.type === 'brush').slice(0, 2)) {
        const local = structuredClone(source);
        for (const grade of [local.hdr_grade, local.sdr_grade]) Object.assign(grade.detail, { texture_amount: .4, clarity_amount: .4, sharpen_amount: .4 });
        if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Detail edit failed');
      }
    }));
    await operation('B stroke', () => stroke(3));
    await operation(`B zoom ${zoom} right after stroke`, zoomIn);
    await operation('B fit', fit);
    await operation('B stroke', () => stroke(4));
    await page.waitForTimeout(6000);
    await operation(`B zoom ${zoom} 6 s after stroke`, zoomIn);
    await operation('B fit', fit);
    await operation(`B zoom ${zoom} nothing changed`, zoomIn);
    await operation('B fit', fit);
    // C. A brand-new unfeathered brush local with Detail.
    await operation('C create local', () => page.evaluate(async () => {
      const local = newLocalAdjustment('brush');
      local.mask.leaf.strokes = [{ points: [{ x: .35, y: .4, pressure: 1 }, { x: .6, y: .55, pressure: 1 }], radius: .05, hardness: .6, flow: 1, opacity: 1, erase: false }];
      for (const grade of [local.hdr_grade, local.sdr_grade]) { grade.exposure = .5; Object.assign(grade.detail, { clarity_amount: .5, sharpen_amount: .5 }); }
      if (!await queueEditCommand('create_local', { local })) throw Error('Create failed');
      state.selectedLocalId = local.id; renderLocalAdjustments();
    }));
    await operation(`C zoom ${zoom} right after create`, zoomIn);
    await operation('C fit', fit);
    report.status = 'complete';
  } catch (e) { report.status = 'failed'; report.failure = String(e.stack || e); throw e; }
  finally { c.write(output, report); await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
