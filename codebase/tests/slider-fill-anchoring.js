/**
 * Every rendered slider's fill runs between its home and its thumb.
 *
 *   node tests/run-in-electron.js tests/slider-fill-anchoring.js
 *
 * Preview Responsiveness Tuning Sprint P1. The fill of a two-sided slider has
 * to start at the slider's home (0 EV for an Exposure Band) and end at the
 * thumb, on the thumb's side. The fill is sized from `--fill-w` and placed from
 * `--fill-start`; a container whose CSS ignores `--fill-start` draws the right
 * width from the left edge, which is the bug the owner saw on the Selected band
 * rail. So the check is geometric, in pixels, for every range input the HDR
 * and SDR panels render, with each control's value set below, at and above its
 * home.
 *
 * The home edge must sit within 1.5 px of the home position (the rail's 1 px
 * cap inset plus rounding). The thumb edge is compared with the native thumb's
 * centre, which travels over the rail minus one thumb width, so it is allowed
 * half a thumb plus 1 px: the fill must end under the thumb, not merely near it.
 */
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

async function measureLane(page, lane) {
  return page.evaluate(async (laneName) => {
    if (typeof switchLane === "function" && state.activeLane !== laneName) await switchLane(laneName);
    const panel = document.querySelector(`[data-lane-panel="${laneName}"]`);
    panel.querySelectorAll(".control-group.collapsed .group-toggle").forEach((toggle) => toggle.click());
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const results = [];
    const skipped = [];
    for (const control of panel.querySelectorAll('input[type="range"]')) {
      const name = control.id || control.dataset.path || control.dataset.localGrade || control.getAttribute("aria-label") || "unnamed";
      const shell = control.closest(".range-shell");
      const fill = shell?.querySelector(".slider-fill");
      const shellBox = shell?.getBoundingClientRect();
      if (!shell || !fill || !shellBox || shellBox.width < 20 || control.offsetParent === null) {
        skipped.push(name);
        continue;
      }
      const minimum = Number(control.min);
      const maximum = Number(control.max);
      if (!(maximum > minimum)) { skipped.push(name); continue; }
      const home = rangeControlHome(control, minimum, maximum);
      const bipolar = minimum < 0 && maximum > 0;
      const origin = bipolar ? home : minimum;
      const thumbWidth = parseFloat(getComputedStyle(shell).getPropertyValue("--instrument-slider-thumb-w")) || 9;
      const original = control.value;
      const span = maximum - minimum;
      const samples = bipolar
        ? [minimum + (home - minimum) * 0.3, home, home + (maximum - home) * 0.7]
        : [minimum + span * 0.3, minimum + span * 0.7];
      for (const requested of samples) {
        control.value = String(requested);
        updateRangeVisual(control);
        const value = Number(control.value);
        const fraction = (value - minimum) / span;
        const originFraction = (origin - minimum) / span;
        const width = shellBox.width;
        const originX = shellBox.left + originFraction * width;
        const thumbX = shellBox.left + thumbWidth / 2 + fraction * (width - thumbWidth);
        const box = fill.getBoundingClientRect();
        const thumbOnRight = value >= origin;
        const homeEdge = thumbOnRight ? box.left : box.right;
        const thumbEdge = thumbOnRight ? box.right : box.left;
        const homeError = Math.abs(homeEdge - originX);
        const thumbError = Math.abs(thumbEdge - thumbX);
        const atHome = Math.abs(value - origin) < 1e-9;
        const pass = homeError <= 1.5 && (atHome ? box.width <= 1.5 : thumbError <= thumbWidth / 2 + 1);
        results.push({
          lane: laneName, name, value, origin,
          fill: [Math.round(box.left - shellBox.left), Math.round(box.right - shellBox.left)],
          expected: [Math.round(Math.min(originX, thumbX) - shellBox.left), Math.round(Math.max(originX, thumbX) - shellBox.left)],
          homeError: Number(homeError.toFixed(2)),
          thumbError: Number(thumbError.toFixed(2)),
          pass,
        });
      }
      control.value = original;
      updateRangeVisual(control);
    }
    return { results, skipped };
  }, lane);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");

    const hdr = await measureLane(page, "hdr");
    const sdr = await measureLane(page, "sdr");
    const results = [...hdr.results, ...sdr.results];
    const failures = results.filter((row) => !row.pass);
    const checked = new Set(results.map((row) => `${row.lane}:${row.name}`));
    for (const required of ["hdr:tone-equalizer-band-value", "sdr:sdr-tone-equalizer-band-value"]) {
      if (!checked.has(required)) failures.push({ missing: required });
    }
    console.log(JSON.stringify({
      controls: checked.size,
      samples: results.length,
      skipped: [...hdr.skipped, ...sdr.skipped].length,
      failures,
    }, null, 2));
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    if (failures.length) {
      throw new Error(`${failures.length} slider fill sample(s) do not run between home and the thumb.`);
    }
    console.log("Slider fill anchoring test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
