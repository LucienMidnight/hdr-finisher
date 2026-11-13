const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runner = require('./release/runner.cjs');
const list = require('./release/drivers.json');
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-release-unit-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}
test('every standalone JS driver is listed once and all listed files exist', () => runner.validate(list));
test('inventory guard catches a new driver, a deleted file and duplicates', t => {
  const root = scratch(t);
  for (const dir of ['tests','tests/performance','desktop/tests']) fs.mkdirSync(path.join(root, dir), {recursive:true});
  const tiny = {areas:['preview'], drivers:[{path:'tests/first.js',areas:['preview'],tier:'core',launch:{method:'node'}}]};
  fs.writeFileSync(path.join(root,'tests/first.js'),'');
  runner.validate(tiny,root);
  fs.writeFileSync(path.join(root,'tests/new.cjs'),'');
  assert.throws(() => runner.validate(tiny,root), /Unlisted driver/);
  fs.unlinkSync(path.join(root,'tests/new.cjs'));
  assert.throws(() => runner.validate({...tiny,drivers:[...tiny.drivers,...tiny.drivers]},root),/Duplicate/);
  fs.unlinkSync(path.join(root,'tests/first.js'));
  assert.throws(() => runner.validate(tiny,root),/Listed file missing/);
});
test('release selects core plus changed areas and reports unknown source conservatively', () => {
  const result = runner.select(list,'release',null,['codebase/frontend/library-filters.js']);
  const expected = list.drivers.filter(row => row.launch.method !== 'helper' && (row.tier==='core' || row.tier==='area' && row.areas.includes('library')));
  assert.deepEqual(result.rows, expected);
  const unknown = runner.select(list,'release',null,['codebase/frontend/new-feature.js']);
  assert.deepEqual(unknown.unmapped,['codebase/frontend/new-feature.js']);
  assert.deepEqual(unknown.areas,[...list.areas].sort());
  assert.equal(runner.select(list,'release',null,['docs/notes.md']).rows.every(row=>row.tier==='core'),true);
});
test('area, tier, full and single-driver selections preserve diagnostics isolation', () => {
  for (const mode of ['release','area','tier','full']) {
    const value = mode==='area'?'film':mode==='tier'?'full':null;
    const selected = runner.select(list,mode,value).rows;
    assert.ok(selected.length);
    assert.ok(selected.every(row=>row.tier!=='diagnostic' && row.launch.method!=='helper'));
  }
  assert.deepEqual(runner.select(list,'tier','core').rows,list.drivers.filter(row=>row.tier==='core'&&row.launch.method!=='helper'));
  assert.equal(runner.select(list,'driver','tests/performance/phase5-endurance.js').rows.length,1);
  assert.equal(runner.select(list,'driver','tests/electron-initial-load.js').rows[0].path,'tests/startup-state.js');
  assert.throws(()=>runner.select(list,'area','typo'),/Unknown area/);
  assert.throws(()=>runner.select(list,'driver','missing'),/Unknown driver/);
  assert.throws(()=>runner.select(list,'tier','diagnostic'),/only by explicit/);
});
test('commands retain export enforcement, native/package launch and per-run output', () => {
  const row = list.drivers.find(row=>row.path==='tests/performance/preview-export-compare.js');
  const invocation = runner.command(row,'Z:/scratch-run',list);
  assert.ok(invocation.args.includes('--enforce'));
  assert.ok(invocation.args.includes('Z:/scratch-run/preview-export-compare.json'));
  assert.equal(runner.command(list.drivers.find(row=>row.path==='desktop/tests/electron-smoke.js'),'tmp',list).args[0],'tests/run-native-electron.js');
  assert.ok(runner.command(list.drivers.find(row=>row.path==='tests/performance/packaged-baselines.js'),'tmp',list).args.includes('--packaged'));
});
test('known failures require the same driver and message on both attempts', t => {
  const root=scratch(t), a=path.join(root,'a.log'), b=path.join(root,'b.log');
  fs.writeFileSync(a,'Error: exact old failure');fs.writeFileSync(b,'Error: exact old failure');
  const known={failures:[{driver:'a.js',messages:['Error: exact old failure']}]};
  const attempts=[{exitCode:1,log:a},{exitCode:1,log:b}];
  assert.equal(runner.classify(attempts,known,'a.js'),'known');
  assert.equal(runner.classify(attempts,known,'b.js'),'new');
  fs.writeFileSync(b,'Error: different failure');
  assert.equal(runner.classify(attempts,known,'a.js'),'new');
  assert.equal(runner.classify([attempts[0],{...attempts[1],exitCode:0}],known,'a.js'),'flaky');
  assert.equal(runner.classify([{exitCode:0}],known,'a.js'),'passed');
});
test('estimates use actual latest durations, reserve one failed retry and expose missing history', () => {
  const actual=runner.estimate([{path:'a'},{path:'b'},{path:'c'}],[{driver:'a',durationSeconds:4,exitCode:0},{driver:'a',durationSeconds:8,exitCode:1},{driver:'b',durationSeconds:3,exitCode:0},{driver:'b',durationSeconds:999,exitCode:null,interrupted:true}]);
  assert.equal(actual.seconds,11);assert.equal(actual.retrySeconds,8);assert.deepEqual(actual.unknown,['c']);
});
test('fixture protection detects changed and missing files without overwriting them', t => {
  const file=path.join(scratch(t),'fixture.hdrfinisher');fs.writeFileSync(file,'original');
  const hashes=runner.hashProjects([file]);runner.checkProjects(hashes);
  fs.writeFileSync(file,'changed');assert.throws(()=>runner.checkProjects(hashes),/protected project changed/);
  assert.equal(fs.readFileSync(file,'utf8'),'changed');
  fs.unlinkSync(file);assert.throws(()=>runner.checkProjects(hashes),/protected project changed/);
});
test('ambiguous or incomplete CLI selections fail before any run', () => {
  assert.throws(()=>runner.parse(['--area']),/Missing value/);
  assert.throws(()=>runner.parse(['--release','--full']),/one selection/);
  assert.throws(()=>runner.parse(['--stop-after','0']),/positive/);
  assert.deepEqual(runner.parse(['--tier','core','--plan']),{mode:'tier',plan:true,value:'core'});
});
const {execFileSync, spawnSync} = require('node:child_process');
function isolatedRunner(t) {
  const root=scratch(t);
  for (const dir of ['tests/release','tests/performance','desktop/tests','output']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'release/runner.cjs'),path.join(root,'tests/release/runner.cjs'));
  fs.copyFileSync(path.join(__dirname,'release/process-tree.cjs'),path.join(root,'tests/release/process-tree.cjs'));
  fs.mkdirSync(path.join(root,'tests/helpers'),{recursive:true});
  fs.copyFileSync(path.join(__dirname,'helpers/photos-root.cjs'),path.join(root,'tests/helpers/photos-root.cjs'));
  fs.mkdirSync(path.join(root,'tools/lib'),{recursive:true});
  for (const name of ['platform.cjs','machine-settings.cjs']) fs.copyFileSync(path.join(__dirname,'../tools/lib',name),path.join(root,'tools/lib',name));
  const projects=[0,1,2].map(i=>{const file=path.join(root,`fixture-${i}.hdrfinisher`);fs.writeFileSync(file,'protected');return file;});
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
  git('init','--quiet');git('config','user.name','Release runner test');git('config','user.email','runner@example.invalid');
  const rows=[];
  function driver(name,body,tier='core') {
    const file=`tests/${name}.js`;fs.writeFileSync(path.join(root,file),body);
    rows.push({path:file,areas:['preview'],tier,launch:{method:'node'}});
  }
  driver('pass',`console.log('PASS');`);
  driver('flaky',`const fs=require('fs');const f='output/retry';if(!fs.existsSync(f)){fs.writeFileSync(f,'1');console.error('Error: transient');process.exitCode=1;}`);
  driver('known',`console.error('Error: recorded failure');process.exitCode=1;`);
  driver('new',`console.error('Error: different failure');process.exitCode=1;`);
  driver('mutate',`require('fs').writeFileSync(${JSON.stringify(projects[0])},'changed');`,'diagnostic');
  driver('head',`require('child_process').execFileSync('git',['commit','--allow-empty','-qm','moved']);`,'diagnostic');
  fs.writeFileSync(path.join(root,'tests/release/drivers.json'),JSON.stringify({areas:['preview'],sourceAreas:[],protectedProjects:projects,drivers:rows}));
  fs.writeFileSync(path.join(root,'tests/release/known-failures.json'),JSON.stringify({failures:[{driver:'tests/known.js',messages:['Error: recorded failure']}]}));
  git('add','.');git('commit','-qm','initial');git('tag','v1.0.0');
  const run=(...args)=>spawnSync(process.execPath,['tests/release/runner.cjs',...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
  const states=()=>fs.readdirSync(path.join(root,'output/release-checks'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>JSON.parse(fs.readFileSync(path.join(root,'output/release-checks',e.name,'state.json'),'utf8')));
  return {root,run,states,projects,git};
}
test('real subprocess run resumes completed work, retries once, classifies failures and writes history', t => {
  const fixture=isolatedRunner(t);
  const first=fixture.run('--tier','core','--stop-after','1');
  assert.equal(first.status,130,first.stderr+first.stdout);
  assert.equal(fixture.states()[0].results['tests/pass.js'].classification,'passed');
  const second=fixture.run('--tier','core');
  assert.equal(second.status,1,second.stderr+second.stdout);
  const state=fixture.states()[0];assert.equal(state.completed,true);
  assert.deepEqual(Object.fromEntries(Object.entries(state.results).map(([key,value])=>[key,value.classification])),{'tests/pass.js':'passed','tests/flaky.js':'flaky','tests/known.js':'known','tests/new.js':'new'});
  const history=fs.readFileSync(path.join(fixture.root,'output/release-checks/history.jsonl'),'utf8').trim().split('\n');assert.equal(history.length,6);
  const third=fixture.run('--tier','core');assert.equal(third.status,1);assert.equal(fixture.states().length,1);
  assert.equal(fs.readFileSync(path.join(fixture.root,'output/release-checks/history.jsonl'),'utf8').trim().split('\n').length,6);
  for(const file of fixture.projects) assert.equal(fs.readFileSync(file,'utf8'),'protected');
});
test('runner refuses dirty tracked files and reports mid-run revision and fixture changes', t => {
  const fixture=isolatedRunner(t);
  fs.appendFileSync(path.join(fixture.root,'tests/pass.js'),'\n');
  const dirty=fixture.run('--tier','core');assert.equal(dirty.status,1);assert.match(dirty.stderr,/Commit tracked-file changes/);
  fixture.git('add','.');fixture.git('commit','-qm','intentional test edit');
  const moved=fixture.run('--driver','tests/head.js');assert.equal(moved.status,1);assert.match(moved.stdout,/HEAD moved/);
  const mutated=fixture.run('--driver','tests/mutate.js');assert.equal(mutated.status,1);assert.match(mutated.stdout,/protected project changed/);
});
test('another active runner blocks GPU work across selections', t => {
  const fixture=isolatedRunner(t),out=path.join(fixture.root,'output/release-checks');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'active.lock'),String(process.pid));
  const result=fixture.run('--tier','core');assert.equal(result.status,1);assert.match(result.stderr,/owns the GPU/);
});

