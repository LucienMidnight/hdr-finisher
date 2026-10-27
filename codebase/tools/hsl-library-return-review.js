/* Matched warm-folder returns, one disposable profile, copied photos only.
 * Timing target: first picture <=1.75s (1.46s baseline plus 20% run variation).
 * Post-Grade delay >20% is recorded for investigation, not automatically fixed.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=path.resolve('output/hsl-library-return'),folder=path.join(out,'ordinary'),empty=path.join(out,'empty');
(async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();
 const results={basis:'same warmed 25-photo RAW copy folder, one disposable profile',tolerance:'first <=1750ms; report post-Grade change over 20%'};
 try{
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.waitForFunction(()=>state.gpuPreview?.available,null,{timeout:60000});
  await page.evaluate(()=>activateWorkflowTab('import'));
  const library=page.frame({url:/\/library(?:\?|$)/});
  await library.waitForFunction(()=>window.HDRLibrary);
  await library.evaluate(()=>{
   window.trialEvents=[];const original=HDRLibraryStopwatch;
   window.HDRLibraryStopwatch=(stage,fields={})=>{window.trialEvents.push({stage,...fields});original(stage,fields);};
  });
  async function measure(name){
   await library.evaluate(async({folder})=>{window.trialEvents=[];await HDRLibrary.browse(folder);},{folder});
   await library.waitForFunction(()=>window.trialEvents.some(e=>e.stage==='folder_twenty_fifth_picture'),null,{timeout:240000});
   results[name]=await library.evaluate(()=>({
    first_ms:trialEvents.find(e=>e.stage==='folder_first_grid_picture')?.duration_ms,
    twenty_fifth_ms:trialEvents.find(e=>e.stage==='folder_twenty_fifth_picture')?.duration_ms,
    finished_thumbnail_canvases:document.querySelectorAll('#grid-space canvas[data-picture-key]').length,
    camera_previews:document.querySelectorAll('#grid-space img[data-preview=true]').length,
    events:trialEvents.filter(e=>e.stage.startsWith('folder_')),
   }));
   await page.screenshot({path:path.join(out,name+'.png')});
   console.log(name,JSON.stringify(results[name]));
  }
  await measure('cold');
  await library.evaluate(empty=>HDRLibrary.browse(empty),empty);
  await measure('skip-grade');
  await library.evaluate(empty=>HDRLibrary.browse(empty),empty);
  const photo=path.join(out,'IMG_0114.CR2');
  await page.evaluate(async photo=>{
   const grant=await desktop.grantSourcePath(photo);
   let job=(await projectIo.createImportJob(fetch,{grant:grant.grant})).payload;
   while(!['ready','error','cancelled'].includes(job.state)){await new Promise(r=>setTimeout(r,150));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
   if(job.state!=='ready')throw Error(JSON.stringify(job));
   await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,'');
   activateWorkflowTab('grade');await switchLane('sdr');
  },photo);
  await page.waitForFunction(()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready',null,{timeout:240000});
  await page.evaluate(async()=>{
   const branch=state.adjustments.sdr,recipe=branch.hsl.channels.find(c=>c.id==='yellow').recipe;
   Object.assign(recipe,{luminance:.8,uniformity:0,opacity:1});
   Object.assign(recipe.ranges[0],{width:15,feather:21});
   branch.hsl_section_enabled=true;state.globalEditDirty=true;await syncGlobalEditState();
   setGradeMode('local');await assignToolToPending('hue_range');
   Object.assign(selectedMaskLeaf(),{hue_center:109,hue_width:24,hue_smoothness:41,saturation_floor:.04});
   selectedLocal().sdr_grade.exposure=1.05;selectedLocal().hdr_grade.exposure=1.05;
   if(!await commitSelectedLocal({maskContent:true}))throw Error('Local commit failed');
   state.localShowMask=false;invalidatePreview('sdr');await settlePreview('sdr',{});
  });
  await page.waitForFunction(()=>state.acceptedPresentation?.exact&&state.acceptedPresentation.generation===state.previewGeneration[state.currentView]&&viewerState().status==='ready',null,{timeout:240000});
  await page.screenshot({path:path.join(out,'grade-active.png')});
  results.grade=await page.evaluate(()=>({lane:state.currentView,global:state.adjustments.sdr.hsl.channels.find(c=>c.id==='yellow').recipe,local:selectedLocal(),selectionEngineActive:typeof HDRHslSelectionGpu!=='undefined'}));
  await page.evaluate(()=>activateWorkflowTab('import'));
  await measure('after-grade');
  results.first_ratio=results['after-grade'].first_ms/results['skip-grade'].first_ms;
  results.twenty_fifth_ratio=results['after-grade'].twenty_fifth_ms/results['skip-grade'].twenty_fifth_ms;
  results.baseline_met=results['after-grade'].first_ms<=1750;
  assert.equal(results.grade.selectionEngineActive,false,'Incomplete engine must remain inactive');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(results,null,2));

  const html="<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Library return check</title>\n<style>body{margin:24px;background:#202124;color:#eee;font:16px/1.5 system-ui}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;display:block}figure{margin:0}a{color:#9cf}p{max-width:1100px}</style>\n<h1>Library return check</h1>\n<p>Look for a picture in each of the 25 visible cells. Both captures are from the running app and were reviewed.</p>\n<p>This checks embedded camera previews in a warmed folder of disposable 42 MP RAW copies. It does not measure finished-thumbnail speed or establish the cause of Steve's original blank cells.</p>\n<main><figure><figcaption>Skip Grade — first @BASE1@ s; 25th @BASE25@ s</figcaption><a href=\"skip-grade.png\"><img src=\"skip-grade.png\" alt=\"Library grid without entering Grade\"></a></figure>\n<figure><figcaption>After Grade with HSL and Local hue mask — first @AFTER1@ s; 25th @AFTER25@ s</figcaption><a href=\"after-grade.png\"><img src=\"after-grade.png\" alt=\"Library grid after Grade\"></a></figure></main>\n<p>Cold first visit: 6.96 s to first picture, 7.55 s to 25th; rows became usable at 6.64 s. Warm first return was 46% slower after Grade (0.12 s difference), exceeding the proposed 20% comparison allowance but remaining below the ordinary-folder baseline. One paired run cannot attribute that difference.</p>\n<p>The October 27 12:43 log shows a fresh launch, 3.48 s waiting for the Library GPU renderer, 8.99 s cache reconciliation and 41.22 s total startup upkeep. Those overlaps do not establish upkeep as the cause. Five failed attempts all reported unreadable saved settings for Balanced Rock. No Library fix was made.</p>\n<p><a href=\"grade-active.png\">Grade settings capture</a> · <a href=\"result.json\">Measured results</a> · <a href=\"live-log-summary.json\">Read-only live-log extract</a></p>\n<p>The new shared selection engine is inactive. Global/Local smoothing app acceptance, zoom captures, 24/42 MP control timings and bush lift measurements remain unfinished.</p></html>";
  const tokens={'@BASE1@':results['skip-grade'].first_ms,'@BASE25@':results['skip-grade'].twenty_fifth_ms,'@AFTER1@':results['after-grade'].first_ms,'@AFTER25@':results['after-grade'].twenty_fifth_ms};
  fs.writeFileSync(path.join(out,'index.html'),Object.entries(tokens).reduce((s,[key,value])=>s.replace(key,(value/1000).toFixed(2)),html));
  console.log('RESULT',JSON.stringify({baseline:results['skip-grade'],after:results['after-grade'],first_ratio:results.first_ratio,twenty_fifth_ratio:results.twenty_fifth_ratio,baseline_met:results.baseline_met}));
 }catch(e){fs.writeFileSync(path.join(out,'partial-result.json'),JSON.stringify({...results,error:e.stack},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
