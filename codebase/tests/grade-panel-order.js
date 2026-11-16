const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { importTestPattern } = require("./helpers/import-test-pattern");

const output = path.resolve(__dirname, "../output/review/panel-order");
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const errors = [], results = { lanes: [], pixelChecks: [], displayTelemetry: "Synthetic 613-nit primary display for advisory/Undo verification" };
  try {
    const page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL);
    await importTestPattern(page);
    await page.waitForFunction(() => state.gpuPreview?.available && !state.importInProgress);
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [1408, 794]);
    const original = await page.evaluate(() => JSON.stringify(state.adjustments));
    const expected = ["highlights", "tone", "equalizer", "curves", "color", "hsl", "color-grading", "black-and-white", "detail", "film-look", "vignette"];
    const shared = new Set(["curves", "hsl", "color-grading", "black-and-white", "detail", "film-look", "vignette"]);
    for (const lane of ["hdr", "sdr", "hdr"]) {
      await page.evaluate(async lane => { await switchLane(lane); }, lane);
      const groups = await page.locator(`[data-lane-panel="${lane}"] > .control-group`).evaluateAll(elements => elements.map(element => element.dataset.group));
      assert.deepEqual(groups, expected.map(name => shared.has(name) ? name : `${lane}-${name}`));
      assert.equal(await page.locator(`[data-lane-panel="${lane === "hdr" ? "sdr" : "hdr"}"]`).isVisible(), false);
      const top = await page.evaluate(() => [...document.querySelectorAll('#control-mode-global > [data-group], #control-mode-global > #raw-settings-section')].map(element => element.dataset.group || element.id));
      assert.deepEqual(top, ["raw-settings-section", "raw-highlights", "denoise", "geometry", "perspective"]);
      results.lanes.push({ lane, groups, top });
    }
    assert.equal(await page.evaluate(() => JSON.stringify(state.adjustments)), original, "Lane switching must not edit the grade");

    for (const lane of ["hdr", "sdr"]) {
      await page.evaluate(async lane => { await switchLane(lane); collapseGradeModules(); }, lane);
      await page.evaluate(() => { document.querySelector(".grade-rail").scrollTop = 0; });
      if (lane === "sdr") await page.locator('[data-group="vignette"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${lane}-panel.png`), scale: "css" });
      const section = page.locator(`[data-group="${lane}-highlights"]`);
      await section.locator(".group-toggle").click();
      if (await section.locator(".section-bypass").getAttribute("aria-pressed") !== "true") await section.locator(".section-bypass").click();
      const first = await section.locator(".control-group-body > :first-child").evaluate(element => ({ path: element.dataset.controlPath, adjustable: Boolean(element.querySelector("input,select,button")), text: element.textContent }));
      if (lane === "hdr") assert.equal(first.path, "hdr.highlight_compression_target_nits");
      else { assert.equal(first.adjustable, false); assert.match(first.text, /100%/); }
      const savedMode = await page.locator(`#${lane}-compression-mode`).inputValue();
      for (const mode of ["peak_fit", "fixed_cap", "soft_ceiling", "clip"]) {
        await page.locator(`#${lane}-compression-mode`).selectOption(mode);
        assert.equal(await page.locator(`#${lane}-compression-start`).isVisible(), mode !== "clip");
        assert.equal(await page.locator(`#${lane}-compression-softness`).isVisible(), mode === "soft_ceiling");
        assert.equal(await page.locator(`#${lane}-compression-detail`).isVisible(), mode === "peak_fit");
        assert.equal(await page.locator(`#${lane}-compression-color`).isVisible(), mode === "peak_fit");
        if (lane === "hdr") assert.equal(await page.locator("#hdr-compression-target").isVisible(), true);
      }
      await page.locator(`#${lane}-compression-mode`).selectOption(savedMode);
      await section.locator(".group-preset").click();
      assert.equal(await page.evaluate(() => state.groupPresetContext.groupId), `${lane}-highlights`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => { document.querySelector(".grade-rail").scrollTop = 0; });
      await page.screenshot({ path: path.join(output, `${lane}-highlight-controls.png`), scale: "css" });
      await page.evaluate(() => document.querySelector('[data-group="curves"] .group-toggle').click());
      assert.equal(await page.evaluate(() => groupPresetContextForElement(document.querySelector('[data-group="curves"]')).groupId), `${lane}-curves`);
      await page.evaluate(async lane => { await switchLane(lane === "hdr" ? "sdr" : "hdr"); await switchLane(lane); }, lane);
      assert.equal(await page.locator('[data-group="curves"]').evaluate(element => element.classList.contains("collapsed")), false);
      await section.locator(".group-toggle").click();
      assert.equal(await section.locator(".group-toggle").getAttribute("aria-expanded"), "false");
      assert.equal(await page.locator(`#${lane}-compression-mode`).isVisible(), false);
      const comparison = await page.evaluate(async lane => {
        const panel = document.querySelector(`[data-lane-panel="${lane}"]`);
        const read = async () => {
          state.previewScheduler?.cancel();
          while (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => null);
          await syncGlobalEditState();
          if (!await renderGpuDraft(lane, { longEdge: 512 })) throw Error(`GPU render failed: ${JSON.stringify(state.lastGpuDraftRefusal)}`);
          const analysis = await state.gpuPreview.analyzeScope(els.previewCanvas, { width: 128, height: 64, tier: "picture", raw: true });
          if (!analysis?.halves) throw Error("No finished GPU picture readback");
          const hash = await crypto.subtle.digest("SHA-256", new Uint16Array(analysis.halves).buffer);
          return { hash: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join(""), width: 128, height: 64 };
        };
        const before = await read();
        for (const name of [`${lane}-tone`, `${lane}-equalizer`, "hsl", "curves", `${lane}-highlights`, `${lane}-color`, "color-grading", "black-and-white", "detail", "film-look", "vignette"]) panel.append(document.querySelector(`[data-group="${name}"]`));
        const oldOrder = await read();
        arrangeLaneControlGroups(lane);
        return { lane, before, oldOrder, after: await read() };
      }, lane);
      assert.deepEqual(comparison.before, comparison.oldOrder, "Old/new panel order must render identical sampled pixels");
      assert.deepEqual(comparison.before, comparison.after);
      results.pixelChecks.push(comparison);
    }

    await page.evaluate(async () => { await switchLane("hdr"); collapseGradeModules(); });
    const highlight = page.locator('[data-group="hdr-highlights"]');
    await highlight.locator(".group-toggle").click();
    const baseline = await page.evaluate(async () => { await syncGlobalEditState(); return JSON.stringify(state.adjustments); });
    await page.evaluate(() => { state.displayTelemetry = { displays: [{ primary: true, max_luminance_nits: 613 }] }; renderHighlightDisplayNote(); });
    assert.equal(await page.evaluate(() => JSON.stringify(state.adjustments)), baseline, "Telemetry is not an edit");
    assert.equal(await page.locator("#hdr-compression-display-note").isVisible(), true);
    await page.evaluate(() => { document.querySelector(".grade-rail").scrollTop = 0; });
    await page.screenshot({ path: path.join(output, "display-note.png"), scale: "css" });
    await page.locator("#hdr-compression-use-display").click();
    await page.evaluate(async () => { await syncGlobalEditState(); });
    assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 625);
    assert.equal(await highlight.locator(".group-reset").isVisible(), true);
    await page.evaluate(async () => { await queueEditCommand("undo"); });
    assert.equal(await page.evaluate(() => JSON.stringify(state.adjustments)), baseline, "One Undo restores the full prior grade");
    await page.evaluate(async () => { await queueEditCommand("redo"); });
    assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 625);
    await highlight.locator(".group-reset").click();
    await page.evaluate(async () => { await syncGlobalEditState(); });
    assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 1000);
    await page.evaluate(async () => { await queueEditCommand("undo"); });
    assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 625);
    await page.evaluate(async () => { await queueEditCommand("undo"); });
    for (const displays of [[{ max_luminance_nits: 1000 }], []]) {
      await page.evaluate(displays => { state.displayTelemetry = { displays }; renderHighlightDisplayNote(); }, displays);
      assert.equal(await page.locator("#hdr-compression-display-note").isVisible(), false);
    }
    await page.locator("#hdr-compression-target").focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.id), "hdr-compression-mode");
    await highlight.locator(".section-bypass").click();
    const enabled = await page.evaluate(() => state.adjustments.hdr.highlight_section_enabled);
    await page.evaluate(async () => { await switchLane("sdr"); await switchLane("hdr"); });
    assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_section_enabled), enabled);
    await highlight.locator(".section-bypass").click();
    const sticky = await page.evaluate(() => {
      document.querySelector('[data-group="vignette"]').scrollIntoView();
      const header = document.querySelector(".grade-header").getBoundingClientRect(), tabs = document.querySelector(".grade-folder-tabs").getBoundingClientRect();
      return { contained: header.top >= 0 && tabs.bottom <= innerHeight, header: getComputedStyle(document.querySelector(".grade-header")).position, tabs: getComputedStyle(document.querySelector(".grade-folder-tabs")).position };
    });
    assert.deepEqual(sticky, { contained: true, header: "sticky", tabs: "sticky" });
    assert.deepEqual(errors, []);
    results.status = "passed";
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log("Grade panel order, both lanes, mode visibility, folding, presets, bypass, focus, sticky chrome, advisory, Undo/Redo and exact sampled GPU pixels passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