test('known signatures do not hide a second failure in a combined invocation', () => {
  const known={failures:[{driver:'film',messages:['Error: exact numerical failure']}]};
  assert.equal(runner.knownMessage('Error: exact numerical failure',known,'film'),true);
  assert.equal(runner.knownMessage('Error: exact numerical failure\npage.evaluate: Error: preset await',known,'film'),false);
  assert.equal(runner.knownMessage('Error: changed numerical failure',known,'film'),false);
});
test('unfinished selection includes only incomplete work plus explicit reruns', () => {
  const previous={drivers:['tests/pass.js','tests/incomplete.js','tests/failed.js'],results:{'tests/pass.js':{classification:'passed'},'tests/incomplete.js':{attempts:[]},'tests/failed.js':{classification:'new'}}};
  const tiny={drivers:previous.drivers.map(path=>({path,tier:'core',launch:{method:'node'}}))};
  assert.deepEqual(runner.unfinishedSelection(tiny,previous,['tests/failed.js']).rows.map(r=>r.path),['tests/incomplete.js','tests/failed.js']);
  assert.throws(()=>runner.unfinishedSelection(tiny,previous,['missing']),/missing or not runnable/);
});
test('an exact known failure runs once while an unfamiliar failure still retries', t => {
  const fixture=isolatedRunner(t);
  const result=fixture.run('--tier','core');
  assert.equal(result.status,1,result.stdout+result.stderr);
  const state=fixture.states()[0];
  assert.equal(state.results['tests/known.js'].attempts.length,1);
  assert.equal(state.results['tests/new.js'].attempts.length,2);
});
test('cross-revision continuation starts fresh and leaves prior evidence untouched', t => {
  const fixture=isolatedRunner(t);
  fixture.run('--tier','core','--stop-after','1');
  const parent=fs.readdirSync(path.join(fixture.root,'output/release-checks'),{withFileTypes:true}).find(e=>e.isDirectory()).name;
  const source=path.join(fixture.root,'output/release-checks',parent);
  const before=fs.readFileSync(path.join(source,'state.json'),'utf8');
  fixture.git('commit','--allow-empty','-qm','new application revision');
  const plan=fixture.run('--full','--unfinished-from',source,'--also-driver','tests/pass.js','--plan');
  assert.equal(plan.status,0,plan.stdout+plan.stderr);
  assert.match(plan.stdout,/4 drivers/);
  assert.equal(fixture.states().length,1);
  const run=fixture.run('--full','--unfinished-from',source,'--also-driver','tests/pass.js');
  assert.equal(run.status,1,run.stdout+run.stderr);
  assert.equal(fs.readFileSync(path.join(source,'state.json'),'utf8'),before);
  const next=fixture.states().find(s=>s.revision!==JSON.parse(before).revision);
  assert.equal(Object.keys(next.results).length,4);
  assert.equal(next.results['tests/pass.js'].attempts.length,1);
});

