const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

const desktop = path.resolve(__dirname, "../desktop");
const review = path.resolve(__dirname, "../output/review/scopes-readout");
const themes = ["modern-dark", "default-light", "studio-gray"];

async function inspect(page, mode) {
  const panel = await page.evaluate(() => {
    const canvas = els.histogram;
    const ctx = canvas.getContext("2d");
    // Record the rendered frame, not just the outer canvas' position.
    const strokeRect = ctx.strokeRect, arc = ctx.arc;
    let edge;
    ctx.strokeRect = function (x, ...args) { edge = x; return strokeRect.call(this, x, ...args); };
    ctx.arc = function (x, y, radius, ...args) { edge = x - radius; return arc.call(this, x, y, radius, ...args); };
    try { drawHistogram(state.lastScope); }
    finally { delete ctx.strokeRect; delete ctx.arc; }

    const readings = document.querySelector(".scope-readings");
    const bounds = readings.getBoundingClientRect();
    const title = document.querySelector(".dock-panel-title").getBoundingClientRect();
    const rows = [...els.scopeStats.querySelectorAll("dt")].map(term => {
      const value = term.nextElementSibling;
      const textRects = [term, value].map(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()];
      });
      const [[labelBox], [valueBox]] = textRects;
      return {
        label: term.textContent, value: value.textContent,
        tooltip: term.dataset.tooltip && term.dataset.tooltip === value.dataset.tooltip,
        fits: textRects.every(rects => rects.length === 1)
          && labelBox.right <= valueBox.left && labelBox.left >= bounds.left
          && valueBox.right <= bounds.right && valueBox.bottom <= bounds.bottom
          && Math.abs(labelBox.top - valueBox.top) <= 1,
      };
    });
    return {
      rows,
      xDelta: canvas.getBoundingClientRect().left + edge - title.left,
      scrolls: readings.scrollHeight > readings.clientHeight || readings.scrollWidth > readings.clientWidth,
      dockHeight: els.analysisDock.getBoundingClientRect().height,
      minHeight: LAYOUT_LIMITS.dockH[0],
      width: innerWidth,
      lane: state.lastScope.preview_kind,
    };
  });
  const context = `${panel.lane} ${mode} at ${panel.width}px`;
  assert.ok(Math.abs(panel.xDelta) <= 1, `${context}: plot offset ${panel.xDelta}px`);
  assert.ok(!panel.scrolls, `${context}: the readout overflows`);
  assert.ok(Math.abs(panel.dockHeight - panel.minHeight) <= 1, `${context}: dock not at minimum height`);
  assert.match(panel.rows[0].label, /^Peak \((preview|estimate)\)$/);
  assert.deepEqual(panel.rows.slice(1, 3).map(row => row.label), ["Brightest 1%", "Median brightness"]);
  if (panel.lane === "hdr") {
    assert.equal(panel.rows[3].label, "Above reference white");
    assert.match(panel.rows[4].label, /^% > \d+(?:\.\d+)? nit$/);
  }
  assert.equal(panel.rows.length, panel.lane === "hdr" ? 5 : 3);
  for (const row of panel.rows) {
    assert.ok(row.fits && row.tooltip && row.value, `${context}: ${JSON.stringify(row)}`);
  }
}

