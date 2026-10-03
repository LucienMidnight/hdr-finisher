/** Native-pointer representative drag coverage. Disposable session, never saves. */
const path = require('path');
const { chromium } = require('playwright');
const c = require('./heavy-project-review-common');
const args = process.argv.slice(2);
const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const project = path.resolve(opt('--project', ''));
const output = path.resolve(opt('--output', 'output/performance/review/drag-review.json'));
const count = Number(opt('--samples', 10));
const only = new RegExp(opt('--only', '.*'));
const native = args.includes('--native');
const paths = ['exposure', 'contrast_pivot', 'lift', 'lift_range', 'saturation', 'white_balance_kelvin',
  'color_grading.blending', 'black_and_white.reds', 'vignette.amount', 'vignette.feather',
  'film_look.look_strength', 'film_look.red_response', 'detail.clarity_amount', 'detail.microcontrast',
  'film_look.halation_radius', 'film_look.bloom_radius', 'film_look.grain_amount',
  'highlight_compression_softness', 'highlight_compression_peak_detail'];
const percentile = (v, q) => { const s = v.filter(Number.isFinite).sort((a,b) => a-b); return s[Math.max(0,Math.ceil(s.length*q)-1)] ?? null; };
async function selectLocal(page, type) {
  await page.evaluate(t => { const local = state.editDocument.local_adjustments.find(x => x.mask?.leaf?.type === t); if (!local) throw Error(`No ${t}`); state.selectedLocalId = local.id; renderLocalAdjustments(); }, type);
  if (await page.locator('#grade-mode-local').getAttribute('aria-expanded') !== 'true') await page.locator('#grade-mode-local').click();
}
async function canvasDrag(page, kind, direction) {
  const lane = await page.evaluate(() => state.currentView);
  const selector = kind === 'curve' ? '#curve-editor' : lane === 'hdr' ? '#tone-equalizer-editor' : '#sdr-tone-equalizer-editor';
  await c.reveal(page, selector); await c.stable(page);
  const point = await page.evaluate(k => {
    if (k === 'curve') return curvePointCanvasPosition(currentCurveValues()[2]);
    const n = currentToneEqualizerNodes(state.currentView); const x = n[Math.floor(n.length / 2)]; return toneEqualizerCanvasPosition(x.input_ev, x.adjustment_ev);
  }, kind);
  const box = await page.locator(selector).boundingBox(); const b = await c.mark(page);
  await page.mouse.move(box.x + point.x, box.y + point.y); await page.mouse.down();
  try { for (let i=1;i<=12;i++) { await page.mouse.move(box.x + point.x + (kind==='band-position' ? direction*12*i/12 : 0), box.y + point.y - (kind==='band-position' ? 0 : direction * 12 * i / 12)); await page.waitForTimeout(500/12); } }
  finally { await page.mouse.up(); }
  const released = await page.evaluate(b => __review.pointers.slice(b.t).filter(x => x.kind === 'pointerup').at(-1)?.at || performance.now(), b);
  if (!await page.evaluate(b=>__review.edits.slice(b.e).some(x=>x.lane===state.currentView),b)) throw Error(`Canvas pointer missed editable node: ${kind}`);
  await page.waitForFunction(at => __review.settledScopes.some(x=>x.at>=at && x.lane===state.currentView && x.applicationGeneration===state.previewGeneration[state.currentView]),released,{timeout:180000});
  await c.stable(page); const r = await c.result(page,b,released);
  if (!r.trustedPointers || !r.editCount || !r.framesDuringDrag && !r.framesAfterRelease) throw Error('Canvas drag produced no measured change and preview');
  return r;
}
async function padDrag(page,kind,direction){
  const selector=kind==='wheel'?'[data-wheel="highlights"] .color-wheel-pad':'#vignette-center-handle';
  await c.reveal(page,kind==='wheel'?selector:'input[data-path="current.vignette.amount"]');
  await c.stable(page);
  const box=await page.locator(kind==='wheel'?'[data-wheel="highlights"] .color-wheel-puck':selector).boundingBox();
  if(!box)throw Error(`Hidden ${selector}`);
  const b=await c.mark(page); const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  try{for(let i=1;i<=12;i++){await page.mouse.move(x+direction*6*i/12,y+direction*3*i/12);await page.waitForTimeout(500/12);}}
  finally{await page.mouse.up();}
  const released=await page.evaluate(b=>__review.pointers.slice(b.t).filter(x=>x.kind==='pointerup').at(-1)?.at||performance.now(),b);
  await page.waitForFunction(at=>__review.settledScopes.some(x=>x.at>=at&&x.lane===state.currentView&&x.applicationGeneration===state.previewGeneration[state.currentView]),released,{timeout:180000});
  await c.stable(page);const r=await c.result(page,b,released);if(!r.trustedPointers||!r.editCount)throw Error(`No pad edit ${kind}`);return r;
}
async function main() {
  const report = { ...c.manifest(project), schemaVersion: 1, sampleCount: count, methodology: '12 native pointer moves over nominal 500 ms; actual duration retained. Control fine mode for enhanced rails; native-thumb movement for overlaid luma rails. Preparation excluded; manual highlight anchors isolate controls; Color and Color Grading activated outside clock. First sample is first interaction in that row, NOT guaranteed cold cache; later samples alternate direction. Application presentation event/rAF observations, not physical scanout timings.', rows: [], errors: [] };
  report.zoomPolicy = native ? '100% native; zoom preparation excluded' : 'Fit';
  const browser = await chromium.launch({headless:false}); const page = await browser.newPage({viewport:{width:2560,height:1440}});
  report.displayContext=JSON.parse(process.env.HDR_FINISHER_REVIEW_DISPLAY_CONTEXT||'null');
  report.actualViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio}));
  const requests = c.networkProbe(page); page.on('pageerror',e => report.errors.push(String(e)));
  async function row(name, action) {
    if (!only.test(name)) return;
    const observations = []; const entry = {name, observations, recipe:await page.evaluate(()=>({lane:state.currentView,adjustments:structuredClone(state.adjustments[state.currentView]),denoise:structuredClone(state.denoise[state.currentView])}))}; report.rows.push(entry);
    for (let i=0;i<count;i++) { const n=requests.length; const r=await action(i%2 ? -1 : 1); r.requests=requests.slice(n); observations.push(r); c.write(output,report); }
    entry.summary = Object.fromEntries(['inputToFirstFrameMs','releaseToExactMs','releaseToScopesMs','releaseToScopeCallbackCompleteMs','releaseToObservedStableMs'].map(k=>[k,{medianMs:percentile(observations.map(x=>x[k]),.5),p95Ms:percentile(observations.map(x=>x[k]),.95),maximumMs:Math.max(...observations.map(x=>x[k]).filter(Number.isFinite))}]));
    c.write(output,report); console.log(name, JSON.stringify(entry.summary));
  }
  try {
    await c.open(page,project,true);
    if (native) { await page.locator('#zoom-actual').click(); await c.stable(page); }
    for (const lane of ['hdr','sdr']) {
      await page.evaluate(x=>switchLane(x),lane); await c.stable(page);
      // The mature fixture bypasses Color and Color Grading. Activate these
      // outside the clock so their drags measure processing, not bypassed work.
      await page.evaluate(()=>{ for(const key of ['color_section_enabled','color_grading_section_enabled'])commitAdjustmentValue(`current.${key}`,true,{manual:true}); }); await c.stable(page);
      for (const p of paths) {
        if (p.startsWith('highlight_compression_')) { await page.evaluate(p => commitAdjustmentValue('current.highlight_compression_mode', p.endsWith('softness') ? 'soft_ceiling' : 'peak_fit', {manual:true}), p); await c.stable(page); }
        const selector=`current.${p}`;
        await row(`${lane}: ${p}`, d=>c.drag(page,selector,d));
      }
      await row(`${lane}: curve luma node`,d=>canvasDrag(page,'curve',d));
      await c.reveal(page,'#curve-editor');
      await page.locator('[data-curve-channel="red"]').click();
      await row(`${lane}: curve red node`,d=>canvasDrag(page,'curve',d));
      await page.locator('[data-curve-channel="luma"]').click();
      await row(`${lane}: exposure-band node`,d=>canvasDrag(page,'band',d));
      await row(`${lane}: exposure-band node position`,d=>canvasDrag(page,'band-position',d));
      if(lane==='hdr')await row('hdr: exposure-band smoothing',d=>c.drag(page,'current.tone_equalizer_smoothing',d));
      await row(`${lane}: color-wheel pad`,d=>padDrag(page,'wheel',d));
      await row(`${lane}: vignette center handle`,d=>padDrag(page,'vignette',d));
      await selectLocal(page,'brush');
      for (const selector of ['#local-exposure','#local-opacity','input[data-local-mask-param="mask_feather"]','input[data-local-mask-param="mask_shift_edge"]'])
        await row(`${lane}: brush ${selector}`,d=>c.drag(page,selector,d));
      await selectLocal(page,'linear_gradient');
      await row(`${lane}: gradient fan`,d=>c.drag(page,'input[data-local-mask-param="gradient_fan"]',d));
      await selectLocal(page,'luminance_range');
      await row(`${lane}: luma reference upper rail`,d=>c.drag(page,'.luma-reference-range input[data-range-handle="1"]',d));
      await row(`${lane}: luma refined upper rail`,d=>c.drag(page,'.luma-refine-range input[data-range-handle="1"]',d));
      await page.locator('#grade-mode-local').click();
      await page.evaluate(async()=>{ if(!state.denoise[state.currentView].enabled) await setDenoiseEnabled(true); }); await c.stable(page);
      await row(`${lane}: denoise amount`,d=>c.drag(page,'#denoise-amount',d));
      await page.evaluate(()=>setDenoiseEnabled(false)); await c.stable(page);
    }
    await page.evaluate(()=>switchLane('hdr')); await c.stable(page);
    await row('shared: straighten drag and Apply',async d=>{ await c.reveal(page,'#rotate-tool-toggle'); await page.locator('#rotate-tool-toggle').click(); return c.drag(page,'#crop-straighten',d,500,{apply:'#rotate-apply'}); });
    await row('shared: perspective horizontal drag and Apply',d=>c.drag(page,'#perspective-horizontal',d,500,{apply:'#perspective-apply'}));
    if(!report.rows.length)throw Error('No rows matched --only');
    report.completedAt=new Date().toISOString(); report.status='complete';
  } catch(e) { report.status='failed'; report.failure=String(e.stack||e); report.diagnostic=await page.evaluate(()=>({viewer:viewerState(),accepted:state.acceptedPresentation,refusal:state.lastGpuDraftRefusal,curve:currentCurveValues(),channel:state.selectedCurveChannel,edits:__review.edits.slice(-16),pointers:__review.pointers.slice(-16),scopeCallbacks:__review.settledScopes.slice(-8),scheduler:state.previewScheduler.snapshot?.()})).catch(()=>null); throw e; }
  finally { c.write(output,report); await browser.close(); }
}
module.exports={selectLocal,canvasDrag};
if (require.main === module || process.argv[1] === __filename) main().catch(e=>{console.error(e);process.exitCode=1;});
