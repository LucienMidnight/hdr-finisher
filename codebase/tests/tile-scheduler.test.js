// Phase 4: tile identity, ordering, residency and generation-safe admission.
//
// The scheduler owns the rules the exit gate is about — "Fit and zoomed views
// never show a mixed generation", bounded residency, and visible-region
// priority — and it holds no GPU resources, so all of it is deterministic.

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { HDRTileScheduler } = require(path.join(__dirname, "../frontend/tile-scheduler.js"));

function scheduler(options = {}) {
  return new HDRTileScheduler({ tileSize: 256, ...options });
}

test("tiles are anchored to global output coordinates, not to an index", () => {
  const sched = scheduler();
  const a = sched.plan({ width: 1024, height: 512, identity: "s1" });
  const b = sched.plan({ width: 2048, height: 1024, identity: "s1" });

  const origin = (plan) => plan.tiles.find((tile) => tile.rect.x === 512 && tile.rect.y === 256);
  // The same output region keeps the same key even though the grid grew, so a
  // pan or a resize does not orphan work that is still valid.
  assert.equal(origin(a).key, origin(b).key);
  assert.match(origin(a).key, /\|512,256,256,256\|/);
});

test("a different identity or halo is a different tile", () => {
  const sched = scheduler();
  const base = sched.plan({ width: 512, height: 512, identity: "s1" }).tiles[0].key;
  const other = sched.plan({ width: 512, height: 512, identity: "s2" }).tiles[0].key;
  const haloed = sched.plan({ width: 512, height: 512, identity: "s1", halo: 8 }).tiles[0].key;

  assert.notEqual(base, other);
  assert.notEqual(base, haloed);
});

test("the grid covers the output exactly once, including partial edge tiles", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 700, height: 390, identity: "s1" });

  const covered = new Map();
  for (const tile of plan.tiles) {
    for (let y = tile.rect.y; y < tile.rect.y + tile.rect.height; y += 1) {
      for (let x = tile.rect.x; x < tile.rect.x + tile.rect.width; x += 1) {
        const key = `${x},${y}`;
        covered.set(key, (covered.get(key) || 0) + 1);
      }
    }
  }
  assert.equal(covered.size, 700 * 390);
  assert.ok([...covered.values()].every((count) => count === 1));

  const last = plan.tiles.find((tile) => tile.rect.x === 512 && tile.rect.y === 256);
  assert.deepEqual({ ...last.rect }, { x: 512, y: 256, width: 188, height: 134 });
});

test("a halo is clamped to the output rather than padded past its edge", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 512, height: 512, identity: "s1", halo: 16 });

  const corner = plan.tiles.find((tile) => tile.rect.x === 0 && tile.rect.y === 0);
  assert.deepEqual({ ...corner.haloRect }, { x: 0, y: 0, width: 272, height: 272 });

  const interiorSched = new HDRTileScheduler({ tileSize: 128 });
  const interiorPlan = interiorSched.plan({ width: 512, height: 512, identity: "s1", halo: 16 });
  const interior = interiorPlan.tiles.find((tile) => tile.rect.x === 128 && tile.rect.y === 128);
  assert.deepEqual({ ...interior.haloRect }, { x: 112, y: 112, width: 160, height: 160 });
});

test("at Fit every tile is visible, so the whole image is the visible set", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 1024, height: 512, identity: "s1" });

  assert.equal(plan.visibleCount, plan.tileCount);
  assert.equal(plan.visibleKeys.length, plan.tileCount);
});

