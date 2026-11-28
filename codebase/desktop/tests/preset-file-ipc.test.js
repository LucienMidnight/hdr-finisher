const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const presets = require('../../frontend/grading-preset-files');

function ipc(dialog) {
  const handlers = new Map();
  const main = require.resolve('../main.js');
  const source = fs.readFileSync(main, 'utf8');
  const context = vm.createContext({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    validateSender: () => ({ role: 'main' }),
    mainWindow: {}, app: { isPackaged: false }, dialog, require: createRequire(main),
    // The desktop must not block its event loop on the selected storage.
    fs: { promises: fs.promises },
  });
  vm.runInContext(source.slice(source.indexOf('function registerIpc()'),
    source.indexOf('function updateWindowDocumentState()')) + '\nregisterIpc();', context);
  return (name, ...args) => handlers.get(`desktop:${name}-grading-preset-file`)({}, ...args);
}

test('desktop portable preset selection writes and reads the same file without blocking I/O', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-preset-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'preset.json');
  const text = presets.encode([{ groupId: 'hdr-tone', name: 'Warm tone', values: { contrast: 3 } }]);
  const invoke = ipc({
    async showSaveDialog(_parent, options) {
      assert.equal(options.defaultPath, 'Warm-tone-preset.json');
      return { filePath };
    },
    async showOpenDialog() { return { filePaths: [filePath] }; },
  });
  assert.equal(await invoke('export', text), true);
  assert.equal(fs.readFileSync(filePath, 'utf8'), text);
  assert.equal(await invoke('import'), text);
  fs.truncateSync(filePath, 2 * 1024 * 1024 + 1);
  await assert.rejects(invoke('import'));
});

test('cancelling portable preset dialogs has no file result', async () => {
  const invoke = ipc({
    async showSaveDialog() { return { canceled: true }; },
    async showOpenDialog() { return { canceled: true }; },
  });
  const text = presets.encode([{ groupId: 'hdr-tone', name: 'Test', values: {} }]);
  assert.equal(await invoke('export', text), false);
  assert.equal(await invoke('import'), null);
});
