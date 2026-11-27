const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setupClose(window) {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function registerIpc()');
  const end = source.indexOf('function updateWindowDocumentState()', start);
  const handlers = new Map();
  const context = vm.createContext({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    validateSender: () => ({role:'main'}), mainWindow: window,
    quitRequested:false, forceClose:false,
    documentState:{}, safeSuggestedName:value=>value, updateWindowDocumentState(){},
  });
  vm.runInContext(source.slice(start, end) + '\nregisterIpc();', context);
  const complete = allowed => handlers.get('desktop:complete-photo-close')({}, allowed);
  complete.laterSave = () => handlers.get('desktop:set-document-state')({}, {dirty:false});
  return complete;
}

test('cancelling or failing a project save retires its pending window close', async () => {
  let closes = 0;
  const window = {pendingCloseAfterSave:true,close:()=>closes++};
  const complete = setupClose(window);
  await complete(false);
  assert.equal(window.pendingCloseAfterSave,false);
  await complete.laterSave();
  assert.equal(closes,0,'A later successful save cannot close the window');
});

test('sidecar close acknowledgement still cancels or closes as requested', async () => {
  let closes = 0;
  const window = {pendingSidecarClose:true,close:()=>closes++};
  const complete = setupClose(window);
  await complete(false);
  assert.equal(window.pendingSidecarClose,false);
  assert.equal(closes,0);
  window.pendingSidecarClose=true;
  await complete(true);
  assert.equal(window.pendingSidecarClose,false);
  assert.equal(closes,1);
});

for (const outcome of ['cancelled','failed','saved']) {
  test(`desktop Save reports ${outcome} without retaining an abandoned close`, async () => {
    const answers = [];
    const context = vm.createContext({
      desktop: {completePhotoClose:async allowed=>answers.push(allowed)},
      saveProjectToPath:async()=>{if(outcome==='failed')throw Error('Write failed');return outcome==='saved';},
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/desktop-commands.js'),'utf8'),context);
    const saving=context.handleDesktopCommand('save');
    if(outcome==='failed')await assert.rejects(saving,/Write failed/);
    else assert.equal(await saving,outcome==='saved');
    assert.deepEqual(answers,outcome==='saved'?[]:[false]);
  });
}
