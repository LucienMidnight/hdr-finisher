const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { HDRMaskExpression } = require("../frontend/mask-expression.js");

function editor() {
  const commands = [];
  const state = {
    session: { session_id: "photo" }, editDocument: { local_adjustments: [] },
    gradeMode: "local", currentView: "hdr", localHiddenGizmoIds: new Set(),
    localMaskCommitDepth: 0, localMaskDraftGeneration: 0,
  };
  const context = vm.createContext({
    state, crypto: { randomUUID }, maskExpression: HDRMaskExpression,
    HDRHSL: { newRecipe: () => ({}) }, defaultCurvePoints: () => [], defaultColorGrading: () => ({}),
    els: {}, window: { clearTimeout }, commands,
    queueEditCommand: async (type, payload) => { commands.push({ type, payload }); return true; },
    invalidatePreview() {}, debouncePreview() {}, queueLocalMaskOverlayRender() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/local-adjustments-ui.js"), "utf8"), context);
  // These tests exercise real authoring operations; layout and painting are
  // covered separately by the browser interaction drivers.
  context.renderLocalAdjustments = () => {};
  context.setGradeMode = mode => { state.gradeMode = mode; };
  return { context, state, commands };
}

test("tool clicks create selected unused drafts; another type converts and the lit tool creates anew", async () => {
  const { context: c, state, commands } = editor();
  await c.assignToolToPending("brush");
  const first = c.selectedLocal();
  assert.equal(c.localAdjustmentRows().length, 1);
  assert.equal(c.localAdjustments().length, 0, "unused masks must not participate in rendering or saves");
  assert(c.unusedLocal(first));
  await c.assignToolToPending("linear_gradient");
  assert.equal(c.selectedLocal().id, first.id);
  assert.equal(c.selectedMaskLeaf().type, "linear_gradient");
  await c.assignToolToPending("linear_gradient");
  assert.notEqual(c.selectedLocal().id, first.id);
  assert.equal(c.localAdjustmentRows().length, 1);
  assert.equal(state.localTool, "linear_gradient");
  assert.equal(commands.length, 0);
});

test("default luma stays unused through grade edits, then first range/sample content creates one history command", async () => {
  const { context: c, commands } = editor();
  await c.assignToolToPending("luminance_range");
  c.selectedLocal().hdr_grade.exposure = 1;
  assert.equal(await c.commitSelectedLocal(), false);
  assert.equal(c.localAdjustments().length, 0);
  c.selectedMaskLeaf().full_start_ev = -2;
  assert.equal(await c.commitSelectedLocal({ maskContent: true }), true);
  assert.equal(c.localAdjustments().length, 1);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "create_local");
  assert.equal(commands[0].payload.local.hdr_grade.exposure, 1);
  assert.equal(commands[0].payload.local.mask.leaf.full_start_ev, -2);
  await c.commitSelectedLocal();
  assert.equal(commands[1].type, "update_local");
});

test("selecting another row discards an unused mask without creating or deleting history", async () => {
  const { context: c, state, commands } = editor();
  const existing = c.newLocalAdjustment("brush");
  state.editDocument.local_adjustments.push(existing);
  await c.assignToolToPending("luminance_range");
  const draft = c.selectedLocal();
  c.selectLocalAdjustment(draft.id);
  assert(c.unusedLocal(), "selecting the same row should retain its draft");
  c.selectLocalAdjustment(existing.id);
  assert.equal(c.selectedLocal(), existing);
  assert.equal(c.localAdjustmentRows().length, 1);
  assert.equal(commands.length, 0);
});

test("brush content and a completed path create once; cancelling an unplaced path creates nothing", async () => {
  const { context: c, commands } = editor();
  await c.assignToolToPending("brush");
  c.selectedMaskLeaf().strokes.push({ points: [{ x: .5, y: .5 }] });
  await c.commitSelectedLocal({ maskContent: true });
  await c.assignToolToPending("path");
  c.cancelLocalPathDraft();
  assert.equal(commands.length, 1);
  await c.assignToolToPending("path");
  c.selectedMaskLeaf().nodes.push({ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 });
  await c.finishLocalPathDraft();
  assert.equal(commands.length, 2);
  assert.equal(commands[1].type, "create_local");
  assert.equal(c.localAdjustments().length, 2);
});

test("a rejected first-content edit restores the unused draft", async () => {
  const { context: c } = editor();
  await c.assignToolToPending("linear_gradient");
  const draft = c.selectedLocal();
  c.queueEditCommand = async () => false;
  assert.equal(await c.commitSelectedLocal({ maskContent: true }), false);
  assert.equal(c.localAdjustments().length, 0);
  assert.equal(c.selectedLocal(), draft);
  assert(c.unusedLocal());
});
