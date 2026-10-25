/* Always-on stage records; only paths and timing/identity metadata leave the page. */
(() => {
  let events = [], timer;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!events.length) return;
    const batch = events; events = [];
    void fetch("/api/library/stopwatch", { method: "POST", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch)
    }).catch(() => {});
  }
  window.HDRLibraryStopwatch = (stage, fields = {}) => {
    events.push({ stage, time: (performance.timeOrigin + performance.now()) / 1000, ...fields });
    if (events.length >= 64) flush();
    else if (!timer) timer = setTimeout(flush, 100);
  };
  window.addEventListener("pagehide", flush);
})();
HDRLibraryStopwatch("loaded");

// A request owns its stopwatch, so concurrent grid and fullscreen work cannot
// borrow one another's identity. Presentation is a compositor opportunity,
// not a claim to measure physical display scanout.
window.HDRLibraryTrace = Object.freeze({
  begin(view, path, started = performance.now()) {
    const trace = {request:crypto.randomUUID(),view,path,started};
    HDRLibraryStopwatch("navigation", {request:trace.request,view,path});
    return trace;
  },
  mark(trace, stage, started, fields = {}) {
    if (!trace) return;
    HDRLibraryStopwatch(stage, {request:trace.request,view:trace.view,path:trace.path,
      duration_ms:performance.now()-started,...fields});
  },
  end(trace,reason) {
    if (!trace || trace.ended) return;
    trace.ended = true;
    this.mark(trace,"fullscreen_outcome",trace.started,{blank:!trace.presented,stand_in:!!trace.standInPresented,sharp:!!trace.sharpPresented,reason});
  },
  present(trace, current, fields = {}) {
    if (!trace) return;
    const submitted = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!current()) return;
      trace.presented = true;
      if (fields.stand_in) trace.standInPresented = true;
      if (fields.sharp) trace.sharpPresented = true;
      this.mark(trace,"present",submitted,fields);
      this.mark(trace,"key_to_picture",trace.started,fields);
      if (fields.sharp) this.end(trace,"sharp presented");
    }));
  }
});
