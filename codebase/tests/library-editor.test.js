const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function host() {
  const listeners = {}, sent = [], gates = [], exports = [];
  const buttons = ["copy-grade", "paste-grade", "paste-grade-choose", "quick-export"].map(command => ({ dataset: { desktopCommand: command } }));
  const frame = { contentWindow: { postMessage: message => sent.push(message), focus() {} }, after() {} };
  const window = { addEventListener: (name, callback) => listeners[name] = callback,
    HDRGradeSaving: { item: () => "photo|copy|2", leave: async label => { gates.push(label); return false; }, refresh: async () => {} },
    batchExport: { quick: async paths => exports.push(paths), open: async paths => exports.push(paths) } };
  const document = { getElementById: () => frame, createElement: () => ({ querySelector: () => ({ addEventListener() {} }) }),
    querySelectorAll: selector => selector === "[data-desktop-command]" ? buttons : [], documentElement: { dataset: { theme: "default-dark" } } };
  const state = { activeWorkflow: "import" };
  const requests = [];
  const context = { window, document, state, desktop: null, fetch: async (url, options) => {
    requests.push({url, body:JSON.parse(options.body)});
    return {ok:true, json:async()=>({session:{session_id:'open'}})};
  }, location: { origin: "http://local" },
    MutationObserver: class { observe() {} }, showUploadError: error => { throw new Error(error); } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../frontend/library-editor.js"), "utf8"), context);
  const message = data => listeners.message({ source: frame.contentWindow, origin: "http://local", data: { type: "hdr-library", ...data } });
  return { window, state, buttons, message, sent, gates, exports, requests };
}

test("paste asks the leave gate for the exact open virtual copy and respects Cancel", async () => {
  const h = host();
  assert.equal(await h.window.HDRLibraryHost.preparePaste(["photo"]), true);
  assert.equal(h.gates.length, 0);
  assert.equal(await h.window.HDRLibraryHost.preparePaste(["photo|copy|2"]), false);
  assert.equal(h.gates.length, 1);
});

test("Library menu availability follows selection, clipboard and workspace", () => {
  const h = host();
  h.message({ action: "command-state", selected: 0, copied: false });
  assert.ok(h.buttons.every(button => button.disabled));
  h.message({ action: "command-state", selected: 1, copied: false });
  assert.deepEqual(h.buttons.map(button => button.disabled), [false, true, true, false]);
  h.message({ action: "command-state", selected: 3, copied: true });
  assert.deepEqual(h.buttons.map(button => button.disabled), [false, false, false, false]);
  assert.equal(h.window.HDRLibraryHost.dispatch("paste-grade"), true);
  assert.equal(h.sent.at(-1).command, "paste-grade");
  h.state.activeWorkflow = "grade";
  assert.equal(h.window.HDRLibraryHost.dispatch("paste-grade"), false);
});

test("Library export actions pass the selected item identities into batch export", async () => {
  const h = host();
  h.message({ action: "quick-export", paths: ["photo", "photo|copy|2"] });
  h.message({ action: "export-selection", paths: ["other"] });
  await Promise.resolve();
  assert.deepEqual(h.exports, [["photo", "photo|copy|2"], ["other"]]);
});


test("Don't save reloads the saved photo before the paste mutation", async () => {
  const h = host();
  h.state.session = {session_id:'open'}; h.state.documentDirty = true;
  h.window.HDRGradeSaving.leave = async () => true;
  let refreshed = false;
  h.window.HDRGradeSaving.refresh = async session => { assert.equal(session.session_id,'open'); refreshed = true; };
  assert.equal(await h.window.HDRLibraryHost.preparePaste(['photo|copy|2']),true);
  assert.deepEqual(h.requests,[{url:'/api/library/grade/open',body:{action:'discard-for-paste'}}]);
  assert.equal(refreshed,true);
});
