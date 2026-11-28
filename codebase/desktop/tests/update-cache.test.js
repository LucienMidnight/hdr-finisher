const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { cachedUpdateResult } = require("../lib/updates");

function loadUpdateCheck({ readFile, writeFile, fetch, warn }) {
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  const context = vm.createContext({
    app: { getVersion: () => "1.1.0" }, updatesManagedByStore: () => false,
    fs: { promises: { readFile, writeFile } },
    updateCheckCachePath: () => "cache.json",
    cachedUpdateResult, fetch, URL, AbortSignal, allowedProjectUrl: () => true,
    console: { warn },
  });
  vm.runInContext("let updateCheckCache = null, updateCheckCacheWrite = Promise.resolve();\n" +
    source.slice(source.indexOf("function semverParts("), source.indexOf("function randomSecret(")), context);
  return context.checkForUpdates;
}

test("an update check reuses the saved result without a network request", async () => {
  const result = { status: "current", currentVersion: "1.1.0" };
  const check = loadUpdateCheck({
    async readFile(file, encoding) {
      assert.equal(file, "cache.json");
      assert.equal(encoding, "utf8");
      return JSON.stringify({ checkedAt: Date.now(), result });
    },
  });
  assert.equal((await check()).status, result.status);
  assert.equal((await check()).currentVersion, result.currentVersion);
});

test("overlapping update results write the cache in order, even if a write fails", async () => {
  let finishWrite, version = 1;
  const writes = [], warnings = [];
  const check = loadUpdateCheck({
    async readFile() { throw Object.assign(Error("missing"), { code: "ENOENT" }); },
    async fetch() {
      const tag = "v1.1." + version++;
      return { ok: true, json: async () => ({
        tag_name: tag, html_url: "https://github.com/example/repo/releases/tag/" + tag,
      }) };
    },
    writeFile(_file, text) {
      writes.push(JSON.parse(text).result.latestVersion);
      if (writes.length === 1) return new Promise((_resolve, reject) => { finishWrite = reject; });
      return Promise.resolve();
    },
    warn: (...args) => warnings.push(args),
  });
  const first = check({ force: true }), second = check({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ["1.1.1"]);
  const diskError = Error("disk full");
  finishWrite(diskError);
  assert.equal((await first).latestVersion, "1.1.1");
  assert.equal((await second).latestVersion, "1.1.2");
  assert.deepEqual(writes, ["1.1.1", "1.1.2"]);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(diskError));
});
