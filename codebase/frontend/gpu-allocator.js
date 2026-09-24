/**
 * Phase 5 item 1: one allocator for every GPU cache entry and every mandatory
 * working set.
 *
 * The renderer used to bound each cache on its own: a fixed count of source
 * proxy levels per lane, an 80/20 byte share for the two tile caches. Those
 * budgets could not see each other, so pressure in one cache evicted entries
 * the other still needed, and a pass could have the tiles it was reading
 * evicted underneath it. This registry gives the caches one LRU order and one
 * budget, lets a pass pin what it is using, and keeps the accounting exact
 * enough for the peak-agreement gate: every registered entry reports the bytes
 * the device was asked to create, and eviction always goes through the entry's
 * own release callback so the cache map and the registry cannot disagree.
 */

class HDRGpuAllocator {
  constructor({ budgetBytes = 0, onEvict = null, now = null } = {}) {
    this.budgetBytes = Math.max(0, Number(budgetBytes) || 0);
    this.onEvict = typeof onEvict === "function" ? onEvict : null;
    this.now = typeof now === "function" ? now : (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    // Insertion order is LRU order: a touch moves the entry to the end.
    this.entries = new Map();
    this.reservations = new Map();
    this.nextId = 1;
    this.evictions = 0;
    this.evictedBytes = 0;
    this.overBudgetBytes = 0;
    this.lastEviction = null;
  }

  setBudget(bytes) {
    this.budgetBytes = Math.max(0, Number(bytes) || 0);
    return this.enforceBudget();
  }

  /** Register a live device resource. `evict` must release it, not just forget it. */
  register({ kind, key = null, bytes = 0, evict = null, pinned = false }) {
    const entry = {
      id: this.nextId,
      kind,
      key,
      bytes: Math.max(0, Number(bytes) || 0),
      evict: typeof evict === "function" ? evict : null,
      pins: pinned ? 1 : 0,
      at: this.now(),
    };
    this.nextId += 1;
    this.entries.set(entry.id, entry);
    this.enforceBudget({ protect: entry.id });
    return entry;
  }

  unregister(entry) {
    if (!entry) return false;
    return this.entries.delete(entry.id);
  }

  touch(entry) {
    if (!entry || !this.entries.has(entry.id)) return entry;
    this.entries.delete(entry.id);
    entry.at = this.now();
    this.entries.set(entry.id, entry);
    return entry;
  }

  pin(entry) {
    if (entry) entry.pins += 1;
    return entry;
  }

  unpin(entry) {
    if (entry) entry.pins = Math.max(0, entry.pins - 1);
    return entry;
  }

  /**
   * Reserve bytes for a working set that is about to be held, so eviction can
   * see it before the textures exist. Releases are idempotent.
   */
  reserve({ kind, bytes = 0, release = null }) {
    const reservation = {
      id: this.nextId,
      kind,
      bytes: Math.max(0, Number(bytes) || 0),
      release: typeof release === "function" ? release : null,
      released: false,
    };
    this.nextId += 1;
    this.reservations.set(reservation.id, reservation);
    this.enforceBudget();
    return reservation;
  }

  releaseReservation(reservation) {
    if (!reservation || reservation.released) return false;
    reservation.released = true;
    this.reservations.delete(reservation.id);
    if (reservation.release) reservation.release();
    return true;
  }

  usedBytes() {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.bytes;
    for (const reservation of this.reservations.values()) bytes += reservation.bytes;
    return bytes;
  }

  /**
   * Evict least-recently-used unpinned entries until `incomingBytes` fits.
   * Entries registered by this call (`protect`) are never the victims of it.
   */
  enforceBudget({ incomingBytes = 0, protect = null } = {}) {
    const incoming = Math.max(0, Number(incomingBytes) || 0);
    let freedBytes = 0;
    let evictions = 0;
    for (const entry of [...this.entries.values()]) {
      if (this.usedBytes() + incoming <= this.budgetBytes) break;
      if (entry.pins > 0 || entry.id === protect) continue;
      this.entries.delete(entry.id);
      try {
        if (entry.evict) entry.evict(entry);
      } catch (error) {
        if (typeof console !== "undefined" && console.warn) console.warn("gpu-allocator evict failed", error);
      }
      this.evictions += 1;
      freedBytes += entry.bytes;
      evictions += 1;
      this.lastEviction = { kind: entry.kind, key: entry.key, bytes: entry.bytes, at: this.now() };
    }
    this.evictedBytes += freedBytes;
    // What remains unfunded after evicting everything evictable. A caller that
    // reported an incoming allocation learns here that it will exceed budget.
    this.overBudgetBytes = Math.max(0, this.usedBytes() + incoming - this.budgetBytes);
    return { freedBytes, evictions, overBytes: this.overBudgetBytes };
  }

  snapshot() {
    const byKind = {};
    for (const entry of this.entries.values()) {
      const bucket = byKind[entry.kind] || (byKind[entry.kind] = { entries: 0, bytes: 0, pinned: 0 });
      bucket.entries += 1;
      bucket.bytes += entry.bytes;
      if (entry.pins > 0) bucket.pinned += 1;
    }
    let reservedBytes = 0;
    const reservations = [];
    for (const reservation of this.reservations.values()) {
      reservedBytes += reservation.bytes;
      reservations.push({ kind: reservation.kind, bytes: reservation.bytes });
    }
    const registeredBytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    return {
      budgetBytes: this.budgetBytes,
      registeredBytes,
      reservedBytes,
      usedBytes: registeredBytes + reservedBytes,
      entries: this.entries.size,
      byKind,
      reservations,
      evictions: this.evictions,
      evictedBytes: this.evictedBytes,
      overBudgetBytes: this.overBudgetBytes,
      lastEviction: this.lastEviction ? { ...this.lastEviction } : null,
    };
  }
}

if (typeof window !== "undefined") {
  window.HDRGpuAllocator = HDRGpuAllocator;
}
