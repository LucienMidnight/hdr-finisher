const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRScopeUI } = require("../frontend/scope-ui.js");

test("scope quality and freshness policies are pure inputs", () => {
  assert.equal(HDRScopeUI.freshnessLabel("interactive"), "Preview");
  assert.equal(HDRScopeUI.freshnessLabel("refinement"), "Refined");
  assert.equal(HDRScopeUI.freshnessLabel("settled"), "Settled");
  assert.deepEqual(HDRScopeUI.requestResolution("interactive", "performance"), { bins: 96, columns: 96 });
  assert.deepEqual(HDRScopeUI.requestResolution("settled", "reference"), { bins: 384, columns: 384 });
  assert.deepEqual(HDRScopeUI.requestResolution("settled", "balanced"), { bins: 256, columns: 256 });
  const fallback = { settledEdge: 2048 };
  assert.equal(HDRScopeUI.qualityProfile({ balanced: fallback }, "retired", "balanced"), fallback);
});

test("HDR guide ceilings and labels follow the delivered bin domain", () => {
  const scope = { preview_kind: "hdr", bin_edges: [1, 10000], guides: [] };
  assert.equal(HDRScopeUI.hdrCeiling(scope), 10000);
  assert.deepEqual(Array.from(HDRScopeUI.guidesForDisplay(scope)), [1, 10, 100, 203, 1000, 4000, 10000]);
  assert.equal(HDRScopeUI.compactGuideLabel(scope, { value: 4000, label: "4000 nit" }), "4k");
  assert.equal(HDRScopeUI.compactGuideLabel(scope, { value: 203, label: "203 active" }), "RW 203");
  assert.equal(HDRScopeUI.guidePosition(scope, 100), 0.5);
});

test("scope tooltips describe only visible guides", () => {
  const scope = {
    preview_kind: "hdr",
    scope_type: "reference_nits_waveform",
    bin_edges: [1, 4000],
    guides: [
      { value: 1, label: "1 nit" },
      { value: 203, label: "203 active" },
      { value: 10000, label: "10000 peak" },
    ],
  };
  const tooltip = HDRScopeUI.guideTooltip(scope);
  assert.match(tooltip, /1 nit/);
  assert.match(tooltip, /RW 203: active HDR reference white/);
  assert.doesNotMatch(tooltip, /10k/);
  assert.equal(
    HDRScopeUI.guideTooltip({ scope_type: "vectorscope" }),
    "Chroma direction and saturation. Distance from center indicates saturation.",
  );
});

test("scope channels are selected without application state", () => {
  const channels = ["R", "G", "B", "Y"].map((name) => ({ name }));
  assert.deepEqual(HDRScopeUI.filteredChannels(channels, "luma").map(({ name }) => name), ["Y"]);
  assert.deepEqual(HDRScopeUI.filteredChannels(channels, "parade").map(({ name }) => name), ["R", "G", "B"]);
  assert.deepEqual(HDRScopeUI.filteredChannels(channels, "overlay").map(({ name }) => name), ["R", "G", "B"]);
});

test("scope titles take channel mode explicitly", () => {
  assert.equal(HDRScopeUI.titleFor({ preview_kind: "hdr", scope_type: "vectorscope" }, "luma"), "HDR Vectorscope");
  assert.equal(HDRScopeUI.titleFor({ preview_kind: "hdr", scope_type: "reference_nits_waveform" }, "parade"), "HDR Reference Waveform Parade");
  assert.equal(HDRScopeUI.titleFor({ preview_kind: "sdr", scope_type: "normalized_waveform" }, "luma"), "SDR Waveform Luma");
  assert.equal(HDRScopeUI.titleFor({ preview_kind: "sdr", scope_type: "histogram" }, "overlay"), "SDR Histogram");
});
