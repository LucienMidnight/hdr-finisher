(function () {
  "use strict";

  /**
   * Tile scheduling for exact selected-tier rendering.
   *
   * PRD 5.3: tiled execution processes the selected tier exactly, using global
   * output coordinates, module-declared halos, bounded tile and scratch caches,
   * visible-region priority, generation-safe scheduling, and atomic replacement
   * of all currently visible tiles. No mixed-generation tile set may ever be
   * visible.
   *
   * This module owns identity, ordering, residency and admission. It performs
   * no GPU work and holds no GPU resources, so it is deterministic and can be
   * tested without an adapter.
   */

  const DEFAULT_TILE_SIZE = 512;

  function clampInt(value, low, high) {
    return Math.max(low, Math.min(high, Math.floor(value)));
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height;
  }

  /**
   * Halo requirements are declared per node family, including for nodes that
   * need none. PRD 5.3 asks for the metadata even at zero so a node can never
   * silently acquire a neighbourhood dependency without declaring it.
   */
  const NODE_HALOS = Object.freeze({
    geometry: 0,
    exposure: 0,
    "white-balance": 0,
    curves: 0,
    color: 0,
    grading: 0,
    vignette: 0,
    grain: 0,
    // Neighbourhood modules declare radius-derived halos in later phases; the
    // vocabulary exists now so the scheduler can already carry them.
    detail: null,
    denoise: null,
    halation: null,
    bloom: null,
    softness: null,
    "mask-feather": null,
  });

  function declaredHalo(nodes = []) {
    let halo = 0;
    for (const node of nodes) {
      const declared = Object.prototype.hasOwnProperty.call(NODE_HALOS, node.id ?? node)
        ? NODE_HALOS[node.id ?? node]
        : undefined;
      if (declared === undefined) {
        throw new Error(`Node "${node.id ?? node}" did not declare a halo`);
      }
      const value = declared === null ? Number(node.halo) : declared;
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Node "${node.id ?? node}" declared an invalid halo`);
      }
      halo = Math.max(halo, Math.ceil(value));
    }
    return halo;
  }

  class HDRTileScheduler {
    constructor(options = {}) {
      this.tileSize = Math.max(64, Math.floor(Number(options.tileSize) || DEFAULT_TILE_SIZE));
      this.maxResidentBytes = Math.max(0, Math.floor(Number(options.maxResidentBytes) || 0));
      this.maxScratchBytes = Math.max(0, Math.floor(Number(options.maxScratchBytes) || 0));
      // Insertion-ordered, so the first key is the least recently used.
      this.resident = new Map();
      this.residentBytes = 0;
      this.scratchBytes = 0;
      this.accepted = new Map();
      this.evictions = [];
    }

    /**
     * Tile identity is anchored to global output coordinates, never to a tile
     * index, so the same output region keeps the same identity across pans,
     * zooms and grid changes that leave the region itself alone.
     */
    static tileKey(identity, rect, halo = 0) {
      return `${identity}|${rect.x},${rect.y},${rect.width},${rect.height}|h${halo}`;
    }

    static declaredHalo(nodes) {
      return declaredHalo(nodes);
    }

    static nodeHalos() {
      return { ...NODE_HALOS };
    }

    /**
     * Lay out the tile grid for one output and order it for execution.
     *
     * Visible tiles come first, nearest the viewport centre first, because at
     * Fit every tile is visible and at magnified zoom the viewer is waiting on
     * the middle of the screen. Offscreen tiles keep a stable order after them.
     */
    plan(options = {}) {
      const width = Math.max(1, Math.floor(Number(options.width) || 1));
      const height = Math.max(1, Math.floor(Number(options.height) || 1));
      const identity = String(options.identity ?? "");
      const generation = Number(options.generation ?? 0);
      const halo = Number.isFinite(Number(options.halo))
        ? Math.max(0, Math.floor(Number(options.halo)))
        : declaredHalo(options.nodes || []);
      const tileSize = Math.max(64, Math.floor(Number(options.tileSize) || this.tileSize));
      const viewport = options.viewport
        ? {
          x: clampInt(options.viewport.x ?? 0, 0, width),
          y: clampInt(options.viewport.y ?? 0, 0, height),
          width: clampInt(options.viewport.width ?? width, 1, width),
          height: clampInt(options.viewport.height ?? height, 1, height),
        }
        : { x: 0, y: 0, width, height };

      const centreX = viewport.x + viewport.width / 2;
      const centreY = viewport.y + viewport.height / 2;
      const tiles = [];
      for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
          const rect = {
            x,
            y,
            width: Math.min(tileSize, width - x),
            height: Math.min(tileSize, height - y),
          };
          const haloed = {
            x: Math.max(0, rect.x - halo),
            y: Math.max(0, rect.y - halo),
          };
          haloed.width = Math.min(width, rect.x + rect.width + halo) - haloed.x;
          haloed.height = Math.min(height, rect.y + rect.height + halo) - haloed.y;
          const visible = rectsIntersect(rect, viewport);
          const dx = rect.x + rect.width / 2 - centreX;
          const dy = rect.y + rect.height / 2 - centreY;
          tiles.push({
            key: HDRTileScheduler.tileKey(identity, rect, halo),
            rect,
            // The halo is clamped to the output, never padded past its edge.
            haloRect: haloed,
            halo,
            visible,
            distance: Math.sqrt(dx * dx + dy * dy),
          });
        }
      }

      tiles.sort((a, b) => {
        if (a.visible !== b.visible) return a.visible ? -1 : 1;
        if (a.distance !== b.distance) return a.distance - b.distance;
        if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
        return a.rect.x - b.rect.x;
      });
      tiles.forEach((tile, index) => { tile.priority = index; });

      return {
        identity,
        generation,
        width,
        height,
        tileSize,
        halo,
        viewport,
        tiles,
        visibleKeys: tiles.filter((tile) => tile.visible).map((tile) => tile.key),
        tileCount: tiles.length,
        visibleCount: tiles.filter((tile) => tile.visible).length,
      };
    }

    // ---- residency -------------------------------------------------------

    /**
     * Admit a tile result. Returns the keys evicted to make room, so the caller
     * can destroy exactly those GPU resources and nothing else.
     */
    admit(key, bytes, { pinned = [] } = {}) {
      const size = Math.max(0, Math.floor(Number(bytes) || 0));
      if (this.resident.has(key)) {
        this.residentBytes -= this.resident.get(key).bytes;
        this.resident.delete(key);
      }
      this.resident.set(key, { bytes: size });
      this.residentBytes += size;
      // The tile just admitted is implicitly pinned: evicting it here would
      // discard the work this call exists to record.
      return this.trim([...pinned, key]);
    }

    touch(key) {
      const entry = this.resident.get(key);
      if (!entry) return false;
      this.resident.delete(key);
      this.resident.set(key, entry);
      return true;
    }

    has(key) {
      return this.resident.has(key);
    }

    /**
     * Evict least-recently-used tiles until residency fits the budget. Pinned
     * keys are never evicted: PRD 11.3 requires that cache eviction cannot
     * destroy resources referenced by submitted GPU work.
     */
    trim(pinned = []) {
      const protectedKeys = new Set(pinned);
      const evicted = [];
      if (!this.maxResidentBytes) return evicted;
      for (const key of [...this.resident.keys()]) {
        if (this.residentBytes <= this.maxResidentBytes) break;
        if (protectedKeys.has(key)) continue;
        const entry = this.resident.get(key);
        this.resident.delete(key);
        this.residentBytes -= entry.bytes;
        evicted.push(key);
        this.accepted.delete(key);
      }
      this.evictions.push(...evicted);
      return evicted;
    }

    /** Transient scratch is bounded separately and never accumulates. */
    reserveScratch(bytes) {
      const size = Math.max(0, Math.floor(Number(bytes) || 0));
      if (this.maxScratchBytes && size > this.maxScratchBytes) return false;
      this.scratchBytes = size;
      return true;
    }

    releaseScratch() {
      this.scratchBytes = 0;
    }

    // ---- generation safety -----------------------------------------------

    /**
     * Record a completed tile against the generation that produced it. A tile
     * accepted under an older generation never counts towards a newer one.
     */
    acceptTile(key, generation) {
      this.accepted.set(key, Number(generation));
      this.touch(key);
    }

    acceptedGeneration(key) {
      return this.accepted.has(key) ? this.accepted.get(key) : null;
    }

    /**
     * True only when every visible tile of this plan is accepted at exactly
     * this generation. This is the atomic-replacement condition: a partially
     * complete set is never presentable.
     */
    isVisibleSetComplete(plan, generation) {
      if (!plan?.visibleKeys?.length) return false;
      return plan.visibleKeys.every((key) => this.accepted.get(key) === Number(generation));
    }

    /**
     * The generation that may be presented, or null.
     *
     * A set that mixes generations is never presentable, so the caller keeps
     * the previous accepted presentation instead of showing a torn frame.
     */
    presentableGeneration(plan) {
      if (!plan?.visibleKeys?.length) return null;
      let generation = null;
      for (const key of plan.visibleKeys) {
        if (!this.accepted.has(key)) return null;
        const value = this.accepted.get(key);
        if (generation === null) generation = value;
        else if (generation !== value) return null;
      }
      return generation;
    }

    /** Tiles of this plan that still have to run for the target generation. */
    pendingTiles(plan, generation) {
      return plan.tiles.filter((tile) => this.accepted.get(tile.key) !== Number(generation));
    }

    /** Drop everything recorded for a superseded identity. */
    invalidate(predicate) {
      const removed = [];
      for (const key of [...this.resident.keys()]) {
        if (!predicate(key)) continue;
        this.residentBytes -= this.resident.get(key).bytes;
        this.resident.delete(key);
        this.accepted.delete(key);
        removed.push(key);
      }
      return removed;
    }

    snapshot() {
      return {
        tileSize: this.tileSize,
        residentTiles: this.resident.size,
        residentBytes: this.residentBytes,
        maxResidentBytes: this.maxResidentBytes,
        scratchBytes: this.scratchBytes,
        maxScratchBytes: this.maxScratchBytes,
        acceptedTiles: this.accepted.size,
        evictions: this.evictions.length,
      };
    }
  }

  HDRTileScheduler.DEFAULT_TILE_SIZE = DEFAULT_TILE_SIZE;

  if (typeof window !== "undefined") window.HDRTileScheduler = HDRTileScheduler;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRTileScheduler };
})();
