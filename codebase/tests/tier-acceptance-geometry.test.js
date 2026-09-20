// Geometry trims the frame; it does not lower the tier.
//
// A straighten or a crop makes the presented picture smaller than the selected
// tier's long edge even though every pixel of it was processed at that tier.
// Acceptance used to compare the *presented* edge against the tier target, so
// any straightened or cropped image was never accepted as exact. That is one
// cause with three visible symptoms: the viewer said "Preparing {tier}"
// forever, every gesture fell back to the bootstrap proxy because
// selectedTierReady() was false, and the preview cache never matched its own
// entries so each request re-fetched a frame it already held.
//
// app.js is a single browser script that touches the DOM at load, so these
// tests lift the functions out of the source and run them in a bare context
// with the surrounding shell stubbed. Every extraction is asserted, so a rename
// breaks the test loudly instead of silently testing nothing.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `could not find ${startMarker} in app.js`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `could not find ${endMarker} after ${startMarker} in app.js`);
  return source.slice(start, end);
}

// 6000 x 4000 source, straightened by 1.8 degrees. The backend returns a frame
// trimmed to the largest inscribed rectangle, so a 4096 request presents 4011.
const SOURCE = { width: 6000, height: 4000 };
const STRAIGHTENED = { width: 4011, height: 2607 };

function shell({ previewResolution = "4096" } = {}) {
  const state = {
    previewResolution,
    currentView: "hdr",
    previewGeneration: { hdr: 7, sdr: 0 },
    acceptedPresentation: null,
    previewUnavailableReason: "",
    session: { session_id: "s1", source: SOURCE },
    adjustments: { shared: { geometry: { perspective_horizontal: 0, perspective_vertical: 0 } } },
    zoomReferenceFrame: null,
    geometryTransformHandoffSignature: null,
    geometryPresentationPending: false,
  };
  const context = vm.createContext({
    state,
    els: { previewCanvas: { style: { display: "block" } } },
    geometrySignature: () => "straighten:-1.8",
    applyZoomGeometry() {},
    clearRotateDraftTransformProperties() {},
    clearInteractiveStraightenPreview() {},
    ensureGeometryCoordinateMap() {},
    renderCurrentPreviewSize() {},
    renderReadouts() {},
    renderViewerStatus() {},
    gpuPreviewEligible: () => true,
  });
  vm.runInContext(
    [
      'const PREVIEW_RESOLUTION_OPTIONS = new Set(["1024", "2048", "4096", "full"]);',
      'const DEFAULT_PREVIEW_RESOLUTION = "1024";',
      extract("function normalizedPreviewResolution(", "function previewResolutionLabel("),
      extract("function previewTargetLongEdge(", "function previewResolutionDimensions("),
      extract("function deriveViewerState(", "function viewerState("),
      extract("function acceptPresentation(", "\nfunction "),
      extract("function residentAuthoringLongEdge(", "function bootstrapProxyLongEdge("),
      "globalThis.api = { acceptPresentation, deriveViewerState, residentAuthoringLongEdge, previewTargetLongEdge };",
    ].join("\n"),
    context,
  );
  return { state, ...context.api };
}

function viewerStatus({ state, deriveViewerState }) {
  return deriveViewerState({
    requestedTier: state.previewResolution,
    accepted: state.acceptedPresentation,
    currentGeneration: state.previewGeneration.hdr,
    lane: "hdr",
    geometrySignature: "straighten:-1.8",
    unavailableReason: state.previewUnavailableReason,
  }).status;
}

test("the tier target still comes from the source, not from the trimmed frame", () => {
  const app = shell();
  assert.equal(app.previewTargetLongEdge("4096"), 4096);
});

test("a straightened 4K render is exact, and the viewer is Ready", () => {
  const app = shell();
  app.acceptPresentation(
    "hdr", "settled", STRAIGHTENED.width, STRAIGHTENED.height,
    "WebGPU", "", 1, 7, "direct", 4096,
  );
  assert.equal(app.state.acceptedPresentation.exact, true);
  assert.equal(app.state.acceptedPresentation.tier, "4096");
  assert.equal(app.state.acceptedPresentation.processedLongEdge, 4096);
  // The presented picture is genuinely smaller than the tier, and is recorded
  // as such. Only the claim of exactness changed.
  assert.equal(app.state.acceptedPresentation.longEdge, 4011);
  assert.equal(viewerStatus(app), "ready");
});

test("the same straightened frame at the 1K tier is exact too", () => {
  const app = shell({ previewResolution: "1024" });
  app.acceptPresentation("hdr", "settled", 1003, 652, "WebGPU", "", 1, 7, "direct", 1024);
  assert.equal(app.state.acceptedPresentation.exact, true);
  assert.equal(viewerStatus(app), "ready");
});

test("a bootstrap proxy is still refused, however it is presented", () => {
  const app = shell();
  app.acceptPresentation("hdr", "settled", 1003, 652, "WebGPU", "", 1, 7, "direct", 1024);
  assert.equal(app.state.acceptedPresentation.exact, false);
  assert.equal(app.state.acceptedPresentation.tier, null);
  assert.equal(viewerStatus(app), "preparing");
});

test("with no processed edge reported, the presented edge still decides", () => {
  const app = shell();
  app.acceptPresentation("hdr", "settled", 1003, 652, "WebGPU", "", 1, 7, "direct", null);
  assert.equal(app.state.acceptedPresentation.exact, false);
  app.acceptPresentation("hdr", "settled", 4096, 2731, "WebGPU", "", 1, 7, "direct", null);
  assert.equal(app.state.acceptedPresentation.exact, true);
});

test("the resident short-circuit accepts the straightened frame", () => {
  const app = shell();
  app.acceptPresentation(
    "hdr", "settled", STRAIGHTENED.width, STRAIGHTENED.height,
    "WebGPU", "", 1, 7, "direct", 4096,
  );
  // Without this, a settled pass re-rendered the whole frame on every gesture
  // instead of recognising the tier already resident on the canvas.
  assert.equal(app.residentAuthoringLongEdge(), 4096);
});

test("the resident short-circuit still declines a frame processed below the tier", () => {
  const app = shell();
  app.acceptPresentation("hdr", "settled", 1003, 652, "WebGPU", "", 1, 7, "direct", 1024);
  assert.equal(app.residentAuthoringLongEdge(), null);
});