test('explicit release approval raises only its cap and preserves stricter limits and resume', t => {
  assert.throws(()=>runner.parse(['--approved-release-minutes','0']),/positive/);
  assert.throws(()=>runner.parse(['--full','--approved-release-minutes','150']),/release selection/);
  const fixture=isolatedRunner(t),out=path.join(fixture.root,'output/release-checks');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'history.jsonl'),JSON.stringify({driver:'tests/pass.js',durationSeconds:120*60,exitCode:0})+'\n');
  const normal=fixture.run('--release');
  assert.equal(normal.status,1);assert.match(normal.stderr,/exceeds the approved limit/);
  const strict=fixture.run('--release','--approved-release-minutes','150','--limit-minutes','100');
  assert.equal(strict.status,1);assert.match(strict.stderr,/exceeds the approved limit/);
  const first=fixture.run('--release','--approved-release-minutes','150','--stop-after','1');
  assert.equal(first.status,130,first.stdout+first.stderr);
  assert.match(first.stdout,/Explicitly approved release cap: 150/);
  assert.equal(fixture.states()[0].results['tests/pass.js'].attempts.length,1);
  const resumed=fixture.run('--release','--approved-release-minutes','150');
  assert.equal(resumed.status,1,resumed.stdout+resumed.stderr);
  assert.equal(fixture.states().length,1);
  assert.equal(fixture.states()[0].results['tests/pass.js'].attempts.length,1);
});


