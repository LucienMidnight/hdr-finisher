const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const HDRTonePreviewModel = require("../frontend/tone-preview-model.js");

function load(file, context) {
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend", file), "utf8"), context);
  return context;
}

test("both lanes interleave the same live sections without losing their identity or fold state", () => {
  const names = ["highlights", "tone", "equalizer", "curves", "color", "hsl", "color-grading", "black-and-white", "detail", "film-look", "vignette"];
  const shared = new Set(["curves", "hsl", "color-grading", "black-and-white", "detail", "film-look", "vignette"]);
  const groups = new Map();
  const panels = ["hdr", "sdr"].map(lane => ({
    dataset: { lanePanel: lane }, children: [],
    insertBefore(group, next) {
      if (group.parent) group.parent.children.splice(group.parent.children.indexOf(group), 1);
      this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, group);
      group.parent = this;
    },
  }));
  for (const lane of ["hdr", "sdr"]) for (const name of names) {
    const id = shared.has(name) ? name : `${lane}-${name}`;
    if (!groups.has(id)) groups.set(id, { id, collapsed: id !== "curves", authoredValue: 7 });
  }
  const denoise = { id: "denoise", parent: "global" };
  groups.set("denoise", denoise);
  const context = load("lanes-compare.js", {
    els: { lanePanels: panels },
    document: { querySelector: selector => groups.get(selector.match(/data-group="([^"]+)"/)[1]) },
  });
  for (const lane of ["hdr", "sdr", "hdr", "sdr"]) {
    context.arrangeLaneControlGroups(lane);
    const panel = panels.find(item => item.dataset.lanePanel === lane);
    assert.deepEqual(panel.children.map(group => group.id), names.map(name => shared.has(name) ? name : `${lane}-${name}`));
    assert.equal(panel.children[3], groups.get("curves"));
    assert.equal(panel.children[3].collapsed, false);
    assert.ok(panel.children.every(group => group.authoredValue === 7));
    assert.equal(denoise.parent, "global");
  }
});

function displayHarness() {
  const elements = {
    "hdr-compression-display-note": { hidden: true },
    "hdr-compression-display-message": { textContent: "" },
    "hdr-compression-target": { min: "200", max: "10000", step: "2.5", dataset: { path: "hdr.highlight_compression_target_nits", instrumentStep: "25" } },
  };
  const edits = [];
  const state = { adjustments: { hdr: { highlight_compression_target_nits: 1000 } } };
  const context = load("highlight-controls.js", {
    state, HDRTonePreviewModel, projectReferenceWhiteNits: () => 203,
    document: { getElementById: id => elements[id] },
    beginGlobalEditGesture: control => edits.push(["begin", control.dataset.path]),
    commitAdjustmentValue: (controlPath, value) => { edits.push(["commit", controlPath, value]); state.adjustments.hdr.highlight_compression_target_nits = value; },
    endGlobalEditGesture: control => edits.push(["end", control.dataset.path]),
  });
  return { context, state, elements, edits };
}

test("display guidance is advisory, hidden for unknown or sufficient peaks, and uses the primary display", () => {
  const { context, state, elements, edits } = displayHarness();
  for (const [displays, visible] of [
    [[], false], [[{ max_luminance_nits: 0 }], false], [[{ max_luminance_nits: 1200 }], false],
    [[{ max_luminance_nits: 1000 }], false], [[{ max_luminance_nits: 613 }], true],
    [[{ max_luminance_nits: 400 }, { primary: true, max_luminance_nits: 1500 }], false],
    [[{ nominal_headroom: 1, sdr_white_nits: 203 }], true],
  ]) {
    state.displayTelemetry = { displays };
    context.renderHighlightDisplayNote();
    assert.equal(elements["hdr-compression-display-note"].hidden, !visible);
    assert.equal(state.adjustments.hdr.highlight_compression_target_nits, 1000);
  }
  assert.deepEqual(edits, []);
});

test("Use this display clamps and rounds to the ordinary slider step in one normal edit gesture", () => {
  for (const [peak, expected] of [[613, 625], [604, 600], [80, 200], [12000, 10000]]) {
    const { context, state, edits } = displayHarness();
    state.displayTelemetry = { displays: [{ max_luminance_nits: peak }] };
    context.useHighlightDisplayPeak();
    assert.equal(state.adjustments.hdr.highlight_compression_target_nits, expected);
    assert.deepEqual(edits.map(edit => edit[0]), ["begin", "commit", "end"]);
    context.useHighlightDisplayPeak();
    assert.equal(edits.length, 3);
  }
  const { context, edits } = displayHarness();
  context.useHighlightDisplayPeak();
  assert.deepEqual(edits, []);
});
