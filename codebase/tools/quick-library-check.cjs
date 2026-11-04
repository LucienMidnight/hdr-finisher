// Plain Electron quick check: no Playwright, DevTools or remote debugging port.
// node tools/quick-library-check.cjs [--seconds=90] [--label=name] [--single] [--redisplay]
// --grade-handoff --folder=library-live-grid --seconds=6: one saved exposure hand-off and blank-tile check.
// --grade-return --folder=library-live-grid: Grade slider + typed value, Library tab + keyboard, F, Compare, settle.
// --retention --folder=hdr-test: focused memory acceptance across cancel/Grade/100% views; cadence is diagnostic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawn}=require('node:child_process');
const {MemoryMonitor}=require('./library-memory-monitor.cjs');
const root=path.resolve(__dirname,'..');
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const seconds=Number(arg('seconds',90)),label=arg('label','run');
const gradeHandoffMode=process.argv.includes("--grade-handoff");
const memoryDiagnostic=process.argv.includes('--memory-diagnostic');
const gradeReturnMode=process.argv.includes('--grade-return')||memoryDiagnostic;
const retentionMode=process.argv.includes('--retention')||gradeReturnMode;
const singleMode=process.argv.includes('--single'),singleSteps=Number(arg('steps',10)),singlePace=Number(arg('pace',1500));
// --back steps back over the same photos (same-session reopening); --hdr
// switches the Library to its HDR rendition before Single opens.
// --keep-profile=<name> reuses a named temporary profile, so a second run
// measures reopening after restart; remove it with --drop-profile on the last run.
const keepProfile=arg('keep-profile',null),dropProfile=process.argv.includes('--drop-profile');
if(keepProfile!==null&&!/^[\w-]+$/.test(keepProfile))throw Error('Profile name must be simple');
// --folder=<name> measures a reusable copy under output/test-photos instead of the locked fixture.
const folderName=arg('folder',null);
if(folderName!==null&&!/^[\w.-]+$/.test(folderName))throw Error('Folder must be a simple folder name under output/test-photos');
const folder=path.join(root,'output/test-photos',folderName??'library-mixed-v1-run');
if(folderName!==null&&!fs.existsSync(folder))throw Error('No such test-photos folder: '+folder);
const out=path.resolve(root,'output/quick-library-check',label);
if(path.dirname(out)!==path.join(root,'output/quick-library-check'))throw Error('Label must be a simple folder name');
if(!Number.isFinite(seconds)||seconds<=0||seconds>110||!Number.isInteger(singleSteps)||singleSteps<0||!Number.isFinite(singlePace)||singlePace<0)throw Error('Invalid duration, steps or pace');
fs.mkdirSync(out,{recursive:true});
for(const name of ['report.json','scenario.json','failure.json']){const file=path.join(out,name);if(fs.existsSync(file))fs.unlinkSync(file);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function freezeSummary(probe = {}) {
  const summary = (list = [], label) => {
    const values = list.map(item => item.ms).sort((a, b) => b - a);
    return { measure: label, longest_ms: values[0] ?? 0, top_five_ms: values.slice(0, 5),
      over_100ms_count: values.filter(ms => ms > 100).length,
      total_ms_over_100: Math.round(values.filter(ms => ms > 100).reduce((sum, ms) => sum + ms, 0)),
      over_250ms_count: values.filter(ms => ms > 250).length };
  };
  const tasks = (probe.long_tasks || []).map(item => item.ms).sort((a, b) => b - a);
  return { frame_gaps: summary(probe.frame_gaps, 'time the window did not draw a frame'),
    main_thread_blocks: summary(probe.main_blocks, 'main-thread blocks (20 ms timer late)'),
    long_tasks: { count: tasks.length, total_ms: Math.round(tasks.reduce((a, b) => a + b, 0)), longest_ms: tasks[0] ?? 0 } };
}

function analyse(text, openedAt, events, openedPageAt, visibleFiles) {
  const shown = new Map(), preview = new Map(), failed = new Map(), reclaims = [], memory = [], developed = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[library\] (\w+) (\{.*\})\s*$/);
    if (!m) continue;
    let d; try { d = JSON.parse(m[2]); } catch { continue; }
    const t = (d.time > 1e12 ? d.time / 1000 : d.time) - openedAt / 1000;
    if (t < 0) continue;
    const name = d.path ? path.basename(d.path) : null;
    if (m[1] === 'page_picture_work_failed' && name) failed.set(name, d.reason || d.error || '');
    if (m[1] === 'library_grant_reclaiming') reclaims.push([+t.toFixed(1), name]);
    if (m[1] === 'picture_live_developed') developed.push(t);
    if (m[1] === 'app_memory' && d.totalBytes) memory.push([t, d.totalBytes]);
  }
  const page=require('./library-quick-metrics.cjs').pictures(events,openedPageAt);
  for(const [name,t] of page.shown)shown.set(name,t);
  for(const [name,t] of page.preview)preview.set(name,t);
  const times = [...shown.values()].sort((a, b) => a - b);
  const at = n => times[n - 1] === undefined ? null : +times[n - 1].toFixed(1);
  const by = s => times.filter(x => x <= s).length;
  let gap = 0, last = 0;
  for (const x of times) { gap = Math.max(gap, x - last); last = x; }
  return {
    photos: visibleFiles?.length ?? 50, shown_by: { s15: by(15), s30: by(30), s60: by(60), s90: by(90), end: times.length },
    time_to: { first: at(1), ten: at(10), twenty: at(20), thirty: at(30), forty: at(40) },
    longest_picture_gap_s: +gap.toFixed(1), developments: developed.length,
    camera_previews: preview.size, reclaims, peak_gb: +(Math.max(0, ...memory.map(x => x[1])) / 1e9).toFixed(3),
    failed: Object.fromEntries(failed), not_shown: (visibleFiles ? visibleFiles.map(file=>path.basename(file)) : fs.readdirSync(folder).filter(n=>!n.endsWith(".hdrf"))).filter(n=>!shown.has(n)),
  };
}