test("at magnified zoom visible tiles come first, nearest the viewport centre", () => {
  const sched = scheduler();
  const plan = sched.plan({
    width: 2048,
    height: 2048,
    identity: "s1",
    viewport: { x: 1024, y: 1024, width: 512, height: 512 },
  });

  assert.ok(plan.visibleCount > 0);
  assert.ok(plan.visibleCount < plan.tileCount);

  // Every visible tile is ordered before every offscreen one.
  const firstOffscreen = plan.tiles.findIndex((tile) => !tile.visible);
  assert.ok(plan.tiles.slice(0, firstOffscreen).every((tile) => tile.visible));
  assert.ok(plan.tiles.slice(firstOffscreen).every((tile) => !tile.visible));

  // The first tile is the one whose centre is nearest the viewport centre.
  // With a viewport centre that lands on a tile boundary, two tiles are
  // equidistant, so the assertion is on the distance rather than on which of
  // the two ties won.
  const first = plan.tiles[0];
  assert.equal(first.visible, true);
  assert.equal(first.distance, Math.min(...plan.tiles.map((tile) => tile.distance)));

  const visible = plan.tiles.filter((tile) => tile.visible);
  for (let index = 1; index < visible.length; index += 1) {
    assert.ok(visible[index].distance >= visible[index - 1].distance);
  }
});

test("halos are declared per node, including the zero ones", () => {
  const halos = HDRTileScheduler.nodeHalos();
  // Pointwise nodes declare zero rather than being absent, so a node cannot
  // acquire a neighbourhood dependency without saying so.
  assert.equal(halos.exposure, 0);
  assert.equal(halos.curves, 0);
  assert.equal(halos.grain, 0);
  assert.equal(halos.geometry, 0);
  // Neighbourhood families carry null, meaning "the node supplies its radius".
  assert.equal(halos.detail, null);
  assert.equal(halos.denoise, null);

  assert.equal(HDRTileScheduler.declaredHalo(["exposure", "curves"]), 0);
  assert.equal(HDRTileScheduler.declaredHalo([{ id: "detail", halo: 12 }, "exposure"]), 12);
  assert.equal(HDRTileScheduler.declaredHalo([{ id: "detail", halo: 3.2 }]), 4);

  assert.throws(() => HDRTileScheduler.declaredHalo(["mystery-node"]), /did not declare a halo/);
  assert.throws(() => HDRTileScheduler.declaredHalo([{ id: "detail" }]), /invalid halo/);
});

test("residency is bounded and evicts least-recently-used first", () => {
  const sched = scheduler({ maxResidentBytes: 300 });

  sched.admit("a", 100);
  sched.admit("b", 100);
  sched.admit("c", 100);
  assert.equal(sched.residentBytes, 300);

  sched.touch("a"); // a is now the most recent, b the least
  const evicted = sched.admit("d", 100);

  assert.deepEqual(evicted, ["b"]);
  assert.equal(sched.has("b"), false);
  assert.equal(sched.has("a"), true);
  assert.equal(sched.residentBytes, 300);
});

test("pinned tiles are never evicted, because submitted work still references them", () => {
  const sched = scheduler({ maxResidentBytes: 200 });
  sched.admit("a", 100);
  sched.admit("b", 100);

  const evicted = sched.admit("c", 100, { pinned: ["a", "b"] });
  assert.deepEqual(evicted, []);
  // The budget is knowingly exceeded rather than destroying in-flight resources.
  assert.equal(sched.residentBytes, 300);
  assert.equal(sched.has("a"), true);
  assert.equal(sched.has("b"), true);
});

test("scratch is bounded separately and does not accumulate", () => {
  const sched = scheduler({ maxScratchBytes: 1000 });

  assert.equal(sched.reserveScratch(600), true);
  assert.equal(sched.scratchBytes, 600);
  assert.equal(sched.reserveScratch(900), true);
  // A reservation replaces the previous one; scratch is transient.
  assert.equal(sched.scratchBytes, 900);
  assert.equal(sched.reserveScratch(1200), false);
  sched.releaseScratch();
  assert.equal(sched.scratchBytes, 0);
});

test("a visible set is presentable only when every tile is at the same generation", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 512, height: 512, identity: "s1", generation: 7 });
  assert.equal(plan.visibleCount, 4);

  for (const key of plan.visibleKeys.slice(0, 3)) sched.acceptTile(key, 7);
  // Three of four: not presentable, so the previous presentation is retained.
  assert.equal(sched.isVisibleSetComplete(plan, 7), false);
  assert.equal(sched.presentableGeneration(plan), null);

  sched.acceptTile(plan.visibleKeys[3], 7);
  assert.equal(sched.isVisibleSetComplete(plan, 7), true);
  assert.equal(sched.presentableGeneration(plan), 7);
});

