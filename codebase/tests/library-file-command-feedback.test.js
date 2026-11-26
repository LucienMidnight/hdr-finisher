const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

for (const recycleLabel of ['Recycle Bin','Trash']) {
  test(`Delete uses the backend's ${recycleLabel} destination without changing its confirmation route`, async () => {
    const dialogs = [], requests = [];
    const context = vm.createContext({performance, setTimeout, clearTimeout, crypto:{randomUUID},
      HDRLibraryDialogs: {ask:async options => {dialogs.push(options);return false;}},
    });
    context.window = context;
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-file-commands.js'),'utf8'),context);
    const commands = context.HDRLibraryFileCommands.create({status:() => {},
      api:async (route,body) => {requests.push(body);return {count:1,attached_copies:0,recycle:1,recycle_label:recycleLabel,warnings:[]};},
    });
    await commands.remove([{path:'/temporary/photo.png'}]);
    assert.equal(dialogs[0].confirm,`Move to ${recycleLabel}`);
    assert.ok(dialogs[0].message.includes(`go to the ${recycleLabel}`));
    assert.equal(requests.length,1);
    assert.equal(requests[0].action,'delete');
  });
}

test('Delete shows waiting status before planning and logs a cancelled confirmation', async () => {
  const events = [], listeners = {}, statuses = [], requests = [];
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  const context = vm.createContext({performance, setTimeout, clearTimeout, crypto:{randomUUID},
    addEventListener: (name, callback) => {listeners[name] = callback;},
    fetch: async (_url, options) => {events.push(...JSON.parse(options.body));},
    HDRLibraryDialogs: {ask:async () => false},
  });
  context.window = context;
  for (const file of ['library-stopwatch.js','library-file-commands.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8'),context);
  const commands = context.HDRLibraryFileCommands.create({
    status: text => statuses.push(text),
    api: async (route, body) => {requests.push({route,body});return pending;},
  });
  const removing = commands.remove([{path:'C:/disposable/photo.png'}]);
  assert.equal(statuses.length,1,'Waiting feedback is visible while the plan is still pending');
  release({count:1, attached_copies:0, recycle:1, warnings:[]});
  await removing;
  listeners.pagehide();
  assert.equal(requests.length,1,'Cancel never submits an execution request');
  const planned=events.find(event=>event.stage==='file_command_request');
  assert.equal(planned.route,'delete');
  assert.equal(planned.step,'plan');
  const decision=events.find(event=>event.stage==='file_command_confirmation_decision');
  assert.equal(decision.reason,'cancelled');
  assert.equal(decision.route,'Delete photos');
});

test('Direct and health results apply each deletion once and catch up another window', async () => {
  const context = vm.createContext({HDRLibraryDialogs:{}});
  context.window=context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-file-commands.js'),'utf8'),context);
  const deleted=[], otherWindow=[];
  const apply=target=>(changes,missed)=>{
    assert.equal(missed,false);
    for (const entry of changes) for (const change of entry.changes) target.push(change.old);
  };
  const direct=context.HDRLibraryFileCommands.createChangeFeed(apply(deleted));
  const observer=context.HDRLibraryFileCommands.createChangeFeed(apply(otherWindow));
  const entries=['a.ARW','b.ARW'].map((old,i)=>({revision:i+1,changes:[{old,new:'Trash'}],removed_copies:[]}));
  const first={revision:1,recent_changes:entries.slice(0,1)}, second={revision:2,recent_changes:entries};
  await Promise.all([direct.receive(first),direct.receive(first),direct.receive(second),direct.receive(first),direct.receive(second),observer.receive(second)]);
  assert.deepEqual(deleted,['a.ARW','b.ARW']);
  assert.deepEqual(otherWindow,deleted);
});

test('A queued Delete shows its current wait phase and item count', async () => {
  let release,poll;
  const request=new Promise(resolve=>{release=resolve;});
  const context=vm.createContext({performance,crypto:{randomUUID:()=> 'delete-request'},setTimeout:fn=>{poll=fn;},clearTimeout:()=>{},
    HDRLibraryDialogs:{ask:async()=>false}});
  context.window=context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-file-commands.js'),'utf8'),context);
  const statuses=[];
  const commands=context.HDRLibraryFileCommands.create({status:text=>statuses.push(text),api:async(route,body)=>{
    if(body) return request;
    return {active:[{request_id:'delete-request',phase:'waiting_writer',done:0,total:2}]};
  }});
  const pending=commands.remove([{path:'a.ARW'},{path:'b.ARW'}]);
  await poll();
  assert.match(statuses.at(-1),/Waiting for settings to finish saving.*0 of 2/);
  release({count:2,attached_copies:0,recycle:2,warnings:[]});
  await pending;
});


test('A failed file-command refresh is retried by the next identical health reply', async () => {
  const context = vm.createContext({HDRLibraryDialogs:{}});
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-file-commands.js'),'utf8'),context);
  const seen = [];
  let fail = true;
  const feed = context.HDRLibraryFileCommands.createChangeFeed(async changes => {
    seen.push(changes.map(entry => entry.revision).join(','));
    if (fail) { fail = false; throw Error('Temporary folder refresh failure'); }
  });
  const first = {revision:1,recent_changes:[{revision:1,changes:[]}]};
  const failed = feed.receive(first);
  const retry = feed.receive(first);
  await assert.rejects(failed,/Temporary folder refresh failure/);
  await retry;
  await feed.receive(first);
  assert.deepEqual(seen,['1','1'],'The failed revision retries once; successful duplicates are ignored');
});

test('A newer file-command reply catches up failed revisions without applying older replies again', async () => {
  const context = vm.createContext({HDRLibraryDialogs:{}});
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-file-commands.js'),'utf8'),context);
  const applied = [];
  let fail = true;
  const feed = context.HDRLibraryFileCommands.createChangeFeed(async (changes,missed) => {
    assert.equal(missed,false);
    if (fail) { fail = false; throw Error('Offline'); }
    applied.push(...changes.map(entry => entry.revision));
  });
  const entries = [1,2].map(revision => ({revision,changes:[]}));
  const first = {revision:1,recent_changes:entries.slice(0,1)};
  const failed = feed.receive(first);
  const newer = feed.receive({revision:2,recent_changes:entries});
  const older = feed.receive(first);
  await assert.rejects(failed,/Offline/);
  await Promise.all([newer,older]);
  assert.deepEqual(applied,[1,2]);
});
