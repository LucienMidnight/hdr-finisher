const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Delete shows waiting status before planning and logs a cancelled confirmation', async () => {
  const events = [], listeners = {}, statuses = [], requests = [];
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  const context = vm.createContext({performance, setTimeout, clearTimeout,
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
