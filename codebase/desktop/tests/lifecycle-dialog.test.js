const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { leaveCurrentPhoto } = require("../../frontend/photo-transition");

const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test("a failed Windows session-end dialog is logged without allowing a dirty project to close", async () => {
  const window = new EventEmitter();
  let blocked = 0, saves = 0;
  const warnings = [];
  const error = Error("window unavailable");
  const context = vm.createContext({
    isMain: true, window, record: {},
    saveWindowBounds() { saves++; }, documentState: { dirty: true, displayName: "Photo" }, leaveCurrentPhoto,
    dialog: { async showMessageBox() { throw error; } },
    console: { warn: (_message, cause) => warnings.push(cause) },
  });
  vm.runInContext(source.slice(source.indexOf('if (isMain) window.on("query-session-end"'),
    source.indexOf('window.on("closed"')), context);
  window.emit("query-session-end", { preventDefault() { blocked++; } });
  await nextTurn();
  assert.equal(saves, 1);
  assert.equal(blocked, 1);
  assert.deepEqual(warnings, [error]);
});

test("a failed backend-exit dialog is logged without authorizing shutdown", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null });
  const warnings = [];
  const error = Error("window unavailable");
  let quits = 0;
  const context = vm.createContext({
    backend: null, backendProcess: null, shuttingDown: false, testMode: true,
    randomSecret: () => "test", backendCommand: () => ({ executable: "stub", args: [], cwd: "." }),
    getBackendLogWriter: () => ({ events: { backend() {} } }),
    os: { tmpdir: () => "." }, sweepProofScratch() {}, createProofScratch: () => "scratch",
    clearProofScratch() {}, markProofBackend() {}, spawn: () => child,
    libraryStage() {}, readline: { createInterface: () => new EventEmitter() },
    require: () => ({ waitForBackend: async () => ({ protocol_version: 1, backend_version: "1.1.0", port: 1025 }) }),
    process: { platform: "darwin", env: {}, pid: 1 }, applicationPreferences: {},
    app: { getPath: () => ".", getVersion: () => "1.1.0" },
    AbortSignal, fetch: async () => ({ ok: true, json: async () => ({ status: "ok" }) }),
    mainWindow: { isDestroyed: () => false }, documentState: { dirty: true },
    dialog: { async showMessageBox() { throw error; } },
    console: { warn: (_message, cause) => warnings.push(cause) },
    beginShutdown() { quits++; },
  });
  vm.runInContext(source.slice(source.indexOf("async function startBackend("),
    source.indexOf("async function stopBackend(")), context);
  await context.startBackend();
  child.emit("exit", 1);
  await nextTurn();
  assert.deepEqual(warnings, [error]);
  assert.equal(quits, 0);
});
