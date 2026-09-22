const assert = require("node:assert/strict");
const test = require("node:test");

const { HDRViewportRequest } = require("../frontend/viewport-request.js");

test("Fit produces a whole-output request with no padding to amplify", () => {
  const request = HDRViewportRequest.build({
    lane: "hdr",
    sessionId: "session",
    output: { width: 4000, height: 3000 },
    source: { width: 8000, height: 6000 },
    halo: 0,
  });

  assert.equal(request.fit, true);
  assert.deepEqual({ ...request.roi }, { x: 0, y: 0, width: 4000, height: 3000 });
  assert.deepEqual({ ...request.sourceRect }, { x: 0, y: 0, width: 8000, height: 6000 });
  assert.equal(request.telemetry.haloAmplification, 1);
  assert.equal(request.telemetry.outputPixels, 12_000_000);
  assert.ok(Object.isFrozen(request));
  assert.ok(Object.isFrozen(request.roi));
});

test("a magnified viewport is padded by the minimum ROI fraction and clamped", () => {
  const request = HDRViewportRequest.build({
    output: { width: 4000, height: 3000 },
    source: { width: 8000, height: 6000 },
    visible: { x: 1000, y: 800, width: 400, height: 300 },
    minimumRoiFraction: 0.25,
    halo: 0,
  });

  // 25% of 400/300 is 100/75 on each side.
  assert.deepEqual({ ...request.roi }, { x: 900, y: 725, width: 600, height: 450 });
  assert.equal(request.fit, false);
  assert.equal(request.telemetry.roiPixels, 600 * 450);
  assert.equal(request.telemetry.haloAmplification, 1);
});

test("padding clamps to the output instead of leaving it", () => {
  const request = HDRViewportRequest.build({
    output: { width: 1000, height: 1000 },
    visible: { x: 0, y: 0, width: 100, height: 100 },
    minimumRoiFraction: 0.5,
  });
  assert.deepEqual({ ...request.roi }, { x: 0, y: 0, width: 200, height: 200 });
});

test("the halo expands the processed region and is reported as amplification", () => {
  const request = HDRViewportRequest.build({
    output: { width: 1000, height: 1000 },
    visible: { x: 400, y: 400, width: 200, height: 200 },
    minimumRoiFraction: 0,
    halo: 60,
  });
  assert.deepEqual({ ...request.roi }, { x: 400, y: 400, width: 200, height: 200 });
  assert.deepEqual({ ...request.haloRect }, { x: 340, y: 340, width: 320, height: 320 });
  assert.equal(request.telemetry.processedPixels, 320 * 320);
  assert.ok(Math.abs(request.telemetry.haloAmplification - (320 * 320) / (200 * 200)) < 1e-9);
});

test("tiles are anchored to the global grid and clipped to the region", () => {
  const request = HDRViewportRequest.build({
    output: { width: 2000, height: 2000 },
    visible: { x: 900, y: 900, width: 300, height: 300 },
    minimumRoiFraction: 0,
    halo: 0,
    tileSize: 512,
  });

  // The region spans the 1024 boundary in both axes, so it touches four global
  // tiles, each clipped to the region rather than to the whole tile.
  assert.equal(request.tiles.length, 4);
  assert.deepEqual({ ...request.tiles[0] }, { x: 900, y: 900, width: 124, height: 124 });
  assert.deepEqual({ ...request.tiles[1] }, { x: 1024, y: 900, width: 176, height: 124 });
  assert.deepEqual({ ...request.tiles[2] }, { x: 900, y: 1024, width: 124, height: 176 });
  assert.deepEqual({ ...request.tiles[3] }, { x: 1024, y: 1024, width: 176, height: 176 });
  assert.equal(request.telemetry.visibleTiles, 4);
  // Anchoring is to the global grid: the same region keys the same way at any
  // pan or zoom that leaves it alone.
  const again = HDRViewportRequest.build({
    output: { width: 2000, height: 2000 },
    visible: { x: 900, y: 900, width: 300, height: 300 },
    minimumRoiFraction: 0,
    halo: 0,
    tileSize: 512,
  });
  assert.deepEqual(again.tiles.map((tile) => ({ ...tile })), request.tiles.map((tile) => ({ ...tile })));
});

