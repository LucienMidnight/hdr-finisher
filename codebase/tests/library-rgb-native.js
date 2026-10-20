/* Selected native development survives zoom-out and is reused on later zooms. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-rgb-native',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const codecs=process.argv.includes('--codecs');
const raw=path.join(folder,codecs?'photo.jxl':'photo.jpg'),edited=path.join(folder,codecs?'edited.heic':'edited.png');
if(codecs){
 execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/library_codec_native.py'),folder],{cwd:root});
}else{
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',"from PIL import Image;import sys;Image.open(sys.argv[1]).resize((3200,1869)).save(sys.argv[2],quality=95)",'D:/Photos/Play_Raw/Zebras Crossing - thekman/darktable_exported/DSC_3931_01.jpg',raw]);
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import sys,json
from pathlib import Path
from PIL import Image
sys.path.insert(0,'backend')
from hdr_finisher.sessions import SessionStore
from hdr_finisher.models import LocalAdjustment
p=Path(sys.argv[1]);Image.open(p.with_name('photo.jpg')).save(p)
s=SessionStore().prepare_session(p,owns_source_path=False);a=s.edit_document().model_dump(mode='json');b=json.loads(json.dumps(a))
b['global_adjustments']['shared']['geometry']['rotation']=90
b['global_adjustments']['sdr']['exposure']=.3
local=LocalAdjustment();local.sdr_grade.exposure=.2;b['local_adjustments']=[local.model_dump(mode='json')]
p.with_name(p.name+'.hdrf').write_text(json.dumps({'format':'HDR Finisher Photo','schema_version':1,'photo_id':'native-test','marks':{},'albums':[],'grade':b,'grade_default':a}),encoding='utf8')
`,edited],{cwd:root});
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log('PAGE',m.text());});
 await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
 const frame=page.locator('#library-frame');
 page.on('response',async r=>{if(r.status()>=400)console.error('HTTP',r.status(),r.url(),(await r.text().catch(()=>'' )).slice(0,300));});
 const nativeReady=async()=>{
  await page.waitForFunction(()=>{
   const w=document.querySelector('#library-frame').contentWindow;
   return !!w.HDRLibrary.getSnapshot().native || /% unavailable/.test(w.document.body.textContent);
  },null,{timeout:180000});
  assert.ok(await frame.evaluate(el=>!!el.contentWindow.HDRLibrary.getSnapshot().native),
   await frame.evaluate(el=>el.contentWindow.document.body.innerText.slice(-1200)));
 };
 await frame.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
 await page.waitForFunction(()=>document.querySelector('#library-frame').contentWindow.document.querySelectorAll('#grid-space canvas[data-picture-key]').length===2,null,{timeout:120000});
 await frame.evaluate(el=>{const w=el.contentWindow,fetch=w.fetch.bind(w);w.__nativeRequests=[];w.fetch=(url,options)=>{
  const record=String(url)==='/api/library/live-scene'&&JSON.parse(options.body).edge===100000?JSON.parse(options.body):null;
  if(record)w.__nativeRequests.push(record);
  return fetch(url,options).then(response=>{if(record)record.status=response.status;return response;});
 };});
 await frame.evaluate(async el=>{
  const w=el.contentWindow,gpu=await w.HDRLibraryPictures.initialize(),render=gpu.renderTo;
  w.__nativePixels={};
  gpu.renderTo=async function(canvas,...args){
   const result=await render.call(this,canvas,...args),r=args.at(-1)?.viewport;
   if(r&&result?.rendered){
    const pixels=await this.readPresentationRegion(8,8,Math.floor(r.x+r.width/2),Math.floor(r.y+r.height/2));
    w.__nativePixels[this.libraryMeta.path]={pixels,memory:this.resourceMemorySnapshot().resident.totalBytes,budget:this.memoryBudgetBytes()};
   }
   return result;
  };
 });
 const rows=[];
 for(const photo of [edited,raw]){
  await frame.evaluate((el,photo)=>{const d=el.contentWindow.document;[...d.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===photo).click();d.getElementById('single-view').click();},photo);
  await page.waitForFunction(photo=>document.querySelector('#library-frame').contentWindow.document.getElementById('single-picture').dataset.picturePath===photo,photo,{timeout:90000});
  await frame.evaluate(el=>el.contentWindow.document.getElementById('zoom-button').click());
  const immediate=await frame.evaluate(el=>{const w=el.contentWindow,d=w.document;return {zoom:w.HDRLibrary.getSnapshot().zoom,fitVisible:!d.getElementById('single-picture').hidden,native:w.HDRLibrary.getSnapshot().native};});
  assert.ok(immediate.zoom&&immediate.fitVisible&&!immediate.native,'2560 picture is visible immediately');
  // Leave zoom before the full source is ready, then request it again.
  await frame.evaluate(el=>el.contentWindow.document.getElementById('zoom-button').click());
  await frame.evaluate(el=>el.contentWindow.document.getElementById('zoom-button').click());
  await nativeReady();
  const first=await frame.evaluate(el=>({snapshot:el.contentWindow.HDRLibrary.getSnapshot(),requests:el.contentWindow.__nativeRequests.length}));
  assert.ok(Math.max(first.snapshot.native.width,first.snapshot.native.height)>2560);
  await frame.evaluate(el=>{const d=el.contentWindow.document;d.getElementById('zoom-button').click();d.getElementById('zoom-button').click();});
  await page.waitForFunction(()=>!!document.querySelector('#library-frame').contentWindow.HDRLibrary.getSnapshot().native,null,{timeout:90000});
  const after=await frame.evaluate(el=>el.contentWindow.__nativeRequests.length);
  assert.equal(after,first.requests,'Later zoom reuses the retained full-size scene');
  const requested=await frame.evaluate((el,photo)=>el.contentWindow.__nativeRequests.filter(r=>r.path===photo),photo);
  assert.ok(requested.filter(r=>r.gpu&&r.status!==202).length<=1&&requested.filter(r=>!r.gpu&&r.status===200).length<=1,'One native development per selected photo (paused requests do no work): '+JSON.stringify(requested));
  if(photo===edited)assert.ok(await frame.evaluate((el,photo)=>el.contentWindow.__nativeRequests.every(r=>r.path===photo),photo),'No neighbour native development');
  const drawn=await frame.evaluate((el,photo)=>el.contentWindow.__nativePixels[photo],photo);
  assert.ok(drawn?.pixels?.values.some((v,i)=>i%4!==3&&v>0),'Native viewport contains drawn pixels');
  assert.ok(drawn.memory<=drawn.budget,'Native working resources stay within the existing GPU budget');
  rows.push({photo,native:first.snapshot.native,requests:after,residentBytes:drawn.memory,budgetBytes:drawn.budget});
  const crop=await frame.evaluate(el=>{const w=el.contentWindow,c=w.document.getElementById('native-picture'),stage=w.document.getElementById('single-stage');return {width:c.width,height:c.height,maxWidth:stage.clientWidth*(w.devicePixelRatio||1),maxHeight:stage.clientHeight*(w.devicePixelRatio||1)};});
  assert.ok(crop.width<=Math.ceil(crop.maxWidth)&&crop.height<=Math.ceil(crop.maxHeight),'Retain the visible native crop, not a full-size GPU surface');
  await frame.evaluate(el=>{const d=el.contentWindow.document;d.getElementById('zoom-button').click();d.getElementById('grid-view').click();});
 }
 await frame.evaluate(el=>{const w=el.contentWindow,c=w.document.getElementById('compare-enabled');c.checked=true;c.dispatchEvent(new w.Event('change'));});
 await page.waitForFunction(()=>{
  const d=document.querySelector('#library-frame').contentWindow.document;
  return [...d.querySelectorAll('.compare-fit')].every(c=>c.dataset.picturePath&&Number(c.dataset.pictureEdge)===2560);
 },null,{timeout:90000});
 // Start grid recovery in a fresh page after the native/Compare journey;
 // Compare commands can asynchronously restore Single after a toolbar click.
 await page.reload();await page.evaluate(()=>activateWorkflowTab('import'));
 await frame.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
 await page.waitForFunction(()=>{const w=document.querySelector('#library-frame').contentWindow;return w.HDRLibrary.getSnapshot().view==='grid'&&[...w.document.querySelectorAll('#grid-space canvas[data-picture-key]')].filter(c=>!c.hidden).length===2;},null,{timeout:90000});
 // Both ordinary formats draw real grid cells and retain their authored SDR.
 for(const photo of [raw,edited]){
  const meta=await frame.evaluate((el,p)=>el.contentWindow.HDRLibraryScenes.load(p,640),photo);
  assert.equal(meta.renderer,'gpu');assert.ok(meta.rgb_adapter);assert.equal(meta.has_reference,meta.rgb_contract.colour.authored_sdr);
 }
 await frame.evaluate(async el=>{
  const w=el.contentWindow,gpu=await w.HDRLibraryPictures.initialize();
  w.__adapter=w.navigator.gpu.requestAdapter.bind(w.navigator.gpu);
  w.navigator.gpu.requestAdapter=async()=>null;gpu.device.destroy();
 });
 await page.waitForFunction(()=>{
  const d=document.querySelector('#library-frame').contentWindow.document;
  return [...d.querySelectorAll('#grid-space img[data-cpu-fallback="true"]')].filter(c=>!c.hidden).length===2;
 },null,{timeout:120000}).catch(async e=>{console.log('RECOVERY STATE',await frame.evaluate(el=>({snapshot:el.contentWindow.HDRLibrary.getSnapshot(),body:el.contentWindow.document.body.innerText,grid:el.contentWindow.document.getElementById('grid-space').innerHTML})));throw e;});
 await frame.evaluate(el=>{const w=el.contentWindow;w.navigator.gpu.requestAdapter=w.__adapter;});
 await page.waitForFunction(()=>{
  const d=document.querySelector('#library-frame').contentWindow.document;
  return [...d.querySelectorAll('#grid-space canvas[data-picture-key]')].filter(c=>!c.hidden).length===2;
 },null,{timeout:120000});
 console.log('Photographic RGB cells, selected native reuse, memory and automatic hardware recovery passed.');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
