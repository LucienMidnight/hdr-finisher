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
  const history=fs.readFileSync(path.join(fixture.root,'output/release-checks/history.jsonl'),'utf8').trim().split('\n');assert.equal(history.length,7);
  const third=fixture.run('--tier','core');assert.equal(third.status,1);assert.equal(fixture.states().length,1);
  assert.equal(fs.readFileSync(path.join(fixture.root,'output/release-checks/history.jsonl'),'utf8').trim().split('\n').length,7);
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
