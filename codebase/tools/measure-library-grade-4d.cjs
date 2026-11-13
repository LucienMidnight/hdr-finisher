// One bounded real-app run; originals are never opened or changed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/library-grade-4d');
const photos=path.join(root,'output/test-photos'),folder=path.join(photos,'test-memory-4d');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(folder,{recursive:true});
const sources=[['library-mixed-v1-run','DSC03819.ARW'],['library-mixed-v1-run','DSC00264.ARW'],['batch5-edited','20250412_0039.ARW'],['batch5-edited','20250412_0039.ARW.hdrf'],['batch5-edited','DSC04375_DxO_clipped_-1.5EV.tif']];
for(const [dir,name]of sources){const target=path.join(folder,name);if(!fs.existsSync(target)){fs.copyFileSync(path.join(photos,dir,name),target);}}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-test-4d-'));
const config={batch4d:true,folder:folder.replaceAll('\\','/'),photoA:path.join(folder,'DSC03819.ARW').replaceAll('\\','/'),photoB:path.join(folder,'DSC00264.ARW').replaceAll('\\','/'),out};
const configPath=path.join(profile,'quick-config.json');fs.writeFileSync(configPath,JSON.stringify(config));
fs.writeFileSync(path.join(profile,'window-state.json'),JSON.stringify({x:0,y:0,...Object.fromEntries(['width','height'].map((k,i)=>[k,Number(require('./lib/platform.cjs').machineSettings().windowSize.split('x')[i])]))}));
const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HDR_FINISHER_QUICK_LIBRARY_CONFIG:configPath};delete env.ELECTRON_RUN_AS_NODE;
const desktop=path.join(root,'desktop');let app,observer,gpu;
function kill(p){if(p?.pid)try{require('./lib/platform.cjs').stopTree(p.pid);}catch{}}
(async()=>{const start=Date.now();try{
  fs.writeFileSync(path.join(out,'points.jsonl'),'');
  app=spawn(require(path.join(desktop,'node_modules/electron')),[desktop],{cwd:desktop,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const log=fs.createWriteStream(path.join(out,'electron.log'));app.stdout.pipe(log);app.stderr.pipe(log);
  observer=spawn(require('./lib/platform.cjs').pythonExecutable(),[path.join(__dirname,'measure-library-processes.py'),String(app.pid),'1'],{windowsHide:true});observer.stdout.pipe(fs.createWriteStream(path.join(out,'memory.jsonl')));observer.stderr.pipe(fs.createWriteStream(path.join(out,'process-errors.txt')));
  if(process.platform==='win32'){gpu=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'record-gpu-4d.ps1'),'-RootPid',String(app.pid),'-Output',path.join(out,'gpu.jsonl')],{windowsHide:true,stdio:['ignore','ignore','pipe']});gpu.stderr.pipe(fs.createWriteStream(path.join(out,'gpu-errors.txt')));}else{fs.writeFileSync(path.join(out,'gpu.jsonl'),JSON.stringify({unavailable:'NVIDIA board counters are Windows-only; process memory is sampled separately'})+'\n');}
  const result=path.join(profile,'quick-result.json');let last='';
  while(!fs.existsSync(result)){
    if(Date.now()-start>540000)throw Error('540s deadline reached');if(app.exitCode!==null)throw Error('App exited '+app.exitCode);
    try{const stage=JSON.parse(fs.readFileSync(path.join(profile,'quick-stage.json'))).stage;if(stage!==last){console.log(stage);last=stage;}}catch{}await sleep(200);
  }
  const report=JSON.parse(fs.readFileSync(result));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...report,elapsedMs:Date.now()-start,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),config},null,2));console.log(JSON.stringify(report));
  if(report.error)process.exitCode=1;
}finally{
  const log=path.join(profile,'logs/backend.log');if(fs.existsSync(log))fs.copyFileSync(log,path.join(out,'backend.log'));
  if(app&&app.exitCode===null){fs.writeFileSync(path.join(profile,'quick-quit'),'quit');await sleep(2000);}kill(app);kill(observer);kill(gpu);
  // Only our own resolved temporary directories are removed, with native PowerShell.
  for(const target of [profile,folder])require('./lib/platform.cjs').removeTestFolder(target,target===profile?os.tmpdir():photos);
}})().catch(e=>{fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack||e));console.error(e);process.exitCode=1;});
