/**
 * Editing Peak with Clarity: the reduced-surround map against the patch's own.
 * Measurement only; disposable session, never saves a project.
 *
 *   node tests/run-in-electron.js tests/performance/editing-peak-clarity-reference.js \
 *     --project <file.hdrfinisher> [--set hdr.detail.clarity_amount=100,hdr.detail.clarity_radius_percent=1.5] \
 *     [--local-type brush --local-set detail.clarity_amount=100] --output <report.json>
 *
 * When Clarity's reach puts the sixteen measurement patches over the editing
 * budget, the measurement reads Clarity's maps from one reduced render of the
 * frame (`measurementClaritySurround`). This driver measures that way, then
 * switches the reduced render off and measures the same patches with their
 * full-size halos in groups that each fit the unchanged budget, which is the
 * arithmetic the patches used before. Every patch's highlight-anchor signal
 * and finished peak must agree within --limit (default 0.5%).
 *
 * The reference needs at least one patch to fit the budget with its full halo,
 * so it cannot run above about 2% radius on a 42 MP frame; there the check is
 * preview-export-compare.js against the export itself.
 */
const path = require('node:path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/editing-peak-clarity-reference.json'));
const limit = Number(opt('--limit', 0.005));
const pairs = (text) => text.split(',').filter(Boolean).map((entry) => {
  const [controlPath, raw] = entry.split('=');
  return { path: controlPath, value: JSON.parse(raw) };
});

