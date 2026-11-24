const assert = require("node:assert/strict");
const { test } = require("node:test");

const { HDRGeometryMath } = require("../frontend/geometry-math.js");

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

test("neutral geometry is decided from geometry alone", () => {
  const neutral = { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral(neutral), true);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, flip_horizontal: true }), false);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, straighten_angle: 0.001 }), false);
  assert.equal(HDRGeometryMath.geometryTransformIsNeutral({ ...neutral, crop: { ...neutral.crop, width: 0.9 } }), false);
});

test("projective points reject a point at infinity", () => {
  assert.deepEqual(HDRGeometryMath.projectivePoint(identity, { x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
  const projected = HDRGeometryMath.projectivePoint([2, 0, 1, 0, 3, -1, 0, 0, 1], { x: 2, y: 2 });
  assert.deepEqual(projected, { x: 5, y: 5 });
  const infinite = HDRGeometryMath.projectivePoint([1, 0, 0, 0, 1, 0, 1, 0, -1], { x: 1, y: 2 });
  assert.equal(Number.isNaN(infinite.x), true);
  assert.equal(Number.isNaN(infinite.y), true);
});

test("frame dimensions apply rotation, safe straighten, crop, and authoritative maps", () => {
  const source = { width: 6000, height: 4000 };
  const rotated = HDRGeometryMath.sourcePixelFrameDimensions(source, {
    rotation: 90,
    crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
  });
  assert.deepEqual(rotated, { width: 2000, height: 6000 });
  const straightened = HDRGeometryMath.sourcePixelFrameDimensions(source, {
    rotation: 0,
    straighten_angle: 10,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  });
  assert.ok(straightened.width < source.width);
  assert.ok(straightened.height < source.height);
  assert.deepEqual(
    HDRGeometryMath.sourcePixelFrameDimensions(source, {}, { fullOutputWidth: 1234, fullOutputHeight: 789 }),
    { width: 1234, height: 789 },
  );
});

test("crop aspect ratios use explicit geometry and source", () => {
  const source = { width: 6000, height: 4000 };
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "free" }, source), null);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "original", rotation: 0 }, source), 1.5);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "original", rotation: 90 }, source), 2 / 3);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "custom", custom_ratio: { width: 5, height: 4 } }, source), 1.25);
  assert.equal(HDRGeometryMath.cropAspectRatio({ ratio_mode: "16:9" }, source), 16 / 9);
});

test("mask projection preserves absent path handles and recursively maps leaves", () => {
  const matrix = [2, 0, 0.1, 0, 2, 0.2, 0, 0, 1];
  const expression = {
    operator: "add",
    children: [
      { operator: "leaf", leaf: { type: "linear_gradient", start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } },
      {
        operator: "leaf",
        leaf: {
          type: "path",
          nodes: [{ x: 0.25, y: 0.5, in_x: null, in_y: null, out_x: 0.5, out_y: 0.75 }],
          feather_nodes: [],
        },
      },
    ],
  };
  const projected = HDRGeometryMath.projectMaskExpressionToOutput(expression, matrix);
  assert.deepEqual(projected.children[0].leaf.start, { x: 0.1, y: 0.2 });
  assert.deepEqual(projected.children[0].leaf.end, { x: 2.1, y: 2.2 });
  assert.equal(projected.children[1].leaf.nodes[0].in_x, null);
  assert.equal(projected.children[1].leaf.nodes[0].in_y, null);
  assert.equal(projected.children[1].leaf.nodes[0].out_x, 1.1);
  assert.equal(projected.children[1].leaf.nodes[0].out_y, 1.7);
  assert.equal(HDRGeometryMath.projectiveMatrixIsAffine(matrix), true);
  assert.equal(HDRGeometryMath.projectiveMatrixIsAffine([1, 0, 0, 0, 1, 0, 0.1, 0, 1]), false);
});

test("the frame size at a processing edge is exact or unknown, never a scaled guess", () => {
  const source = { width: 5320, height: 7968 };
  assert.deepEqual(HDRGeometryMath.frameSizeAtEdge(source, {}, 5634), { width: 3762, height: 5634 });
  assert.deepEqual(HDRGeometryMath.frameSizeAtEdge(source, {}, 16384), source);
  const perspective = { perspective_horizontal: -30, perspective_vertical: -20 };
  // Scaling the full-resolution output (4900 x 7421) gives 3464; the backend's frame is 3465 wide.
  assert.equal(HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634), null);
  assert.equal(HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634, { fullOutputWidth: 4900, fullOutputHeight: 7421 }), null);
  assert.deepEqual(
    HDRGeometryMath.frameSizeAtEdge(source, perspective, 5634, { outputWidth: 3465, outputHeight: 5247 }),
    { width: 3465, height: 5247 },
  );
  assert.equal(HDRGeometryMath.frameSizeAtEdge(null, {}, 5634), null);
});

