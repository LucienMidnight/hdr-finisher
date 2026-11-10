const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { waitForInitialLoad } = require("./electron-initial-load");

function fixture(loading) {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => "http://127.0.0.1/", isLoadingMainFrame: () => loading,
  });
  const app = { evaluate: (callback, argument) => callback({ BrowserWindow: {
    getAllWindows: () => [{ webContents: contents }],
  } }, argument) };
  const page = { waitForURL: async () => {} };
  return { contents, app, page, stop: () => { loading = false; contents.emit("did-stop-loading"); } };
}

test("initial load completes when finish-load has passed but stop-loading is pending", async () => {
  const f = fixture(true);
  f.contents.emit("did-finish-load");
  const pending = waitForInitialLoad(f.app, f.page, { timeout: 1000 });
  setImmediate(f.stop);
  await pending;
  assert.equal(f.contents.eventNames().length, 0);
});

test("an already loaded window needs no future notification", async () => {
  const f = fixture(false);
  await waitForInitialLoad(f.app, f.page, { timeout: 1000 });
  assert.equal(f.contents.eventNames().length, 0);
});

test("initial loading failure is reported and listeners are removed", async () => {
  const f = fixture(true);
  const pending = waitForInitialLoad(f.app, f.page, { timeout: 1000 });
  setImmediate(() => f.contents.emit("did-fail-load", {}, -2, "failed", "", true));
  await assert.rejects(pending, /Initial app load failed: failed/);
  assert.equal(f.contents.eventNames().length, 0);
});

test("a stalled initial load fails within its deadline", async () => {
  const f = fixture(true);
  await assert.rejects(waitForInitialLoad(f.app, f.page, { timeout: 20 }), /did not stop within/);
  assert.equal(f.contents.eventNames().length, 0);
});

test("the main app window is chosen over the splash, and the load waits until it is shown", async () => {
  const splash = Object.assign(new EventEmitter(), { getURL: () => "file:///app/splash/splash.html", isLoadingMainFrame: () => false });
  const main = Object.assign(new EventEmitter(), { getURL: () => "http://127.0.0.1/", isLoadingMainFrame: () => true });
  let visible = false;
  const mainWindow = { webContents: main, isDestroyed: () => false, isVisible: () => visible };
  const app = { evaluate: (callback, argument) => callback({ BrowserWindow: {
    getAllWindows: () => [{ webContents: splash }, mainWindow],
    fromWebContents: (contents) => contents === main ? mainWindow : null,
  } }, argument) };
  let done = false;
  const pending = waitForInitialLoad(app, { waitForURL: async () => {} }, { timeout: 1000 }).then(() => { done = true; });
  await new Promise((resolve) => setImmediate(resolve));
  main.isLoadingMainFrame = () => false; main.emit("did-stop-loading");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(done, false, "waits while the main window is still hidden");
  visible = true;
  await pending;
  assert.equal(splash.eventNames().length, 0);
});
