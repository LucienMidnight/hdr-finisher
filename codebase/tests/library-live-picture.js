/* Compare live finished pixels with Grade's numerical renderer before any file codec. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-live-picture',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const sources=['D:/test-photos-delete-later/DSC07072.ARW',path.join(root,'tests/fixtures/sdr_gradient.png')];
const photos=sources.map(source=>{const p=path.join(folder,path.basename(source));fs.copyFileSync(source,p);return p;});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
 const result=await page.locator('#library-frame').evaluate(async(element,photos)=>{
  const w=element.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),original=gpu.renderTo,rows=[];
  let captured;
  gpu.renderTo=async function(canvas,...args){const result=await original.call(this,canvas,...args);captured=await this.analyzeScope(canvas,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return result;};
  const location=(await(await w.fetch('/api/library/cache-settings')).json()).location;
  for(const photo of photos){
   const meta=await w.HDRLibraryScenes.load(photo,640),lanes={};
   for(const lane of ['hdr','sdr']){
    const canvas=w.document.createElement('canvas');w.document.body.append(canvas);
    await w.HDRLibraryPictures.show(meta,canvas,new w.AbortController().signal,()=>true,lane==='hdr');
    if(!captured)throw Error('No live pixel capture');
    const bytes=new Uint8Array(captured.halves.buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    lanes[lane]=w.btoa(binary);canvas.remove();
   }
   rows.push({photo,meta,lanes});
  }
  gpu.renderTo=original;return {location,rows};
 },photos);
 const file=path.join(folder,'pixels.json');fs.writeFileSync(file,JSON.stringify(result));
 const output=execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_live_compare.py'),file],{cwd:root,encoding:'utf8',maxBuffer:1<<24});
 const report=JSON.parse(output.trim().split('\n').at(-1));console.log(JSON.stringify(report));
 for(const row of report)for(const check of row.checks)assert.ok(check.passed,JSON.stringify({photo:row.photo,...check}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
