/* Release diagnostic; run through run-in-electron.js under the shared GPU lock.
 * --batch <data-group> limits each lock acquisition; --list only inventories.
 * Never saves a project. Pixel observations are screen signatures, not export parity.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const out = path.resolve(opt('--output', 'output/performance/grade-0-9-2'));
const batch = opt('--batch', 'hdr-tone');
const samples = Number(opt('--samples', '3'));
const only = new RegExp(opt('--only', '.*'));
const controlName = c => c.path || c.data.sectionPath || c.id || (c.data.localGrade ? `local.${c.data.localGrade}`
  : c.data.localMaskParam ? `mask.${c.data.localMaskParam}` : c.data.hslKey ? `${c.group === 'local-adjustments' ? 'local.hsl' : 'hsl'}.${c.data.hslKey}`
    : `mask.range.${c.label || 'handle'}.${c.data.rangeHandle}`);
const startedAt = Date.now();
const report = { date: new Date().toISOString(), batch, samples, rows: [], errors: [],
  latencyContract:'On-screen exact current generation after automatic anchors; background catch-up drain recorded separately',
  referenceContract:'Reference steps measure on-screen settlement; actual control observations additionally drain background work before sampling their pixels',
  commit: require('child_process').execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
  driverSha256:require('crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  methodology: 'Normal input/change handlers to exact current-generation presentation plus two animation frames; texture readback after clock. Nine 32px patches diagnose changes, not whole-picture or export agreement. Reference Exposure steps are restored between trials. Native-pointer drag presentation events are throughput observations, not physical scanout.' };
const network=[];
fs.mkdirSync(out, { recursive: true });
const spentBeforeMs = fs.readdirSync(out).filter(n=>n.endsWith('.json') && (!args.includes('--followup') || n.startsWith('w10-'))).reduce((total,name)=> {
  try { const file=path.join(out,name), data=JSON.parse(fs.readFileSync(file,'utf8'));
    return total+(data?.date && Array.isArray(data.rows) ? Math.max(0,(data.completedAt ? Date.parse(data.completedAt) : fs.statSync(file).mtimeMs)-Date.parse(data.date)) : 0);
  } catch { return total; }
},0);
// Leave ten minutes for Electron launches and early overwritten diagnostic attempts.
const measurementLimitMs = (args.includes('--followup') ? 85 : 110)*60000;
report.budget={spentBeforeMs,measurementLimitMs,allowance:args.includes('--followup') ? 'W10: 85 measurement minutes plus 5 launch minutes within 90-minute cap' : 'W1: 110 measurement minutes plus 10 launch minutes'};
const budgetExceeded=()=>spentBeforeMs+Date.now()-startedAt>=measurementLimitMs;
const save = () => fs.writeFileSync(path.join(out, `${path.basename(opt('--label', batch))}.json`), JSON.stringify(report, null, 2));
async function signature(page) {
  const texture = await page.evaluate(() => window.__gradeSignature());
  if (texture !== null) return `texture:${texture}`;
  const bytes = await page.locator('#preview-canvas').screenshot({ timeout: 15000 });
  return `compositor:${require('crypto').createHash('sha256').update(bytes).digest('hex')}`;
}
async function stable(page,drainBackground=true) {
  await page.waitForFunction(drainBackground => {
    const lane = state.currentView, a = state.acceptedPresentation;
    const coordinator = state.renderCoordinator?.state(lane);
    return !state.importInProgress && viewerState().status === 'ready' && a?.lane === lane
      && a.generation === state.previewGeneration[lane] && a.exact
      && a.processedLongEdge === requiredProcessingLongEdge()
      && !state.gpuDraftInFlight && !state.globalEditSyncPending
      && !state.denoiseInputQueue?.running
      && !['preparing','recalculating'].includes(state.denoiseRuntime?.[lane]?.status)
      && (typeof retouchUI === 'undefined' || !retouchUI.busy)
      && (typeof pendingHighlightAnchors === 'undefined' || !pendingHighlightAnchors.size)
      && (drainBackground ? !coordinator?.inFlight && !coordinator?.pending
        && !coordinator?.panTimerPending && !coordinator?.catchUpTimerPending
        : coordinator?.inFlight?.priority !== 'foreground' && coordinator?.pending?.priority !== 'foreground')
      && !state.zoomRefinementTimer
      && (typeof exactHighlightAnchorInflight === 'undefined' || !exactHighlightAnchorInflight.size);
  }, drainBackground, { timeout: 45000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function change(page, selector, value, reset = false, capture = true) {
  const networkStart=network.length;
  const priorImport=await page.evaluate(()=>state.importGeneration);
  const start = await page.evaluate(({ selector, value, reset }) => {
    const c = document.querySelector(selector);
    const t = performance.now();
    window.__gradeAnchorProfile = [];
    if(selector==='#film-push_pull') document.querySelector(`[data-film-push="${Math.round(Number(value))}"]`)?.click();
    else if (c.tagName === 'BUTTON') { if(window.__gradeValue(c)!==value) c.click(); }
    else if (reset && c.type === 'range') c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    else {
      if (c.type === 'checkbox') c.checked = value;
      else c.value = String(value);
      c.dispatchEvent(new Event('input', { bubbles: true }));
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (selector.startsWith('#retouch-')) applySelectedRetouch(false);
    return { t, generation: state.previewGeneration[state.currentView] };
  }, { selector, value, reset });
  if(batch==='raw-highlights' && selector.startsWith('#raw-')) await page.waitForFunction(g=>state.importGeneration>g && !state.importInProgress,priorImport,{timeout:120000});
  await stable(page,false);
  const visibleMs=await page.evaluate(t=>performance.now()-t,start.t);
  if(capture) await stable(page);
  const result = await page.evaluate(async ({ t, selector, capture, profile }) => {
    const c = document.querySelector(selector);
    const ended = performance.now();
    const gpu=(capture || profile) ? window.HDRFinisherPerformance.gpuSnapshot() : null;
    return { startedAt: profile ? t : undefined, ms: ended - t, value: window.__gradeValue(c),
      stored: c.dataset.path || c.dataset.sectionPath ? getValueByPath(state.adjustments, c.dataset.path || c.dataset.sectionPath) : null,
      gpu:gpu ? {renders:gpu.renders?.slice(-4),stages:gpu.stages?.slice(-16),allocator:gpu.resources?.memory?.allocator,refusal:state.lastGpuDraftRefusal} : null,
      anchorProfile: profile ? window.__gradeAnchorProfile : undefined,
      accepted: structuredClone(state.acceptedPresentation) };
  }, { t: start.t, selector, capture, profile: args.includes('--profile') });
  result.drainedMs=capture ? result.ms : null; result.ms=visibleMs;
  if (capture) result.pixels = await signature(page);
  if (capture || args.includes('--profile')) result.network=network.slice(networkStart);
  return result;
}
async function curves(page,lane,zoom) {
  for (const channel of ['luma','red','green','blue']) {
    await page.locator(`[data-curve-channel="${channel}"]`).click(); await stable(page);
    const baseline = await signature(page);
    const entries = Object.fromEntries(['add','drag','remove'].map(action=> {
      const row={path:`curves.${channel}.${action}`,lane,zoom,observations:[],errors:[],status:'Preview changed',resetPixelsMatch:true};
      report.rows.push(row); return [action,row];
    }));
    const observe = async (action,callback) => {
      let started = await page.evaluate(()=>performance.now());
      const released = await callback(); if(released) started=released;
      await stable(page);
      const ms = await page.evaluate(start=>performance.now()-start,started);
      const pixels = await signature(page);
      const expected = action==='drag' ? pixels!==baseline : pixels===baseline;
      entries[action].observations.push({ms,pixels,expectedPicture:expected});
      if(!expected) entries[action].status='Needs investigation: curve picture mismatch';
      save();
    };
    for(let trial=0;trial<samples;trial++) {
      if(budgetExceeded() || Date.now()-startedAt>14*60000){report.stopped='Measurement allowance reached or 14 minute batch limit';return;}
      await observe('add',async()=>{await page.locator('#curve-add').click();});
      await observe('drag',async()=>{
        const point=await page.evaluate(()=>curvePointCanvasPosition(currentCurveValues()[state.selectedCurvePoint]));
        const box=await page.locator('#curve-editor').boundingBox();
        await page.mouse.move(box.x+point.x,box.y+point.y); await page.mouse.down();
        for(let step=1;step<=30;step++) {
          await page.mouse.move(box.x+point.x,box.y+point.y-24*step/30); await page.waitForTimeout(8);
        }
        await page.mouse.up(); return page.evaluate(()=>performance.now());
      });
      await observe('remove',async()=>{await page.locator('#curve-remove').click();});
    }
    for(const [action,row] of Object.entries(entries)) {
      row.expected = action==='drag' ? 'Authored point changes image' : 'Neutral point add / removal preserves original image';
      row.referenceNotMeasured='Canvas gesture diagnostic; use ordinary control reference rows for surrounding actions';
      console.log(`${lane}/${zoom} curves ${channel}/${action}: ${row.status}`);
    }
  }
}
async function match(page,zoom) {
  const row={path:'sdr.match_entire',lane:'sdr',zoom,observations:[],errors:[],referenceBefore:[],referenceActive:[],referenceReset:[],resetPixelsMatch:true,status:'Preview changed'};
  report.rows.push(row);
  const ref=async()=>{const value=await page.locator('#sdr-exposure').inputValue();const r=await change(page,'#sdr-exposure',Number(value)+.2,false,false);await change(page,'#sdr-exposure',value,false,false);return r.ms;};
  for(let i=0;i<samples;i++)row.referenceBefore.push(await ref());
  const baseline=await signature(page);
  for(let i=0;i<samples;i++) {
    if(budgetExceeded()){report.stopped='Measurement allowance reached';return;}
    const t=await page.evaluate(()=>performance.now());
    const response=page.waitForResponse(r=>r.url().endsWith('/sdr-match')&&r.request().method()==='POST',{timeout:120000});
    await page.locator('#sdr-match-entire').click();
    const reply=await response;
    if(!reply.ok())throw Error(`Match failed with HTTP ${reply.status()}`);
    await page.waitForFunction(()=>!els.sdrMatchEntire.disabled,null,{timeout:120000});
    await stable(page,false);
    const ms=await page.evaluate(t=>performance.now()-t,t);
    await stable(page);const pixels=await signature(page);
    row.observations.push({ms,pixels,response:await reply.json()});
    if(pixels===baseline)row.status='Needs investigation: Match picture unchanged';
    row.referenceActive.push(await ref());
    if(!await page.evaluate(()=>revertRendition('sdr')))throw Error('SDR revert failed');
    await stable(page);
    row.resetPixelsMatch &&= await signature(page)===baseline;
    row.referenceReset.push(await ref());save();
    console.log(`sdr/${zoom} Match sample ${i+1}: ${ms.toFixed(1)} ms`);
  }
}
async function gestureChecks(page,lane,zoom) {
  const observe=async(name,act,restore,expected='change')=>{
    if(budgetExceeded() || Date.now()-startedAt>14*60000){report.stopped='Measurement allowance reached or 14 minute batch limit';return;}
    const row={path:name,lane,zoom,observations:[],errors:[],status:'Preview changed',resetPixelsMatch:true,
      expected,referenceNotMeasured:'Gesture only; surrounding Exposure references are in value-control rows'};
    report.rows.push(row); save();
    try {
      for(let i=0;i<samples;i++) {
        const baseline=await signature(page), t=await page.evaluate(()=>performance.now());
        await act(); await stable(page,false);
        const ms=await page.evaluate(t=>performance.now()-t,t); await stable(page);
        const pixels=await signature(page);
        row.observations.push({ms,pixels,rawImport:batch==='raw-highlights'?await page.evaluate(()=>state.editDocument?.source?.raw_import_settings):undefined,expectedPicture:expected==='identity'?pixels===baseline:pixels!==baseline});
        await restore(); await stable(page);
        row.resetPixelsMatch &&= (await signature(page))===baseline;
      }
      if(row.observations.some(o=>!o.expectedPicture))row.status='Needs investigation: gesture picture mismatch';
      else if(expected==='identity')row.status='Expected identity verified';
    }catch(e){row.errors.push(e.message);row.status='Not checked: gesture driver error';}
    save();
  };
  if(batch.endsWith('-equalizer')) {
    const prefix=lane==='sdr'?'sdr-tone-equalizer':'tone-equalizer';
    const original=await page.evaluate(lane=>structuredClone(currentToneEqualizerNodes(lane)),lane);
    const restore=async()=>page.evaluate(({lane,original})=>commitAdjustmentValue(`${lane}.tone_equalizer_nodes`,original,{manual:true}),{lane,original});
    await observe(`${lane}.bands.add-remove`,async()=>page.locator(`#${prefix}-add`).click(),async()=>{await page.locator(`#${prefix}-remove`).click();},'identity');
    await observe(`${lane}.bands.keyboard-vertical`,async()=>{await page.locator(`#${prefix}-editor`).focus();await page.keyboard.press('ArrowUp');},restore);
    await observe(`${lane}.bands.drag`,async()=>{
      const point=await page.evaluate(lane=>{const c=toneEqualizerUi(lane).editor,r=c.getBoundingClientRect(),l=toneEqualizerEditorLayout(),n=currentToneEqualizerNodes(lane)[state.selectedToneEqualizerBand];return {x:r.x+l.left+(n.input_ev-TONE_EQUALIZER_MIN_EV)/(toneEqualizerPqMaxEv()-TONE_EQUALIZER_MIN_EV)*(r.width-l.left-l.right),y:r.y+l.top+(2-n.adjustment_ev)/4*(r.height-l.top-l.bottom)};},lane);
      await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+6,point.y-25,{steps:8});await page.mouse.up();
    },restore);
  }
  if(batch==='color-grading') {
    for(const zone of ['shadows','midtones','highlights']) {
      await page.locator(`#wheel-tab-${zone}`).click();
      await observe(`wheels.${zone}.pad-reset`,async()=>{const b=await page.locator(`[data-wheel="${zone}"] .color-wheel-pad`).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.8,b.y+b.height*.4,{steps:8});await page.mouse.up();},async()=>page.locator(`[data-wheel="${zone}"] .color-wheel-pad`).dblclick());
    }
  }
  if(batch==='raw-highlights') {
    await page.locator('#raw-settings-toggle').click();
    for(const [id,value] of [['lens-mode','off'],['lens-distortion',false],['lens-ca',false],['lens-vignetting',false],['lens-focal',35],['lens-aperture',8],['lens-distance',10]]) {
      const original=await page.locator(`#${id}`).evaluate(c=>c.type==='checkbox'?c.checked:c.value);
      const apply=async value=>{
        const generation=await page.evaluate(()=>state.importGeneration);
        await page.locator(`#${id}`).evaluate((c,v)=>{if(c.type==='checkbox')c.checked=v;else c.value=String(v);c.dispatchEvent(new Event('change',{bubbles:true}));},value);
        await page.locator('#apply-raw-settings').click();
        await page.waitForFunction(g=>state.importGeneration>g&&!state.importInProgress,generation,{timeout:120000});
        await stable(page);
        const saved=await page.evaluate(()=>state.editDocument.source.raw_import_settings.lens);
        const keys={'lens-mode':'mode','lens-distortion':'distortion','lens-ca':'chromatic_aberration','lens-vignetting':'vignetting','lens-focal':'focal_length_mm','lens-aperture':'aperture','lens-distance':'focus_distance_m'};
        if(String(saved[keys[id]])!==String(value))throw Error(`RAW ${id} did not persist: ${saved[keys[id]]} expected ${value}`);
      };
      await observe(`raw.import.${id}`,()=>apply(value),()=>apply(original),'identity');
    }
  }
  if(batch==='geometry') {
    await observe('geometry.straighten-apply',async()=>{await page.locator('#rotate-tool-toggle').click();await page.locator('#crop-straighten').evaluate(c=>{c.value='2';c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));});await page.locator('#rotate-apply').click();},async()=>page.evaluate(()=>resetControlGroup('geometry')));
    await observe('geometry.crop-ratio-apply',async()=>{await page.locator('#crop-tool-toggle').click();await page.locator('#crop-ratio').selectOption('1:1');await page.locator('#crop-done').click();},async()=>page.evaluate(()=>resetControlGroup('geometry')));
    for(const id of ['rotate-left','rotate-right','flip-horizontal','flip-vertical']) {
      await observe(`geometry.${id}`,async()=>{await page.locator('#rotate-tool-toggle').click();await page.locator(`#${id}`).click();await page.evaluate(()=>closeRotateMode(true));},async()=>page.evaluate(()=>resetControlGroup('geometry')));
    }
    await observe('geometry.crop-handle-apply',async()=>{
      await page.locator('#crop-tool-toggle').click();const h=page.locator('.crop-handle').first();const b=await h.boundingBox();
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+80,b.y+60,{steps:8});await page.mouse.up();await page.locator('#crop-done').click();
    },async()=>page.evaluate(()=>resetControlGroup('geometry')));
  }
}
async function main() {
  if(budgetExceeded()) { report.stopped='Measurement allowance reached'; save(); process.exit(0); }
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    page.on('pageerror', e => report.errors.push({ kind: 'page', message: e.message }));
    page.on('console', m => { if (m.type() === 'error') report.errors.push({ kind: 'console', message: m.text() }); });
    page.on('response', async r => { if (r.status() >= 400) {const entry={kind:'backend',status:r.status(),url:r.url()};report.errors.push(entry);try{entry.body=(await r.text()).slice(0,4000);}catch{}} });
    const pending=new Map();
    page.on('request',r=>{ const url=new URL(r.url()); if(!url.pathname.startsWith('/api/')) return; const record={path:url.pathname,method:r.method(),startedAt:Date.now()}; network.push(record);pending.set(r,record); });
    page.on('response',r=>{const record=pending.get(r.request());if(record){record.status=r.status();record.ms=Date.now()-record.startedAt;record.timings=Object.fromEntries(Object.entries(r.headers()).filter(([key])=>/^x-(cpu|mask|image|source-level)/.test(key)));pending.delete(r.request());}});
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799');
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot()?.available, null, { timeout: 120000 });
    await page.evaluate(()=>window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    if(args.includes('--profile')) await page.evaluate(() => {
      const timeout=window.setTimeout;
      window.setTimeout=function(callback,ms,...args) {
        if(callback.name==='dispatch') return timeout.call(this,()=>{
          (window.__gradeAnchorProfile ||= []).push({name:'dispatch',at:performance.now(),ms,
            interacting:state.previewScheduler?.interacting,frame:state.previewScheduler?.frameInFlight,
            pending:state.previewScheduler?.framePending,draft:Boolean(state.gpuDraftInFlight),
            exact:state.acceptedPresentation?.exact,current:state.acceptedPresentation?.generation===state.previewGeneration[state.currentView]});
          callback(...args);
        },ms);
        return timeout.call(this,callback,ms,...args);
      };
      for(const name of ['scheduleExactHighlightAnchor','measureExactHighlightAnchor','wakePendingHighlightAnchor']) {
        const original=window[name];
        window[name]=function(...args) {
          (window.__gradeAnchorProfile ||= []).push({name,at:performance.now(),key:args[0]?.key});
          return original.apply(this,args);
        };
      }
    });
    const input=path.resolve(opt('--input', args.includes('--followup') && ['black-and-white','color-grading','detail','hdr-color','sdr-color','hdr-tone','sdr-tone'].includes(batch) ? 'output/test-photos/grade-colour-chart.tiff' : 'output/test-photos/grade-24mp.tiff'));
    if(batch==='raw-highlights' && args.includes('--followup')) {
      const disposable=path.resolve('output/test-photos/grade-review-raw'+path.extname(input));
      if(!fs.existsSync(disposable))fs.copyFileSync(input,disposable);
      report.rawSource={original:input,disposable,sha256:require('crypto').createHash('sha256').update(fs.readFileSync(input)).digest('hex')};
      await page.evaluate(async input=>{state.appPreferences.gradeAutosave=false;const selection=await desktop.grantSourcePath(input);await openStagedDesktopSource(selection);},disposable);
    }
    else await page.setInputFiles('#file-input',input);
    await page.waitForFunction(() => state.session, null, { timeout: 120000 });
    await stable(page);
    await page.evaluate(() => {
      window.__gradeValue = c => c.tagName === 'BUTTON'
        ? c.id === 'denoise-bypass' ? state.denoise[state.currentView].enabled
          : getValueByPath(state.adjustments,c.dataset.path || c.dataset.sectionPath)
        : c.type === 'checkbox' ? c.checked : c.value;
      window.__gradeSignature = async () => {
        const gpu = state.gpuPreview, target = gpu.presentationTarget;
        if (!target?.valid || state.acceptedPresentation?.execution !== 'tiled') return null;
        const visible = visibleOutputRect(target.width, target.height) || { x:0,y:0,width:target.width,height:target.height };
        let hash = 2166136261;
        for (const [fx, fy] of [[.1,.1],[.5,.1],[.9,.1],[.1,.5],[.5,.5],[.9,.5],[.1,.9],[.5,.9],[.9,.9]]) {
          const patch = await gpu.readPresentationRegion(32,32,Math.floor(visible.x+visible.width*fx),Math.floor(visible.y+visible.height*fy));
          const bytes = new Uint8Array(new Float32Array(patch.values).buffer);
          for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
        }
        return hash >>> 0;
      };
    });
    report.conditions = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      source: state.session.source, userAgent: navigator.userAgent,
      gpu: window.HDRFinisherPerformance.gpuSnapshot().adapter }));
    const readInventory = async () => page.evaluate(() => [...document.querySelectorAll('input,select,button,canvas,[contenteditable],[role="slider"],[tabindex],[data-hsl-handle],.crop-handle,.perspective-handle')]
      .filter(c => c.closest('#grade-workflow-panel,.control-group,.local-adjustments-panel,.retouch-panel')
        || c.closest('.viewer-panel') && !c.closest('#proof-workflow-panel') || c.dataset.path || c.dataset.localGrade || c.dataset.hslKey)
      .map((c, index) => ({ index, id: c.id, tag: c.tagName, type: c.type, role:c.getAttribute('role'), path: c.dataset.path,
        data: { ...c.dataset }, group: c.closest('[data-group]')?.dataset.group || c.closest('section')?.getAttribute('aria-label'),
        label: c.getAttribute('aria-label') || c.closest('.control-row')?.querySelector('label')?.textContent || c.textContent?.trim().slice(0, 100),
        min: c.min ?? c.getAttribute('aria-valuemin'), max: c.max ?? c.getAttribute('aria-valuemax'), step: c.step,
        defaultValue: c.dataset.defaultValue ?? c.defaultValue, initialValue:c.type==='checkbox' ? c.checked : c.value,
        disabled:Boolean(c.disabled),
        selector: (() => { const parts=[]; for(let e=c;e;e=e.parentElement) { if(e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; } parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement?.children || []].indexOf(e)+1})`); } return parts.join(' > '); })(),
        options: c.options ? [...c.options].map(o => ({ value: o.value, label: o.textContent })) : undefined })));
    const inventory = await readInventory();
    fs.writeFileSync(path.join(out, 'inventory-runtime.json'), JSON.stringify(inventory, null, 2));
    if (args.includes('--list')) {
      const variants = [];
      const { selectLocalDraft } = require('../helpers/local-adjustments');
      for (const type of ['brush','linear_gradient','luminance_range','hue_range','path']) {
        await selectLocalDraft(page, type);
        variants.push({ type, controls: await readInventory() });
      }
      await page.locator('#grade-mode-retouch').click();
      for (const mode of ['inpaint','heal','clone']) {
        await page.locator(`#retouch-mode-${mode}`).click();
        variants.push({ type: `retouch-${mode}`, controls: await readInventory() });
      }
      await page.locator('#grade-mode-global').click();
      const stocks = await page.locator('#film-stock').evaluate(c=>[...c.options].map(o=>o.value));
      for (const stock of stocks) {
        await page.evaluate(stock=>commitAdjustmentValue('current.film_look.film_stock',stock,{manual:true}),stock);
        await stable(page);
        variants.push({type:`film-stock-${stock}`,controls:await readInventory()});
      }
      fs.writeFileSync(path.join(out, 'inventory-variants.json'), JSON.stringify(variants, null, 2));
      return;
    }
    const eligible = c => c.group?.toLowerCase() === batch && (c.path || c.id || c.data.sectionPath || c.data.hslKey || c.data.localGrade || c.data.localMaskParam || c.data.rangeHandle !== undefined)
      && (['INPUT','SELECT'].includes(c.tag) || c.tag==='BUTTON' && (c.path || c.data.sectionPath || c.id==='denoise-bypass'))
      && c.type !== 'file';
    const controls = inventory.filter(eligible);
    if(batch==='match') {
      await page.evaluate(()=>{commitAdjustmentValue('hdr.exposure',.8,{manual:true});commitAdjustmentValue('hdr.saturation',30,{manual:true});});await stable(page);
    }
    for (const lane of opt('--lanes',batch==='raw-highlights'||batch==='geometry' ? 'hdr' : batch==='match'||batch.startsWith('sdr-') ? 'sdr' : batch.startsWith('hdr-') ? 'hdr' : 'hdr,sdr').split(',')) {
      await page.evaluate(lane => switchLane(lane), lane); await stable(page);
      if (batch === 'retouch' && !report.retouchSetup) {
        await page.locator('#grade-mode-retouch').click();
        for (const mode of ['inpaint','heal','clone']) {
          if (!await page.evaluate(mode => retouchUI.active && retouchUI.mode === mode, mode)) await page.locator(`#retouch-mode-${mode}`).click();
          await page.evaluate(() => ensureGeometryCoordinateMap());
          const box = await page.evaluate(() => activePreviewElement().getBoundingClientRect().toJSON());
          const count = await page.evaluate(() => state.editDocument.repairs.length);
          if (mode !== 'inpaint') await page.mouse.click(box.x+box.width*.35,box.y+box.height*.45);
          await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);
          await page.waitForFunction(count => state.editDocument.repairs.length > count && !retouchUI.busy, count, { timeout:45000 });
          await stable(page);
        }
        report.retouchSetup = await page.evaluate(() => state.editDocument.repairs.map(r=>({id:r.id,mode:r.recipe.mode})));
      }
      if (batch.endsWith('-equalizer')) { await page.evaluate(lane => { const nodes=currentToneEqualizerNodes(lane); nodes[Math.floor(nodes.length/2)].adjustment_ev=.8; commitAdjustmentValue(`${lane}.tone_equalizer_nodes`,nodes,{manual:true}); },lane); await stable(page); }
      if (batch === 'denoise') { await page.evaluate(() => setDenoiseEnabled(true)); await stable(page); }
      if (batch === 'film-look') {
        await page.evaluate(() => commitAdjustmentValue('current.film_look.film_stock','kodak_portra_400',{manual:true}));
        await stable(page);
      }
      if (batch === 'hsl') {
        await page.evaluate(() => hslEdit(hslUI.panels[0], () => { hslChannel(hslUI.panels[0]).recipe.saturation = 40; }));
        await stable(page);
      }
      if (batch === 'local-adjustments') {
        const { createLocalAdjustment } = require('../helpers/local-adjustments');
        await createLocalAdjustment(page, opt('--local-type','luminance_range')); await stable(page);
        await page.evaluate(async()=>{
          const local=structuredClone(selectedLocal()),grade=local[`${state.currentView}_grade`];
          grade.exposure=.35;
          if(grade.hsl){grade.hsl.saturation=40;if(!grade.hsl.ranges?.length)grade.hsl.ranges=[{center:25,width:16,feather:12,subtract:false}];}
          if(!await queueEditCommand('update_local',{local},local.id)) throw Error('Local fixture preparation failed');
        });
        await stable(page);
        report.localFixture={type:opt('--local-type','luminance_range'),exposure:.35,hslSaturation:40,reason:'Active grade makes mask controls observable'};
        controls.splice(0,controls.length,...(await readInventory()).filter(eligible));
      }
      await page.evaluate(group => {
        document.querySelector(`[data-group="${group}"]`)?.classList.remove('collapsed');
        for (const d of document.querySelectorAll(`[data-group="${group}"] details`)) d.open = true;
      }, batch);
      for (const zoom of (args.includes('--followup')&&batch==='film-look' ? 'actual,fit' : opt('--zooms',batch==='raw-highlights'?'fit':'fit,actual')).split(',')) {
        await page.evaluate(zoom => setZoomMode(zoom), zoom); await stable(page);
        if(batch==='denoise') {
          const started=Date.now(); await page.evaluate(()=>recalculateDenoise()); await stable(page);
          (report.denoisePreparation ||= []).push({lane,zoom,ms:Date.now()-started,reason:'Analysis preparation; warm control timings follow'});
        }
        if(args.includes('--followup') && (batch==='geometry'||batch==='raw-highlights'||batch==='color-grading'||batch.endsWith('-equalizer'))) await gestureChecks(page,lane,zoom);
        if(batch === 'curves') { await curves(page,lane,zoom); continue; }
        if(batch === 'match') { await match(page,zoom); continue; }
        for (const c of controls) {
          if (!only.test(controlName(c)) && !(args.includes('--followup') && batch==='film-look' && (zoom==='actual' || c.path?.endsWith('.grain_amount')))) continue;
          if(budgetExceeded()) { report.stopped='Measurement allowance reached'; return; }
          if (Date.now() - startedAt > 14 * 60000) { report.stopped = '14 minute batch limit'; return; }
          const selector = c.id ? `#${c.id}` : c.path ? `[data-path="${c.path}"]` : c.data.sectionPath ? `[data-section-path="${c.data.sectionPath}"]`
            : c.data.localGrade ? `[data-local-grade="${c.data.localGrade}"]`
              : c.data.localMaskParam ? `[data-local-mask-param="${c.data.localMaskParam}"]`
                : c.data.hslKey ? `#hsl-${batch === 'hsl' ? 'global' : 'local'}-panel [data-hsl-key="${c.data.hslKey}"]`
                  : c.data.rangeHandle !== undefined ? `[aria-label=${JSON.stringify(c.label)}][data-range-handle="${c.data.rangeHandle}"]` : c.selector;
          const row = { path: controlName(c), selector, lane, zoom, observations: [], errors: [] };
          report.rows.push(row); save();
          const errorStart = report.errors.length;
          const prepared = [];
          const wheel=c.path?.match(/color_grading\.(shadows|midtones|highlights)\./)?.[1];
          if(wheel) await page.locator(`#wheel-tab-${wheel}`).click();
          let localBefore=null;
          try {
            if(batch==='local-adjustments') {
              const key=c.data.localGrade, changes=[];
              if(key==='contrast_pivot')changes.push(['contrast',.3]);
              if(key==='tint_hue')changes.push(['tint_purity',40]);
              if(key==='detail.clarity_radius_percent')changes.push(['detail.clarity_amount',50]);
              if(key?.startsWith('detail.sharpen_') && key!=='detail.sharpen_amount')changes.push(['detail.sharpen_amount',100]);
              if(key?.startsWith('color_grading.') && !key.endsWith('.saturation')) {
                for(const zone of ['shadows','midtones','highlights'])changes.push([`color_grading.${zone}.saturation`,40]);
                if(key.endsWith('.blending')||key.endsWith('.balance')) for(const [zone,hue] of [['shadows',220],['midtones',130],['highlights',30]])changes.push([`color_grading.${zone}.hue`,hue]);
              }
              if(changes.length) {
                localBefore=await page.evaluate(()=>structuredClone(selectedLocal()));
                await page.evaluate(async changes=>{const local=structuredClone(selectedLocal()),grade=local[`${state.currentView}_grade`];for(const [p,v]of changes)setValueByPath(grade,p,v);if(!await queueEditCommand('update_local',{local},local.id))throw Error('Local prerequisite failed');},changes);
                row.localPreparation=changes;await stable(page);
              }
            }
            if (batch === 'retouch') {
              const mode = c.id === 'retouch-opacity' ? 'clone' : 'inpaint';
              const id = report.retouchSetup.find(r=>r.mode === mode)?.id;
              await page.evaluate(id => { selectRetouchRepair(id); retouchUI.active=false; renderLocalMaskOverlay(); }, id);
              if (['retouch-feather','retouch-texture'].includes(c.id)) {
                await page.locator('#retouch-method').selectOption('original-detail');
                await page.locator('#retouch-apply').click(); await stable(page);
              }
            }
            const dependencies = [];
            if(batch==='raw-highlights' && c.id==='raw-edge-colour-expand') await change(page,'#raw-highlight-method','edge_colour_v1');
            if(c.data.sectionPath?.endsWith('.tone_section_enabled')) dependencies.push([`${lane}.exposure`,.5]);
            if(c.data.sectionPath?.endsWith('.color_section_enabled')) dependencies.push([`${lane}.saturation`,30]);
            if(c.data.sectionPath?.endsWith('.detail_section_enabled')) dependencies.push(['current.detail.texture_amount',50]);
            if(batch.endsWith('-highlights') && c.path?.endsWith('_softness')) dependencies.push([`${lane}.highlight_compression_mode`,'soft_ceiling']);
            if(batch.endsWith('-highlights') && c.path?.includes('_manual_peak_')) dependencies.push([`${lane}.highlight_compression_peak_measurement`,'manual']);
            if(batch.endsWith('-highlights') && c.path?.endsWith('_attenuation')) dependencies.push([`${lane}.highlight_compression_color_handling`,'agx_attenuate']);
            if(batch==='hdr-highlights') dependencies.push(['hdr.exposure',3],['hdr.highlight_section_enabled',true]);
            if(batch==='sdr-highlights') dependencies.push(['sdr.exposure',1]);
            const match = c.path?.match(/^(.*\.(?:shadows|midtones|highlights))_(center|width)$/);
            if (match) dependencies.push([match[1], .5]);
            if (c.path?.startsWith('hdr.highlights')) dependencies.push(['hdr.exposure', 2]);
            if (c.path?.endsWith('.contrast_pivot')) dependencies.push([`${lane}.contrast`, .3]);
            if (c.path?.endsWith('_desaturation_start')) dependencies.push([c.path.replace('_start',''), 50]);
            if (c.path?.endsWith('.tint_hue')) dependencies.push([`${lane}.tint_purity`, 40]);
            if (batch === 'black-and-white') dependencies.push([`${lane}.black_and_white_section_enabled`, true]);
            if (batch === 'vignette' && !c.path?.endsWith('.amount')) dependencies.push(['current.vignette.amount', -40]);
            if (batch === 'color-grading' && !c.path?.endsWith('.saturation')) {
              for (const zone of ['shadows','midtones','highlights']) dependencies.push([`current.color_grading.${zone}.saturation`, 40]);
              if (c.path?.endsWith('.blending') || c.path?.endsWith('.balance')) {
                for (const [zone,hue] of [['shadows',220],['midtones',130],['highlights',30]]) dependencies.push([`current.color_grading.${zone}.hue`,hue]);
              }
            }
            if (c.path?.endsWith('clarity_radius_percent')) dependencies.push(['current.detail.clarity_amount', 50]);
            if (c.path?.includes('sharpen_') && !c.path.endsWith('sharpen_amount')) dependencies.push(['current.detail.sharpen_amount', 100]);
            if (c.path?.includes('.film_look.grain_') && !c.path.endsWith('grain_amount')) dependencies.push(['current.film_look.grain_amount',40]);
            if (c.path?.includes('.film_look.halation_') && !c.path.endsWith('halation_amount')) dependencies.push(['current.film_look.halation_amount',80]);
            if (c.path?.includes('.film_look.lens_') && !c.path.endsWith('lens_filter')) dependencies.push(['current.film_look.lens_filter','black_pro_mist']);
            if (c.path?.includes('.film_look.grain_custom_')) dependencies.push(['current.film_look.grain_film_format','custom']);
            if (c.path?.endsWith('grain_custom_height_mm')) dependencies.push(['current.film_look.grain_capture_geometry','horizontal_strip']);
            if (c.path?.endsWith('grain_custom_width_mm')) dependencies.push(['current.film_look.grain_capture_geometry','vertical_strip']);
            for (const [p,v] of dependencies) {
              prepared.push([p, await page.evaluate(p => getValueByPath(state.adjustments,p), p)]);
              await page.evaluate(([p,v]) => commitAdjustmentValue(p,v,{manual:true}), [p,v]);
            }
            row.preparation = dependencies;
            if (prepared.length) await stable(page);
            await page.evaluate(selector => {
              for (let element = document.querySelector(selector)?.parentElement; element; element = element.parentElement) {
                if ((element.hidden || element.classList.contains('hidden')) && element.id) document.querySelector(`[aria-controls="${CSS.escape(element.id)}"]`)?.click();
              }
            }, selector);
            const plan = await page.evaluate(async selector => {
              const c = document.querySelector(selector), value = window.__gradeValue(c);
              let alternative;
              if (c.type === 'checkbox' || c.tagName === 'BUTTON') alternative = !value;
              else if (c.options) alternative = [...c.options].find(o => !o.disabled && o.value !== value)?.value;
              else { const delta = c.id==='film-push_pull' ? 1 : (Number(c.max) - Number(c.min)) * .2; alternative = Number(value) + delta <= Number(c.max) ? Number(value) + delta : Number(value) - delta; }
              return { value, alternative, disabled: c.disabled };
            }, selector);
            plan.pixels = await signature(page);
            row.plan = plan;
            if (plan.disabled || plan.alternative === undefined || c.id!=='film-push_pull' && !await page.locator(selector).isVisible()) { row.status = 'Not checked: inactive prerequisite'; continue; }
            // Reference uses normal Exposure input events, restores its value every time.
            const ref = async () => {
              const s = `#${lane}-exposure`;
              const v = await page.locator(s).inputValue();
              const r = await change(page, s, Number(v) + .2, false, false); await change(page, s, v, false, false); if(args.includes('--profile')) (row.referenceProfiles ||= []).push(r); return r.ms;
            };
            row.referenceBefore = []; row.referenceActive = []; row.referenceReset = [];
            for (let i = 0; i < samples; i++) row.referenceBefore.push(await ref());
            row.preWarmupPixels = plan.pixels;
            plan.pixels = await signature(page);
            for (let i = 0; i < samples; i++) {
              const changed = await change(page, selector, plan.alternative);
              row.observations.push(changed);
              row.referenceActive.push(await ref());
              if(args.includes('--profile') && i===0) {
                row.referenceActiveWarm=[];
                for(let warm=0;warm<3;warm++) row.referenceActiveWarm.push(await ref());
              }
              const restored = await change(page, selector, plan.value);
              row.observations.push({ ...restored, restore: true });
              row.referenceReset.push(await ref());
              if(args.includes('--profile') && i===0) {
                row.referenceResetWarm=[];
                for(let warm=0;warm<3;warm++) row.referenceResetWarm.push(await ref());
              }
            }
            if(args.includes('--profile') && ['denoise','retouch'].includes(batch)) {
              const enabled = await page.evaluate(() => state.denoise[state.currentView].enabled);
              const repairs = await page.evaluate(() => structuredClone(state.editDocument.repairs));
              if(batch==='denoise') await page.evaluate(() => setDenoiseEnabled(false));
              else await page.evaluate(repairs => queueEditCommand('set_repairs',{repairs:repairs.map(r=>({...r,enabled:false}))}), repairs);
              await stable(page);
              row.referenceOff=[];
              for(let warm=0;warm<3;warm++) row.referenceOff.push(await ref());
              if(batch==='denoise') await page.evaluate(enabled => setDenoiseEnabled(enabled), enabled);
              else await page.evaluate(repairs => queueEditCommand('set_repairs',{repairs}), repairs);
              await stable(page);
            }
            row.status = row.observations.some(o => !o.restore && o.pixels !== plan.pixels) ? 'Preview changed' : 'Needs investigation: no screen change';
            row.resetPixelsMatch = row.observations.filter(o => o.restore).every(o => o.pixels === plan.pixels);
            if (c.type === 'range' && zoom === 'fit') {
              const output = c.path ? page.locator(`[data-value-path="${c.path}"]`).first() : page.locator(selector).locator('xpath=ancestor::*[contains(@class,"control-row")][1]').locator('output').first();
              if (await output.count()) {
                const entry = await output.evaluate((e,{p,alternative})=> {
                  const control=e.closest('.control-row')?.querySelector('input');
                  const scale=(p && MANUAL_VALUE_RULES[p]?.entryScale) || (e.textContent.includes('%') && Number(control?.max)<=1 ? 100 : 1);
                  const text=String(alternative*scale);
                  return {text,expected:p ? normalizeManualControlValue(p,text)?.value ?? Math.round(alternative*1e6)/1e6 : Math.round(alternative*1e6)/1e6};
                },{p:c.path,alternative:plan.alternative});
                await output.evaluate(e => e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
                if (await output.getAttribute('contenteditable')) {
                  await page.keyboard.insertText(entry.text);
                  await page.keyboard.press('Enter');
                  if (batch === 'retouch') await page.evaluate(() => applySelectedRetouch(false));
                  await stable(page);
                  row.typed = await page.evaluate(({ p, selector }) => p ? getValueByPath(state.adjustments, p) : document.querySelector(selector).value, { p: c.path, selector });
                  row.typedEntry=entry; row.typedMatches=Number(row.typed)===Number(entry.expected);
                  await change(page, selector, plan.value);
                }
              }
              await page.locator(selector).scrollIntoViewIfNeeded();
              const box = await page.locator(selector).boundingBox();
              if (box && batch !== 'retouch') {
                const native = c.data.rangeHandle !== undefined ? await page.locator(selector).evaluate(input=>{
                  const r=input.getBoundingClientRect(),thumb=parseFloat(getComputedStyle(input,'::-webkit-slider-thumb').width)||13;
                  const x=r.x+thumb/2+(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*(r.width-thumb);
                  const hits=[];for(let y=r.top;y<r.bottom;y++)for(let px=Math.max(r.left,x-18);px<Math.min(r.right,x+18);px++)if(document.elementFromPoint(px,y)===input)hits.push({x:px,y,d:(px-x)**2+(y-(r.top+r.height/2))**2});
                  return hits.sort((a,b)=>a.d-b.d)[0]||null;
                }) : null;
                row.dragTrials = [];
                for (let trial = 0; trial < samples; trial++) {
                await page.evaluate(() => {
                  window.__gradeDrag = { events: [], start: performance.now(), refusalsBefore: structuredClone(state.gpuDraftRefusals), schedulerBefore: state.previewScheduler?.snapshot() };
                  window.__gradeDragListener = e => window.__gradeDrag.events.push({ t: performance.now(), ...e.detail });
                  window.addEventListener('hdrfinisher:preview-presented', window.__gradeDragListener);
                });
                const sx=native?.x ?? box.x+box.width*.1,sy=native?.y ?? box.y+box.height/2;
                await page.mouse.move(sx,sy);
                await page.mouse.down();
                for (let step = 0; step < 30; step++) {
                  await page.mouse.move(native ? sx+box.width*.25*(c.data.rangeHandle==='1'?-1:1)*step/29 : box.x+box.width*(.1+.8*step/29),sy);
                  await page.waitForTimeout(8);
                }
                row.drag = await page.evaluate(() => {
                  const d = window.__gradeDrag; d.end = performance.now();
                  window.removeEventListener('hdrfinisher:preview-presented', window.__gradeDragListener);
                  d.refusalsAfter=structuredClone(state.gpuDraftRefusals); d.schedulerAfter=state.previewScheduler?.snapshot();
                  d.presentationsPerSecond = d.events.length / ((d.end - d.start) / 1000); return d;
                });
                row.dragTrials.push(row.drag);
                await page.mouse.up(); await stable(page);
                await change(page, selector, plan.value);
                }
                row.drag = { presentationsPerSecond: row.dragTrials.map(d => d.presentationsPerSecond).sort((a,b)=>a-b)[Math.floor(samples/2)], samples };
              }
            }
            if (c.type === 'number' && zoom === 'fit' && await page.locator(selector).isVisible()) {
              await page.locator(selector).fill(String(plan.alternative));
              await page.locator(selector).press('Tab'); await stable(page);
              row.typed = await page.evaluate(({ p, selector }) => p ? getValueByPath(state.adjustments, p) : document.querySelector(selector).value, { p: c.path, selector });
              row.typedMatches=Number(row.typed)===Number(plan.alternative);
              await change(page, selector, plan.value);
            }
            row.defaultReset = c.type === 'range' && batch!=='raw-highlights' ? await change(page, selector, null, true) : null;
            await change(page, selector, plan.value);
          } catch (e) { row.errors.push(e.message); row.status = 'Not met: driver/control error'; }
          finally {
            if(localBefore) { await page.evaluate(async local=>{if(!await queueEditCommand('update_local',{local},local.id))throw Error('Local prerequisite restore failed');},localBefore); await stable(page); }
            for (const [p,v] of prepared.reverse()) await page.evaluate(([p,v]) => commitAdjustmentValue(p,v,{manual:true}), [p,v]);
            if (prepared.length) await stable(page);
            row.runtimeErrors = report.errors.slice(errorStart);
            save(); console.log(`${lane}/${zoom} ${row.path}: ${row.status}`);
          }
        }
      }
    }
  } finally { report.completedAt=new Date().toISOString(); save(); await browser.close(); }
}
main().catch(e => { report.fatal = e.stack; save(); console.error(e); process.exitCode = 1; });
