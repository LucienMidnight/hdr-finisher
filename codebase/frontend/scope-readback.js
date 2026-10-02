(function () {
  "use strict";

  /** Read the exact maximum accumulated into a settled scope-peak grid. */
  async function readPeak(target, halfToFloat) {
    if (!target) return null;
    try {
      await target.readBuffer.mapAsync(GPUMapMode.READ);
      const values = new Uint16Array(target.readBuffer.getMappedRange());
      let peak = 0;
      for (let index = 0; index < values.length; index += 4) {
        const value = halfToFloat(values[index]);
        if (value > peak) peak = value;
      }
      return peak;
    } catch (error) {
      return null;
    } finally {
      if (target.readBuffer.mapState === "mapped") target.readBuffer.unmap();
      target.busy = false;
    }
  }

  /** Map, unpack, publish metrics for, and release one scope analysis buffer. */
  async function readAnalysis(renderer, {
    canvas,
    source,
    resource,
    width,
    height,
    generation,
    tier,
    startedAt,
    encodedAt,
    submittedAt,
    halfToFloat,
    raw = false,
  }) {
    try {
      await resource.readBuffer.mapAsync(GPUMapMode.READ);
      if (renderer.scopeSources.get(canvas) !== source) return null;
      const mappedAt = performance.now();
      const sourceBytes = new Uint16Array(resource.readBuffer.getMappedRange());
      const rowStride = resource.bytesPerRow / 2;
      if (raw) {
        // The caller forwards the half floats as they are: RGB, rows packed.
        const halves = new Uint16Array(width * height * 3);
        let target = 0;
        for (let row = 0; row < height; row += 1) {
          let index = row * rowStride;
          for (let column = 0; column < width; column += 1) {
            halves[target++] = sourceBytes[index];
            halves[target++] = sourceBytes[index + 1];
            halves[target++] = sourceBytes[index + 2];
            index += 4;
          }
        }
        return { halves, width, height, sourceSerial: source.serial };
      }
      const pixels = new Float32Array(width * height * 3);
      const cellPeaks = new Float32Array(width * height);
      let targetIndex = 0;
      let peakIndex = 0;
      for (let row = 0; row < height; row += 1) {
        let sourceIndex = row * rowStride;
        for (let column = 0; column < width; column += 1) {
          pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex]);
          pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 1]);
          pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 2]);
          cellPeaks[peakIndex++] = halfToFloat(sourceBytes[sourceIndex + 3]);
          sourceIndex += 4;
        }
      }
      const completedAt = performance.now();
      const metric = {
        generation,
        tier,
        lane: source.lane,
        sourceSerial: source.serial,
        applicationGeneration: source.applicationGeneration,
        geometrySignature: source.geometrySignature,
        width,
        height,
        encodeMs: encodedAt - startedAt,
        submitMs: submittedAt - encodedAt,
        mapReadbackMs: mappedAt - submittedAt,
        unpackMs: completedAt - mappedAt,
        totalMs: completedAt - startedAt,
        byteLength: resource.bytesPerRow * height,
      };
      if (renderer.instrumentationEnabled) {
        renderer.performanceMetrics.scopes.push(metric);
        if (renderer.performanceMetrics.scopes.length > 240) renderer.performanceMetrics.scopes.shift();
        renderer.recordStage("scopes", { ...metric });
      }
      return {
        pixels,
        cellPeaks,
        width,
        height,
        lane: source.lane,
        sourceSerial: source.serial,
        applicationGeneration: source.applicationGeneration,
        geometrySignature: source.geometrySignature,
        sessionId: source.sessionId,
        metric,
      };
    } catch {
      return null;
    } finally {
      if (resource.readBuffer.mapState === "mapped") resource.readBuffer.unmap();
      resource.busy = false;
      renderer.activeScopeCount = Math.max(0, renderer.activeScopeCount - 1);
      renderer.flushDeferredDestroy();
    }
  }

  const HDRScopeReadback = Object.freeze({ readPeak, readAnalysis });

  if (typeof window !== "undefined") window.HDRScopeReadback = HDRScopeReadback;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRScopeReadback };
})();
