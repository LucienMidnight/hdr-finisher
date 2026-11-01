/* Read-only D:/Photos scroll and disposable Delete confirmation, through
 * node tests/run-in-electron.js tools/measure-library-big-folder.js
 * Set HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440 and create/set
 * HDR_FINISHER_ELECTRON_TEST_USER_DATA to output/big-folder/measurement-profile
 * (an absolute path). No deletion is confirmed.
 * Stop on the owner's 4 GB / approximately one-second validation gate. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {hashProjects, checkProjects} = require('../tests/release/runner.cjs');
const root = path.resolve(__dirname, '..');
const output = process.env.HDR_FINISHER_MEASUREMENT_OUTPUT || path.join(root, 'output/big-folder');
const disposable = path.join(root, 'output/test-photos/big-folder-delete');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(label)), ms);})]).finally(() => clearTimeout(timer));
};
(async () => {
  fs.mkdirSync(output, {recursive:true});
  fs.mkdirSync(disposable, {recursive:true});
  const photo = path.join(disposable, 'delete-check.png');
  if (!fs.existsSync(photo)) fs.copyFileSync(path.join(root,'tests/fixtures/sdr_gradient.png'),photo);
  const before = hashProjects(require('../tests/release/drivers.json').protectedProjects);
  const browser = await chromium.launch();
  let observer, stream, peak = 0, exceeded = false,latestCaches=null,latestFrontend=null,latestRoles=null,peakSample=null,endSample=null;
  const report = {startedAt:new Date().toISOString(), ceilingBytes:Math.max(2_500_000_000,Math.min(4_000_000_000,os.totalmem()/4)), deleteLimitMs:1000, requestedScrollSeconds:300, finishedGridCells:[], samples:0};
  const record = () => fs.writeFileSync(path.join(output,'measurement.json'),JSON.stringify({...report,peakChargedBytes:peak,peakSample,endSample},null,2)+'\n');
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.evaluate(() => activateWorkflowTab('import'));
    const lib = page.frame({url:/\/library(?:\?|$)/});
    await lib.waitForFunction(() => window.HDRLibrary);
    stream = fs.createWriteStream(path.join(output,'measurement-memory.jsonl'));
    observer = spawn(path.join(root,'.venv/Scripts/python.exe'),[path.join(__dirname,'measure-library-processes.py'),process.env.HDR_FINISHER_ELECTRON_MAIN_PID],{windowsHide:true});
    let pending = '';
    observer.stdout.on('data',chunk => {
      pending += chunk;
      let newline;
      while ((newline=pending.indexOf('\n'))>=0) {
        const line=pending.slice(0,newline).trim();pending=pending.slice(newline+1);
        if (!line) continue;
        const sample=JSON.parse(line);
        sample.caches=latestCaches;sample.frontend=latestFrontend;sample.electron=latestRoles;
        if(sample.totalBytes>peak){peak=sample.totalBytes;peakSample=sample;}endSample=sample;report.samples++;
        exceeded ||= peak>report.ceilingBytes;
        stream.write(JSON.stringify(sample)+'\n');record();
      }
    });
    observer.stderr.on('data',chunk=>fs.appendFileSync(path.join(output,'measurement-observer.log'),chunk));
    observer.on('error',error=>{report.observerError=String(error);});
    observer.on('exit',(code,signal)=>{report.observerError=`Observer stopped before the gate finished (${code ?? signal})`;});
    const api = async (route,body) => {
      const r=await global.HDRFinisherElectronTestHarness.fetch('/api/library/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      if(!r.ok)throw Error(await r.text());return r.json();
    };
    // Startup cleanup finishes against the empty disposable profile, before
    // the real folder is known. No marks, edits, or file commands target it.
    const profile=process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
    if(!profile)throw Error('Set an explicit disposable measurement profile first');
    await bounded((async()=>{
      const log=path.join(profile,'logs/backend.log');
      while(!fs.existsSync(log)||!fs.readFileSync(log,'utf8').includes('[library] startup_upkeep_finished '))await sleep(200);
    })(),20000,'Startup cleanup did not finish before opening real data');
    report.startupCleanupFinishedBeforeRealFolder=true;
    await api('pins',{paths:['D:/Photos']});
    const opening = Date.now();
    void lib.evaluate(()=>HDRLibrary.browse('D:/Photos')).catch(error=>{report.browseError=String(error);});
    while (!exceeded) {
      const count = await bounded(lib.evaluate(()=>HDRLibrary.getSnapshot().count),10000,'Folder startup did not answer');
      if (count>0) break;
      if(Date.now()-opening>180000)throw Error('No real photos after three-minute startup');
      await sleep(500);
    }
    report.folderStartupMs=Date.now()-opening;
    await api("lock-metrics",{reset:true});
    const scrolling = Date.now();
    let scrollRequest=null,lastReplyAt=Date.now(),accounting=null;
    report.memoryMethod='Windows proportional resident: private pages plus shared pages / OS ShareCount; ordinary working sets are diagnostic only';
    for(let tick=0;Date.now()-scrolling<300000;tick++) {
      if(exceeded)break;
      if(Date.now()-scrolling<120000)report.earlyThumbnailPeakBytes=Math.max(report.earlyThumbnailPeakBytes||0,latestCaches?.caches?.thumbnails?.bytes||0);
      if(report.observerError)throw Error(report.observerError);
      if(!accounting)accounting=Promise.allSettled([
        api('memory').then(value=>{latestCaches={at:Date.now(),...value};}),
        lib.evaluate(()=>HDRLibrary.getSnapshot().ram).then(value=>{latestFrontend={at:Date.now(),...value};}),
        global.HDRFinisherElectronTestHarness.memory().then(value=>{latestRoles=value;})
      ]).finally(()=>{accounting=null;});
      // Keep the OS observer running during a blocked renderer. Do not queue
      // more page calls behind it or mistake a five-second pause for the
      // owner's ten-minute memory verdict.
      if(!scrollRequest)scrollRequest=lib.evaluate(tick=>{
        const grid=document.getElementById('library-grid');
        const end=Math.max(0,grid.scrollHeight-grid.clientHeight);
        if(tick%3===0)grid.scrollTop=tick%90===87?0:Math.min(end,grid.scrollTop+grid.clientHeight*.5);
        grid.dispatchEvent(new Event('scroll'));
        return {count:HDRLibrary.getSnapshot().count,drawn:document.querySelectorAll('#grid-space canvas[data-picture-key]').length};
      },tick).then(({count,drawn})=>{report.finishedGridCells.push({seconds:(Date.now()-scrolling)/1000,count:drawn});report.maxDrawnCells=Math.max(report.maxDrawnCells||0,drawn);report.lastPhotoCount=count;report.scrollReplies=(report.scrollReplies||0)+1;lastReplyAt=Date.now();})
        .catch(error=>{report.scrollError=String(error);}).finally(()=>{scrollRequest=null;});
      report.longestScrollReplyGapMs=Math.max(report.longestScrollReplyGapMs||0,Date.now()-lastReplyAt);
      if(tick%15===0)console.log(JSON.stringify({scrollSeconds:Math.round((Date.now()-scrolling)/1000),peakGB:peak/1e9,photos:report.lastPhotoCount}));
      await sleep(1000);
    }
    report.scrollEndedAt=new Date().toISOString();
    report.scrollLock=await bounded(api("lock-metrics",{}),10000,"Lock metrics did not answer");
    report.scrollSeconds=(Date.now()-scrolling)/1000;
    report.scrollPeakSample=peakSample;report.scrollEndSample=endSample;
    const thumbnailEnd=endSample?.caches?.caches?.thumbnails?.bytes || 0;
    const recentCells=report.finishedGridCells.filter(row=>row.seconds>=240);
    report.retention={thumbnailEndBytes:thumbnailEnd,finishedLastMinute:recentCells.some(row=>row.count>0)};
    if(report.observerError)throw Error(report.observerError);
    if(!exceeded){
    await lib.evaluate(folder=>HDRLibrary.browse(folder),disposable);
    await lib.locator('#grid-space .library-cell').first().click();
    await api('pins',{paths:['D:/Photos']});
    report.backgroundBeforeDelete=await bounded(api('health'),5000,'Activity did not answer');
    // Pin refresh and the streamed listing may repaint the initial cell.
    // Select the disposable picture again after the refresh has settled.
    await lib.locator('#grid-space .library-cell').first().click();
    await lib.waitForFunction(photo => HDRLibrary.getSnapshot().selection.some(value=>value.replaceAll('\\','/')===photo),photo.replaceAll('\\','/')) .catch(async () => {
      await lib.locator('#grid-space .library-cell').first().click();
    });
    report.selectionBeforeDelete=await lib.evaluate(()=>HDRLibrary.getSnapshot().selection);
    const started = Date.now();
    await lib.locator('body').press('Delete');
    const dialog=lib.getByRole('dialog',{name:'Delete photos',exact:true});
    try {
      await dialog.waitFor({state:'visible',timeout:5000});
      report.deleteConfirmationMs=Date.now()-started;
      report.deleteConfirmationText=await dialog.innerText();
      await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    } catch (error) {report.deleteConfirmationMs=Date.now()-started;report.deleteError=String(error);}
    report.disposablePreserved=fs.existsSync(photo);
    console.log('Delete confirmation:',report.deleteConfirmationMs,'ms');record();

    }
    report.verdict=exceeded?'STOP: memory ceiling exceeded':report.lastPhotoCount>0 && report.retention.finishedLastMinute && report.retention.thumbnailEndBytes>Math.max(0,report.earlyThumbnailPeakBytes||0)?'PASS':'FAIL: finished real-folder pictures were not retained';
    if(!report.samples)throw Error('Memory observer produced no samples');
    console.log(report.verdict,JSON.stringify({...report,peakChargedBytes:peak,peakSample,endSample}));
    report.memoryRetentionVerdict=report.verdict;
    if(!exceeded && report.scrollLock.hold_ms>250)report.verdict='FAIL: normal-use marks lock exceeds 250 ms';
    if(report.verdict!=='PASS')process.exitCode=1;
    if(!exceeded && report.deleteConfirmationMs>report.deleteLimitMs){report.verdict='FAIL: Delete confirmation over one second';process.exitCode=1;}
  } catch(error) {report.verdict=exceeded?'STOP: memory ceiling exceeded':'FAIL';report.error=String(error.stack||error);console.error(error);process.exitCode=1;}
  finally {
    observer?.removeAllListeners('exit');observer?.stdout.removeAllListeners('data');observer?.kill();stream?.end();
    try {checkProjects(before);report.protectedProjectsUnchanged=true;}
    catch(error) {report.protectedProjectsUnchanged=false;report.verdict='FAIL';report.error=String(error);process.exitCode=1;}
    report.finishedAt=new Date().toISOString();record();
    // Capture the isolated backend log before the runner removes its profile.
    const log=path.join(process.env.HDR_FINISHER_USER_DATA_DIR||process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA||'', 'logs/backend.log');
    if(fs.existsSync(log))fs.copyFileSync(log,path.join(output,'measurement-backend.log'));
    await browser.close();
    // The exact child directory is ours; never traverse the rest of test-photos.
    fs.rmSync(disposable,{recursive:true,force:true});

  }
})();
