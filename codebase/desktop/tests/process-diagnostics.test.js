const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { installProcessDiagnostics } = require("../lib/process-diagnostics");

function fixture({ dirty = true, response = 0, shuttingDown = false } = {}) {
  const root = path.resolve(__dirname, "../../output/process-diagnostics-tests");
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "case-"));
  const app = Object.assign(new EventEmitter(), {
    getPath: () => directory, getVersion: () => "test",
  });
  const calls = { dialogs: [], quits: 0, gone: 0, revealed: [], crashOptions: null };
  const diagnostics = installProcessDiagnostics({
    app,
    crashReporter: { start: (options) => { calls.crashOptions = options; } },
    dialog: { showMessageBox: async (_window, options) => { calls.dialogs.push(options); return { response }; } },
    shell: { showItemInFolder: (file) => calls.revealed.push(file) },
    isShuttingDown: () => shuttingDown,
    getDocumentState: () => ({ dirty }),
    onRendererGone: () => { calls.gone += 1; },
    quit: async () => { calls.quits += 1; },
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), isDestroyed: () => false,
  });
  return { app, calls, diagnostics, window, failure: diagnostics.attachWindow(window) };
}

test("renderer exit reports locally and preserves the session unless Quit is chosen", async () => {
  const f = fixture();
  f.window.webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: -536870904 });
  await f.failure.showFailure();
  assert.equal(f.failure.hasFailed(), true);
  assert.equal(f.calls.gone, 1);
  assert.equal(f.calls.quits, 0);
  assert.equal(f.calls.dialogs.length, 1, "overlapping notifications should share a single dialog");
  assert.deepEqual(f.calls.dialogs[0].buttons, ["Keep Open", "Open Logs", "Quit Without Saving"]);
  assert.match(f.calls.dialogs[0].detail, /unsaved changes/);
  assert.equal(f.calls.dialogs[0].cancelId, 0);
  assert.deepEqual(f.calls.crashOptions, { uploadToServer: false });
  const events = fs.readFileSync(f.diagnostics.logPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).event, "render-process-gone");
  assert.equal(events.at(-1).reason, "oom");
  assert.equal(events.at(-1).exitCode, -536870904);
  assert.ok(events.at(-1).timestamp);
});

test("Open Logs keeps the session, and explicit Quit closes it", async () => {
  for (const response of [1, 2]) {
    const f = fixture({ response });
    f.window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    await f.failure.showFailure();
    assert.equal(f.calls.quits, response === 2 ? 1 : 0);
    assert.deepEqual(f.calls.revealed, response === 1 ? [f.diagnostics.logPath] : []);
  }
});

test("shutdown exits do not raise a crash dialog; GPU exits are recorded independently", () => {
  const f = fixture({ shuttingDown: true });
  f.window.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
  f.app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 5 });
  assert.equal(f.failure.hasFailed(), false);
  assert.equal(f.calls.dialogs.length, 0);
  assert.equal(f.calls.gone, 0);
  const events = fs.readFileSync(f.diagnostics.logPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).type, "GPU");
  assert.equal(events.at(-1).exitCode, 5);
});
