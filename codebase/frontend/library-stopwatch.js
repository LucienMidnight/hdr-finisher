/* Always-on stage records; only paths and timing/identity metadata leave the page. */
// Log labels only: never change transport/cache keys or rendering decisions.
window.HDRLibraryPictureLog = (meta = {}, fields = {}) => ({
  picture_size: meta.edge === 100000 ? "detail preview" : meta.edge <= 640 ? "thumbnail" : meta.edge ? "screen preview" : "thumbnail,screen preview,detail preview",
  view: meta.trace?.view || meta.log_view || "grid,filmstrip,single,fullscreen,compare",
  ...(meta.log_step ? {step:meta.log_step} : {}), ...fields
});
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
    fields = {...fields};
    if (stage.startsWith("picture_") || stage === "navigation") {
      if (fields.quick_draw && fields.sharp_draw) { fields.picture_size = "thumbnail,screen preview"; fields.step = "quick draw,sharp draw"; }
      else if (fields.quick_draw) fields.picture_size = "thumbnail";
      else if (fields.sharp_draw) fields.picture_size = "screen preview";
      fields.picture_size ||= "thumbnail,screen preview,detail preview";
      fields.view ||= "grid,filmstrip,single,fullscreen,compare";
      if (fields.quick_draw && fields.sharp_draw) fields.step = "quick draw,sharp draw";
      else if (fields.quick_draw) fields.step = "quick draw";
      else if (fields.sharp_draw) fields.step = "sharp draw";
      if (fields.key) {
        const scene = fields.key.startsWith("live-");
        fields[scene ? "scene_key" : "picture_key"] = scene ? fields.key.slice(5) : fields.key;
        delete fields.key;
      }
    }
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
    const trace = {request:crypto.randomUUID(),view,path,started,picture_size:view === "grid" || view === "filmstrip" ? "thumbnail" : "screen preview"};
    HDRLibraryStopwatch("navigation", {request:trace.request,view,path,picture_size:trace.picture_size});
    return trace;
  },
  mark(trace, stage, started, fields = {}) {
    if (!trace) return;
    HDRLibraryStopwatch(stage, {request:trace.request,view:trace.view,path:trace.path,picture_size:trace.picture_size,
      duration_ms:performance.now()-started,...fields});
  },
  end(trace,reason) {
    if (!trace || trace.ended) return;
    trace.ended = true;
    this.mark(trace,"picture_review_outcome",trace.started,{blank:!trace.presented,quick_draw:!!trace.standInPresented,sharp_draw:!!trace.sharpPresented,reason});
  },
  present(trace, current, fields = {}) {
    if (!trace) return;
    const submitted = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!current()) return;
      trace.presented = true;
      window.HDRLibraryFolderPresented?.(trace,fields);
      if (fields.quick_draw) trace.standInPresented = true;
      if (fields.sharp_draw) trace.sharpPresented = true;
      this.mark(trace,"picture_present",submitted,fields);
      this.mark(trace,"picture_navigation_to_present",trace.started,fields);
      if (fields.sharp_draw) this.end(trace,"sharp draw presented");
    }));
  }
});