/** Runs in the page. `grouped` measures in budget-sized groups with the reduced render switched off. */
const measure = async (grouped) => {
  const renderer = state.gpuPreview, lane = 'hdr', budget = 4 * 1024 * 1024, white = projectReferenceWhiteNits();
  const rank = renderer.rankEditingPeakCandidates, tiled = renderer.renderTiledTo, haloOf = renderer.roiSourceHalo;
  const surround = renderer.measurementClaritySurround;
  let slice = null, patches = null, halo = null, rows = [];
  // The app's own background measurements pass their own isCurrent; this one marks ours.
  const mine = () => true;
  renderer.rankEditingPeakCandidates = async function (...values) {
    const ranked = await rank.apply(this, values);
    if (!ranked) return ranked;
    patches = ranked.patches;
    return slice ? { ...ranked, patches: ranked.patches.slice(slice[0], slice[1]) } : ranked;
  };
  renderer.roiSourceHalo = function (...values) {
    const reach = haloOf.apply(this, values);
    if (values[6]?.analysisMasks) halo = reach;
    return reach;
  };
  renderer.renderTiledTo = async function (...values) {
    const result = await tiled.apply(this, values);
    const options = values[11];
    if (options?.analysisPatch && options.isCurrent === mine) {
      rows.push({ key: `${options.analysisPatch.x},${options.analysisPatch.y}`, peak: result?.metrics?.exactPeak ?? null });
    }
    return result;
  };
  if (grouped) renderer.measurementClaritySurround = async () => null;
  const call = (anchorOnly) => renderer.measureEditingPeak(els.previewCanvas, state.session.session_id, lane,
    JSON.parse(JSON.stringify(state.adjustments)), sampleCurvePoints, JSON.parse(JSON.stringify(localAdjustments())),
    state.editRevision, white, { width: state.session.source.width, height: state.session.source.height },
    { ...(gpuPreviewSourceOptions(lane) || {}), tier: 'settled', measureOnly: true, highlightAnchorOnly: anchorOnly,
      applicationGeneration: state.previewGeneration[lane], isCurrent: mine });
  const nits = (value) => (Number.isFinite(value) ? value / 0.18 * white : null);
  const report = { grouped };
  try {
    for (const [name, anchorOnly] of [['anchor', true], ['peak', false]]) {
      rows = [];
      const started = performance.now();
      let metrics = null, refusals = null, value = null;
      if (!grouped) {
        const result = await call(anchorOnly);
        metrics = result?.metrics ?? null; refusals = result?.refusals ?? null;
        // A project with no automatic anchor still reads the same signal off its patches.
        value = (anchorOnly ? result?.highlightAnchor?.value : null) ?? result?.metrics?.exactPeak;
      } else {
        await call(anchorOnly);
        const group = Math.floor(budget / (128 + 2 * halo) ** 2);
        report.fullHalo = halo; report.patchesPerGroup = group;
        if (group < 1) { refusals = ['no patch fits the budget with its full halo']; }
        for (let first = 0; group >= 1 && first < patches.length; first += group) {
          slice = [first, first + group];
          const result = await call(anchorOnly);
          if (!result?.rendered) { refusals = result?.refusals || ['not rendered']; break; }
          value = Math.max(value ?? 0, anchorOnly ? result.highlightAnchor?.value ?? result.metrics.exactPeak : result.metrics.exactPeak);
        }
        slice = null;
        // The finished peak is compressed against the anchor, so give it the full-size one.
        if (anchorOnly && value !== null) {
          const ranked = await rank.call(renderer, state.session.session_id, lane, JSON.parse(JSON.stringify(state.adjustments)),
            sampleCurvePoints, JSON.parse(JSON.stringify(localAdjustments())), state.editRevision, white,
            { width: state.session.source.width, height: state.session.source.height }, mine);
          if (ranked?.anchor) renderer.peakReductionCache.set(ranked.anchor.key, value);
        }
      }
      report[name] = { nits: nits(value), ms: performance.now() - started, refusals, metrics,
        patches: Object.fromEntries(rows.filter((row) => row.peak !== null).map((row) => [row.key, nits(row.peak)])) };
    }
    return report;
  } finally {
    renderer.rankEditingPeakCandidates = rank; renderer.renderTiledTo = tiled; renderer.roiSourceHalo = haloOf;
    renderer.measurementClaritySurround = surround;
  }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = { ...c.manifest(project), limit, status: 'running' };
  try {
    await c.open(page, project, false);
    report.sessionEdits = pairs(opt('--set', ''));
    if (report.sessionEdits.length) {
      await page.evaluate(async (edits) => {
        for (const edit of edits) commitAdjustmentValue(edit.path, edit.value, { manual: true });
        await settlePreview('hdr', {});
      }, report.sessionEdits);
      await c.stable(page);
    }
    report.localEdits = pairs(opt('--local-set', ''));
    if (report.localEdits.length) {
      await page.evaluate(async ({ edits, type }) => {
        const local = structuredClone(localAdjustments().find((item) => item.mask?.leaf?.type === type));
        if (!local) throw new Error(`--local-set requires a ${type} local`);
        for (const edit of edits) {
          const parts = edit.path.split('.');
          let target = local.hdr_grade;
          for (const part of parts.slice(0, -1)) target = target[part];
          target[parts.at(-1)] = edit.value;
        }
        if (!await queueEditCommand('update_local', { local }, local.id)) throw new Error('Local edit failed');
        await settlePreview('hdr', {});
      }, { edits: report.localEdits, type: opt('--local-type', 'brush') });
      await c.stable(page);
    }
    await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0
      && exactScopePeakInflight.size === 0, null, { timeout: 180000 });
    report.surround = await page.evaluate(`(${measure.toString()})(false)`);
    report.reference = await page.evaluate(`(${measure.toString()})(true)`);
    report.projectUnchanged = c.manifest(project).projectSha256 === report.projectSha256;
    const failures = [];
    if (!report.surround.peak.metrics?.claritySurround) failures.push('the measurement did not use the reduced render; nothing to compare');
    report.comparison = {};
    for (const name of ['anchor', 'peak']) {
      const measured = report.surround[name], reference = report.reference[name];
      if (measured.refusals || reference.refusals) { failures.push(`${name}: ${JSON.stringify(measured.refusals || reference.refusals)}`); continue; }
      const keys = Object.keys(measured.patches).filter((key) => reference.patches[key]);
      const errors = keys.map((key) => Math.abs(measured.patches[key] / reference.patches[key] - 1));
      const worst = Math.max(0, ...errors);
      report.comparison[name] = { patches: keys.length, worst, mean: errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length),
        overall: Math.abs(measured.nits / reference.nits - 1), measuredNits: measured.nits, referenceNits: reference.nits };
      if (keys.length < 16) failures.push(`${name}: only ${keys.length} of 16 patches were paired`);
      if (worst > limit) failures.push(`${name}: worst patch differs by ${(worst * 100).toFixed(3)}% (limit ${(limit * 100).toFixed(2)}%)`);
    }
    if (!report.projectUnchanged) failures.push('the project file changed');
    report.failures = failures;
    report.status = failures.length ? 'failed' : 'passed';
    c.write(output, report);
    console.log(JSON.stringify({ status: report.status, comparison: report.comparison, fullHalo: report.reference.fullHalo,
      surroundMs: [report.surround.anchor.ms, report.surround.peak.ms].map(Math.round), failures }));
    if (failures.length) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
