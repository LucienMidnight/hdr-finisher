// Loaded by main.js only when the explicit quick-check switch is present.
const fs = require('node:fs'), path = require('node:path');
async function run({app, window, backend, configPath = process.env.HDR_FINISHER_QUICK_LIBRARY_CONFIG}) {
  if (!configPath) return;
  const profile = app.getPath('userData');
  if (!path.basename(profile).includes('test-')) throw Error('Quick check requires a test- profile');
  if (path.resolve(configPath) !== path.join(profile, 'quick-config.json')) throw Error('Config must be inside the test profile');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const stagePath = path.join(profile, 'quick-stage.json');
  const resultPath = path.join(profile, 'quick-result.json');
  const quitTimer=setInterval(()=>{if(fs.existsSync(path.join(profile,'quick-quit'))){clearInterval(quitTimer);for(const w of require('electron').BrowserWindow.getAllWindows())w.destroy();app.quit();}},50);quitTimer.unref();
  const stage = name => fs.writeFileSync(stagePath, JSON.stringify({stage:name}));
  window.webContents.on('console-message', (_event, ...args) => {
    const message = args.find(value => typeof value === 'string' && value.startsWith('QUICK_LIBRARY_STAGE:'));
    if (message) stage(message.slice('QUICK_LIBRARY_STAGE:'.length));
  });
  try {
    stage('cache guard');
    const cache = await (await fetch(`${backend.url}/api/library/cache-settings`, {
      headers:{'X-HDR-Finisher-Token':backend.authoringSecret}, signal:AbortSignal.timeout(10000)
    })).json();
    const location = String(cache.location || '');
    if (!location.toLowerCase().includes('test-') || !config.warm && fs.existsSync(path.join(location, 'library-pictures')) && fs.readdirSync(path.join(location, 'library-pictures')).length)
      throw Error('Not an empty isolated cache: ' + location);
    if(config.trace)await require('electron').contentTracing.startRecording({included_categories:['toplevel','devtools.timeline','v8']});
    stage('shell ready');
    await window.webContents.executeJavaScript(`(async()=>{while(document.body?.dataset.ready!=='true'||!document.getElementById('library-frame')?.contentWindow?.HDRLibrary)await new Promise(r=>setTimeout(r,20));activateWorkflowTab('import');})()`);
    const frame = window.webContents.mainFrame.framesInSubtree.find(frame => /\/library(?:\?|$)/.test(frame.url));
    if (!frame) throw Error('Library frame missing');
    if(config.batch4d){const result=await require('./library-memory-4d.cjs').run({app,window,frame,config,stage,backend});fs.writeFileSync(resultPath,JSON.stringify(result));stage('done');return;}
    if(config.pixelCapture){await require('./library-pixel-test.cjs').run({frame,config,stage});stage('done');return;}
    if(config.batch5c){const result=await require('./library-wait-check.cjs').run({window,frame,config,stage});result.appStartToScenarioDoneMs=Date.now()-config.appStartedAt;fs.writeFileSync(resultPath,JSON.stringify(result));stage('done');return;}
    const source = fs.readFileSync(path.join(__dirname, '../tools/quick-library-scenario.js'), 'utf8');
    const result = config.gradeHandoffPixels ? await require('./library-grade-picture-check.cjs').run({window,frame,config,stage}) : await frame.executeJavaScript(`(${source})(${JSON.stringify(config)})`);
    if(config.gradeHandoffPopout&&result.grade_handoff&&result.stage==='done'){
      stage('handoff: pop out Library');
      await frame.executeJavaScript(`document.getElementById('popout-library').click()`);
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const wait=async predicate=>{const end=Date.now()+30000;while(!await predicate()){if(Date.now()>end)throw Error('Detached hand-off timed out');await sleep(25);}};
      let detached;
      await wait(()=>{detached=require('electron').BrowserWindow.getAllWindows().find(w=>w!==window&&/\/library(?:\?|$)/.test(w.webContents.getURL()));return !!detached;});
      window.setBounds({x:0,y:0,width:1200,height:1000});detached.setBounds({x:1220,y:0,width:1200,height:1000});
      await wait(()=>detached.webContents.executeJavaScript(`document.body.dataset.libraryReady==='true'&&HDRLibrary.getSnapshot().visible>0&&[...document.querySelectorAll('#grid-space .library-cell')].every(c=>c.querySelector('canvas[data-picture-key]:not([hidden])'))`));
      await detached.webContents.executeJavaScript(`window.handoffEvents=[];window.handoffBlanks=0;const originalStopwatch=HDRLibraryStopwatch;window.HDRLibraryStopwatch=(stage,fields)=>{if(stage==='grade_picture_handoff')handoffEvents.push(fields);originalStopwatch(stage,fields);};window.handoffBlankTimer=setInterval(()=>{for(const c of document.querySelectorAll('#grid-space .library-cell'))if(!c.querySelector('canvas[data-picture-key]:not([hidden])'))handoffBlanks++;},16);`);
      await window.webContents.executeJavaScript(`activateWorkflowTab('grade')`);window.focus();
      await wait(()=>window.webContents.executeJavaScript(`HDRGradeSaving.ready()&&HDRGradeLibraryPictures.getSnapshot().clean`));
      await window.webContents.executeJavaScript(`(()=>{const control=document.getElementById('hdr-exposure');control.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:993}));control.value=String(Number(control.value)+.25);control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));control.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:993}));})()`);
      await wait(()=>detached.webContents.executeJavaScript(`handoffEvents.length>0`));
      const popout=await detached.webContents.executeJavaScript(`(()=>{clearInterval(handoffBlankTimer);return {handoff:handoffEvents.at(-1),blank_tiles:handoffBlanks,marked:!!document.querySelector('canvas[data-grade-handoff]')};})()`);
      result.grade_handoff.popout=popout;
      if(!popout.marked||popout.blank_tiles||!popout.handoff.route.startsWith('Grade picture'))result.errors.push('Detached Library failed to reuse Grade picture: '+JSON.stringify(popout));
      if(popout.handoff.available_to_picture_ms>500)result.errors.push('Detached hand-off missed 500 ms: '+popout.handoff.available_to_picture_ms);
    }
    if(config.trace)await require('electron').contentTracing.stopRecording(path.join(profile,'diagnostic-trace.json'));
    if(config.memoryProbe)result.memory_probe=await require('./quick-memory-probe.cjs').probe({app,window,frame});
    fs.writeFileSync(resultPath+'.tmp', JSON.stringify(result));
    fs.renameSync(resultPath+'.tmp', resultPath);
    stage('done');
  } catch(error) {
    fs.writeFileSync(resultPath, JSON.stringify({error:String(error.stack || error)}));
    stage('failed');
  }
}
module.exports = {run};
