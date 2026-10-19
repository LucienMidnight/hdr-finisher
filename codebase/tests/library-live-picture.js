/* Compare live finished pixels with Grade's numerical renderer before any file codec. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-live-picture',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const sources=['D:/test-photos-delete-later/DSC07072.ARW',path.join(root,'tests/fixtures/sdr_gradient.png')];
const photos=sources.map(source=>{const p=path.join(folder,path.basename(source));fs.copyFileSync(source,p);return p;});
const edited=path.join(folder,'edited.png');fs.copyFileSync(sources[1],edited);photos.push(edited);
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import sys,json
from pathlib import Path
sys.path.insert(0,'backend')
from hdr_finisher.sessions import SessionStore
from hdr_finisher.models import LocalAdjustment
p=Path(sys.argv[1]);session=SessionStore().prepare_session(p,owns_source_path=False)
a=session.edit_document().model_dump(mode='json');b=json.loads(json.dumps(a))
b['global_adjustments']['hdr']['exposure']=.6
b['global_adjustments']['sdr']['exposure']=.3
b['global_adjustments']['shared']['geometry']['rotation']=90
local=LocalAdjustment();local.hdr_grade.exposure=.25;local.sdr_grade.exposure=.15
b['local_adjustments']=[local.model_dump(mode='json')]
b['denoise']['hdr']['enabled']=True
p.with_name(p.name+'.hdrf').write_text(json.dumps({'format':'HDR Finisher Photo','schema_version':1,'photo_id':'live-test','marks':{},'albums':[],'grade':b,'grade_default':a}),encoding='utf8')
`,edited],{cwd:root});
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
