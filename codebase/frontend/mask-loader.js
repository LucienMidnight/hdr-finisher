(function () {
  "use strict";

  /**
   * Fetch and upload one CPU-rendered spatial mask leaf.
   *
   * The renderer remains responsible for deciding whether a leaf belongs on
   * this path and for producing its stable spatial identity. This module owns
   * the request, response-body, upload, cache, and in-flight lifetime.
   */
  async function loadCpuMaskLeaf(renderer, {
    sessionId,
    local,
    maskPath,
    longEdge,
    editRevision,
    geometrySignature,
    maskSignature,
    isCurrent = () => true,
    signal = undefined,
    draftExpression = null,
    remember = true,
  }) {
    const key = `${sessionId}:${longEdge}:${geometrySignature}:cpu-spatial-leaf:${maskSignature}`;
    const cached = renderer.localMasks.get(key);
    if (cached) {
      renderer.localMasks.delete(key);
      renderer.localMasks.set(key, cached);
      cached.lastUseSerial = renderer.maskUseSerial;
      return cached;
    }
    const inflight = renderer.localMaskInflight.get(key);
    if (inflight && !inflight.signal?.aborted) return inflight.promise;
    const pending = (async () => {
      const pathQuery = maskPath ? `&mask_path=${encodeURIComponent(maskPath)}` : "";
      const startedAt = performance.now();
      // A leaf the backend has not committed yet is rasterized from the
      // request itself; the committed endpoint would answer with the older
      // mask while this key names the newer one.
      const response = draftExpression
        ? await fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mask: draftExpression,
            edit_revision: editRevision,
            long_edge: longEdge,
            geometry_signature: geometrySignature,
          }),
          signal,
        })
        : await fetch(
          `/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}&spatial_only=true${pathQuery}`,
          { signal },
        );
      // A refused or stale mask still owns its body: a native-edge mask is tens
      // of MB, and leaving it unread holds an HTTP/1.1 connection (§15.56).
      if (!response.ok || response.headers.get("X-Geometry-Signature") !== geometrySignature) {
        await response.body?.cancel?.().catch(() => null);
        return null;
      }
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const source = new Uint8Array(await response.arrayBuffer());
      if (signal?.aborted || !isCurrent()) return null;
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? source : new Uint8Array(bytesPerRow * height);
      if (padded !== source) {
        for (let row = 0; row < height; row += 1) {
          padded.set(source.subarray(row * width, (row + 1) * width), row * bytesPerRow);
        }
      }
      const texture = renderer.device.createTexture({
        size: { width, height },
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      renderer.device.queue.writeTexture(
        { texture },
        padded,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const entry = {
        kind: "cpu-spatial-leaf", texture, width, height, byteSize: width * height, cacheKey: key, longEdge,
        // The backend's verdict on this bitmap: soft enough to be stretched
        // over a magnified frame, or not shown to be.
        soft: response.headers.get("X-Mask-Soft") === "1",
        // Not soft only because its edges are too steep for this bitmap's
        // size, which a larger bitmap may fix; other reasons are about the
        // mask itself.
        softRetryable: ["bend", "border"].includes(response.headers.get("X-Mask-Soft-Reason") || ""),
        softEstimate: Number(response.headers.get("X-Mask-Soft-Estimate")),
        softLimit: Number(response.headers.get("X-Mask-Soft-Limit")),
        // Where the bitmap sits in the full-resolution frame, as fractions of
        // it: a crop is rounded differently at the bitmap's size.
        frameRect: (response.headers.get("X-Mask-Frame-Rect") || "0,0,1,1").split(",").map(Number),
      };
      renderer.localMasks.set(key, entry);
      if (remember && longEdge <= (renderer.softMaskMaxEdge || 0)) {
        renderer.rememberSoftMask?.(sessionId, geometrySignature, maskSignature, entry);
      }
      renderer.retainLocalMask(entry, longEdge);
      if (renderer.instrumentationEnabled) {
        renderer.performanceMetrics.maskEvents ||= [];
        renderer.performanceMetrics.maskEvents.push({
          kind: "cpu-spatial-leaf",
          maskPath: maskPath || "root",
          longEdge,
          width,
          height,
          cpuMaskMs: Number(response.headers.get("X-CPU-Mask-Ms")) || null,
          requestMs: performance.now() - startedAt,
          cpuMaskRequest: true,
          draft: Boolean(draftExpression),
        });
      }
      return entry;
    })();
    const record = { promise: pending, signal };
    renderer.localMaskInflight.set(key, record);
    try {
      return await pending;
    } finally {
      if (renderer.localMaskInflight.get(key) === record) renderer.localMaskInflight.delete(key);
    }
  }

  /** Where a tile is, and how far its halo reaches: what a mask tile depends on. */
  function spatialTileKey(tile) {
    return `${tile.rect.x},${tile.rect.y},${tile.rect.width},${tile.rect.height}|h${tile.halo}`;
  }

  /** Load every missing tile for one local through one bounded batch request. */
  async function loadCpuMaskTiles(renderer, {
    sessionId,
    batch,
    longEdge,
    editRevision,
    geometrySignature,
    maskSignature,
    isCurrent,
    signal,
  }) {
    // Grade values, opacity and bypass do not alter the spatial mask. Spatial
    // identity plus geometry is the actual cache invalidation boundary, and a
    // tile of it is the same tile whichever edit or source level asked: the
    // plan's own tile key carries the edit revision, so it is not used here.
    const prefix = `${sessionId}:${batch.local.id}:${longEdge}:${geometrySignature}:${maskSignature}:`;
    const entries = new Map();
    const missing = [];
    for (const tile of batch.tiles) {
      const key = `${prefix}${spatialTileKey(tile)}`;
      const cached = renderer.maskTiles.get(key);
      if (cached) {
        renderer.maskTiles.delete(key);
        renderer.maskTiles.set(key, cached);
        entries.set(tile.key, cached);
        continue;
      }
      missing.push({ tile, key });
    }
    if (!missing.length) return { localIndex: batch.localIndex, entries };
    const response = await fetch(
      `/api/session/${sessionId}/local-mask-tiles`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          edit_revision: editRevision,
          geometry_signature: geometrySignature,
          long_edge: longEdge,
          tiles: missing.map(({ tile }) => ({
            local_id: batch.local.id,
            x: tile.rect.x,
            y: tile.rect.y,
            width: tile.rect.width,
            height: tile.rect.height,
            halo: tile.halo,
          })),
        }),
      },
    );
    if (!response.ok || !renderer.maskTileBatch) {
      await response.body?.cancel?.().catch(() => null);
      return { localIndex: batch.localIndex, entries };
    }
    const parsed = renderer.maskTileBatch.parse(new Uint8Array(await response.arrayBuffer()));
    if (!isCurrent()) return { localIndex: batch.localIndex, entries };
    parsed.entries.forEach((entry, index) => {
      const target = missing[index];
      if (!target || entry.status !== "ok") return;
      const width = Number(entry.tile_width);
      const height = Number(entry.tile_height);
      const bytes = entry.payload;
      if (!width || !height || !bytes || bytes.byteLength < width * height) return;
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? bytes : new Uint8Array(bytesPerRow * height);
      if (padded !== bytes) {
        for (let row = 0; row < height; row += 1) {
          padded.set(bytes.subarray(row * width, (row + 1) * width), row * bytesPerRow);
        }
      }
      const texture = renderer.device.createTexture({
        size: { width, height }, format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      renderer.device.queue.writeTexture(
        { texture }, padded, { bytesPerRow, rowsPerImage: height }, { width, height },
      );
      const cached = { texture, width, height, byteSize: width * height, key: target.key };
      renderer.maskTiles.set(target.key, cached);
      entries.set(target.tile.key, cached);
    });
    return { localIndex: batch.localIndex, entries };
  }

  const HDRMaskLoader = Object.freeze({ loadCpuMaskLeaf, loadCpuMaskTiles, spatialTileKey });

  if (typeof window !== "undefined") window.HDRMaskLoader = HDRMaskLoader;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRMaskLoader };
})();