test("a mixed-generation set is never presentable", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 512, height: 512, identity: "s1" });

  for (const key of plan.visibleKeys) sched.acceptTile(key, 7);
  assert.equal(sched.presentableGeneration(plan), 7);

  // One tile is replaced by newer work while the rest are still generation 7.
  sched.acceptTile(plan.visibleKeys[1], 8);
  assert.equal(sched.presentableGeneration(plan), null);
  assert.equal(sched.isVisibleSetComplete(plan, 7), false);
  assert.equal(sched.isVisibleSetComplete(plan, 8), false);

  for (const key of plan.visibleKeys) sched.acceptTile(key, 8);
  assert.equal(sched.presentableGeneration(plan), 8);
});

test("pending tiles name exactly the work a generation still owes", () => {
  const sched = scheduler();
  const plan = sched.plan({ width: 512, height: 512, identity: "s1" });

  assert.equal(sched.pendingTiles(plan, 3).length, 4);
  sched.acceptTile(plan.visibleKeys[0], 3);
  assert.equal(sched.pendingTiles(plan, 3).length, 3);

  // A tile accepted at an older generation still counts as pending.
  sched.acceptTile(plan.visibleKeys[1], 2);
  assert.equal(sched.pendingTiles(plan, 3).length, 3);
});

test("eviction of a visible tile makes the set unpresentable again", () => {
  const sched = scheduler({ maxResidentBytes: 300 });
  const plan = sched.plan({ width: 512, height: 512, identity: "s1" });

  for (const key of plan.visibleKeys) {
    sched.admit(key, 100);
    sched.acceptTile(key, 5);
  }
  // The budget forced one out, so the visible set is no longer complete and
  // the viewer must keep its previous presentation rather than tear.
  assert.ok(sched.evictions.length > 0);
  assert.equal(sched.presentableGeneration(plan), null);
});

test("invalidating an identity drops only that identity's tiles", () => {
  const sched = scheduler();
  const first = sched.plan({ width: 512, height: 512, identity: "s1" });
  const second = sched.plan({ width: 512, height: 512, identity: "s2" });
  for (const key of first.visibleKeys) { sched.admit(key, 10); sched.acceptTile(key, 1); }
  for (const key of second.visibleKeys) { sched.admit(key, 10); sched.acceptTile(key, 1); }

  const removed = sched.invalidate((key) => key.startsWith("s1|"));
  assert.equal(removed.length, 4);
  assert.equal(sched.presentableGeneration(first), null);
  assert.equal(sched.presentableGeneration(second), 1);
});

test("the plan is deterministic for the same inputs", () => {
  const a = scheduler().plan({ width: 1500, height: 900, identity: "s1", viewport: { x: 100, y: 50, width: 640, height: 480 } });
  const b = scheduler().plan({ width: 1500, height: 900, identity: "s1", viewport: { x: 100, y: 50, width: 640, height: 480 } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("tile counts and bounded residency hold at 24MP, 42MP and 8K", () => {
  const cases = [
    { id: "24MP", width: 6000, height: 4000 },
    { id: "42MP", width: 5320, height: 7968 },
    { id: "8K UHD", width: 7680, height: 4320 },
  ];
  for (const entry of cases) {
    const sched = new HDRTileScheduler({ tileSize: 512, maxResidentBytes: 256 * 1024 * 1024 });
    const plan = sched.plan({ ...entry, identity: entry.id });
    const expected = Math.ceil(entry.width / 512) * Math.ceil(entry.height / 512);
    assert.equal(plan.tileCount, expected, `${entry.id} tile count`);

    // Admit every tile at an RGBA16F tile-sized cost; residency must stay
    // inside the configured bound rather than growing with the image.
    for (const tile of plan.tiles) {
      sched.admit(tile.key, tile.rect.width * tile.rect.height * 8);
    }
    assert.ok(
      sched.residentBytes <= sched.maxResidentBytes,
      `${entry.id} residency ${sched.residentBytes} exceeded ${sched.maxResidentBytes}`,
    );
  }
});