test("an old crop map cannot size a redeveloped RAW with new dimensions", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const geometry = { crop: { x: 0, y: 0, width: 0.5, height: 1 } };
  const state = {
    session: { session_id: "same", source: { width: 6000, height: 4000 } },
    adjustments: { shared: { geometry } },
  };
  let serveSecondMap;
  const secondResponse = new Promise(resolve => { serveSecondMap = resolve; });
  let requests = 0;
  const context = vm.createContext({
    state, geometryMath: HDRGeometryMath, console,
    window: require("../frontend/source-transport.js"),
    geometryCoordinateMapCache: new Map(), geometryFullOutputFrames: new Map(), geometryCoordinateMapRequests: new Map(),
    queueLocalMaskOverlayRender() {}, applyZoomGeometry() {},
    fetch: async () => ++requests === 1
      ? { ok: true, json: async () => ({ full_output_width: 3000, full_output_height: 4000 }) }
      : secondResponse,
  });
  vm.runInContext(fs.readFileSync(require.resolve("../frontend/geometry-tools.js"), "utf8"), context);
  await context.ensureGeometryCoordinateMap(1280);
  assert.equal(context.sourcePixelFrameDimensions().width, 3000);

  const stale = context.ensureGeometryCoordinateMap(1920);
  state.session.source = { width: 2400, height: 1600 };
  assert.deepEqual(context.sourcePixelFrameDimensions(), { width: 1200, height: 1600 });
  serveSecondMap({ ok: true, json: async () => ({ full_output_width: 3000, full_output_height: 4000 }) });
  assert.equal(await stale, null);
  assert.deepEqual(context.sourcePixelFrameDimensions(), { width: 1200, height: 1600 });
});

test("a newer geometry-map request does not join a stale edit or keep session backoff", async () => {
  const vm = require("node:vm");
  const { frontendSource } = require("./frontend-source.js");
  const state = { session: { session_id: "same", source: { width: 6000, height: 4000 } }, editRevision: 7,
    adjustments: { shared: { geometry: { straighten_angle: 1.3 } } } };
  const oldRequest = Promise.withResolvers();
  const requests = [];
  let capacityAvailable = true;
  const context = vm.createContext({
    state, geometryMath: HDRGeometryMath, performance, console, window: {},
    geometryCoordinateMapCache: new Map(), geometryFullOutputFrames: new Map(), geometryCoordinateMapRequests: new Map(),
    queueLocalMaskOverlayRender() {}, applyZoomGeometry() {},
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      if (request.edit_revision === 7) return oldRequest.promise;
      if (!capacityAvailable) return { ok: false, status: 507, json: async () => ({ detail: "Capacity" }) };
      return { ok: true, json: async () => ({ output_width: request.long_edge - 3, output_height: 900 }) };
    },
  });
  vm.runInContext(frontendSource("source-transport.js") + "\n" + frontendSource("geometry-tools.js"), context);
  const old = context.ensureGeometryCoordinateMap(1920, { reportFailure: true });
  state.editRevision = 8;
  const newest = context.ensureGeometryCoordinateMap(1920, { reportFailure: true });
  oldRequest.resolve({ ok: false, status: 409, json: async () => ({ detail: "Stale" }) });
  await assert.rejects(old, { status: 409 });
  assert.equal((await newest).outputWidth, 1917);
  assert.deepEqual(requests.map(request => request.edit_revision), [7, 8]);

  capacityAvailable = false;
  await assert.rejects(context.ensureGeometryCoordinateMap(2560, { reportFailure: true }), { status: 507 });
  capacityAvailable = true;
  context.clearGeometryMapCapacityRefusals();
  assert.equal((await context.ensureGeometryCoordinateMap(2560, { reportFailure: true })).outputWidth, 2557);
});

test("capacity recovery retries only the current picture after the backoff expires", async () => {
  const vm = require("node:vm");
  const { declarations } = require("./frontend-source.js");
  const timers = new Map();
  const state = { session: { session_id: "photo" }, currentView: "hdr", previewGeneration: { hdr: 3 },
    editRevision: 5, zoomMode: "custom", zoomPercent: 100, previewUnavailableReason: "Capacity" };
  const renders = [];
  let nextTimer = 0, scopeRefreshes = 0;
  const context = vm.createContext({ state, performance: { now: () => 3000 },
    window: {
      setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      clearTimeout: id => timers.delete(id),
    },
    geometryDraftActive: () => false,
    nativeGeometryViewportActive: () => false,
    renderGpuDraft: async (...args) => { renders.push(args); return true; },
    debounceOverlayAndScopes: () => { scopeRefreshes += 1; },
  });
  vm.runInContext("let previewCapacityRecovery = null;\n" +
    declarations("clearPreviewCapacityRecovery", "schedulePreviewCapacityRecovery"), context);
  const schedule = () => context.schedulePreviewCapacityRecovery({ retryAfter: 7000 }, "hdr", "photo", 3, "settled", 7968);
  schedule();
  schedule();
  assert.equal(timers.size, 1);
  assert.equal(timers.get(1).delay, 4000);
  state.editRevision += 1;
  await timers.get(1).callback();
  assert.equal(renders.length, 0);
  timers.delete(1);
  schedule();
  await timers.get(2).callback();
  assert.equal(renders.length, 1);
  assert.equal(renders[0][1].reason, "source-capacity-recovery");
  assert.equal(renders[0][1].longEdge, 7968);
  assert.equal(scopeRefreshes, 1);
});
