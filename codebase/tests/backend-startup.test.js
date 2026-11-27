const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { waitForBackend } = require('../desktop/lib/backend-readiness.cjs');
const { installTestDialogs } = require('../desktop/lib/test-mode.cjs');

test('startup extends the idle deadline for genuine progress', async () => {
  const child = spawn(process.execPath, ['-e', `
    console.log('HDR_FINISHER_PROGRESS {"phase":"importing"}');
    setTimeout(()=>console.log('HDR_FINISHER_PROGRESS {"phase":"loaded"}'), 800);
    setTimeout(()=>console.log('HDR_FINISHER_READY {"port":42}'), 1600);
  `]);
  const ready = await waitForBackend(child, { idleMs: 1200, totalMs: 5000 });
  assert.equal(ready.port, 42);
});
test('duplicate progress cannot hide a stalled backend', async () => {
  const child = spawn(process.execPath, ['-e', `setInterval(()=>console.log('HDR_FINISHER_PROGRESS {"phase":"stuck"}'),20)`]);
  try { await assert.rejects(waitForBackend(child, { idleMs: 1500, totalMs: 6000 }), /stalled at stuck/); }
  finally { child.kill(); }
});
test('startup reports a backend crash immediately', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(7)']);
  await assert.rejects(waitForBackend(child), /code 7/);
});
test('absolute startup limit still fails a backend making endless progress', async () => {
  const child = spawn(process.execPath, ['-e', `let n=0;setInterval(()=>console.log('HDR_FINISHER_PROGRESS '+JSON.stringify({phase:String(n++)})),20)`]);
  try { await assert.rejects(waitForBackend(child, { idleMs: 4000, totalMs: 1500 }), /stalled/); }
  finally { child.kill(); }
});
test('test mode never opens a native dialog and marks unexpected dialogs as failures', async () => {
  const dialog = {}; let failures = 0;
  installTestDialogs(dialog, { fail: () => failures++, log: () => {} });
  assert.equal((await dialog.showMessageBox({ buttons: ['Save','Discard','Cancel'] })).response, 1);
  assert.equal(failures, 0);
  await dialog.showMessageBox({ type: 'error', message: 'backend failed', buttons: ['Quit'] });
  dialog.showErrorBox('failed', 'backend');
  await dialog.showOpenDialog({});
  assert.equal(failures, 3);
});
test('failed launch cleanup captures OS children before any Playwright handle', async () => {
  // A separate harness exits while its mock Electron child and grandchild run.
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-startup-cleanup-'));
  const marker = path.join(root, 'pids.json');
  const helper = require.resolve('./owned-electron-launch.cjs');
  const script = `
    require(${JSON.stringify(helper)}).installOwnedLaunches();
    const cp=require('node:child_process'),fs=require('node:fs');
    const child=cp.spawn(process.execPath,['-e', 'const cp=require("node:child_process"); const c=cp.spawn(process.execPath,["-e","setInterval(()=>{},1000)"]); console.log(JSON.stringify([process.pid,c.pid])); setInterval(()=>{},1000)'],
      {argv0:'electron',env:{...process.env,HDR_FINISHER_TEST_MODE:'1'},stdio:['ignore','pipe','ignore']});
    child.stdout.once('data', data=>{fs.writeFileSync(${JSON.stringify(marker)},data); process.exit(1)});
  `;
  const harness = spawn(process.execPath, ['-e', script], { stdio: 'pipe' });
  let diagnostic = ''; harness.stderr.on('data', chunk => diagnostic += chunk);
  await new Promise(resolve => harness.once('exit', resolve));
  try {
    const pids = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const { listProcesses } = require('./release/process-tree.cjs');
    const rows = listProcesses();
    for (const pid of pids) assert.ok(!rows.some(row => row.pid === pid), `${pid} survived: ${diagnostic}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('backend parent watchdog stops Python and its child before readiness', async t => {
  const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-watchdog-test-'));
  t.after(() => fs.rmSync(scratch, {recursive:true,force:true,maxRetries:5}));
  const python = path.resolve(__dirname, process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python');
  const source = `import sys,os,subprocess,time\nfrom backend_parent_watch import watch_desktop\nwatch_desktop(int(sys.argv[1]))\nc=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])\nprint(str(os.getpid())+','+str(c.pid),flush=True)\ntime.sleep(60)`;
  const parent = spawn(process.execPath, ['-e', `
    const cp=require('node:child_process');
    const child=cp.spawn(${JSON.stringify(python)},['-c',${JSON.stringify(source)},String(process.pid)],{detached:process.platform!=='win32',cwd:${JSON.stringify(path.resolve(__dirname,'..'))},stdio:['ignore','pipe',require('node:fs').openSync(${JSON.stringify(path.join(scratch,'stderr.log'))},'w')]});
    child.stdout.once('data',d=>{process.stdout.write(d);process.exit(0)});
  `], { stdio: 'pipe' });
  let text=''; parent.stdout.on('data', chunk=>text+=chunk);
  await new Promise(resolve=>parent.once('exit',resolve));
  const ids=text.trim().split(',').map(Number);
  assert.equal(ids.length,2);
  const { listProcesses, stopProcessTree } = require('./release/process-tree.cjs');
  try {
    const deadline=Date.now()+10000;
    while (listProcesses().some(row=>ids.includes(row.pid)) && Date.now()<deadline)
      await new Promise(resolve=>setTimeout(resolve,100));
    assert.deepEqual(listProcesses().filter(row=>ids.includes(row.pid)), [], "watchdog survivors");
  } finally { stopProcessTree(ids.map(pid=>({pid}))); }
});
