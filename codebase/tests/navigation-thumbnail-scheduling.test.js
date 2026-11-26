const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { declarations } = require("./frontend-source.js");

function fixture() {
  const identity = { sessionId: "photo", lane: "sdr", generation: 3, geometrySignature: "crop" };
  const state = {
    session: { session_id: "photo", source: { width: 7362, height: 4200 } },
    currentView: "sdr", activeWorkflow: "grade", editRevision: 2, previewGeneration: { sdr: 3 },
    gpuPreview: { activeRenderCount: 0, renderNavigationProxy: async () => null },
    acceptedPresentation: { ...identity, exact: true, processedLongEdge: 1600 },
  };
  const image = { style: {} };
  const timers = new Map();
  const fetches = [];
  let serial = 0;
  const c = vm.createContext({
    state, AbortController, console, els: { navigationThumbImage: image },
    URL: { createObjectURL: () => "blob:thumbnail", revokeObjectURL() {} },
    geometrySignature: () => "crop", navigationWindowWanted: () => true, updateNavigationViewport() {},
    scopePresentationIdentity: () => ({ ...identity, generation: state.previewGeneration.sdr }),
    scopePresentationMatches: (presentation, lane) => lane === state.currentView
      && Object.entries(c.scopePresentationIdentity()).every(([key, value]) => presentation?.[key] === value),
    syncGlobalEditState: async () => true, localsBypassed: () => false, gpuPreviewEligible: () => true,
    sampleCurvePoints() {}, localAdjustments: () => [], projectReferenceWhiteNits: () => 203,
    cpuPreviewReason: () => "tiled", microGrainPreviewRequest: () => ({}), safeJson: response => response.json(),
    fetch: async (url, options) => {
      fetches.push({ url, body: JSON.parse(options.body) });
      return { ok: true, blob: async () => ({}) };
    },
    window: {
      clearTimeout: id => timers.delete(id),
      setTimeout: (fn) => { timers.set(++serial, fn); return serial; },
      HDRWholeImagePreviewPipe: {
        request: (_purpose, _width, options) => ({ ...options, longEdge: 512 }),
      },
    },
  });
  vm.runInContext(`const navigationThumbnail = { timer: 0, key: "", url: "" };
    ${declarations("navigationThumbnailWorkPending", "navigationThumbnailWorkReady", "scheduleNavigationThumbnail",
    "refreshNavigationThumbnail", "wholeScopePresentation", "auxiliaryGpuCancelled", "auxiliaryGpuRefusalCancelled")}`, c);
  return { c, state, image, timers, fetches };
}

test("Navigate uses the retained lower picture once active zoom work settles", async () => {
  const { c, state, image, timers, fetches } = fixture();
  for (const [key, value] of [["gpuDraftInFlight", {}], ["zoomRefinementTimer", 1],
    ["zoomRefinementInFlight", {}], ["importInProgress", true], ["previewScheduler", { interacting: true }]]) {
    state[key] = value;
    assert.equal(c.navigationThumbnailWorkReady(), false);
    delete state[key];
  }
  assert.equal(c.navigationThumbnailWorkReady(), true);
  await c.refreshNavigationThumbnail();
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /purpose=navigation/);
  assert.equal(fetches[0].body.long_edge, 512);
  assert.equal(image.src, "blob:thumbnail");
  image.onload();
  assert.equal(image.style.visibility, "");
  assert.equal(timers.size, 0);
  state.previewGeneration.sdr++;
  await c.refreshNavigationThumbnail();
  assert.equal(fetches.length, 1);
  assert.equal(timers.size, 0);
});

test("a thrown GPU Navigate failure falls back once", async () => {
  const { c, state, image, fetches } = fixture();
  state.gpuPreview.renderNavigationProxy = async () => { throw Error("GPU allocation failed"); };
  await c.refreshNavigationThumbnail();
  assert.equal(fetches.length, 1);
  assert.equal(image.src, "blob:thumbnail");
});

for (const kind of ["superseded", "aborted"]) {
  test(`a ${kind} Navigate render does not run the CPU fallback`, async () => {
    const { c, state, fetches } = fixture();
    state.gpuPreview.renderNavigationProxy = async () => {
      if (kind === "superseded") {
        state.gpuPreview.lastRenderRefusal = { reason: "superseded-after-masks" };
        return null;
      }
      throw Object.assign(Error("cancelled"), { name: "AbortError" });
    };
    await c.refreshNavigationThumbnail();
    assert.equal(fetches.length, 0);
  });
}

test("a superseded photo cannot start the Navigate CPU fallback", async () => {
  const { c, state, fetches } = fixture();
  state.gpuPreview.renderNavigationProxy = async () => {
    state.previewGeneration.sdr++;
    return null;
  };
  await c.refreshNavigationThumbnail();
  assert.equal(fetches.length, 0);
});

test("Navigate waits for a different matching whole Micro picture, not another zoom tile", async () => {
  const { c, state, image, timers } = fixture();
  let attempts = 0;
  c.fetch = async () => ++attempts === 1
    ? { status: 409, json: async () => ({ detail: { code: "micro_navigation_source_unavailable" } }) }
    : { ok: true, blob: async () => ({}) };
  state.acceptedPresentation.execution = "cpu-viewport";
  await c.refreshNavigationThumbnail();
  await c.refreshNavigationThumbnail();
  state.acceptedPresentation = { ...state.acceptedPresentation };
  await c.refreshNavigationThumbnail();
  assert.equal(attempts, 1);
  assert.equal(timers.size, 0);
  state.acceptedPresentation = { ...state.acceptedPresentation, execution: null };
  await c.refreshNavigationThumbnail();
  assert.equal(attempts, 2);
  assert.equal(image.src, "blob:thumbnail");
});
