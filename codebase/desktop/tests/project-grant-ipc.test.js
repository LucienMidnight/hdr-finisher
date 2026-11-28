const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { isProjectPath, pathKey } = require("../lib/validation");

test("project grant checks existence without sync filesystem access", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-grant-ipc-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const existing = path.join(directory, "open.hdrfinisher");
  await fs.promises.writeFile(existing, "");
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  const handlers = new Map();
  const granted = [];
  const context = vm.createContext({
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on() {} },
    validateSender: () => ({ role: "main" }),
    fs: { promises: fs.promises }, path, pathKey, isProjectPath,
    knownProjectPaths: new Set(),
    grantPath(file, intent) { granted.push([file, intent]); return { path: file }; },
  });
  vm.runInContext(source.slice(source.indexOf("async function pathExists("), source.indexOf("function cleanGradingPresetPayload(")) +
    source.slice(source.indexOf("function registerIpc()"), source.indexOf("function updateWindowDocumentState()")) +
    "\nregisterIpc();", context);
  const grant = (file, intent) => handlers.get("desktop:grant-project-path")({}, file, intent);
  assert.equal((await grant(existing, "project-open")).exists, true);
  const missing = path.join(directory, "new");
  await assert.rejects(grant(missing + ".hdrfinisher", "project-open"));
  const save = await grant(missing, "project-save");
  assert.equal(save.path, missing + ".hdrfinisher");
  assert.equal(save.exists, false);
  assert.deepEqual(granted, [[existing, "project-open"], [save.path, "project-save"]]);
});
