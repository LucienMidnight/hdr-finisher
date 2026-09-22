(function () {
  /**
   * Serialize presentation to one canvas and refuse stale generations.
   *
   * A generation may resize a canvas's drawing buffer and encode into it only
   * while it owns that canvas's gate. Without the gate, two generations at
   * different sizes interleave: one resizes the buffer while the other is
   * encoding against the previous size, which fails device validation with a
   * scissor mismatch and can leave a cleared canvas behind. The gate is
   * released at submission, not at the end of the render, so readbacks, cache
   * trims and mask fetches never hold it.
   *
   * Staleness is checked after the wait, because a generation can become
   * superseded while it is queued behind another presentation. A refused
   * generation returns null before the resize callback runs, so the accepted
   * frame stays on screen.
   */
  class HDRPresentationGate {
    constructor() {
      this.locks = new WeakMap();
    }

    /**
     * Wait for the canvas, then confirm the caller is still current.
     *
     * `isCurrent` is optional; when provided, a false answer refuses the
     * presentation. `resize` is optional and runs only after the gate is held
     * and the caller is confirmed current, so it is the only place a caller
     * should resize the canvas.
     *
     * Returns `{ current, release }` when the gate is held, or `null` when the
     * caller was refused. `release` is idempotent.
     */
    async acquire(canvas, isCurrent, resize) {
      const tail = this.locks.get(canvas) || Promise.resolve();
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      this.locks.set(canvas, tail.then(() => held));
      await tail;
      if (typeof isCurrent === "function" && isCurrent() === false) {
        release();
        return null;
      }
      if (typeof resize === "function") resize();
      return {
        current: () => typeof isCurrent !== "function" || isCurrent() !== false,
        release,
      };
    }
  }

  if (typeof window !== "undefined") window.HDRPresentationGate = HDRPresentationGate;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRPresentationGate };
})();
