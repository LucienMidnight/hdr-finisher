/** Phase 2: editing measurement cannot request native sources or native masks.
 * Run through run-in-electron.js with --project <read-only fixture>
 * and optionally --reference-nits <exact CPU peak> --output <report.json>.
 */
const fs = require('fs'), path = require('path');
const {chromium} = require('playwright');
const common = require('./performance/heavy-project-review-common');
const args = process.argv.slice(2), opt = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
(async () => {
  const browser = await chromium.launch({headless:false}), page = await browser.newPage();
  try {
    await common.open(page, path.resolve(opt('--project')), false);
    await page.waitForFunction(() => pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0 && exactScopePeakInflight.size === 0, null, {timeout:180000});
    const result = await page.evaluate(async () => {
      const renderer = state.gpuPreview, proxy = renderer.loadProxy, mask = renderer.loadLocalMask, region = renderer.loadProxyRegion, leaf = renderer.loadCpuLeafAt;
      const before = JSON.stringify(state.acceptedPresentation), dimensions = [els.previewCanvas.width, els.previewCanvas.height];
      const frame = renderer.lastPresentedFrame, maskRecord = renderer.frameMaskRecord, placeholder = renderer.placeholderSource;
      const requests = [], samples = [];
      renderer.loadProxy = function(...args) { if (args[2] > 1600) throw Error('Native whole-source measurement request'); requests.push({sourceEdge:args[2]}); return proxy.apply(this,args); };
      renderer.loadLocalMask = function(...args) { if (args[2] > 1600) throw Error('Native mask measurement request'); requests.push({maskEdge:args[2]}); return mask.apply(this,args); };
      renderer.loadProxyRegion = function(...args) {const rect=args[7]; if (rect.width*rect.height > 4*1024*1024) throw Error('Patch budget exceeded'); requests.push({region:rect}); return region.apply(this,args);};
      renderer.loadCpuLeafAt = async function(...args) {
        if (args[4] > 3200) throw Error('Native whole-mask measurement request');
        const entry = await leaf.apply(this, args);
        if (entry && entry.width * entry.height > 4*1024*1024) throw Error('Editing mask pixel budget exceeded');
        requests.push({leafEdge:args[4], pixels:entry ? entry.width*entry.height : null});
        return entry;
      };
      try {
        for (const [lane, robust] of [['hdr',false], ['sdr',false], ['hdr',true], ['sdr',true]]) {
          const adjustments = structuredClone(state.adjustments);
          if (robust) {adjustments[lane].highlight_section_enabled=true; adjustments[lane].highlight_compression_mode='peak_fit'; adjustments[lane].highlight_compression_peak_measurement='robust';}
          const started=performance.now();
          const measured = await renderer.measureEditingPeak(els.previewCanvas,state.session.session_id,lane,adjustments,sampleCurvePoints,structuredClone(localAdjustments()),state.editRevision,projectReferenceWhiteNits(),state.session.source,{isCurrent:()=>true,highlightAnchorOnly:robust});
          if (robust ? !Number.isFinite(measured?.highlightAnchor?.value) : !measured?.rendered) throw Error(`${lane} ${robust ? 'robust' : 'maximum'} measurement failed: ${JSON.stringify(measured)}`);
          if (measured?.metrics?.processedBound > 4*1024*1024) throw Error('Total source patch budget exceeded');
          samples.push({lane,robust, measured,durationMs:performance.now()-started,nits:measured?.metrics?.exactPeak/.18*projectReferenceWhiteNits()});
        }
        if (JSON.stringify(state.acceptedPresentation)!==before || els.previewCanvas.width!==dimensions[0] || els.previewCanvas.height!==dimensions[1]) throw Error('Measurement disturbed the visible frame');
        if (renderer.lastPresentedFrame !== frame || renderer.frameMaskRecord !== maskRecord || renderer.placeholderSource !== placeholder) throw Error('Measurement replaced visible frame resources');
        return {samples, requests};
      } finally {renderer.loadProxy=proxy;renderer.loadLocalMask=mask;renderer.loadProxyRegion=region;renderer.loadCpuLeafAt=leaf;}
    });
    const reference = Number(opt('--reference-nits',NaN));
    if (Number.isFinite(reference)) {
      result.relativeError = Math.abs(result.samples[0].nits/reference-1);
      if (result.relativeError > .01) throw Error(`Peak error ${result.relativeError*100}% exceeds 1%`);
    }
    const output = opt('--output'); if (output) fs.writeFileSync(output, JSON.stringify(result,null,2));
    console.log(JSON.stringify(result.samples));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
