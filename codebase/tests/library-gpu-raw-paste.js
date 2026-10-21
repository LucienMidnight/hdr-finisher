// Paste preflight reuses the development a RAW thumbnail already performed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const original=process.env.HDR_PASTE_RAW||'D:/test-photos-delete-later/DSC07072.ARW';
const folder=path.resolve(__dirname,'../output/library-gpu-raw-paste',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const before=path.join(folder,'before.ARW'),after=path.join(folder,'after.ARW');
for(const file of [before,after])fs.copyFileSync(original,file);
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
    const api=async(route,data)=>{
      const response=await global.HDRFinisherElectronTestHarness.fetch(route,{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      assert.ok(response.ok,await response.clone().text());return response.json();
    };
    let start=Date.now();await api('/api/library/grade-prepare',{path:before});
    const cpuSeconds=(Date.now()-start)/1000;
    const library=page.locator('#library-frame');
    await library.evaluate(async(element,file)=>{
      const win=element.contentWindow;
      if(!win.HDRLibraryGpuRaw?.enabled())throw Error('A usable GPU is required');
      const result=await win.HDRLibraryGpuRaw.thumbnail(file,640);
      if(result.route!=='gpu-raw-thumbnail')throw Error(JSON.stringify(result));
    },after);
    start=Date.now();
    const ready=await Promise.all(Array.from({length:3},()=>api('/api/library/grade-prepare',{path:after})));
    assert.ok(ready.every(result=>result.ready));
    const reusedSeconds=(Date.now()-start)/1000;
    const copied=await api('/api/library/grade-copy',{path:after});
    assert.ok(copied.groups.length);
    const selection={lanes:['hdr','sdr'],settings:['global_adjustments.hdr.exposure']};
    const checked=await api('/api/library/grade-paste',{paths:[after],selection,preview:true});
    const pasted=await api('/api/library/grade-paste',{paths:[after],selection});
    assert.equal(checked.count,0);assert.equal(pasted.count,0);
    for(const file of [before,after])assert.ok(!fs.existsSync(file+'.hdrf'),'Unchanged paste writes no sidecar');
    const result={cpuSeconds,reusedSeconds,simultaneousRequests:3,checked,pasted};
    console.log(JSON.stringify(result));fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
