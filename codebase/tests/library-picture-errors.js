/* Real grid on one reusable real-photo copy; virtual copies exercise grades. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const root=path.resolve(__dirname,".."),folder=path.join(root,"output/test-photos/graceful-grades");
const review=path.join(root,"output/graceful-grades"),photo=path.join(folder,"photo.jpg"),sidecar=photo+".hdrf";
const reusePhoto=require('./helpers/reuse-test-photo.cjs');
reusePhoto(reusePhoto.source('DSC_3931_01.jpg'),path.join(root,'output/graceful-grades/photo.jpg'));
fs.mkdirSync(review,{recursive:true});
const original=fs.readFileSync(photo);
execFileSync(require('../tools/lib/platform.cjs').pythonExecutable(),["-c",`
import json,sys
from pathlib import Path
from hdr_finisher.sessions import SessionStore
p=Path(sys.argv[1])
grade=SessionStore().prepare_session(p,owns_source_path=False).edit_document().model_dump(mode="json")
bad=json.loads(json.dumps(grade)); bad["global_adjustments"]["hdr"]["exposure"]=999
future=json.loads(json.dumps(grade)); future["app_version"]="99.0.0"
copies=[dict(photo_id=key,name=key,grade=value,marks={})
 for key,value in (("damaged-tone",bad),("whole-grade","unreadable grade"),("newer-grade",future))]
doc=dict(format="HDR Finisher Photo",schema_version=1,photo_id="healthy",contains_source_pixels=False,marks={},virtual_copies=copies)
Path(str(p)+".hdrf").write_text(json.dumps(doc),encoding="utf-8")
`,photo],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,"backend")},stdio:"pipe"});
(async()=>{
 let browser;
 try {
  browser=await chromium.launch();
  const page=await browser.newPage(),errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  // JPEG originals are listed only with Show all files (November 3).
  await page.addInitScript(()=>localStorage.setItem("hdr-finisher:library-show-all-files","true"));
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(()=>activateWorkflowTab("import"));
  const frame=page.locator("#library-frame"),doc=page.frameLocator("#library-frame");
  await frame.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
  await page.waitForFunction(()=>{
   const d=document.querySelector("#library-frame").contentDocument;
   return d.querySelectorAll("#grid-space canvas[data-picture-key]:not([hidden])").length===4 &&
          d.querySelectorAll("#grid-space .library-picture-error").length===3;
  },null,{timeout:90000});
  assert.deepEqual(fs.readFileSync(photo),original);
  const warnings=await frame.evaluate(async el=>(await el.contentWindow.fetch("/api/library/health").then(r=>r.json())).picture_errors);
  assert.equal(warnings.length,3); assert.ok(warnings.every(item=>item.grade_warning));
  await page.screenshot({path:path.join(review,"grid.png")});
  const badge=doc.locator("#grid-space .library-picture-error").first();
  await badge.click();
  const dialog=doc.getByRole("dialog",{name:"Library preview error"});
  for(const label of ["Continue without them","Revert to original","Leave as is"])await dialog.getByRole("button",{name:label,exact:true}).waitFor();
  const before=fs.readFileSync(sidecar);
  await dialog.getByRole("button",{name:"Leave as is",exact:true}).click();
  assert.deepEqual(fs.readFileSync(sidecar),before);
  await badge.click();
  await page.screenshot({path:path.join(review,"warning.png")});
  await dialog.getByRole("button",{name:"Continue without them",exact:true}).click();
  await dialog.waitFor({state:"detached"});
  // Queue counters can reach zero before the file observer sees replacement.
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    const value=JSON.parse(fs.readFileSync(sidecar,"utf8"));
    if(value.virtual_copies.some(item=>item.grade_history?.grade_backups?.length))break;
    await page.waitForTimeout(100);
  }
  const saved=JSON.parse(fs.readFileSync(sidecar,"utf8"));
  assert.ok(saved.virtual_copies.some(item=>item.grade_history?.grade_backups?.length));
  assert.deepEqual(fs.readFileSync(photo),original);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pictures:4,warningBadges:3,leaveDoesNotWrite:true,continueKeepsBackup:true,review}));
 } finally {
  if(browser)await browser.close();
  fs.rmSync(sidecar,{force:true,maxRetries:20,retryDelay:100});
  const profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
  if(profile && path.resolve(profile).startsWith(path.resolve(require("node:os").tmpdir())+path.sep)
    && path.basename(profile).startsWith("hdr-finisher-graceful-"))
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
