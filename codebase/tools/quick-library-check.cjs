// Plain Electron quick check: no Playwright, DevTools or remote debugging port.
// node tools/quick-library-check.cjs [--seconds=90] [--label=name] [--single]
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawn}=require('node:child_process');
const {MemoryMonitor}=require('./library-memory-monitor.cjs');
const root=path.resolve(__dirname,'..');
const arg=(name,fallback)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const seconds=Number(arg('seconds',90)),label=arg('label','run');
const singleMode=process.argv.includes('--single'),singleSteps=Number(arg('steps',10)),singlePace=Number(arg('pace',1500));
const folder=path.join(root,'output/test-photos/library-mixed-v1-run');
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

function analyse(text, openedAt, events, openedPageAt) {
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
    photos: 50, shown_by: { s15: by(15), s30: by(30), s60: by(60), s90: by(90), end: times.length },
    time_to: { first: at(1), ten: at(10), twenty: at(20), thirty: at(30), forty: at(40) },
    longest_picture_gap_s: +gap.toFixed(1), developments: developed.length,
    camera_previews: preview.size, reclaims, peak_gb: +(Math.max(0, ...memory.map(x => x[1])) / 1e9).toFixed(3),
    failed: Object.fromEntries(failed), not_shown: fs.readdirSync(folder).filter(n => !n.endsWith('.hdrf') && !shown.has(n)),
  };
}


(async()=>{
  const harnessAt=Date.now();
  // Always create our own empty profile; inherited real-app profile settings are ignored.
  const profile=fs.mkdtempSync(path.join(root,'output','quick-library-test-'));
  const logPath=path.join(profile,'logs/backend.log');
  let app,observer,stage='fixture',done=false;
  const kill=()=>{
    observer?.kill();
    if(app?.pid){try{execFileSync('taskkill',['/pid',String(app.pid),'/T','/F'],{stdio:'ignore',timeout:5000});}catch{try{app.kill('SIGKILL');}catch{}}}
  };
  const cleanup=()=>{
    // Native PowerShell avoids Windows' extended-path removal failures.
    const script = '$target=[IO.Path]::GetFullPath($env:HDR_QUICK_PROFILE); $base=[IO.Path]::GetFullPath($env:HDR_QUICK_OUTPUT); if(!$target.StartsWith($base+[IO.Path]::DirectorySeparatorChar) -or !(Split-Path -Leaf $target).StartsWith("quick-library-test-")){throw "Unsafe cleanup target"}; if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop}';
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HDR_QUICK_PROFILE:profile,HDR_QUICK_OUTPUT:path.join(root,'output')},windowsHide:true,stdio:'ignore',timeout:10000});
  };
  const currentStage=()=>{try{return JSON.parse(fs.readFileSync(path.join(profile,'quick-stage.json'),'utf8')).stage;}catch{return stage;}};
  const deadline=setTimeout(()=>{
    const failure=`Hard timeout (130 s; shutdown bounded to 15 s), stage: ${currentStage()}`;
    console.error(failure);kill();
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({label,error:failure,stage:currentStage(),harness_total_ms:Date.now()-harnessAt},null,1));
    try{cleanup();}catch{}process.exit(1);
  },130000);
  const signal=()=>{kill();try{cleanup();}catch{}process.exit(130);};process.once('SIGINT',signal);process.once('SIGTERM',signal);
  try{
    execFileSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'library-mixed-fixture.py'),'run-copy'],{stdio:'inherit',timeout:30000});
    const config={folder:folder.replaceAll('\\','/'),seconds,singleMode,steps:singleSteps,pace:singlePace,warm:process.argv.includes('--warm'),trace:process.env.HDR_FINISHER_QUICK_TRACE==='1',diagnosticPhoto:process.env.HDR_FINISHER_QUICK_PHOTO||null};
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
      const next=currentStage();if(next!==lastStage){console.log('Library: '+next);lastStage=next;}
      await sleep(100);
    }
    // Read the scenario and backend evidence only after completion.
    const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));done=true;
    fs.writeFileSync(path.join(out,'scenario.json'),JSON.stringify(result,null,1));
    if(config.trace)fs.copyFileSync(path.join(profile,'diagnostic-trace.json'),path.join(out,'diagnostic-trace.json'));
    if(result.error)throw Error(result.error);
    const text=fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8'):'';fs.writeFileSync(path.join(out,'backend.log'),text);
    const freezes=freezeSummary(result.probe),failures=[];
    if(freezes.frame_gaps.longest_ms>250)failures.push(`frame gap ${freezes.frame_gaps.longest_ms} ms`);
    if(freezes.main_thread_blocks.longest_ms>250)failures.push(`main thread block ${freezes.main_thread_blocks.longest_ms} ms`);
    const errors=[...(result.errors||[])];if(!sampleCount||observerError)errors.push('Independent memory observer: '+(observerError||'no samples'));
    sampleIntervals.sort((a,b)=>a-b);
    const report={label,commit:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root}).toString().trim(),seconds,single_mode:singleMode,errors,
      ...analyse(text,result.opened_epoch_ms,result.events,result.opened_ms),grid_progress:result.grid_progress,freezes:{...freezes,failure:failures},single:result.single,
      independent_memory:{...memory.report(),samples:sampleCount,lastBytes:memory.last?.totalBytes,sampleIntervalMs:{requested:250,median:sampleIntervals[Math.floor(sampleIntervals.length/2)],maximum:sampleIntervals.at(-1)},grants_note:'External process census; no DevTools WebSocket instrumentation.'},observerError,
      picture_timing_clock:'Library performance.now()',stage:result.stage,scenario_ms:result.scenario_ms,harness_total_ms:Date.now()-harnessAt,harness_outside_scenario_ms:Date.now()-harnessAt-result.scenario_ms,cdp_attached:false};
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
    console.log(JSON.stringify(report,null,1));
    if(failures.length){console.error(`FREEZE: ${failures.join('; ')} (limit 250 ms)`);process.exitCode=1;}
    if(errors.length)process.exitCode=1;
  }catch(error){console.error(error);process.exitCode=1;
    fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error.stack||error),stage:currentStage(),done},null,1));
  }finally{
    clearTimeout(deadline);const shutdownAt=Date.now();kill();process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
    cleanup();
    const reportPath=path.join(out,'report.json');
    if(fs.existsSync(reportPath)){const final=JSON.parse(fs.readFileSync(reportPath,'utf8'));final.shutdown_cleanup_ms=Date.now()-shutdownAt;final.harness_total_ms=Date.now()-harnessAt;final.harness_outside_scenario_ms=final.harness_total_ms-(final.scenario_ms||0);fs.writeFileSync(reportPath,JSON.stringify(final,null,1));}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
