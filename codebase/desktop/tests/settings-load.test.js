const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const preferences = require("../lib/application-preferences");
const bounds = require("../lib/window-bounds");

test("corrupt preferences and bounds use the same defaults as missing files, with diagnostics", () => {
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  const warnings = [];
  const workArea = { x: 0, y: 0, width: 1408, height: 794 };
  let failure = Object.assign(Error("file is missing"), { code: "ENOENT" });
  const context = vm.createContext({
    ...preferences, ...bounds,
    fs: { readFileSync() { if (failure) throw failure; return "["; } },
    console: { warn: (...args) => warnings.push(args) },
    applicationPreferencesPath: () => "preferences.json",
    windowStatePath: () => "bounds.json",
    screen: { getPrimaryDisplay: () => ({ workArea }) },
  });
  vm.runInContext(
    source.slice(source.indexOf("function loadApplicationPreferences("), source.indexOf("function setRenderingMode(")) +
    source.slice(source.indexOf("function restoredBounds("), source.indexOf("function saveWindowBounds(")), context,
  );
  context.loadApplicationPreferences();
  assert.equal(context.applicationPreferences.renderingMode, preferences.DEFAULT_APPLICATION_PREFERENCES.renderingMode);
  const fallback = bounds.clampWindowBounds(bounds.DEFAULT_WINDOW_BOUNDS, workArea);
  assert.deepEqual(context.restoredBounds("main"), fallback);
  assert.equal(warnings.length, 0);
  failure = null;
  context.loadApplicationPreferences();
  assert.equal(context.applicationPreferences.renderingMode, preferences.DEFAULT_APPLICATION_PREFERENCES.renderingMode);
  assert.deepEqual(context.restoredBounds("main"), fallback);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(([, cause]) => cause.name === "SyntaxError"));
});
