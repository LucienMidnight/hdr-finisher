const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

function registerCacheHandlers(directory, shell, promises = fs.promises, warn = () => {}) {
  const handlers = new Map();
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  const context = vm.createContext({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    validateSender: () => ({ role: "main" }),
    app: { isPackaged: false }, process: { env: { PORTABLE_EXECUTABLE_DIR: directory } },
    path, crypto, shell, fs: { promises }, console: { warn },
  });
  vm.runInContext(source.slice(source.indexOf("function registerIpc()"),
    source.indexOf("function updateWindowDocumentState()")) + "\nregisterIpc();", context);
  return (name, ...args) => handlers.get("desktop:" + name)({}, ...args);
}

test("portable Library cache probe is cleaned up and an unavailable folder has no option", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-cache-ipc-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const invoke = registerCacheHandlers(directory);
  assert.equal((await invoke("library-cache-options")).portable, path.join(directory, "Cache"));
  assert.deepEqual(await fs.promises.readdir(directory), []);
  const missing = registerCacheHandlers(path.join(directory, "missing"));
  assert.equal((await missing("library-cache-options")).portable, undefined);
});

test("showing a Library cache folder waits for asynchronous creation", async () => {
  const folder = path.join(os.tmpdir(), "hdr-cache-ipc");
  const opened = [];
  let finishMkdir;
  const invoke = registerCacheHandlers(null, { openPath: async value => { opened.push(value); return ""; } }, {
    mkdir(value, options) {
      assert.equal(value, folder);
      assert.equal(options.recursive, true);
      return new Promise(resolve => { finishMkdir = resolve; });
    },
  });
  const showing = invoke("reveal-library-cache-directory", folder);
  assert.deepEqual(opened, []);
  finishMkdir();
  await showing;
  assert.deepEqual(opened, [folder]);
});