(async()=>{
  const harnessAt=Date.now();
  // Always create our own empty profile; inherited real-app profile settings are ignored.
  const profile=keepProfile===null?fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-test-quick-')):path.join(os.tmpdir(),'hdr-finisher-test-quick-kept-'+keepProfile);
  if(keepProfile!==null){fs.mkdirSync(profile,{recursive:true});for(const name of ['quick-result.json','quick-stage.json','quick-quit'])fs.rmSync(path.join(profile,name),{force:true});}
  const cacheInventory=()=>Object.fromEntries(['DawnWebGPUCache','GPUCache','DawnGraphiteCache'].map(name=>{
    const directory=path.join(profile,name),files=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>fs.statSync(path.join(directory,n)).isFile()).map(n=>{const body=fs.readFileSync(path.join(directory,n));return {name:n,bytes:body.length,sha256:require('node:crypto').createHash('sha256').update(body).digest('hex')};}):[];
    let entries=[];
    const data=path.join(directory,'data_1');
    if(name==='DawnWebGPUCache'&&fs.existsSync(data)){
      const bytes=fs.readFileSync(data);
      if(bytes.readUInt32LE(12)===256)for(let offset=8192;offset+256<=bytes.length;offset+=256){
        const length=bytes.readInt32LE(offset+32),hash=bytes.readUInt32LE(offset);
        if(hash&&bytes.readInt32LE(offset+20)===0&&length>0&&length<=928)entries.push({hash,reuse:bytes.readInt32LE(offset+12),created:bytes.readBigUInt64LE(offset+24).toString()});
      }
    }
    return [name,{files,entries}];
  }));
  const cacheBefore=cacheInventory();
  const logPath=path.join(profile,'logs/backend.log');
  let app,observer,stage='fixture',done=false;
  // Grade close writes a sidecar through its normal save gate. Restore copies too.
  const sidecars=new Map(), hiddenFiles=[];
  const kill=()=>{
    observer?.kill();
    if(app?.pid){try{execFileSync('taskkill',['/pid',String(app.pid),'/T','/F'],{stdio:'ignore',timeout:5000});}catch{try{app.kill('SIGKILL');}catch{}}}
  };
  const cleanup=()=>{
    for(const [file,hidden] of hiddenFiles)if(fs.existsSync(hidden))fs.renameSync(hidden,file);
    for(const [file,original] of sidecars){if(original)fs.writeFileSync(file,original);else if(fs.existsSync(file))fs.unlinkSync(file);}
    if(keepProfile!==null&&!dropProfile)return;
    // Native PowerShell avoids Windows' extended-path removal failures.
    const script = '$target=[IO.Path]::GetFullPath($env:HDR_QUICK_PROFILE); $base=[IO.Path]::GetFullPath($env:HDR_QUICK_OUTPUT); if(!$target.StartsWith($base+[IO.Path]::DirectorySeparatorChar) -or !(Split-Path -Leaf $target).StartsWith("hdr-finisher-test-quick-")){throw "Unsafe cleanup target"}; if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop}';
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HDR_QUICK_PROFILE:profile,HDR_QUICK_OUTPUT:os.tmpdir()},windowsHide:true,stdio:'ignore',timeout:10000});
  };
  const currentStage=()=>{try{return JSON.parse(fs.readFileSync(path.join(profile,'quick-stage.json'),'utf8')).stage;}catch{return stage;}};
  const deadline=setTimeout(()=>{
    const failure=`Hard timeout (${retentionMode?420:130} s; shutdown bounded to 15 s), stage: ${currentStage()}`;
    console.error(failure);kill();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({label,error:failure,stage:currentStage(),harness_total_ms:Date.now()-harnessAt},null,1));
    try{cleanup();}catch{}process.exit(1);
  },retentionMode?420000:130000);
  const signal=()=>{kill();try{cleanup();}catch{}process.exit(130);};process.once('SIGINT',signal);process.once('SIGTERM',signal);
  try{
  if(retentionMode||gradeHandoffMode||process.argv.includes('--grade-handoff-pixels'))for(const directory of [folder,path.join(root,'output/test-photos/library-live-grid')]){
    for(const name of fs.readdirSync(directory).filter(n=>/\.ARW$/i.test(n))){
      const file=path.join(directory,name+'.hdrf');sidecars.set(file,fs.existsSync(file)?fs.readFileSync(file):null);
    }
  }
    if(folderName===null)execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-mixed-fixture.py'),'run-copy'],{stdio:'inherit',timeout:30000});
    // Reproduce the pre-5a default set without undoing the TIFF listing fix.
    if(process.argv.includes('--pre5a-set')){
      if(path.basename(folder)!=='library-mixed-v1-run')throw Error('Pre-5a set requires the standard fixture');
      for(const name of ['DJI_0071-2.tif','DSC04375_DxO_clipped_target.tif']){
        const file=path.join(folder,name),hidden=file+'.quick-hidden';
        if(fs.existsSync(hidden))throw Error('Fixture already hidden: '+hidden);
        fs.renameSync(file,hidden);hiddenFiles.push([file,hidden]);
      }
    }
    const config={timingOnly:process.argv.includes("--timing-only"),appStartedAt:Date.now(),warmupFolder:path.join(root,'output/test-photos/library-live-grid').replaceAll('\\','/'),startupWarm:process.argv.includes("--startup-warm"),noStartupWarm:process.argv.includes("--no-startup-warm"),coldPipelines:process.argv.includes("--cold-pipelines"),batch5c:process.argv.includes("--batch5c"),popout:process.argv.includes("--popout"),idle:process.argv.includes('--idle'),loseReservation:process.argv.includes('--lose-reservation'),fullscreen:process.argv.includes('--fullscreen'),busy:process.argv.includes('--busy'),pixelReviewOut:out,gradeHandoffPixels:process.argv.includes("--grade-handoff-pixels"),gradeHandoffPopout:process.argv.includes("--grade-handoff-popout"),gradeHandoff:gradeHandoffMode,memoryDiagnostic,gradeReturn:gradeReturnMode,retention:retentionMode,retentionFolder:path.join(root,"output/test-photos/library-live-grid").replaceAll("\\","/"),folder:folder.replaceAll('\\','/'),seconds,singleMode,steps:singleSteps,pace:singlePace,back:process.argv.includes('--back'),hdr:process.argv.includes('--hdr'),redisplay:process.argv.includes('--redisplay'),warm:process.argv.includes('--warm'),trace:process.env.HDR_FINISHER_QUICK_TRACE==='1',memoryProbe:process.argv.includes('--memory-probe'),diagnosticPhoto:process.env.HDR_FINISHER_QUICK_PHOTO||null};
    const configPath=path.join(profile,'quick-config.json');fs.writeFileSync(configPath,JSON.stringify(config));
    const [width,height]=(process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE||'2560x1440').split('x').map(Number);
    fs.writeFileSync(path.join(profile,'window-state.json'),JSON.stringify({x:0,y:0,width,height}));
    const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HDR_FINISHER_QUICK_LIBRARY_CONFIG:configPath};
    delete env.ELECTRON_RUN_AS_NODE;
    const desktop=path.join(root,'desktop');
    stage='launch';app=spawn(require(path.join(desktop,'node_modules/electron')),[desktop],{cwd:desktop,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let appError=null;
    app.on('error',error=>{appError=String(error);});
    const stdout=fs.createWriteStream(path.join(out,'electron.log'));app.stdout.pipe(stdout);app.stderr.pipe(stdout);
    const memory=new MemoryMonitor(4e9),memoryPath=path.join(out,'memory.jsonl');fs.writeFileSync(memoryPath,'');
    let pending='',observerError=null,sampleCount=0,lastSampleAt;const sampleIntervals=[];
    observer=spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'measure-library-processes.py'),String(app.pid),'.25'],{windowsHide:true});
    observer.on('error',e=>{observerError=String(e);});observer.stderr.on('data',chunk=>{observerError=String(chunk);});
    observer.stdout.on('data',chunk=>{
      pending+=chunk;let end;
      while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;
        try{const sample=JSON.parse(line);sampleCount++;if(lastSampleAt!==undefined)sampleIntervals.push(sample.at-lastSampleAt);lastSampleAt=sample.at;
          memory.sample(sample);fs.appendFileSync(memoryPath,line+'\n');}catch(error){observerError=String(error);}
      }
    });
    const resultPath=path.join(profile,'quick-result.json');
    let lastStage='';
    while(!fs.existsSync(resultPath)){
      if(appError)throw Error(appError);
      if(app.exitCode!==null)throw Error('Electron exited '+app.exitCode+' at '+currentStage());
      const next=currentStage();if(next!==lastStage){
        console.log('Library: '+next);lastStage=next;
        if(memoryDiagnostic && /^trim backend \d+$/.test(next)){
          const pid=next.split(' ').at(-1);
          const record=execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'trim-backend-working-set.py'),'--pid',pid],{encoding:'utf8',timeout:10000,windowsHide:true});
          fs.writeFileSync(path.join(out,'trim.json'),record);
        }
      }
      await sleep(100);
    }
    // Read the scenario and backend evidence only after completion.
    const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));done=true;
    fs.writeFileSync(path.join(out,'scenario.json'),JSON.stringify(result,null,1));
    fs.writeFileSync(path.join(out,'gpu-cache.json'),JSON.stringify({before:cacheBefore,after:cacheInventory()},null,1));
    if(config.trace)fs.copyFileSync(path.join(profile,'diagnostic-trace.json'),path.join(out,'diagnostic-trace.json'));
    if(result.error)throw Error(result.error);
    if(result.pixelReview&&result.pixelReview!==out)for(const name of fs.readdirSync(result.pixelReview))fs.copyFileSync(path.join(result.pixelReview,name),path.join(out,name));
    const text=fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8'):'';fs.writeFileSync(path.join(out,'backend.log'),text);
    const freezes=freezeSummary(result.probe),failures=[];
    if(gradeReturnMode){
      if(!result.grade_return||result.stage!=='done')result.errors.push('Grade return sequence did not complete');
      else {
        const saved=JSON.parse(fs.readFileSync(result.grade_return.path+'.hdrf','utf8'));
        if(saved.grade?.global_adjustments?.hdr?.exposure!==result.grade_return.exposure)result.errors.push('Adjusted exposure did not reach the sidecar');
      }
      for(const lane of ['helper','writer']){
        const pauses=text.split('\n').filter(l=>l.startsWith('[library] '+lane+'_pause ')).length;
        const resumes=text.split('\n').filter(l=>l.startsWith('[library] '+lane+'_resume ')).length;
        if(pauses!==resumes)result.errors.push(`${lane}: ${pauses} pauses, ${resumes} resumes`);
      }
      const queued=new Map(), saves=[];
      for(const line of text.split('\n')){
        const match=line.match(/^\[library\] (grade_save_queued|grade_saved) (\{.*\})$/);if(!match)continue;
        const d=JSON.parse(match[2]);
        if(match[1]==='grade_save_queued')queued.set(d.photo,[...(queued.get(d.photo)||[]),d.time]);
        else for(const at of queued.get(d.photo)||[]){saves.push({photo:d.photo,ms:(d.time-at)*1000});queued.delete(d.photo);}
      }
      if(!saves.length)result.errors.push('No completed grade save');
      if(queued.size)result.errors.push('Grade saves remain queued');
      for(const save of saves)if(save.ms>1000)result.errors.push(`Grade save took ${Math.round(save.ms)} ms (limit 1000)`);
      result.grade_return_saves=saves;
    }
    if(freezes.frame_gaps.longest_ms>250)failures.push(`frame gap ${freezes.frame_gaps.longest_ms} ms`);
    if(freezes.main_thread_blocks.longest_ms>250)failures.push(`main thread block ${freezes.main_thread_blocks.longest_ms} ms`);
    const errors=[...(result.errors||[])];if(!sampleCount||observerError)errors.push('Independent memory observer: '+(observerError||'no samples'));
    sampleIntervals.sort((a,b)=>a-b);
    // Stored pictures with a whole colour channel at zero (teal/black thumbnails).
    let channels;
    try{channels=JSON.parse(execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-channel-audit.py'),path.join(profile,'Cache')],{timeout:60000}).toString());}
    catch(error){channels={error:String(error.message||error)};}
    if(channels.one_channel_zero?.length||channels.all_channels_zero?.length)errors.push(`Zeroed colour channels in ${channels.one_channel_zero.length+channels.all_channels_zero.length} stored pictures`);
    const report={label,acceptance_scope:config.gradeHandoffPixels?'42 MP visible-pixel hand-off':retentionMode?'whole-app retention (cadence recorded separately)':'Library quick check',folder:folderName??'library-mixed-v1-run',gpu_developments:process.env.HDR_FINISHER_LIBRARY_GPU_DEVELOPMENTS==='1'?1:2,stored_channels:channels,commit:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root}).toString().trim(),seconds,single_mode:singleMode,errors,
      ...(config.gradeHandoffPixels?{}:analyse(text,result.opened_epoch_ms,result.events,result.opened_ms,result.visible_files)),grid_progress:result.grid_progress,redisplay:result.redisplay,freezes:{...freezes,failure:failures},single:result.single,memory_diagnostic:result.memory_diagnostic,grade_handoff:result.grade_handoff,grade_return:result.grade_return,grade_return_saves:result.grade_return_saves,
      independent_memory:{...memory.report(),samples:sampleCount,lastBytes:memory.last?.totalBytes,sampleIntervalMs:{requested:250,median:sampleIntervals[Math.floor(sampleIntervals.length/2)],maximum:sampleIntervals.at(-1)},grants_note:'External process census; no DevTools WebSocket instrumentation.'},observerError,
      picture_timing_clock:'Library performance.now()',stage:result.stage,scenario_ms:result.scenario_ms,harness_total_ms:Date.now()-harnessAt,harness_outside_scenario_ms:Date.now()-harnessAt-result.scenario_ms,cdp_attached:false};
    if(failures.length&&!retentionMode){console.error(`FREEZE: ${failures.join('; ')} (limit 250 ms)`);process.exitCode=1;}
    errors.push(...memory.failures());
    if(result.retention){
      const samples=fs.readFileSync(memoryPath,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      report.retention=result.retention.map(check=>{
        const tail=samples.filter(s=>s.at>=check.end_epoch_ms-2000&&s.at<=check.end_epoch_ms);
        const unfinished=Object.values(check.snapshot||{}).flatMap(q=>q.jobs||[]).filter(j=>!j.background);
        const settled=tail.length>=4&&tail.every(s=>s.totalBytes<3.4e9)&&unfinished.length===0;
        if(!settled)errors.push('Retention did not settle after '+check.stage);
        return {...check,settled,unfinished,settledBytes:tail.length?Math.max(...tail.map(s=>s.totalBytes)):null,samples:tail.length};
      });
    }
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
    console.log(JSON.stringify(report,null,1));
    if(errors.length){console.error(errors.join('; '));process.exitCode=1;}
  }catch(error){console.error(error);process.exitCode=1;
    fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error.stack||error),stage:currentStage(),done},null,1));
  }finally{
    clearTimeout(deadline);const shutdownAt=Date.now();
    if(done && app?.exitCode===null){fs.writeFileSync(path.join(profile,'quick-quit'),'quit');const end=Date.now()+4000;while(app.exitCode===null&&Date.now()<end)await sleep(50);}
    fs.writeFileSync(path.join(out,'gpu-cache.json'),JSON.stringify({before:cacheBefore,after:cacheInventory()},null,1));
    kill();process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
    cleanup();
    const reportPath=path.join(out,'report.json');
    if(fs.existsSync(reportPath)){const final=JSON.parse(fs.readFileSync(reportPath,'utf8'));final.shutdown_cleanup_ms=Date.now()-shutdownAt;final.harness_total_ms=Date.now()-harnessAt;final.harness_outside_scenario_ms=final.harness_total_ms-(final.scenario_ms||0);fs.writeFileSync(reportPath,JSON.stringify(final,null,1));}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
