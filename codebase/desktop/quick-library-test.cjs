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
    if(config.pixelCapture){await require('./library-pixel-test.cjs').run({frame,config,stage});stage('done');return;}
    const source = fs.readFileSync(path.join(__dirname, '../tools/quick-library-scenario.js'), 'utf8');
    const result = await frame.executeJavaScript(`(${source})(${JSON.stringify(config)})`);
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