test('attempt deadlines use the latest complete success and reject polluted history', () => {
  const records = [{driver:'a',exitCode:0,durationSeconds:200},
    {driver:'a',exitCode:0,durationSeconds:0.01},
    {driver:'a',exitCode:3221225794,durationSeconds:900},
    {driver:'a',exitCode:0,durationSeconds:999,timedOut:true},
    {driver:'a',exitCode:0,durationSeconds:999,interrupted:true},
    {driver:'a',exitCode:0,durationSeconds:999,partial:true}];
  assert.equal(runner.attemptTimeout('a',records),600000);
  assert.equal(runner.attemptTimeout('missing',records),900000);
  assert.equal(runner.attemptTimeout('a',[...records,{driver:'a',exitCode:0,durationSeconds:2}]),300000);
  assert.equal(runner.launchFailed(3221225794),true);
  assert.equal(runner.launchFailed(-1073741502),true);
  assert.equal(runner.launchFailed(null),false);
});
async function fakeInvocations(t, variants, timeout, kill) {
  const dir = scratch(t), log = path.join(dir,'attempt.log'), fd = fs.openSync(log,'w');
  let active, capped = false;
  try {
    const results = await runner.runInvocations({executable:process.execPath,env:{}},
      variants.map(code=>['-e',code]), fd,
      {stopped:()=>false,child:child=>{active=child;},cap:()=>{capped=true;}},
      Infinity, Date.now()+timeout, kill);
    return {results,log:fs.readFileSync(log,'utf8'),capped};
  } finally {
    if (active) runner.stopTree(active);
    fs.closeSync(fd);
  }
}
test('sleeping fake driver times out and exits before another invocation', async t => {
  const r = await fakeInvocations(t,['setInterval(()=>{},1000)','console.log("must not run")'],200);
  assert.equal(r.results.length,1);
  assert.equal(r.results[0].timedOut,true);
  assert.equal(r.capped,false);
  assert.match(r.log,/TIMEOUT/);
  assert.doesNotMatch(r.log,/follow-up invocation/);
});
test('follow-up logs are labelled and share the primary deadline', async t => {
  const r = await fakeInvocations(t,['console.log("primary");','setInterval(()=>{},1000)'],1000);
  assert.equal(r.results[0].exitCode,0);
  assert.equal(r.results[1].timedOut,true);
  assert.match(r.log,/primary invocation/);
  assert.match(r.log,/follow-up invocation 1/);
});
test('tree-kill failure rejects instead of continuing to another driver', async t => {
  await assert.rejects(fakeInvocations(t,['setInterval(()=>{},1000)'],200,
    ()=>{throw Error('STOP: simulated tree-kill failure');}), /simulated tree-kill failure/);
});
test('timed-out known-message attempt is a new failure', t => {
  const log=path.join(scratch(t),'attempt.log'); fs.writeFileSync(log,'Error: old failure');
  assert.equal(runner.classify([{exitCode:1,timedOut:true,log}],
    {failures:[{driver:'a',messages:['Error: old failure']}]},'a'),'new');
});
test('failed-start status stops the run without a retry or later drivers', {skip:process.platform!=='win32'}, t => {
  const fixture=isolatedRunner(t);
  fs.writeFileSync(path.join(fixture.root,'tests/pass.js'),'process.exit(3221225794);');
  fixture.git('add','tests/pass.js'); fixture.git('commit','-qm','simulate failed launch');
  const r=fixture.run('--tier','core');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/STATUS_DLL_INIT_FAILED/);
  const state=fixture.states()[0];
  assert.equal(state.results['tests/pass.js'].attempts.length,1);
  assert.equal(Object.keys(state.results).length,1);
});
test('unverified Electron shutdown stops and blocks unsafe resume', t => {
  const fixture=isolatedRunner(t);
  fs.writeFileSync(path.join(fixture.root,'tests/pass.js'),'process.exit(86);');
  fixture.git('add','tests/pass.js'); fixture.git('commit','-qm','simulate failed shutdown');
  const r=fixture.run('--tier','core');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.match(r.stdout,/shutdown could not be verified/);
  assert.equal(Object.keys(fixture.states()[0].results).length,1);
  const next=fixture.run('--tier','core');
  assert.match(next.stderr,/Previous shutdown was not verified/);
});
test('a passing driver stays passed and a process it left behind is stopped before the next driver', t => {
  const fixture=isolatedRunner(t);
  // Stands in for an Electron tree a launcher reported but left running.
  fs.writeFileSync(path.join(fixture.root,'tests/pass.js'),`const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});c.unref();
console.log('[runner] electron-main '+JSON.stringify({pid:c.pid}));console.log('LEFT='+c.pid);console.log('PASS');`);
  fixture.git('add','tests/pass.js'); fixture.git('commit','-qm','leave a process behind');
  const r=fixture.run('--tier','core','--stop-after','1');
  const state=fixture.states()[0];
  assert.equal(state.results['tests/pass.js'].classification,'passed',r.stdout+r.stderr);
  assert.doesNotMatch(r.stdout,/STOP/);
  const pid=Number(fs.readFileSync(state.results['tests/pass.js'].attempts[0].log,'utf8').match(/LEFT=(\d+)/)[1]);
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});


test('timeout kills a sleeping fake driver and its descendant', async t => {
  const code = `const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('DESCENDANT='+child.pid);setInterval(()=>{},1000);`;
  const r=await fakeInvocations(t,[code],1000);
  const pid=Number(r.log.match(/DESCENDANT=(\d+)/)[1]);
  assert.equal(r.results[0].timedOut,true);
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
