const assert = require("node:assert/strict");
const test = require("node:test");

const { HDRTileScheduler } = require("../frontend/tile-scheduler.js");
const { HDRViewportRequest } = require("../frontend/viewport-request.js");

// The foreground selection the encoder performs: the visible rect padded by
// 15% and clamped to the output, then the plan's tiles that intersect it.
function planForegroundTiles(output, viewport, tileSize, halo) {
  const scheduler = new HDRTileScheduler({ tileSize });
  const plan = scheduler.plan({
    width: output.width,
    height: output.height,
    identity: "test",
    generation: 1,
    tileSize,
    halo,
    nodes: [],
    viewport,
  });
  const padX = Math.round(viewport.width * 0.15);
  const padY = Math.round(viewport.height * 0.15);
  const foregroundRegion = {
    x: Math.max(0, viewport.x - padX),
    y: Math.max(0, viewport.y - padY),
    width: Math.min(output.width - Math.max(0, viewport.x - padX), viewport.width + padX * 2),
    height: Math.min(output.height - Math.max(0, viewport.y - padY), viewport.height + padY * 2),
  };
  return HDRViewportRequest.foregroundTiles(plan.tiles, foregroundRegion);
}

function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

test("a magnified fetch region covers every foreground tile's halo rect", () => {
  const output = { width: 7968, height: 5320 };
  const viewports = [
    { x: 0, y: 0, width: 900, height: 500 },
    { x: 1024, y: 768, width: 1400, height: 900 },
    { x: 3400, y: 2100, width: 1600, height: 1200 },
    { x: output.width - 700, y: output.height - 420, width: 700, height: 420 },
    { x: 0, y: output.height - 300, width: 500, height: 300 },
  ];
  for (const viewport of viewports) {
    for (const tileSize of [256, 512]) {
      for (const halo of [0, 64, 136, 384]) {
        const region = HDRViewportRequest.sourceFetchRegion(
          viewport, output.width, output.height, tileSize, halo,
        );
        assert.ok(region.width > 0 && region.height > 0, "the region must have area");
        assert.ok(containsRect({ x: 0, y: 0, ...output }, region), "the region stays inside the frame");
        for (const tile of planForegroundTiles(output, viewport, tileSize, halo)) {
          assert.ok(
            containsRect(region, tile.haloRect),
            `halo rect ${JSON.stringify(tile.haloRect)} is outside region ${JSON.stringify(region)}`
              + ` (viewport ${JSON.stringify(viewport)}, tile ${tileSize}, halo ${halo})`,
          );
        }
      }
    }
  }
});

test("a magnified fetch region is a fraction of the frame and covers the viewport halo", () => {
  const output = { width: 7968, height: 5320 };
  const viewport = { x: 2000, y: 1200, width: 1000, height: 600 };
  const region = HDRViewportRequest.sourceFetchRegion(viewport, output.width, output.height, 512, 136);

  assert.ok(region.width * region.height < output.width * output.height * 0.25);
  assert.ok(containsRect(region, {
    x: viewport.x - 136,
    y: viewport.y - 136,
    width: viewport.width + 272,
    height: viewport.height + 272,
  }));
});

test("a fetch region clamps to the frame instead of leaving it", () => {
  const output = { width: 4000, height: 3000 };
  const region = HDRViewportRequest.sourceFetchRegion(
    { x: 0, y: 0, width: 600, height: 400 }, output.width, output.height, 512, 256,
  );

  assert.equal(region.x, 0);
  assert.equal(region.y, 0);
  assert.ok(region.width <= output.width);
  assert.ok(region.height <= output.height);
  assert.ok(region.x + region.width <= output.width);
  assert.ok(region.y + region.height <= output.height);
});

test("a Fit-sized viewport yields the whole frame, which the caller declines", () => {
  const output = { width: 1024, height: 683 };
  const region = HDRViewportRequest.sourceFetchRegion(
    { x: 0, y: 0, width: output.width, height: output.height }, output.width, output.height, 512, 0,
  );

  assert.deepEqual(region, { x: 0, y: 0, width: output.width, height: output.height });
  // The renderer only takes the region route below this fraction; a region
  // that is the whole frame is answered by the ordinary whole-frame path.
  assert.ok(region.width * region.height >= output.width * output.height * 0.9);
});
