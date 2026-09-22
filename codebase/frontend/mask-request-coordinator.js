(function () {
  const DEFAULT_MAX_CONCURRENT = 6;
  const DEFAULT_MAX_BATCH_TILES = 64;
  // One response is buffered whole before parsing. A 32 MiB ceiling keeps a
  // single foreground batch from parking a large ArrayBuffer; the backend's
  // own 128 MiB ceiling is a refusal bound, not a target.
  const DEFAULT_MAX_BATCH_BYTES = 32 * 1024 * 1024;
  const BATCH_MAGIC = "HDRMTB1\n";
  const BATCH_HEADER_BYTES = 16;

  class HDRMaskRequestCoordinator {
    constructor(maxConcurrent = DEFAULT_MAX_CONCURRENT) {
      this.maxConcurrent = Math.max(1, Math.floor(Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT));
      this.serial = 0;
      this.controller = null;
      this.generation = null;
      this.active = 0;
      this.maxObserved = 0;
      this.started = 0;
      this.cancelled = 0;
    }

    cancel() {
      this.serial += 1;
      if (this.controller) this.controller.abort();
      this.controller = null;
      this.generation = null;
    }

    async run(generation, tasks, worker, isCurrent = () => true) {
      this.cancel();
      const serial = this.serial;
      const controller = new AbortController();
      this.controller = controller;
      this.generation = generation;
      const queue = Array.from(tasks || []);
      const results = new Array(queue.length).fill(null);
      let cursor = 0;

      const next = async () => {
        while (cursor < queue.length) {
          if (serial !== this.serial || controller.signal.aborted || !isCurrent()) return;
          const index = cursor;
          cursor += 1;
          // Recheck after claiming the slot. A generation can be superseded
          // between turns without allowing its queued request to reach fetch.
          if (serial !== this.serial || controller.signal.aborted || !isCurrent()) return;
          this.active += 1;
          this.started += 1;
          this.maxObserved = Math.max(this.maxObserved, this.active);
          try {
            results[index] = await worker(queue[index], index, controller.signal);
          } catch (error) {
            if (error?.name !== "AbortError") throw error;
            this.cancelled += 1;
          } finally {
            this.active -= 1;
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(this.maxConcurrent, queue.length) },
        () => next(),
      );
      await Promise.all(workers);
      const current = serial === this.serial && !controller.signal.aborted && isCurrent();
      if (current && this.controller === controller) this.controller = null;
      return { results, current };
    }

    snapshot() {
      return {
        generation: this.generation,
        maxConcurrent: this.maxConcurrent,
        active: this.active,
        maxObserved: this.maxObserved,
        started: this.started,
        cancelled: this.cancelled,
      };
    }
  }

  HDRMaskRequestCoordinator.DEFAULT_MAX_CONCURRENT = DEFAULT_MAX_CONCURRENT;

  /**
   * Batching for local-mask tile transport.
   *
   * One batch is one HTTP request and one coordinator slot, so the request
   * count for a tiled generation is `tiles x locals` divided by the batch
   * caps instead of the tile count itself. Tiles stay grouped by local so a
   * batch carries one mask identity and the backend compiles it once.
   */
  class HDRMaskTileBatch {
    static tileBytes(tile) {
      const rect = tile?.rect || {};
      const halo = Math.max(0, Number(tile?.halo) || 0);
      const width = Math.max(0, Number(rect.width) || 0) + halo * 2;
      const height = Math.max(0, Number(rect.height) || 0) + halo * 2;
      return width * height;
    }

    static plan(options = {}) {
      const locals = Array.from(options.locals || []);
      const tiles = Array.from(options.tiles || []);
      const maxTiles = Math.max(1, Math.floor(Number(options.maxTiles) || DEFAULT_MAX_BATCH_TILES));
      const maxBytes = Math.max(1, Math.floor(Number(options.maxBytes) || DEFAULT_MAX_BATCH_BYTES));
      const batches = [];
      for (const [localIndex, local] of locals.entries()) {
        let current = null;
        for (const tile of tiles) {
          const bytes = HDRMaskTileBatch.tileBytes(tile);
          if (!current || current.tiles.length >= maxTiles || current.bytes + bytes > maxBytes) {
            current = { local, localIndex, tiles: [], bytes: 0 };
            batches.push(current);
          }
          current.tiles.push(tile);
          current.bytes += bytes;
        }
      }
      return batches;
    }

    /** Parse the backend's length-prefixed container into manifest entries. */
    static parse(buffer) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      if (bytes.byteLength < BATCH_HEADER_BYTES) {
        throw new Error("Mask tile batch is truncated before its header.");
      }
      for (let index = 0; index < BATCH_MAGIC.length; index += 1) {
        if (bytes[index] !== BATCH_MAGIC.charCodeAt(index)) {
          throw new Error("Mask tile batch magic is not recognized.");
        }
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const entryCount = view.getUint32(8, true);
      const manifestLength = view.getUint32(12, true);
      const manifestEnd = BATCH_HEADER_BYTES + manifestLength;
      if (manifestEnd > bytes.byteLength) {
        throw new Error("Mask tile batch manifest is truncated.");
      }
      const manifest = JSON.parse(
        new TextDecoder().decode(bytes.subarray(BATCH_HEADER_BYTES, manifestEnd)),
      );
      const entries = [];
      let cursor = manifestEnd;
      for (let index = 0; index < entryCount; index += 1) {
        if (cursor + 4 > bytes.byteLength) {
          throw new Error("Mask tile batch payload is truncated.");
        }
        const length = view.getUint32(cursor, true);
        cursor += 4;
        if (cursor + length > bytes.byteLength) {
          throw new Error("Mask tile batch payload is truncated.");
        }
        entries.push({
          ...((manifest.entries || [])[index] || {}),
          payload: bytes.subarray(cursor, cursor + length),
        });
        cursor += length;
      }
      return { manifest, entries };
    }
  }

  HDRMaskTileBatch.DEFAULT_MAX_BATCH_TILES = DEFAULT_MAX_BATCH_TILES;
  HDRMaskTileBatch.DEFAULT_MAX_BATCH_BYTES = DEFAULT_MAX_BATCH_BYTES;

  if (typeof window !== "undefined") {
    window.HDRMaskRequestCoordinator = HDRMaskRequestCoordinator;
    window.HDRMaskTileBatch = HDRMaskTileBatch;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { HDRMaskRequestCoordinator, HDRMaskTileBatch };
  }
})();
