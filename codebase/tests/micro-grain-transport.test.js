const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(response) {
  const context = vm.createContext({ window: {}, URLSearchParams, DOMException,
    fetch: async () => response });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/micro-grain-gpu.js"), "utf8"), context);
  return (current = () => true) => context.window.HDRMicroGrainGpu.readBayer(
    { url: "/grain" }, { x: 0, y: 0, width: 16, height: 16 }, {}, 1, current, false,
  );
}

for (const reason of ["superseded", "conflict", "server failure"]) {
  test(`Micro Grain cancels an unread ${reason} response`, async () => {
    let cancelled = 0;
    let read = false;
    const response = {
      ok: reason !== "server failure", status: reason === "conflict" ? 409 : 503,
      body: { cancel: async () => { cancelled++; } },
      arrayBuffer: async () => { read = true; return new ArrayBuffer(4); },
    };
    const readBayer = harness(response);
    await assert.rejects(readBayer(() => reason !== "superseded"), error =>
      reason === "server failure" ? /503/.test(error.message) : error.name === "AbortError");
    assert.equal(cancelled, 1);
    assert.equal(read, false);
  });
}

test("Micro Grain retains the original error if response cancellation fails", async () => {
  const readBayer = harness({ ok: false, status: 503,
    body: { cancel: async () => { throw new Error("already closed"); } } });
  await assert.rejects(readBayer(), /503/);
});

test("Micro Grain reads a current successful response without cancelling it", async () => {
  const body = new ArrayBuffer(4);
  let cancelled = false;
  const readBayer = harness({ ok: true, status: 200,
    body: { cancel: async () => { cancelled = true; } }, arrayBuffer: async () => body });
  assert.equal(await readBayer(), body);
  assert.equal(cancelled, false);
});
