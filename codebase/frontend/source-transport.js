(function () {
  "use strict";

  // Four bounded chunks overlap response reads with GPU copies without
  // rebuilding an image-sized staging allocation in the browser.
  const UPLOAD_RING_SIZE = 4;

  function supersededError(message) {
    const error = new Error(message || "Source preparation was superseded");
    error.recoverable = true;
    error.superseded = true;
    return error;
  }

  /**
   * Read one response chunk while continuing to check whether its render is
   * still current. Cancelling a superseded pending reader releases the browser
   * connection instead of leaving it parked until the backend finishes.
   */
  function readChunk(reader, isCurrent, assertCurrent, intervalMs = 200) {
    const pending = reader.read();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        callback();
      };
      const timer = setInterval(() => {
        if (!isCurrent || isCurrent() !== false) return;
        finish(() => {
          const cancelled = typeof reader.cancel === "function"
            ? reader.cancel()
            : Promise.resolve();
          Promise.resolve(cancelled).catch(() => null).then(() => {
            try {
              assertCurrent("Source stream was superseded");
              resolve({ value: undefined, done: true });
            } catch (error) {
              reject(error);
            }
          });
        });
      }, intervalMs);
      pending.then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  /** Copy one row chunk through a reusable mapped staging-buffer slot. */
  async function copyChunkStaged(renderer, ring, retired, slot, data, {
    bytesPerRow, rows, width, texture, origin,
  }) {
    const capacity = Math.max(1, bytesPerRow * rows);
    let staging = ring[slot];
    if (!staging || staging.size < capacity) {
      if (staging) retired.push(staging);
      staging = renderer.device.createBuffer({
        size: capacity,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      });
      ring[slot] = staging;
    }
    await staging.mapAsync(GPUMapMode.WRITE);
    new Uint8Array(staging.getMappedRange()).set(new Uint8Array(data));
    staging.unmap();
    const encoder = renderer.device.createCommandEncoder();
    encoder.copyBufferToTexture(
      { buffer: staging, offset: 0, bytesPerRow, rowsPerImage: rows },
      { texture, origin },
      { width, height: rows },
    );
    renderer.device.queue.submit([encoder.finish()]);
    return staging;
  }

  /** Release a staging ring after all of its submitted copies have executed. */
  async function releaseStaging(renderer, ring, retired = []) {
    const buffers = [...ring, ...retired].filter(Boolean);
    ring.length = 0;
    retired.length = 0;
    if (!buffers.length) return;
    await renderer.device.queue.onSubmittedWorkDone().catch(() => null);
    for (const buffer of buffers) buffer.destroy();
  }

  function setMode(renderer, mode) {
    const normalized = String(mode || "");
    if (!["strips", "single", "stream"].includes(normalized)) return renderer.sourceTransportMode;
    renderer.sourceTransportMode = normalized;
    return renderer.sourceTransportMode;
  }

  /** Fill one source texture from a single streamed whole-frame response. */
  async function loadStreaming(renderer, {
    sessionId,
    lane,
    longEdge,
    geometrySignature,
    editRevision,
    sourceIdentity,
    key,
    options = {},
  }) {
    const startedAt = performance.now();
    const endpoint = options.endpoint === "single" ? "proxy" : "proxy-stream";
    const signal = options.signal || renderer.sourceAbortSignal();
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : null;
    const assertCurrent = (message) => {
      if (isCurrent && isCurrent() === false) throw supersededError(message);
    };
    const url = `/api/session/${sessionId}/${endpoint}/${lane}`
      + `?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}`
      + `&geometry_signature=${encodeURIComponent(geometrySignature)}`;
    const response = await fetch(url, { signal });
    let texture = null;
    let reader = null;
    let complete = false;
    const stagingRing = [];
    const retiredStaging = [];
    try {
      if (!response.ok) {
        if (response.status === 409 || response.status === 507) {
          const payload = await response.json().catch(() => null);
          const error = new Error(
            (typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message)
              || (response.status === 409
                ? "WebGPU geometry proxy is waiting for the committed edit"
                : "WebGPU proxy could not be loaded"),
          );
          error.recoverable = true;
          error.previewCapacity = response.status === 507;
          error.status = response.status;
          complete = true;
          throw error;
        }
        await response.arrayBuffer().catch(() => null);
        complete = true;
        return null;
      }
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
      const pixelFormat = response.headers.get("X-Pixel-Format") || "rgba16float";
      const workingSpace = response.headers.get("X-Working-Space") || "acescg";
      const acceptedGeometry = response.headers.get("X-Geometry-Signature") || "{}";
      if (!(width > 0 && height > 0 && bytesPerRow > 0)) {
        await response.arrayBuffer().catch(() => null);
        complete = true;
        return null;
      }
      if (acceptedGeometry !== geometrySignature) {
        const error = new Error("Stale WebGPU geometry proxy rejected");
        error.recoverable = true;
        throw error;
      }
      assertCurrent("Source stream was superseded before upload");
      const bytesPerPixel = pixelFormat === "rgba16float" ? 8 : 16;
      try {
        texture = renderer.device.createTexture({
          size: { width, height },
          format: pixelFormat,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });
      } catch (error) {
        renderer.recordAllocationFailure("source-proxy", error, { width, height });
        throw error;
      }
      const rowsPerChunk = Math.max(1, Math.min(height, Math.floor(renderer.maxSourceChunkBytes / bytesPerRow)));
      const chunkBytes = rowsPerChunk * bytesPerRow;
      const chunkTotal = Math.ceil(height / rowsPerChunk);
      const ringSize = Math.max(1, Math.min(UPLOAD_RING_SIZE, chunkTotal));
      const pending = new Uint8Array(chunkBytes);
      let pendingBytes = 0;
      let transferredBytes = 0;
      let chunkCount = 0;
      let firstByteMs = null;
      let firstTileMs = null;
      const flush = async () => {
        if (!pendingBytes) return;
        if (pendingBytes % bytesPerRow !== 0) {
          const error = new Error("A streamed source chunk was not row-aligned");
          error.recoverable = true;
          throw error;
        }
        const rows = pendingBytes / bytesPerRow;
        await copyChunkStaged(renderer, stagingRing, retiredStaging, chunkCount % ringSize,
          pending.subarray(0, pendingBytes), {
            bytesPerRow, rows, width, texture, origin: { x: 0, y: chunkCount * rowsPerChunk },
          });
        if (firstTileMs === null) firstTileMs = performance.now() - startedAt;
        chunkCount += 1;
        pendingBytes = 0;
      };
      const consume = async (value) => {
        if (firstByteMs === null) firstByteMs = performance.now() - startedAt;
        transferredBytes += value.byteLength;
        let offset = 0;
        while (offset < value.byteLength) {
          const take = Math.min(chunkBytes - pendingBytes, value.byteLength - offset);
          pending.set(value.subarray(offset, offset + take), pendingBytes);
          pendingBytes += take;
          offset += take;
          if (pendingBytes === chunkBytes) await flush();
        }
      };
      reader = response.body?.getReader ? response.body.getReader() : null;
      if (reader) {
        for (;;) {
          assertCurrent("Source stream was superseded");
          const { value, done } = await readChunk(reader, isCurrent, assertCurrent);
          if (done) break;
          await consume(value);
        }
      } else {
        await consume(new Uint8Array(await response.arrayBuffer()));
      }
      assertCurrent("Source stream was superseded");
      await flush();
      if (transferredBytes !== bytesPerRow * height) {
        const error = new Error("A streamed source proxy ended before the whole frame arrived");
        error.recoverable = true;
        throw error;
      }
      complete = true;
      await releaseStaging(renderer, stagingRing, retiredStaging);
      const byteSize = width * height * bytesPerPixel;
      const proxy = {
        texture,
        width,
        height,
        sessionId,
        lane,
        longEdge,
        workingSpace,
        pixelFormat,
        geometrySignature,
        sourceIdentity,
        identity: key,
        byteSize,
        streamed: true,
        streamedSingle: true,
        bindGroups: new Map(),
      };
      texture = null;
      renderer.proxies.set(key, proxy);
      renderer.sourceTransportMetrics = {
        route: "streamed",
        endpoint,
        width,
        height,
        chunkCount,
        rowsPerChunk,
        transferredBytes,
        largestResponseBytes: chunkBytes,
        timeToFirstByteMs: firstByteMs,
        timeToFirstTileMs: firstTileMs,
        totalMs: performance.now() - startedAt,
      };
      renderer.recordAllocation("source-proxy", byteSize, {
        width, height, lane, longEdge, pixelFormat, streamed: true, endpoint,
      });
      renderer.recordStage("proxy-request", {
        lane,
        longEdge,
        cacheHit: false,
        route: "streamed",
        endpoint,
        chunkCount,
        durationMs: renderer.sourceTransportMetrics.totalMs,
        timeToFirstByteMs: firstByteMs,
        timeToFirstTileMs: firstTileMs,
        bytes: transferredBytes,
      });
      renderer.trimProxyLevels(sessionId, lane);
      return proxy;
    } catch (error) {
      renderer.destroyAfterActiveRenders(() => texture?.destroy?.());
      throw error;
    } finally {
      if (!complete) {
        if (reader && typeof reader.cancel === "function") {
          await reader.cancel().catch(() => null);
        } else if (typeof response.body?.cancel === "function") {
          await response.body.cancel().catch(() => null);
        }
      }
      await releaseStaging(renderer, stagingRing, retiredStaging);
    }
  }

  /** Fill a whole source texture from bounded per-strip requests. */
  async function loadStrips(renderer, {
    sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, options = {},
  }) {
    const startedAt = performance.now();
    const signal = options.signal || renderer.sourceAbortSignal();
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : null;
    const assertCurrent = (message) => {
      if (isCurrent && isCurrent() === false) throw supersededError(message);
    };
    const query = (rect) => `/api/session/${sessionId}/source-tile/${lane}`
      + `?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}`
      + `&geometry_signature=${encodeURIComponent(geometrySignature)}`
      + `&x=${rect.x}&y=${rect.y}&width=${rect.width}&height=${rect.height}`
      + (rect.epoch === undefined ? "" : `&source_epoch=${rect.epoch}`);

    const probe = await fetch(query({ x: 0, y: 0, width: 1, height: 1 }), { signal });
    if (!probe.ok) {
      await probe.arrayBuffer().catch(() => null);
      return null;
    }
    const width = Number(probe.headers.get("X-Output-Width"));
    const height = Number(probe.headers.get("X-Output-Height"));
    const pixelFormat = probe.headers.get("X-Pixel-Format") || "rgba16float";
    const workingSpace = probe.headers.get("X-Working-Space") || "acescg";
    const acceptedGeometry = probe.headers.get("X-Geometry-Signature") || "{}";
    const sourceEpoch = Number(probe.headers.get("X-Source-Epoch"));
    await probe.arrayBuffer().catch(() => null);
    assertCurrent("Source tile probe was superseded");
    if (!(width > 0 && height > 0)) return null;
    if (acceptedGeometry !== geometrySignature) {
      const error = new Error("Stale WebGPU geometry tile rejected");
      error.recoverable = true;
      throw error;
    }

    const bytesPerPixel = pixelFormat === "rgba16float" ? 8 : 16;
    let texture;
    try {
      texture = renderer.device.createTexture({
        size: { width, height },
        format: pixelFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
    } catch (error) {
      renderer.recordAllocationFailure("source-proxy", error, { width, height });
      throw error;
    }

    const rowBytes = Math.max(1, width * bytesPerPixel);
    const rowsPerChunk = Math.max(1, Math.min(height, Math.floor(renderer.maxSourceChunkBytes / rowBytes)));
    const chunkTotal = Math.ceil(height / rowsPerChunk);
    const ringSize = Math.max(1, Math.min(UPLOAD_RING_SIZE, chunkTotal));
    const stagingRing = [];
    const retiredStaging = [];
    let transferredBytes = 0;
    let firstTileMs = null;
    let chunkCount = 0;
    try {
      for (let top = 0; top < height; top += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, height - top);
        assertCurrent("Source tile stream was superseded");
        const response = await fetch(query({ x: 0, y: top, width, height: rows, epoch: sourceEpoch }), { signal });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(payload?.detail || "A source tile could not be loaded");
          error.recoverable = response.status === 409;
          error.status = response.status;
          throw error;
        }
        const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
        const data = await response.arrayBuffer();
        if (firstTileMs === null) firstTileMs = performance.now() - startedAt;
        transferredBytes += data.byteLength;
        chunkCount += 1;
        await copyChunkStaged(renderer, stagingRing, retiredStaging,
          chunkCount % ringSize, data, {
            bytesPerRow, rows, width, texture, origin: { x: 0, y: top },
          });
        assertCurrent("Source tile stream was superseded");
      }
    } catch (error) {
      renderer.destroyAfterActiveRenders(() => texture.destroy());
      throw error;
    } finally {
      await releaseStaging(renderer, stagingRing, retiredStaging);
    }

    const byteSize = width * height * bytesPerPixel;
    const proxy = {
      texture,
      width,
      height,
      sessionId,
      lane,
      longEdge,
      workingSpace,
      pixelFormat,
      geometrySignature,
      sourceIdentity,
      identity: key,
      byteSize,
      streamed: true,
      bindGroups: new Map(),
    };
    renderer.proxies.set(key, proxy);
    renderer.sourceTransportMetrics = {
      route: "tiled",
      width,
      height,
      chunkCount,
      rowsPerChunk,
      transferredBytes,
      largestResponseBytes: Math.min(renderer.maxSourceChunkBytes, rowBytes * rowsPerChunk),
      timeToFirstTileMs: firstTileMs,
      totalMs: performance.now() - startedAt,
    };
    renderer.recordAllocation("source-proxy", byteSize, {
      width, height, lane, longEdge, pixelFormat, streamed: true,
    });
    renderer.recordStage("proxy-request", {
      lane,
      longEdge,
      cacheHit: false,
      route: "tiled",
      chunkCount,
      durationMs: renderer.sourceTransportMetrics.totalMs,
      timeToFirstTileMs: firstTileMs,
      bytes: transferredBytes,
    });
    renderer.trimProxyLevels(sessionId, lane);
    return proxy;
  }

  /** Fill a viewport-sized source texture from bounded per-strip requests. */
  async function loadRegion(renderer, {
    sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, region, options = {},
  }) {
    const startedAt = performance.now();
    const signal = options.signal || renderer.sourceAbortSignal();
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : null;
    const assertCurrent = (message) => {
      if (isCurrent && isCurrent() === false) throw supersededError(message);
    };
    const query = (rect, epoch) => `/api/session/${sessionId}/source-tile/${lane}`
      + `?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}`
      + `&geometry_signature=${encodeURIComponent(geometrySignature)}`
      + `&x=${rect.x}&y=${rect.y}&width=${rect.width}&height=${rect.height}&halo=0`
      + (epoch === undefined ? "" : `&source_epoch=${epoch}`);

    const probe = await fetch(query({ x: region.x, y: region.y, width: 1, height: 1 }), { signal });
    if (!probe.ok) {
      await probe.arrayBuffer().catch(() => null);
      return null;
    }
    const outputWidth = Number(probe.headers.get("X-Output-Width"));
    const outputHeight = Number(probe.headers.get("X-Output-Height"));
    const pixelFormat = probe.headers.get("X-Pixel-Format") || "rgba16float";
    const workingSpace = probe.headers.get("X-Working-Space") || "acescg";
    const acceptedGeometry = probe.headers.get("X-Geometry-Signature") || "{}";
    const sourceEpoch = Number(probe.headers.get("X-Source-Epoch"));
    await probe.arrayBuffer().catch(() => null);
    assertCurrent("ROI source region probe was superseded");
    if (!(outputWidth > 0 && outputHeight > 0)) return null;
    if (acceptedGeometry !== geometrySignature) {
      const error = new Error("Stale WebGPU geometry region rejected");
      error.recoverable = true;
      throw error;
    }
    const delivered = {
      x: Math.max(0, Math.min(region.x, outputWidth)),
      y: Math.max(0, Math.min(region.y, outputHeight)),
      width: 0,
      height: 0,
    };
    delivered.width = Math.max(0, Math.min(region.x + region.width, outputWidth) - delivered.x);
    delivered.height = Math.max(0, Math.min(region.y + region.height, outputHeight) - delivered.y);
    if (!(delivered.width > 0 && delivered.height > 0)) return null;
    if (delivered.width * delivered.height >= outputWidth * outputHeight * 0.9) return null;

    const bytesPerPixel = pixelFormat === "rgba16float" ? 8 : 16;
    let texture;
    try {
      texture = renderer.device.createTexture({
        size: { width: delivered.width, height: delivered.height },
        format: pixelFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
    } catch (error) {
      renderer.recordAllocationFailure("source-proxy", error, {
        width: delivered.width, height: delivered.height,
      });
      throw error;
    }

    const rowBytes = Math.max(1, delivered.width * bytesPerPixel);
    const rowsPerChunk = Math.max(1, Math.min(delivered.height,
      Math.floor(renderer.maxSourceChunkBytes / rowBytes)));
    const chunkTotal = Math.ceil(delivered.height / rowsPerChunk);
    const ringSize = Math.max(1, Math.min(UPLOAD_RING_SIZE, chunkTotal));
    const stagingRing = [];
    const retiredStaging = [];
    let transferredBytes = 0;
    let chunkCount = 0;
    let firstTileMs = null;
    try {
      // The chunks are independent row ranges of one texture, and the backend
      // spends most of each request converting to half float. One lane per
      // staging slot fetches them side by side: a slot's next write still
      // waits only for its own earlier copy, and at most `ringSize` chunk
      // responses exist at once, never the whole region.
      let nextTop = 0;
      let failure = null;
      const lane = async (slot) => {
        while (!failure && nextTop < delivered.height) {
          const top = nextTop;
          const rows = Math.min(rowsPerChunk, delivered.height - top);
          nextTop += rows;
          assertCurrent("ROI source region stream was superseded");
          const response = await fetch(query({
            x: delivered.x, y: delivered.y + top, width: delivered.width, height: rows,
          }, sourceEpoch), { signal });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const error = new Error(payload?.detail || "A source region could not be loaded");
            error.recoverable = response.status === 409;
            error.status = response.status;
            throw error;
          }
          const chunk = {
            x: Number(response.headers.get("X-Tile-X")),
            y: Number(response.headers.get("X-Tile-Y")),
            width: Number(response.headers.get("X-Tile-Width")),
            height: Number(response.headers.get("X-Tile-Height")),
          };
          const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
          const data = await response.arrayBuffer();
          if (failure) return;
          if (!(chunk.width > 0 && chunk.height > 0)) throw new Error("A source region chunk arrived empty");
          if (chunk.x < delivered.x || chunk.y < delivered.y
            || chunk.x + chunk.width > delivered.x + delivered.width
            || chunk.y + chunk.height > delivered.y + delivered.height) {
            throw new Error("A source region chunk arrived outside its region");
          }
          if (firstTileMs === null) firstTileMs = performance.now() - startedAt;
          transferredBytes += data.byteLength;
          chunkCount += 1;
          await copyChunkStaged(renderer, stagingRing, retiredStaging, slot, data, {
            bytesPerRow, rows: chunk.height, width: chunk.width, texture,
            origin: { x: chunk.x - delivered.x, y: chunk.y - delivered.y },
          });
          assertCurrent("ROI source region stream was superseded");
        }
      };
      // Every lane stops before the partial texture is released: a copy into
      // a destroyed texture must not be left in flight.
      await Promise.all(Array.from({ length: ringSize }, (_, slot) => lane(slot).catch((error) => {
        failure ||= error;
      })));
      if (failure) throw failure;
    } catch (error) {
      renderer.destroyAfterActiveRenders(() => texture.destroy());
      throw error;
    } finally {
      await releaseStaging(renderer, stagingRing, retiredStaging);
    }

    const byteSize = delivered.width * delivered.height * bytesPerPixel;
    const proxy = {
      texture, width: outputWidth, height: outputHeight, region: { ...delivered },
      textureWidth: delivered.width, textureHeight: delivered.height,
      sessionId, lane, longEdge, workingSpace, pixelFormat, geometrySignature,
      sourceIdentity, identity: key, byteSize, streamed: true, regionTransport: true,
      bindGroups: new Map(),
    };
    renderer.proxies.set(key, proxy);
    renderer.sourceTransportMetrics = {
      route: "region", width: outputWidth, height: outputHeight, region: { ...delivered },
      chunkCount, rowsPerChunk, transferredBytes,
      largestResponseBytes: Math.min(renderer.maxSourceChunkBytes, rowBytes * rowsPerChunk),
      timeToFirstTileMs: firstTileMs, totalMs: performance.now() - startedAt,
    };
    renderer.recordAllocation("source-proxy", byteSize, {
      width: delivered.width, height: delivered.height, lane, longEdge, pixelFormat, region: true,
    });
    renderer.recordStage("proxy-request", {
      lane, longEdge, cacheHit: false, route: "region", chunkCount, region: { ...delivered },
      durationMs: renderer.sourceTransportMetrics.totalMs,
      timeToFirstTileMs: firstTileMs, bytes: transferredBytes,
    });
    renderer.trimProxyLevels(sessionId, lane);
    return proxy;
  }

  /** Fetch, validate, upload, and publish a proxy that already fits one response. */
  async function loadWholeFrame(renderer, {
    sessionId,
    lane,
    longEdge,
    geometrySignature,
    editRevision,
    sourceIdentity,
    key,
    signal,
    isCurrent,
    startedAt,
  }) {
    const response = await fetch(
      `/api/session/${sessionId}/proxy/${lane}?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}`
        + `&geometry_signature=${encodeURIComponent(geometrySignature)}`,
      { signal },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(
        (typeof payload?.detail === "string" ? payload.detail : payload?.detail?.message)
          || (response.status === 409
            ? "WebGPU geometry proxy is waiting for the committed edit"
            : "WebGPU proxy could not be loaded"),
      );
      error.recoverable = response.status === 409 || response.status === 507;
      error.previewCapacity = response.status === 507;
      error.status = response.status;
      throw error;
    }
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
    const workingSpace = response.headers.get("X-Working-Space") || "acescg";
    const pixelFormat = response.headers.get("X-Pixel-Format") || "rgba32float";
    const acceptedGeometry = response.headers.get("X-Geometry-Signature") || "{}";
    const data = await response.arrayBuffer();
    if (acceptedGeometry !== geometrySignature) {
      const error = new Error("Stale WebGPU geometry proxy rejected");
      error.recoverable = true;
      throw error;
    }
    if (isCurrent && isCurrent() === false) throw supersededError("Source proxy was superseded");
    const texture = renderer.device.createTexture({
      size: { width, height },
      format: pixelFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    renderer.device.queue.writeTexture(
      { texture },
      data,
      { offset: 0, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    const byteSize = width * height * (pixelFormat === "rgba16float" ? 8 : 16);
    const proxy = {
      texture,
      width,
      height,
      sessionId,
      lane,
      longEdge,
      workingSpace,
      pixelFormat,
      geometrySignature,
      sourceIdentity,
      identity: key,
      byteSize,
      bindGroups: new Map(),
    };
    renderer.proxies.set(key, proxy);
    renderer.recordAllocation("source-proxy", byteSize, { width, height, lane, longEdge, pixelFormat });
    renderer.sourceTransportMetrics = {
      route: "whole-frame",
      width,
      height,
      chunkCount: 1,
      transferredBytes: data.byteLength,
      largestResponseBytes: data.byteLength,
      timeToFirstTileMs: performance.now() - startedAt,
      totalMs: performance.now() - startedAt,
    };
    renderer.recordStage("proxy-request", {
      lane,
      longEdge,
      cacheHit: false,
      route: "whole-frame",
      durationMs: performance.now() - startedAt,
      bytes: data.byteLength,
    });
    renderer.trimProxyLevels(sessionId, lane);
    return proxy;
  }

  /**
   * Coordinate proxy cache reuse, one in-flight request per identity, bounded
   * route selection, and advisory source-mip progress reporting.
   */
  async function loadProxy(renderer, {
    sessionId,
    lane,
    longEdge,
    geometrySignature = "{}",
    editRevision = 0,
    sourceIdentity = "source",
    options = {},
  }) {
    const region = options.region || null;
    const regionKey = region
      ? `:region:${region.x},${region.y},${region.width},${region.height}`
      : "";
    const key = `${sessionId}:${lane}:${longEdge}:${geometrySignature}:${sourceIdentity}${regionKey}`;
    if (renderer.proxies.has(key)) {
      renderer.recordStage("proxy-request", { lane, longEdge, cacheHit: true });
      return renderer.proxies.get(key);
    }
    // Clarity can change the required halo without changing the source pixels.
    // A resident region that contains the request is already complete evidence;
    // keep its original coordinates so the tile encoder samples it correctly.
    if (region) {
      const resident = [...renderer.proxies.values()].filter((proxy) => {
        const loaded = proxy.region;
        return loaded && proxy.regionTransport && !proxy.identity?.includes(":analysis:")
          && proxy.sessionId === sessionId && proxy.lane === lane
          && proxy.longEdge === longEdge && proxy.geometrySignature === geometrySignature
          && proxy.sourceIdentity === sourceIdentity
          // A luma feather downsamples from the region's origin, so a stand-in
          // must start on the requested cells.
          && loaded.x % (region.alignment || 1) === 0 && loaded.y % (region.alignment || 1) === 0
          && loaded.x <= region.x && loaded.y <= region.y
          && loaded.x + loaded.width >= region.x + region.width
          && loaded.y + loaded.height >= region.y + region.height;
      }).sort((a, b) => a.byteSize - b.byteSize)[0];
      if (resident) {
        renderer.recordStage("proxy-request", { lane, longEdge, cacheHit: true, route: "region", contained: true });
        return renderer.proxies.get(resident.identity);
      }
    }
    if (renderer.proxyInflight.has(key)) return renderer.proxyInflight.get(key);
    const signal = options.signal || renderer.sourceAbortSignal();
    const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : null;
    const pending = (async () => {
      const startedAt = performance.now();
      if (region) {
        const regional = await renderer.loadProxyRegion(
          sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key, region,
          { signal, isCurrent },
        );
        if (regional) return regional;
        // Scene-qualified masks on an authored SDR region may request a
        // separate HDR region. A refused region must retain the mask fallback,
        // never initiate a native whole-source preparation from that request.
        if (options.regionOnly) return null;
      }
      if (longEdge * longEdge * 8 > renderer.maxSourceChunkBytes) {
        if (renderer.sourceTransportMode !== "strips") {
          const streaming = await renderer.loadProxyStreaming(
            sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key,
            {
              signal,
              isCurrent,
              endpoint: renderer.sourceTransportMode === "single" ? "single" : "stream",
            },
          );
          if (streaming) return streaming;
        }
        const streamed = await renderer.loadProxyStreamed(
          sessionId, lane, longEdge, geometrySignature, editRevision, sourceIdentity, key,
          { signal, isCurrent },
        );
        if (streamed) return streamed;
      }
      return loadWholeFrame(renderer, {
        sessionId,
        lane,
        longEdge,
        geometrySignature,
        editRevision,
        sourceIdentity,
        key,
        signal,
        isCurrent,
        startedAt,
      });
    })();
    renderer.proxyInflight.set(key, pending);
    let progressTimer = null;
    let finished = false;
    if (typeof options.onProgress === "function") {
      const poll = async () => {
        if (finished || signal.aborted) return;
        try {
          const response = await fetch(`/api/session/${sessionId}/source-mip-progress`, { signal });
          if (response.ok) {
            const payload = await response.json();
            const build = payload.active_builds?.find((item) => item.long_edge === longEdge);
            if (build && !finished && (!isCurrent || isCurrent())) {
              options.onProgress({ state: "building", ...build });
            }
          }
        } catch (_) {
          // Progress is advisory; the source request owns error reporting.
        }
        if (!finished) progressTimer = setTimeout(poll, 120);
      };
      progressTimer = setTimeout(poll, 120);
    }
    try {
      return await pending;
    } finally {
      finished = true;
      if (progressTimer !== null) clearTimeout(progressTimer);
      options.onProgress?.({ state: "done", long_edge: longEdge });
      renderer.proxyInflight.delete(key);
    }
  }

  const HDRSourceTransport = Object.freeze({
    UPLOAD_RING_SIZE,
    supersededError,
    readChunk,
    copyChunkStaged,
    releaseStaging,
    setMode,
    loadStreaming,
    loadStrips,
    loadRegion,
    loadWholeFrame,
    loadProxy,
  });

  if (typeof window !== "undefined") window.HDRSourceTransport = HDRSourceTransport;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRSourceTransport };
})();
