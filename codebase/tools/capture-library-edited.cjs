/* Capture finished edited grid, filmstrip and Single before/after Part C.
 * node tests/run-in-electron.js tools/capture-library-edited.cjs --baseline
 * Originals are read only; one reusable source copy serves every virtual variant.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {hashProjects,checkProjects}=require('../tests/release/runner.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'output/part-c-edited');
const folder=path.join(root,'output/test-photos/part-c-edited'),phase=process.argv.includes('--baseline')?'baseline':'after',out=path.join(base,phase);
fs.mkdirSync(out,{recursive:true});
const protectedProjects=require('../tests/release/drivers.json').protectedProjects,before=hashProjects(protectedProjects);
execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-edited-fixtures.py'),folder]);
(async()=>{
 const browser=await chromium.launch(),report={phase,images:[],errors:[]};
 try{
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(process.env.HDR_FINISHER_URL);await page.evaluate(()=>activateWorkflowTab('import'));
  const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
  await lib.evaluate(()=>{document.querySelector('[data-sort="name"]').click();});
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
  await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===5,null,{timeout:60000});
  await lib.waitForFunction(()=>[...document.querySelectorAll('#grid-space .library-cell canvas[data-picture-key]')].filter(c=>!c.hidden).length===5,null,{timeout:300000});
  await lib.locator('#grid-space').screenshot({path:path.join(out,'grid.png')});report.images.push('grid.png');
  const paths=await lib.evaluate(()=>HDRLibrary.getSnapshot().paths);
  for(let i=0;i<paths.length;i++){
   await lib.evaluate(p=>{const c=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===p);c.click();document.getElementById('single-view').click();},paths[i]);
   await lib.waitForFunction(p=>{const c=document.getElementById('single-picture');return c.dataset.picturePath===p&&Number(c.dataset.pictureEdge)===2560&&!c.hidden;},paths[i],{timeout:300000});
   const name=`single-${i}.png`;await page.screenshot({path:path.join(out,name),clip:await lib.locator('#single-picture').boundingBox()});report.images.push(name);
   await lib.waitForFunction(()=>[...document.querySelectorAll('#filmstrip .library-cell canvas[data-picture-key], #film-space .library-cell canvas[data-picture-key]')].filter(c=>!c.hidden).length>=1,null,{timeout:60000});
   if(i===0){await page.screenshot({path:path.join(out,'filmstrip.png')});report.images.push('filmstrip.png');}
   await lib.evaluate(()=>document.getElementById('grid-view').click());
  }
  report.complete=true;report.paths=paths;assert.deepEqual(report.errors,[]);
 }finally{
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  checkProjects(before,protectedProjects);await browser.close();
  // Only this tool's disposable source links/sidecars; keep captures and manifest.
  fs.rmSync(path.join(folder,'DSC00264.ARW.hdrf'),{force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});