test("the source rect maps the padded ROI back to source pixels", () => {
  const request = HDRViewportRequest.build({
    output: { width: 4000, height: 3000 },
    source: { width: 8000, height: 6000 },
    visible: { x: 1000, y: 1000, width: 500, height: 500 },
    minimumRoiFraction: 0,
    halo: 0,
  });
  // 2x scale, plus the one-pixel guard the mapping adds to stay conservative.
  assert.deepEqual({ ...request.sourceRect }, { x: 2000, y: 2000, width: 1001, height: 1001 });
});

test("a degenerate visible region is rejected instead of silently rendered", () => {
  assert.throws(
    () => HDRViewportRequest.build({
      output: { width: 100, height: 100 },
      visible: { x: 50, y: 50, width: 0, height: 0 },
    }),
    /visible region with area/,
  );
});

test("compareWithLegacy finds the worst pointwise difference over the overlap", () => {
  const legacy = new Float32Array([
    1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
  ]);
  const roi = new Float32Array([1, 1, 1, 1, 2.5, 2, 2, 2]);
  const result = HDRViewportRequest.compareWithLegacy({
    roiPixels: roi,
    roiWidth: 2,
    roiRect: { x: 0, y: 0, width: 2, height: 1 },
    legacyPixels: legacy,
    legacyWidth: 3,
    legacyRect: { x: 0, y: 0, width: 3, height: 2 },
    channels: 4,
    tolerance: 0.4,
  });
  assert.equal(result.comparedPixels, 2);
  assert.equal(result.maxAbsDifference, 0.5);
  assert.equal(result.withinTolerance, false);
  assert.equal(HDRViewportRequest.compareWithLegacy({
    roiPixels: roi,
    roiWidth: 2,
    roiRect: { x: 0, y: 0, width: 2, height: 1 },
    legacyPixels: legacy,
    legacyWidth: 3,
    legacyRect: { x: 0, y: 0, width: 3, height: 2 },
    channels: 4,
    tolerance: 0.5,
  }).withinTolerance, true);
});

test("compareWithLegacy only compares the intersection of the two rects", () => {
  const legacy = new Float32Array(4 * 4 * 4).fill(1);
  const roi = new Float32Array(2 * 2 * 4).fill(1);
  const result = HDRViewportRequest.compareWithLegacy({
    roiPixels: roi,
    roiWidth: 2,
    roiRect: { x: 2, y: 2, width: 2, height: 2 },
    legacyPixels: legacy,
    legacyWidth: 4,
    legacyRect: { x: 0, y: 0, width: 4, height: 4 },
    channels: 4,
    tolerance: 0,
  });
  assert.equal(result.comparedPixels, 4);
  assert.equal(result.withinTolerance, true);
});

test("foreground tiles are the ones intersecting the viewport, in plan order", () => {
  const tiles = [
    { rect: { x: 0, y: 0, width: 512, height: 512 } },
    { rect: { x: 512, y: 0, width: 512, height: 512 } },
    { rect: { x: 0, y: 512, width: 512, height: 512 } },
    { rect: { x: 512, y: 512, width: 512, height: 512 } },
  ];

  // Fit: no viewport means every tile is foreground.
  assert.equal(HDRViewportRequest.foregroundTiles(tiles, null).length, 4);

  const corner = HDRViewportRequest.foregroundTiles(tiles, { x: 0, y: 0, width: 500, height: 500 });
  assert.deepEqual(corner, [tiles[0]]);

  // A viewport crossing the 512 boundary touches the two top tiles only.
  const strip = HDRViewportRequest.foregroundTiles(tiles, { x: 500, y: 0, width: 100, height: 100 });
  assert.deepEqual(strip, [tiles[0], tiles[1]]);

  // A viewport entirely offscreen processes nothing.
  assert.deepEqual(
    HDRViewportRequest.foregroundTiles(tiles, { x: 2000, y: 2000, width: 100, height: 100 }),
    [],
  );

  // Plain rects are accepted as well as plan entries.
  assert.deepEqual(
    HDRViewportRequest.foregroundTiles([tiles[0].rect], { x: 0, y: 0, width: 10, height: 10 }),
    [tiles[0].rect],
  );
});
