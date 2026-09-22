(function () {
  /**
   * One in-flight plus one latest-pending work queue.
   *
   * Rapid input must not start a run per event. While one run is in flight,
   * every further submit replaces the single pending payload, so the work that
   * follows is always the newest state and the run count follows runs rather
   * than events. A caller that is coalesced still waits for the chain, which
   * means "your input has been applied or superseded by something newer".
   */
  class HDRLatestWorkQueue {
    constructor(run, options = {}) {
      if (typeof run !== "function") throw new TypeError("HDRLatestWorkQueue requires a run function");
      this.run = run;
      this.onError = typeof options.onError === "function" ? options.onError : null;
      this.active = null;
      this.running = false;
      this.pending = null;
      this.hasPending = false;
      this.stats = { started: 0, completed: 0, failed: 0, coalesced: 0, lastPayload: null };
    }

    get busy() {
      return this.running;
    }

    submit(payload) {
      if (this.running) {
        this.pending = payload;
        this.hasPending = true;
        this.stats.coalesced += 1;
        return this.active || Promise.resolve();
      }
      this.running = true;
      this.active = this.drain(payload);
      return this.active;
    }

    async drain(payload) {
      let next = payload;
      while (true) {
        this.stats.started += 1;
        this.stats.lastPayload = next;
        try {
          await this.run(next);
          this.stats.completed += 1;
        } catch (error) {
          this.stats.failed += 1;
          if (this.onError) this.onError(error);
        }
        if (!this.hasPending) break;
        next = this.pending;
        this.pending = null;
        this.hasPending = false;
      }
      this.running = false;
      this.active = null;
    }
  }

  if (typeof window !== "undefined") window.HDRLatestWorkQueue = HDRLatestWorkQueue;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRLatestWorkQueue };
})();
