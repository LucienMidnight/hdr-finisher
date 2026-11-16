const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function controls(reference, target, start) {
  const range = { min: "200" };
  const label = { dataset: {} };
  const state = { adjustments: { hdr: { highlight_compression_target_nits: target, highlight_compression_start_nits: start } } };
  const context = vm.createContext({ state, projectReferenceWhiteNits: () => reference,
    MANUAL_VALUE_RULES: { "hdr.highlight_compression_target_nits": { min: 2, max: 10000, decimals: 0 } },
    document: { getElementById: () => range, querySelector: () => label },
    syncRangeControlFromState() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/highlight-controls.js"), "utf8"), context);
  return { context, state, range, label };
}

for (const reference of [100, 203]) {
  test(`peak input and pasted state keep HDR headroom at ${reference}-nit white`, () => {
    const fixture = controls(reference, 203, 400);
    vm.runInContext('normalizeHighlightCompressionControls("hdr.highlight_compression_target_nits")', fixture.context);
    assert.equal(fixture.range.min, "225");
    assert.equal(fixture.state.adjustments.hdr.highlight_compression_target_nits, 225);
    assert.equal(fixture.state.adjustments.hdr.highlight_compression_start_nits, 224);
    assert.match(fixture.label.dataset.tooltip, /203-nit white/);
  });
}

test("a valid peak is not changed when controls synchronize", () => {
  const fixture = controls(203, 1000, 400);
  vm.runInContext("syncHighlightCompressionMinimum()", fixture.context);
  assert.equal(fixture.state.adjustments.hdr.highlight_compression_target_nits, 1000);
  assert.equal(fixture.state.adjustments.hdr.highlight_compression_start_nits, 400);
});
