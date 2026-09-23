(function () {
  "use strict";

  const TARGETS = Object.freeze({ responsive: 33, balanced: 66, precise: 150 });
  const SCALES = Object.freeze([0.25, 0.375, 0.5, 0.75, 1]);

  class HDRPreviewLatencyController {
    constructor() {
      this.samples = new Map();
      this.decisions = new Map();
    }

    choose({ preference = "balanced", graph = "default", exactEdge, visiblePixels, interacting = true } = {}) {
      const mode = Object.hasOwn(TARGETS, preference) ? preference : "balanced";
      const edge = Math.max(1, Math.round(Number(exactEdge) || 1));
      const pixels = Math.max(1, Number(visiblePixels) || edge * edge);
      if (mode === "precise" || !interacting) return { edge, scale: 1, coarse: false, targetMs: TARGETS[mode] };
      const sample = this.samples.get(graph);
      // A cold graph has no timing evidence. Balanced starts exact; Responsive
      // takes one measured half-scale pass so feedback is useful immediately.
      const predicted = sample ? sample.msPerPixel * pixels : mode === "responsive" ? TARGETS[mode] * 4 : 0;
      let index = SCALES.length - 1;
      while (index > 0 && predicted * SCALES[index] ** 2 > TARGETS[mode] * 1.15) index -= 1;
      const previous = this.decisions.get(`${mode}:${graph}`);
      if (previous !== undefined && Math.abs(index - previous) === 1) {
        // Require a material change before switching adjacent scales. This
        // keeps small timing variation from making the image visibly pulse.
        const previousCost = predicted * SCALES[previous] ** 2;
        if (previousCost >= TARGETS[mode] * 0.7 && previousCost <= TARGETS[mode] * 1.3) index = previous;
      }
      this.decisions.set(`${mode}:${graph}`, index);
      const scale = SCALES[index];
      return { edge: Math.max(256, Math.min(edge, Math.round(edge * scale))), scale, coarse: scale < 1,
        targetMs: TARGETS[mode], predictedMs: predicted * scale ** 2 };
    }

    record({ graph = "default", edge, exactEdge, visiblePixels, elapsedMs } = {}) {
      const ms = Number(elapsedMs);
      const pixels = Number(visiblePixels);
      const ratio = Number(edge) / Number(exactEdge);
      if (!(ms > 0 && pixels > 0 && ratio > 0 && ratio <= 1)) return;
      const rate = ms / (pixels * ratio * ratio);
      const old = this.samples.get(graph);
      this.samples.set(graph, { msPerPixel: old ? old.msPerPixel * 0.7 + rate * 0.3 : rate,
        count: (old?.count || 0) + 1 });
    }

    snapshot() {
      return { targets: TARGETS, samples: Object.fromEntries(this.samples), decisions: Object.fromEntries(this.decisions) };
    }
  }

  if (typeof window !== "undefined") window.HDRPreviewLatencyController = HDRPreviewLatencyController;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRPreviewLatencyController };
})();
