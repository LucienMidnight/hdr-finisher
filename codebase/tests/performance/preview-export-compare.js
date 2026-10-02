/**
 * Preview-versus-export comparison (Viewport-Bounded GPU Preview PRD, 4.6).
 *
 *   $env:HDR_FINISHER_ELECTRON_WINDOW_SIZE = "2560x1440"
 *   node tests/run-in-electron.js tests/performance/preview-export-compare.js \
 *     --project <file.hdrfinisher> --output output/performance/review/<run>/compare.json
 *
 * Opens the project in a disposable session (never saves), shows it at 100%,
 * and for each lane and region reads back the retained presentation target as
 * float. The capture and the page's edit document go to
 * preview_export_compare.py, which renders the same document through the
 * export pipeline before encoding and reports the PRD 4.1-4.3 statistics.
 *
 * Masks: the preview side of a mask is read back from the renderer itself
 * (readLocalMaskRegion): the value each local pass sampled for the frame on
 * screen, before opacity, whether the mask came from the backend or was made
 * on the GPU. It is read on the route the app chose and, when the tiled route
 * has to be forced for the picture readback, on that route too.
 *
 * Options: --lanes hdr,sdr   --zoom 100   --regions id:x:y,id:x:y (centre of
 * each region as a fraction of the image)   --enforce (exit non-zero when a
 * section 4 limit is exceeded).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');

const ROOT = path.join(__dirname, '..', '..');
const STRIP_ROWS = 192;
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/preview-export-compare.json'));
const lanes = opt('--lanes', 'hdr,sdr').split(',').filter(Boolean);
const zoom = Number(opt('--zoom', 100));
const regions = opt('--regions', 'center:0.5:0.5,upper-left:0.25:0.25,lower-right:0.75:0.75')
  .split(',').map((entry) => { const [id, x, y] = entry.split(':'); return { id, x: Number(x), y: Number(y) }; });
const enforce = args.includes('--enforce');

function pythonExecutable() {
  if (process.env.HDR_FINISHER_PYTHON) return process.env.HDR_FINISHER_PYTHON;
  const candidate = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(candidate) ? candidate : 'python';
}

async function main() {
  const work = path.join(path.dirname(output), `${path.basename(output, '.json')}-files`);
  fs.mkdirSync(work, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const report = { ...c.manifest(project), zoom, status: 'running', errors: [] };
  page.on('pageerror', (error) => report.errors.push(String(error)));

  // The picture is only final once the automatic highlight anchors have been
  // measured; until then the shoulder is provisional and would be compared
  // against an export that measures for itself.
  const settled = async () => {
    await c.stable(page);
    await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0,
      null, { timeout: 180000 });
    await page.waitForTimeout(250);
    await c.stable(page);
    // A magnified view is drawn for its region: wait for the pan pass that
    // draws a newly exposed region and for the rest of the frame to catch up.
    await page.waitForFunction(() => {
      const coordinator = state.renderCoordinator;
      const lane = state.currentView;
      return !coordinator || (!coordinator.panPending(lane) && !coordinator.catchUpPending(lane)
        && !coordinator.state(lane).inFlight && !coordinator.state(lane).pending && !state.gpuDraftInFlight);
    }, null, { timeout: 180000, polling: 100 });
    await c.stable(page);
  };

  const manifest = { project, lanes: [] };
  try {
    await c.open(page, project, false);
    report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
    // In-session edits for isolating a module (never saved), e.g.
    //   --set hdr.film_look.grain_amount=0,sdr.film_look.grain_amount=0
    report.sessionEdits = opt('--set', '').split(',').filter(Boolean).map((entry) => {
      const [controlPath, raw] = entry.split('=');
      let value = raw;
      try { value = JSON.parse(raw); } catch { /* a bare string value */ }
      return { path: controlPath, value };
    });
    if (report.sessionEdits.length) {
      await page.evaluate(async (edits) => {
        for (const edit of edits) commitAdjustmentValue(edit.path, edit.value, { manual: true });
        await settlePreview(state.currentView, {});
      }, report.sessionEdits);
      await settled();
    }
    manifest.document = await page.evaluate(() => ({
      ...structuredClone(state.editDocument),
      global_adjustments: structuredClone(state.adjustments),
      local_adjustments: structuredClone(localAdjustments()),
    }));

    for (const lane of lanes) {
      await page.evaluate((target) => switchLane(target), lane);
      await settled();
      await page.evaluate((percent) => setCustomZoom(percent), zoom);
      await settled();
      // Only the tiled route retains a target that can be read back, so the
      // capture is taken on it through the app's own diagnostic switch. The
      // route the app chose by itself is recorded beside it; Direct-versus-
      // Tiled agreement is the existing tiled-direct-parity suite's subject.
      const chosen = await page.evaluate(() => ({
        execution: state.acceptedPresentation?.execution ?? null,
        processedLongEdge: state.acceptedPresentation?.processedLongEdge ?? null,
        processingScale: state.gpuPreview?.lastPresentedFrame
          ? state.gpuPreview.sourcePixelScaleFor(state.gpuPreview.lastPresentedFrame, state.session.source) : null,
      }));
      // A target left valid by an earlier tiled frame says nothing about the
      // frame on screen now, so the accepted frame's own route decides.
      const forced = chosen.execution !== 'tiled';
      const laneCapture = { lane, routeChosenByApp: chosen, capturedOn: forced ? 'tiled (forced for readback)' : 'route chosen by the app', regions: [] };

      const scrollTo = async (region) => {
        await page.evaluate(({ x, y }) => {
          const box = els.previewCanvas.getBoundingClientRect();
          const pane = els.dropzone.getBoundingClientRect();
          els.dropzone.scrollLeft += (box.left + x * box.width) - (pane.left + els.dropzone.clientWidth / 2);
          els.dropzone.scrollTop += (box.top + y * box.height) - (pane.top + els.dropzone.clientHeight / 2);
        }, region);
        await page.waitForTimeout(400);
        await settled();
        await page.evaluate(async () => { await state.gpuPreview.waitForSubmittedWork?.(); });
      };
      // Each active local's mask as the frame on screen sampled it, for `rect`.
      const captureMasks = async (regionId, rect, route) => {
        const locals = await page.evaluate((target) => localAdjustments()
          .filter((local) => local.enabled !== false && local.opacity > 0 && local[`${target}_grade`]?.enabled !== false)
          .map((local) => ({ localId: local.id, name: local.name, leafType: local.mask?.leaf?.type || local.mask?.operator })), lane);
        const masks = [];
        for (const local of locals) {
          const read = await page.evaluate(async ({ localId, rect }) => {
            const result = await state.gpuPreview.readLocalMaskRegion(localId, rect.x, rect.y, rect.width, rect.height);
            if (result.error) return { error: result.error };
            const bytes = new Uint8Array(result.values.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return { base64: btoa(binary), x: result.x, y: result.y, width: result.width, height: result.height,
              execution: result.execution, lane: result.lane, sources: result.sources,
              coveredPixels: result.coveredPixels, missingPieces: result.missingPieces };
          }, { localId: local.localId, rect });
          if (read.error) { masks.push({ ...local, route, previewSource: 'renderer readback', reason: read.error }); continue; }
          if (read.lane !== lane || read.x !== rect.x || read.y !== rect.y || read.width !== rect.width || read.height !== rect.height
            || read.coveredPixels !== rect.width * rect.height) {
            masks.push({ ...local, route: read.execution, previewSource: `renderer readback (${read.sources.join(', ')})`,
              reason: `the readback does not cover the region: ${read.coveredPixels} of ${rect.width * rect.height} pixels, ${read.missingPieces} piece(s) no longer resident, lane ${read.lane}` });
            continue;
          }
          const name = `${lane}-${regionId}-${route}-mask-${local.localId}.f32`;
          fs.writeFileSync(path.join(work, name), Buffer.from(read.base64, 'base64'));
          masks.push({ ...local, route: read.execution, previewSource: `renderer readback (${read.sources.join(', ')})`, file: name });
        }
        return masks;
      };
      const visibleRect = () => page.evaluate(() => visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height)
        || { x: 0, y: 0, width: els.previewCanvas.width, height: els.previewCanvas.height });

      if (forced) {
        // The masks of the route the app chose by itself, before it is replaced.
        laneCapture.chosenRouteRegions = [];
        for (const region of regions) {
          await scrollTo(region);
          const rect = await visibleRect();
          laneCapture.chosenRouteRegions.push({ id: region.id, rect, masks: await captureMasks(region.id, rect, chosen.execution || 'chosen') });
        }
        await page.evaluate(() => applyExecutionOverride('tiled'));
        await page.waitForFunction((target) => state.acceptedPresentation?.execution === 'tiled'
          && state.acceptedPresentation.lane === target, lane, { timeout: 180000 });
        await settled();
      }

      for (const region of regions) {
        await scrollTo(region);

        const frame = await page.evaluate(() => {
          const target = state.gpuPreview.presentationTarget;
          if (!target?.valid || !target.texture) throw new Error('No retained presentation target to read back.');
          if (gpuLumaMaskOverlayOptions()) throw new Error('A mask overlay is drawn into the preview; the capture would not be the picture.');
          const visible = visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height)
            || { x: 0, y: 0, width: target.width, height: target.height };
          const accepted = state.acceptedPresentation;
          return {
            target: { width: target.width, height: target.height, format: String(target.format) },
            canvas: { width: els.previewCanvas.width, height: els.previewCanvas.height },
            visible,
            accepted: accepted && {
              exact: accepted.exact, processedLongEdge: accepted.processedLongEdge, execution: accepted.execution,
              transport: accepted.transport, generation: accepted.generation, lane: accepted.lane,
            },
            requiredLongEdge: requiredProcessingLongEdge(),
            zoomPercent: state.zoomPercent,
            editRevision: state.editRevision,
            referenceWhiteNits: projectReferenceWhiteNits(),
            hdrDisplay: matchMedia('(dynamic-range: high)').matches,
          };
        });
        if (frame.accepted?.execution !== 'tiled' || frame.accepted.lane !== lane || !frame.accepted.exact) {
          throw new Error(`The frame on screen is not a readable exact ${lane} frame: ${JSON.stringify(frame.accepted)}`);
        }
        if (frame.target.width !== frame.canvas.width || frame.target.height !== frame.canvas.height) {
          throw new Error(`Presentation target ${JSON.stringify(frame.target)} is not the canvas ${JSON.stringify(frame.canvas)}`);
        }
        const float16 = frame.target.format.includes('16float');
        const readbackName = `${lane}-${region.id}.f32`;
        const handle = fs.openSync(path.join(work, readbackName), 'w');
        try {
          for (let row = 0; row < frame.visible.height; row += STRIP_ROWS) {
            const rows = Math.min(STRIP_ROWS, frame.visible.height - row);
            const base64 = await page.evaluate(async ({ rect, row, rows, reorder }) => {
              const strip = await state.gpuPreview.readPresentationRegion(rect.width, rows, rect.x, rect.y + row);
              if (!strip?.values || strip.width !== rect.width || strip.height !== rows) throw new Error(`Readback failed at row ${row}`);
              const values = Float32Array.from(strip.values);
              // An 8-bit canvas target is bgra8unorm and the readback does not reorder.
              if (reorder) for (let i = 0; i < values.length; i += 4) { const blue = values[i]; values[i] = values[i + 2]; values[i + 2] = blue; }
              const bytes = new Uint8Array(values.buffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
              return btoa(binary);
            }, { rect: frame.visible, row, rows, reorder: !float16 });
            fs.writeSync(handle, Buffer.from(base64, 'base64'));
          }
        } finally { fs.closeSync(handle); }

        const masks = await captureMasks(region.id, frame.visible, 'tiled');

        laneCapture.target = frame.target;
        laneCapture.hdrSurface = lane === 'hdr' && float16;
        laneCapture.referenceWhiteNits = frame.referenceWhiteNits;
        laneCapture.regions.push({ id: region.id, anchor: { x: region.x, y: region.y }, rect: frame.visible,
          readback: readbackName, accepted: frame.accepted, requiredLongEdge: frame.requiredLongEdge,
          zoomPercent: frame.zoomPercent, hdrDisplay: frame.hdrDisplay, masks });
        console.log(lane, region.id, JSON.stringify(frame.visible), frame.target.format, JSON.stringify(frame.accepted));
      }

      if (lane === 'hdr') {
        laneCapture.peak = await page.evaluate(() => {
          const cached = exactScopePeakCache.get(exactScopePeakKey('hdr')) || null;
          const stat = [...document.querySelectorAll('#scope-stats dt')]
            .map((term) => ({ label: term.textContent.trim(), value: term.nextElementSibling?.textContent.trim() || '' }))
            .find((row) => /^Peak/.test(row.label)) || null;
          const displayed = stat ? Number.parseFloat(stat.value.replace(/,/g, '')) : NaN;
          return {
            reportedNits: Number.isFinite(cached?.peak) ? cached.peak / 0.18 * projectReferenceWhiteNits()
              : Number.isFinite(displayed) ? displayed : null,
            source: Number.isFinite(cached?.peak) ? 'bounded editing peak cache for the current edit state'
              : Number.isFinite(displayed) ? 'the Peak figure shown in the scope panel' : 'none available',
            exact: cached?.exact ?? null,
            measuredLongEdge: cached?.longEdge ?? null,
            displayedStat: stat,
          };
        });
      }
      if (forced) await page.evaluate(() => applyExecutionOverride(null));
      await page.locator('#zoom-fit').click();
      await settled();
      manifest.lanes.push(laneCapture);
    }

    const manifestPath = path.join(work, 'capture.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const comparePath = path.join(work, 'comparison.json');
    let enforceFailed = false;
    try {
      execFileSync(pythonExecutable(), [
        path.join(__dirname, 'preview_export_compare.py'), '--manifest', manifestPath, '--out', comparePath,
        ...(enforce ? ['--enforce'] : []),
      ], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    } catch (error) {
      if (!enforce || !fs.existsSync(comparePath)) throw error;
      enforceFailed = true;
    }
    report.comparison = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
    report.projectUnchanged = c.manifest(project).projectSha256 === report.projectSha256;
    report.status = enforceFailed ? 'limits-exceeded' : 'complete';
    if (enforceFailed || !report.projectUnchanged) process.exitCode = 1;
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error.stack || error);
    throw error;
  } finally {
    c.write(output, report);
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
