const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf('function registerIpc()');
  const end = source.indexOf('function updateWindowDocumentState()', start);
  const listeners = new Map(), calls = [];
  let role = 'main', destroyed = false;
  const context = vm.createContext({
    ipcMain: { handle() {}, on(name, listener) { listeners.set(name, listener); } },
    validateSender(event) { if (!event.valid) throw Error('Unknown sender'); return { role }; },
    mainWindow: { isDestroyed: () => destroyed, setProgressBar: (...args) => calls.push(args) },
  });
  vm.runInContext(source.slice(start, end) + '\nregisterIpc();', context);
  return { send: listeners.get('desktop:set-operation-progress'), calls,
    role: value => { role = value; }, destroy: () => { destroyed = true; } };
}

test('progress IPC ignores stale senders, invalid payloads and closed windows', () => {
  const s = setup();
  assert.doesNotThrow(() => s.send({}, { value: .5 }));
  for (const value of [null, 'bad', 7]) assert.doesNotThrow(() => s.send({ valid: true }, value));
  s.role('library'); s.send({ valid: true }, { value: .5 });
  s.role('main'); s.destroy(); s.send({ valid: true }, { value: .5 });
  assert.equal(s.calls.length, 0);
});

test('progress IPC preserves main-window progress bounds and states', () => {
  const s = setup();
  for (const [value, state] of [[.5, 'paused'], [2, 'error'], [-2, 'bad'], [NaN, 'indeterminate']]) {
    s.send({ valid: true }, { value, state });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [
    [.5, { mode: 'paused' }], [1, { mode: 'error' }],
    [-1, { mode: 'normal' }], [-1, { mode: 'indeterminate' }],
  ]);
});