function waitForScope(page, lane, threshold = null) {
  return page.waitForFunction(({ lane, threshold }) => (
    state.lastScope?.preview_kind === lane && ["settled", "refinement"].includes(state.lastScope.tier)
    && !els.scopeFreshness.classList.contains("updating")
    && (!threshold || state.lastScope.stats.at(-1)?.label === `% > ${threshold} nit`)
  ), { lane, threshold }, { timeout: 30000 });
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-scopes-test-"));
  const capture = process.argv.includes("--capture");
  let app;
  let passed = false;
  try {
    app = await _electron.launch({
      executablePath: require(path.join(desktop, "node_modules/electron")),
      args: [desktop], cwd: desktop, env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.waitForFunction(() => document.body.dataset.ready === "true");
    await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "hdr_headroom.tiff"));
    await page.waitForFunction(() => state.session && !state.importInProgress
      && document.body.dataset.workflow === "grade");
    await page.waitForFunction(() => state.displayTelemetry !== null);
    await waitForScope(page, "hdr");
    const window = await app.browserWindow(page);
    const normal = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.evaluate(() => {
      state.layout.dockH = LAYOUT_LIMITS.dockH[0];
      document.documentElement.style.setProperty("--dock-h", `${state.layout.dockH}px`);
    });
    const live = await page.evaluate(() => ({
      display: state.desktopEnvironment.currentDisplay,
      telemetry: state.displayTelemetry.displays,
    }));
    const actualReadings = [];
    if (process.platform === "win32") {
      const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({
        id: String(d.id), workArea: d.workArea, rect: screen.dipToScreenRect(null, d.bounds),
      })));
      for (const display of displays) {
        const matches = live.telemetry.filter((d) => d.physical_bounds
          && ["x", "y", "width", "height"].every(key => display.rect[key] === d.physical_bounds[key]));
        if (matches.length !== 1 || !matches[0].max_luminance_nits) continue;
        const { name, max_luminance_nits: peak } = matches[0];
        await window.evaluate((win, area) => {
          if (win.isMaximized()) win.unmaximize();
          win.setBounds({ x: area.x, y: area.y, width: Math.min(1300, area.width), height: Math.min(850, area.height) });
        }, display.workArea);
        await page.waitForFunction(id => state.desktopEnvironment.currentDisplay.id === id, display.id);
        try { await waitForScope(page, "hdr", peak); }
        catch (error) {
          const seen = await page.evaluate(() => ({
            currentDisplay: state.desktopEnvironment.currentDisplay,
            peak: scopeDisplayPeakNits(), stats: state.lastScope?.stats, tier: state.lastScope?.tier,
            hidden: document.hidden, freshness: els.scopeFreshness.textContent,
          }));
          throw new Error(`Expected ${name} at ${peak} nits, saw ${JSON.stringify(seen)}`, { cause: error });
        }
        assert.equal(await page.locator("#scope-stats dt").last().textContent(), `% > ${peak} nit`);
        actualReadings.push({ name, peak });
      }
      // Return the isolated test window to its starting monitor for captures.
      const start = displays.find(display => display.id === live.display.id);
      if (start) {
        await window.evaluate((win, { area, normal }) => {
          win.setPosition(area.x, area.y);
          win.setContentSize(normal.width, normal.height);
        }, { area: start.workArea, normal });
        await page.waitForFunction(id => state.desktopEnvironment.currentDisplay.id === id, start.id);
        await waitForScope(page, "hdr", actualReadings.find(reading => reading.name === live.display.label)?.peak);
      }
    }
    await page.evaluate(async () => {
      const reported = state.displayTelemetry;
      state.displayTelemetry = { displays: [] };
      try {
        const applied = await refreshScopes(scopeLongEdge("settled"));
        if (!applied || state.lastScope.stats.at(-1)?.label !== "% > 1000 nit") {
          throw new Error("Scopes did not use the missing-telemetry fallback");
        }
      } finally {
        state.displayTelemetry = reported;
      }
    });
    await page.evaluate(() => refreshScopes(scopeLongEdge("settled")));
    await waitForScope(page, "hdr");
    if (capture) fs.mkdirSync(review, { recursive: true });

    for (const width of [...new Set([normal.width, 1100])]) {
      if (width !== normal.width) {
        await window.evaluate((win, size) => {
          if (win.isMaximized()) win.unmaximize();
          win.setContentSize(size.width, size.height);
        }, { width, height: normal.height });
      }
      await page.waitForFunction(width => innerWidth === width, width);
      for (const lane of ["hdr", "sdr"]) {
        await page.evaluate(lane => switchLane(lane), lane);
        await page.locator("#scope-mode").selectOption("histogram");
        await waitForScope(page, lane);
        for (const theme of themes) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await inspect(page, "histogram");
          if (capture && width === 1100) {
            await page.locator("#analysis-dock").screenshot({ path: path.join(review, `${theme}-${lane}.png`) });
          }
        }
        if (width === 1100) {
          for (const mode of ["waveform", "vectorscope"]) {
            await page.locator("#scope-mode").selectOption(mode);
            await page.waitForFunction(mode => state.lastScope?.scope_type?.endsWith(mode), mode);
            await waitForScope(page, lane);
            await inspect(page, mode);
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ live, actualReadings, normalWidth: normal.width, minimumWidth: 1100, themes }));
    console.log("PASS: Scopes readout, native display changes, fallback and plot alignment");
    passed = true;
  } finally {
    await app?.close();
    if (passed) fs.rmSync(profile, { recursive: true, force: true });
    else console.error(`Preserved failed Scopes test profile: ${profile}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
