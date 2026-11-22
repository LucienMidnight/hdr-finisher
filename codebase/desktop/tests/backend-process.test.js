const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createProofScratch, markProofBackend, sweepProofScratch, stopBackendProcess } = require("../lib/backend-process");

test("Proof scratch sweep removes stale roots while preserving live owners", async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "proof-sweep-test-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 5000)"]);
  t.after(() => stopBackendProcess(child));
  await once(child, "spawn");
  const dead = spawn(process.execPath, ["-e", ""]);
  await once(dead, "exit");

  const ago = new Date(Date.now() - 10 * 60 * 1000);
  function root(name, { backendPid, stale = true } = {}) {
    const directory = fs.mkdtempSync(path.join(tmp, name));
    fs.writeFileSync(path.join(directory, "tile.rgb"), "temporary pixels");
    if (backendPid) markProofBackend(directory, backendPid);
    if (stale) fs.utimesSync(directory, ago, ago);
    return directory;
  }

  const current = createProofScratch(tmp);
  fs.utimesSync(current, ago, ago);
  const otherDesktop = root(`hdr-proof-${child.pid}-`);
  const liveBackend = root(`hdr-proof-${dead.pid}-`, { backendPid: child.pid });
  const abandoned = root(`hdr-proof-${dead.pid}-`, { backendPid: dead.pid });
  const legacy = root("hdr-proof-");
  const recent = root("hdr-proof-", { stale: false });
  const unrelated = root("other-");
  sweepProofScratch(tmp);
  for (const directory of [current, otherDesktop, liveBackend, recent, unrelated]) {
    assert.ok(fs.existsSync(directory), directory);
  }
  for (const directory of [abandoned, legacy]) assert.ok(!fs.existsSync(directory), directory);

  await stopBackendProcess(child);
  assert.ok(child.signalCode || child.exitCode !== null);
  sweepProofScratch(tmp);
  for (const directory of [otherDesktop, liveBackend]) assert.ok(!fs.existsSync(directory), directory);
});
