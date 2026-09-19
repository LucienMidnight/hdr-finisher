// Phase 1 exit gate: state-transition tests for the four viewer states.
//
// app.js is a single browser script that touches the DOM at load, so it cannot
// be required directly. deriveViewerState is deliberately pure — it takes a
// snapshot and returns a status — so this suite lifts that function and the two
// constants it depends on out of the source and evaluates them in a bare
// context. The extraction is asserted, so a rename breaks the test loudly
// instead of silently testing nothing.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../frontend/app.js"), "utf8");

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  assert.ok(start >= 0, `could not find ${startMarker} in app.js`);
  assert.ok(end > start, `could not find ${endMarker} after ${startMarker} in app.js`);
  return source.slice(start, end);
}

const context = vm.createContext({});
vm.runInContext(
  [
    'const PREVIEW_RESOLUTION_OPTIONS = new Set(["1024", "2048", "4096", "full"]);',
    'const DEFAULT_PREVIEW_RESOLUTION = "1024";',
    extract("function deriveViewerState(", "function viewerState("),
    "globalThis.deriveViewerState = deriveViewerState;",
  ].join("\n"),
  context,
);
const { deriveViewerState } = context;

const GEOMETRY = "geometry-a";

function presentation(overrides = {}) {
  return {
    lane: "hdr",
    generation: 7,
    geometrySignature: GEOMETRY,
    requestedTier: "4096",
    tier: "4096",
    exact: true,
    ...overrides,
  };
}

function derive(overrides = {}) {
  return deriveViewerState({
    requestedTier: "4096",
    accepted: presentation(),
    currentGeneration: 7,
    lane: "hdr",
    geometrySignature: GEOMETRY,
    unavailableReason: "",
    ...overrides,
  });
}

test("an exact result at the current generation is Ready", () => {
  const viewer = derive();
  assert.equal(viewer.status, "ready");
  assert.equal(viewer.tier, "4096");
  assert.equal(viewer.presentedTier, "4096");
});

test("a newer edit generation is Updating, and the same-tier image stays presented", () => {
  const viewer = derive({ currentGeneration: 8 });
  assert.equal(viewer.status, "updating");
  assert.equal(viewer.presentedTier, "4096");
});

test("a stale geometry signature is Updating, not Ready", () => {
  const viewer = derive({ geometrySignature: "geometry-b" });
  assert.equal(viewer.status, "updating");
});

test("with no accepted presentation at all the viewer is Preparing and names no tier", () => {
  const viewer = derive({ accepted: null });
  assert.equal(viewer.status, "preparing");
  assert.equal(viewer.presentedTier, null);
});

test("a tier change is Preparing, and the previous tier is still named", () => {
  // The user has just moved 4K -> Full. The accepted 4K image is still on
  // screen and must be labeled as a 4K result, not as a completed Full one.
  const viewer = deriveViewerState({
    requestedTier: "full",
    accepted: presentation({ requestedTier: "4096", tier: "4096" }),
    currentGeneration: 7,
    lane: "hdr",
    geometrySignature: GEOMETRY,
  });
  assert.equal(viewer.status, "preparing");
  assert.equal(viewer.tier, "full");
  assert.equal(viewer.presentedTier, "4096");
});

test("a non-exact bootstrap placeholder never counts as the selected tier", () => {
  const viewer = derive({ accepted: presentation({ exact: false, tier: null }) });
  assert.equal(viewer.status, "preparing");
  assert.equal(viewer.presentedTier, null);
});

test("a presentation from the other lane does not satisfy this lane", () => {
  const viewer = derive({ accepted: presentation({ lane: "sdr" }) });
  assert.equal(viewer.status, "preparing");
  assert.equal(viewer.presentedTier, null);
});

test("Unavailable outranks every other state and carries its reason", () => {
  const viewer = derive({ unavailableReason: "GPU device lost" });
  assert.equal(viewer.status, "unavailable");
  assert.equal(viewer.detail, "GPU device lost");
  // The last valid presentation is still identified, so the viewer can keep
  // showing it rather than blanking.
  assert.equal(viewer.presentedTier, "4096");
});

test("an unrecognized requested tier falls back to the default rather than propagating", () => {
  const viewer = derive({ requestedTier: "9999", accepted: null });
  assert.equal(viewer.tier, "1024");
  assert.equal(viewer.status, "preparing");
});

test("rapid reversal back to the accepted tier returns to Ready without an intermediate state", () => {
  const accepted = presentation();
  const away = deriveViewerState({
    requestedTier: "2048",
    accepted,
    currentGeneration: 7,
    lane: "hdr",
    geometrySignature: GEOMETRY,
  });
  assert.equal(away.status, "preparing");

  const back = deriveViewerState({
    requestedTier: "4096",
    accepted,
    currentGeneration: 7,
    lane: "hdr",
    geometrySignature: GEOMETRY,
  });
  assert.equal(back.status, "ready");
  assert.equal(back.presentedTier, "4096");
});
