// Quick-check diagnostic (--memory-probe): what the Library window holds after a
// run, and how much garbage collection and the Library's own reclaim release.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function probe({app, window, frame}) {
  const pid = window.webContents.getOSProcessId();
  const processes = () => Object.fromEntries(app.getAppMetrics()
    .filter(item => item.pid === pid || item.type === 'GPU')
    .map(item => [item.pid === pid ? 'window' : 'gpu', {
      working_set_mb: Math.round(item.memory.workingSetSize / 1024),
      private_mb: Math.round((item.memory.privateBytes || 0) / 1024)}]));
  const page = () => frame.executeJavaScript(`(()=>{
    const canvases=[...document.querySelectorAll('canvas')];
    const mb=n=>Math.round(n/1e6);
    return {
      js_heap_mb: performance.memory ? mb(performance.memory.usedJSHeapSize) : null,
      js_heap_total_mb: performance.memory ? mb(performance.memory.totalJSHeapSize) : null,
      ram_shares: window.HDRLibraryRAM?.snapshot?.(),
      pictures: window.HDRLibraryPictures?.snapshot?.(),
      quick_pictures: window.HDRLibraryQuickPictures?.snapshot?.(),
      direct_mb: mb(window.HDRLibraryGpuRaw?.directBytes?.() || 0),
      canvases: canvases.length,
      canvas_mpx: Math.round(canvases.reduce((n,c)=>n+c.width*c.height,0)/1e6),
      images: document.images.length,
      blob_images: [...document.images].filter(i=>i.src.startsWith('blob:')).length,
      activity: document.getElementById('index-status')?.textContent,
      background_work: Object.values(window.HDRLibraryScenes?.snapshot?.()||{}).flatMap(q=>q.jobs||[]).filter(j=>j.background).length,
      details_colour: [...document.querySelectorAll('#details dt')].filter(dt=>dt.textContent==='Colour assumed').map(dt=>dt.nextElementSibling?.textContent),
      colour_notes:[...document.querySelectorAll('.library-colour-note')].map(n=>[n.closest('.library-cell')?.dataset.path?.split(/[\\\\/]/).pop(),n.textContent,getComputedStyle(n).color]),
    };})()`);
  const gc = () => window.webContents.executeJavaScriptInIsolatedWorld(998, [{code:
    "(async()=>{if(typeof gc==='function')await gc({type:'major',execution:'async',flavor:'last-resort'});})()"}]);
  const steps = [];
  const record = async name => steps.push({step: name, ...processes(), page: await page()});
  await pause(3000); await record('after run');
  await gc(); await pause(1500); await record('after garbage collection');
  await frame.executeJavaScript('window.HDRLibraryReclaimWaiting?.(8e9)');
  await gc(); await pause(2000); await record('after Library reclaim and collection');
  window.webContents.send('desktop:clear-native-cache');
  await gc(); await pause(2000); await record('after native cache clear');
  steps.push({step: 'largest live objects', objects: await largest(window)});
  return steps;
}
// Diagnostic only: list the largest live arrays in every frame of the window.
async function largest(window) {
  const debug = window.webContents.debugger;
  debug.attach('1.3');
  const out = [];
  try {
    const send = (method, params) => debug.sendCommand(method, params);
    const contexts = [];
    debug.on('message', (_event, method, params) => {
      if (method === 'Runtime.executionContextCreated') contexts.push(params.context);
    });
    await send('Runtime.enable');
    await pause(500);
    try { out.push({heap_usage: await send('Runtime.getHeapUsage')}); } catch (error) { out.push({heap_usage_error: String(error.message)}); }
    try { out.push({dom_counters: await send('Memory.getDOMCounters')}); } catch (error) { out.push({dom_error: String(error.message)}); }
    if (process.env.HDR_QUICK_HEAP_SNAPSHOT) {
      const fs = require('node:fs');
      const file = fs.openSync(process.env.HDR_QUICK_HEAP_SNAPSHOT, 'w');
      const chunk = (_event, method, params) => { if (method === 'HeapProfiler.addHeapSnapshotChunk') fs.writeSync(file, params.chunk); };
      debug.on('message', chunk);
      try { await send('HeapProfiler.enable'); await send('HeapProfiler.takeHeapSnapshot', {reportProgress: false, exposeInternals: true}); }
      finally { debug.removeListener('message', chunk); fs.closeSync(file); }
    }
    for (const context of contexts) {
      for (const type of ['Float32Array', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'ArrayBuffer', 'DataView', 'GPUBuffer', 'GPUTexture', 'ImageData', 'ImageBitmap', 'Response', 'Blob', 'OffscreenCanvas', 'Worker', 'Promise']) {
        try {
          const proto = await send('Runtime.evaluate', {expression: `${type}.prototype`, contextId: context.id});
          if (!proto.result?.objectId) continue;
          const found = await send('Runtime.queryObjects', {prototypeObjectId: proto.result.objectId});
          const summary = await send('Runtime.callFunctionOn', {objectId: found.objects.objectId, returnByValue: true,
            functionDeclaration: `function(){const size=x=>{try{return x.byteLength??(x.width&&x.height?x.width*x.height*(x.depthOrArrayLayers||1):undefined)??x.size??x.length??1;}catch(e){return 1;}};
              const all=this.map(x=>({n:size(x),sample:(()=>{try{if(x instanceof Map)return [...x.keys()].slice(0,3).map(String).map(s=>s.slice(0,120));if(Array.isArray(x))return x.slice(0,4).map(v=>typeof v==='object'&&v?Object.keys(v).slice(0,8).join(','):String(v).slice(0,60));if(x.label!==undefined)return [String(x.label),String(x.mapState||x.format||''),String(x.usage)];}catch(e){}return null;})()}));
              all.sort((a,b)=>b.n-a.n);return {count:all.length,total:all.reduce((s,x)=>s+x.n,0),top:all.slice(0,6)};}`});
          out.push({context: context.origin + ' ' + (context.name || ''), type, ...summary.result.value});
        } catch (error) { out.push({type, error: String(error.message || error)}); }
      }
    }
  } finally { debug.detach(); }
  return out;
}
module.exports = {probe};
