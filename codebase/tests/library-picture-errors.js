/* Real grid: failed grades release workers; ignore persists; reset renders again. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-picture-errors',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
fs.mkdirSync(path.join(folder,'empty'));
const names=['broken-a.png','broken-b.png','healthy-a.png','healthy-b.png','healthy-c.png','healthy-d.png'];
for(const name of names)fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),path.join(folder,name));
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`
import json, sys
from pathlib import Path
from uuid import uuid4
from hdr_finisher.sessions import SessionStore
folder=Path(sys.argv[1])
grade=SessionStore().prepare_session(folder/'broken-a.png',owns_source_path=False).edit_document().model_dump(mode='json')
grade['global_adjustments']['hdr']['film_look']['obsolete_test_setting']=1
for name in ('broken-a.png','broken-b.png'):
 p=folder/name
 doc=dict(format='HDR Finisher Photo',schema_version=1,photo_id=uuid4().hex,contains_source_pixels=False,source={},marks=dict(rating=4,pick='unmarked',label='',tags=['keep']),grade=grade)
 Path(str(p)+'.hdrf').write_text(json.dumps(doc),encoding='utf-8')
`,folder],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'backend')},stdio:'pipe'});
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(()=>activateWorkflowTab('import'));
  const frame=page.locator('#library-frame');
  const doc=page.frameLocator('#library-frame');
  const browse=()=>frame.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
  await browse();
  await doc.locator('#grid-space .library-picture-error').first().waitFor();
  await page.waitForFunction(()=>{
   const w=document.querySelector('#library-frame').contentWindow,d=w.document;
   return d.querySelectorAll('#grid-space .library-picture-error').length===2&&
    [...d.querySelectorAll('#grid-space canvas[data-picture-key]')].filter(c=>!c.hidden).length===4&&
    Object.values(w.HDRLibraryScenes.snapshot()).every(queue=>queue.active===0&&queue.waiting===0);
  },null,{timeout:90000});
  const cell=name=>doc.locator('#grid-space .library-cell').filter({has:doc.locator('.name',{hasText:name})});
  await cell('broken-a.png').locator('.library-picture-error').click();
  await doc.getByRole('dialog',{name:'Library picture error'}).waitFor();
  await doc.getByRole('button',{name:'Ignore error',exact:true}).click();
  await doc.getByRole('dialog',{name:'Library picture error'}).waitFor({state:'detached'});
  assert.match(await cell('broken-a.png').locator('.library-picture-error').textContent(),/ignored/);
  const reloaded=page.waitForEvent('framenavigated',frame=>new URL(frame.url()).pathname==='/library');
  await frame.evaluate(el=>el.contentWindow.location.reload());
  await reloaded;
  await page.waitForFunction(()=>!!document.querySelector('#library-frame').contentWindow.HDRLibrary);
  await browse();
  await cell('broken-a.png').locator('.library-picture-error').waitFor();
  assert.match(await cell('broken-a.png').locator('.library-picture-error').textContent(),/ignored/);
  await frame.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),path.join(folder,'empty'));
  await doc.locator('#index-status').click();
  const activity=doc.locator('#library-activity');
  await activity.getByRole('button').filter({hasText:/broken-b.png/}).click();
  await doc.getByRole('dialog',{name:'Library picture error'}).waitFor();
  await doc.getByRole('button',{name:'Revert to original',exact:true}).click();
  await doc.getByRole('dialog',{name:'Library picture error'}).waitFor({state:'detached'});
  await page.waitForFunction(async photo=>{
   const w=document.querySelector('#library-frame').contentWindow;
   const response=await w.fetch('/api/library/live-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:photo,edge:640})});
   return response.ok&&!!(await response.json()).cached;
  },path.join(folder,'broken-b.png'),{timeout:90000});
  await browse();
  await cell('broken-b.png').locator('canvas[data-picture-key]:not([hidden])').waitFor({timeout:90000});
  assert.equal(await cell('broken-b.png').locator('.library-picture-error').count(),0);
  const saved=await frame.evaluate(async(el,photo)=>{
   const w=el.contentWindow;
   for(let i=0;i<100;i++){
    const settings=await w.fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json());
    if(settings.photos[0]?.storage==='sidecar')return true;
    await new Promise(r=>setTimeout(r,100));
   }return false;
  },path.join(folder,'broken-b.png'));
  assert.ok(saved,'Reset reaches the sidecar writer');
  const result=JSON.parse(fs.readFileSync(path.join(folder,'broken-b.png.hdrf'),'utf8'));
  assert.equal(result.grade,null);assert.equal(result.marks.rating,4);assert.deepEqual(result.marks.tags,['keep']);
  await page.screenshot({path:path.join(folder,'grid.png')});
  await cell('broken-a.png').locator('.library-picture-error').click();
  await page.screenshot({path:path.join(folder,'modal.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({healthyPictures:4,failedPictures:2,ignoreSurvivesReload:true,revertRequeues:true,marksPreserved:true,folder}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
