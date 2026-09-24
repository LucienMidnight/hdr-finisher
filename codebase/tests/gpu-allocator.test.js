// Phase 5 item 1: the central allocator's own contract. The renderer-level
// wiring is asserted in webgpu-allocation-agreement.test.js; this suite pins
// the global LRU order, budget enforcement, pinning and reservations.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadAllocator() {
  const source = fs.readFileSync(path.join(__dirname, "../frontend/gpu-allocator.js"), "utf8");
  const context = vm.createContext({ window: {}, console, performance: { now: () => 1 } });
  vm.runInContext(source, context);
  return context.window.HDRGpuAllocator;
}

function makeAllocator(budgetBytes, options = {}) {
  let clock = 0;
  const Allocator = loadAllocator();
  return new Allocator({ budgetBytes, now: () => (clock += 1), ...options });
}

test("the least recently used registered entry is evicted first", () => {
  const allocator = makeAllocator(100);
  const evicted = [];
  const a = allocator.register({ kind: "proxy", key: "a", bytes: 40, evict: () => evicted.push("a") });
  const b = allocator.register({ kind: "proxy", key: "b", bytes: 40, evict: () => evicted.push("b") });
  allocator.touch(a);
  const result = allocator.enforceBudget({ incomingBytes: 40 });
  assert.equal(evicted.length, 1);
  assert.equal(evicted[0], "b");
  assert.equal(result.evictions, 1);
  assert.equal(result.freedBytes, 40);
  assert.equal(allocator.usedBytes(), 40);
  assert.ok(allocator.entries.has(a.id));
  assert.equal(allocator.entries.has(b.id), false);
});

test("eviction calls the entry's release callback exactly once", () => {
  const allocator = makeAllocator(10);
  let released = 0;
  allocator.register({ kind: "tile", key: "t", bytes: 64, evict: () => { released += 1; } });
  allocator.enforceBudget();
  allocator.enforceBudget();
  assert.equal(released, 1);
  assert.equal(allocator.evictions, 1);
  assert.equal(allocator.evictedBytes, 64);
});

test("an entry with no release callback is evicted from the registry, not leaked", () => {
  const allocator = makeAllocator(10);
  const entry = allocator.register({ kind: "tile", key: "t", bytes: 64 });
  assert.equal(entry.evict, null);
  allocator.enforceBudget();
  assert.equal(allocator.usedBytes(), 0);
  assert.equal(allocator.snapshot().entries, 0);
});

test("pinned entries and reservations survive budget pressure", () => {
  const allocator = makeAllocator(100);
  const released = [];
  const pinned = allocator.register({ kind: "grading", bytes: 80, pinned: true });
  allocator.register({ kind: "proxy", bytes: 40, evict: () => released.push("proxy") });
  const reservation = allocator.reserve({ kind: "tiled-pass", bytes: 30 });
  // Reserving enforces immediately, and the unpinned proxy is the victim.
  assert.equal(released.length, 1);
  assert.equal(released[0], "proxy");
  assert.ok(allocator.entries.has(pinned.id));
  assert.equal(allocator.usedBytes(), 110);
  assert.equal(allocator.snapshot().reservedBytes, 30);
  assert.equal(allocator.snapshot().overBudgetBytes, 10);

  allocator.unpin(pinned);
  allocator.enforceBudget();
  assert.equal(allocator.usedBytes(), 30);
  assert.equal(allocator.releaseReservation(reservation), true);
  assert.equal(allocator.releaseReservation(reservation), false);
  assert.equal(allocator.usedBytes(), 0);
});

test("a reservation's release callback runs once, and only on release", () => {
  const allocator = makeAllocator(100);
  let released = 0;
  const reservation = allocator.reserve({ kind: "pass", bytes: 10, release: () => { released += 1; } });
  assert.equal(released, 0);
  allocator.releaseReservation(reservation);
  allocator.releaseReservation(reservation);
  assert.equal(released, 1);
});

test("registering an entry larger than the budget reports the overage instead of evicting it", () => {
  const allocator = makeAllocator(100);
  const big = allocator.register({ kind: "proxy", bytes: 250, evict: () => assert.fail("never evict the entry just registered") });
  assert.ok(allocator.entries.has(big.id));
  assert.equal(allocator.snapshot().overBudgetBytes, 150);
  assert.equal(allocator.snapshot().evictions, 0);
});

test("unregistering is the cache's way to own removal, and never calls evict", () => {
  const allocator = makeAllocator(100);
  let evicted = 0;
  const entry = allocator.register({ kind: "tile", bytes: 40, evict: () => { evicted += 1; } });
  assert.equal(allocator.unregister(entry), true);
  assert.equal(allocator.unregister(entry), false);
  allocator.enforceBudget();
  assert.equal(evicted, 0);
  assert.equal(allocator.evictions, 0);
});

test("the snapshot groups bytes by kind and reports reservations separately", () => {
  const allocator = makeAllocator(1000);
  allocator.register({ kind: "source-proxy", bytes: 100 });
  allocator.register({ kind: "source-proxy", bytes: 200 });
  const pinned = allocator.register({ kind: "detail-band-tile", bytes: 50, pinned: true });
  allocator.reserve({ kind: "tiled-pass", bytes: 25 });

  const snapshot = allocator.snapshot();
  assert.equal(snapshot.registeredBytes, 350);
  assert.equal(snapshot.reservedBytes, 25);
  assert.equal(snapshot.usedBytes, 375);
  assert.equal(snapshot.entries, 3);
  const proxyBucket = snapshot.byKind["source-proxy"];
  assert.equal(proxyBucket.entries, 2);
  assert.equal(proxyBucket.bytes, 300);
  assert.equal(proxyBucket.pinned, 0);
  const detailBucket = snapshot.byKind["detail-band-tile"];
  assert.equal(detailBucket.entries, 1);
  assert.equal(detailBucket.bytes, 50);
  assert.equal(detailBucket.pinned, 1);
  assert.equal(snapshot.reservations.length, 1);
  assert.equal(snapshot.reservations[0].kind, "tiled-pass");
  assert.equal(snapshot.reservations[0].bytes, 25);
  assert.equal(allocator.unpin(pinned), pinned);
  assert.equal(snapshot.byKind["detail-band-tile"].pinned, 1);
});
