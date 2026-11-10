// The desktop shell sends one step per real startup event: a log line, where
// the bar should be now, and how far it may creep while that step runs.
(() => {
  const version = new URLSearchParams(location.search).get("version");
  document.querySelector(".version").textContent = version ? `Version ${version}` : "";
  const bar = document.querySelector(".bar");
  const fill = bar.querySelector("i");
  const log = document.querySelector(".log");
  const lines = document.querySelector(".lines");
  // Row height comes from the type tokens; it is measured from the first line.
  let row = 0;
  let shown = 0, target = 0, ceiling = 0;

  const frame = () => {
    // Catch up quickly to the reached step, then creep slowly towards the
    // step's limit without ever reaching it.
    if (shown < target) shown = Math.min(target, shown + (target - shown) * 0.2 + 0.002);
    else if (shown < ceiling) shown += (ceiling - shown) * 0.012;
    fill.style.width = `${shown * 100}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(shown * 100)));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.hdrSplash?.onStep(({ text, progress, until }) => {
    target = Math.max(target, progress);
    ceiling = Math.max(target, until ?? progress);
    const line = document.createElement("li");
    line.textContent = text;
    lines.append(line);
    requestAnimationFrame(() => line.classList.add("in"));
    if (!row) { row = line.offsetHeight; log.style.height = `${row * 4}px`; }
    const extra = lines.children.length - 4;
    if (extra > 0) {
      log.classList.add("full");
      lines.style.transform = `translateY(${-extra * row}px)`;
    }
  });
})();
