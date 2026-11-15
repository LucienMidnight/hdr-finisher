const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../frontend/sdr-match-ui.js"), "utf8");

test("local acknowledgements refresh stale markers without replacing newer strokes", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/edit-commands.js"), "utf8"), context);
  const optimistic = [{ id: "parent", mask: { radius: .2 }, sdr_match: { signature: "fit", out_of_date: false } }];
  const saved = structuredClone(optimistic);
  saved[0].sdr_match.out_of_date = true;
  context.mergeLocalSdrMatchStatus(optimistic, saved);
  assert.equal(optimistic[0].sdr_match.out_of_date, true);
  optimistic[0].mask.radius = .3;
  saved[0].sdr_match.out_of_date = false;
  context.mergeLocalSdrMatchStatus(optimistic, saved);
  assert.equal(optimistic[0].mask.radius, .3);
  assert.equal(optimistic[0].sdr_match.out_of_date, true);
});

for (const kind of ["matched", "manual"]) {
  test(`whole-picture Match asks before replacing ${kind} locals`, async () => {
    let prompts = 0;
    const local = { sdr_grade: { exposure: kind === "manual" ? .2 : 0 }, sdr_match: kind === "matched" ? {} : null };
    const context = {
      state: { session: { session_id: "photo" }, editDocument: { local_adjustments: [local] } },
      syncGlobalEditState: async () => true, stablePreviewJson: JSON.stringify,
      defaultLocalGrade: () => ({ exposure: 0 }),
      window: { HDRDialogs: { confirm: async () => { prompts++; return false; } } },
      fetch: () => assert.fail("Declining must not start fitting"),
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    assert.equal(await context.setSdrMatch(), false);
    assert.equal(prompts, 1);
  });
}

for (const changed of [true, false]) {
  test(`local Match uses selected parent and handles changed=${changed}`, async () => {
    const requests = [], effects = [];
    const context = {
      state: { session: { session_id: "photo" }, editRevision: 3, selectedSubMaskId: "child" },
      selectedLocal: () => ({ id: "parent" }), unusedLocal: () => false,
      document: { getElementById: () => null },
      syncGlobalEditState: async () => true,
      fetch: async (url, options) => { requests.push([url, JSON.parse(options.body)]); return { ok: true }; },
      safeJson: async () => ({ changed, message: "Finished" }),
      refreshEditState: async () => effects.push("refresh"),
      invalidatePreview: lane => effects.push(lane), debouncePreview() {}, syncDesktopDocumentState() {},
      status: { post: () => effects.push("status") },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    assert.equal(await context.matchSelectedLocalSdr(), changed);
    assert.equal(requests[0][0], "/api/session/photo/local/parent/sdr-match");
    assert.deepEqual(requests[0][1], { expected_revision: 3 });
    assert.deepEqual(effects, changed ? ["refresh", "sdr", "status"] : ["refresh", "status"]);
    assert.equal(context.state.localSdrMatchBusy, false);
  });
}

test("a late local Match response cannot replace a new photo", async () => {
  let finish, started;
  const requested = new Promise(resolve => { started = resolve; });
  const context = {
    state: { session: { session_id: "old" }, editRevision: 1 },
    document: { getElementById: () => null }, selectedLocal: () => ({ id: "parent" }), unusedLocal: () => false,
    syncGlobalEditState: async () => true,
    fetch: () => { started(); return new Promise(resolve => { finish = resolve; }); },
    safeJson: async () => ({ changed: true }),
    refreshEditState: () => assert.fail("New photo must not be refreshed"),
    status: { post: () => assert.fail("Old photo must not post status") },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const flight = context.matchSelectedLocalSdr();
  await requested;
  context.state.session = { session_id: "new" };
  finish({ ok: true });
  assert.equal(await flight, false);
});
