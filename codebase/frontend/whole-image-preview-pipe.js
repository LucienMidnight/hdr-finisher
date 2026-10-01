(function () {
  "use strict";

  // Analysis and overview work has a separate, bounded source level. It must
  // never inherit the Full tier's native edge from the authoring ROI pipe.
  const LIMITS = Object.freeze({
    scopes: 1600,
    navigation: 512,
    maskOverview: 1600,
    coarseAnalysis: 960,
    fitPlaceholder: 1600,
  });

  // The mask overlay shows the same mask the renderer compiles. At the
  // renderer's own edge its request joins that compile; capped a few pixels
  // below it (1600 against 1606) it cost a second, near-identical one on every
  // brush edit. Above this edge a separate capped compile is under a quarter
  // of the renderer's, and the overlay canvas stays bounded.
  const SHARED_EDGE = Object.freeze({ maskOverview: 3200 });

  class HDRWholeImagePreviewPipe {
    static edgeFor(purpose, requestedEdge) {
      const limit = LIMITS[purpose];
      if (!limit) throw new RangeError(`Unknown whole-image purpose: ${purpose}`);
      const requested = Math.floor(Number(requestedEdge));
      if (Number.isFinite(requested) && requested > limit && requested <= (SHARED_EDGE[purpose] || 0)) {
        return requested;
      }
      return Math.max(256, Math.min(limit, Number.isFinite(requested) ? requested : limit));
    }

    static request(purpose, requestedEdge, identity = {}) {
      const longEdge = this.edgeFor(purpose, requestedEdge);
      return Object.freeze({ ...identity, purpose, longEdge, pipe: "whole-image" });
    }

    static limits() { return LIMITS; }
  }

  window.HDRWholeImagePreviewPipe = HDRWholeImagePreviewPipe;
})();
