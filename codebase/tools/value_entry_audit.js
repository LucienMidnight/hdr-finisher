/**
 * Inventory every numeric readout in the app and try typing into each one.
 *
 *   node tests/run-in-electron.js tools/value_entry_audit.js [output.json]
 *
 * For each readout it records whether it accepts a typed value, the range a
 * typed value is held to, the range of the slider beside it, and what happens
 * when a value above, below and inside the range is typed. Nothing is judged
 * here: the JSON is the evidence behind docs/technical/editable-values.md.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { encodeTiff } = require("../tests/large-noisy-tiff.js");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const outputPath = process.argv.find((argument) => argument.endsWith(".json"))
  || path.join(os.tmpdir(), "hdr-finisher-value-entry-audit.json");

function source() {
  const target = path.join(os.tmpdir(), "hdr-finisher-audit-640x480.tiff");
  if (!fs.existsSync(target)) {
    const pixels = Buffer.alloc(640 * 480 * 3);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = 40 + (index * 7) % 160;
    fs.writeFileSync(target, encodeTiff(pixels, 640, 480));
  }
  return target;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const apiFailures = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      apiFailures.push({ status: response.status(), url: response.url().replace(/^.*\/api\//, "/api/"), at: Date.now() });
    }
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source());
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === "ready", null, { timeout: 120000 });
    await page.evaluate(() => activateWorkflowTab("grade", { focus: false }));

    // A local adjustment has to exist for its controls to be on the page.
    await page.evaluate(() => {
      document.querySelector("#grade-mode-local")?.click();
      document.querySelector('[data-local-tool="linear_gradient"]')?.click();
      document.querySelector("#local-add-adjustment")?.click();
    });
    await page.waitForTimeout(1500);

    const result = { lanes: {}, apiFailures, pageErrors };
    for (const lane of ["hdr", "sdr"]) {
      await page.evaluate((name) => switchLane(name), lane);
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
      await page.waitForTimeout(400);

      const inventory = await page.evaluate(() => {
        const labelFor = (element) => {
          const row = element.closest(".control-row, label, .control-heading, .local-control, .control-pair > *");
          const text = row?.querySelector("label")?.textContent || element.closest("label")?.textContent
            || element.getAttribute("aria-label") || "";
          return text.replace(/\s+/g, " ").trim().slice(0, 60);
        };
        const groupFor = (element) => {
          const group = element.closest(".control-group, .overlay-popover, .workflow-side-panel, .export-sheet, dialog, section");
          return (group?.dataset?.group || group?.id || group?.className || "").toString().split(" ")[0];
        };
        const shown = (element) => Boolean(element.offsetParent);
        const sliderFacts = (control) => control ? {
          min: Number(control.min), max: Number(control.max),
          step: Number(control.dataset.instrumentStep || control.step), disabled: control.disabled,
          id: control.id || null,
        } : null;
        const rows = [];
        const seen = new Set();
        document.querySelectorAll("output, .editable-value").forEach((output) => {
          if (seen.has(output)) return;
          seen.add(output);
          const valuePath = output.dataset.valuePath || null;
          const resolved = valuePath ? resolveAdjustmentPath(valuePath) : null;
          const rule = valuePath ? (MANUAL_VALUE_RULES[valuePath] || MANUAL_VALUE_RULES[resolved] || null) : null;
          const row = output.closest(".control-row") || output.parentElement?.parentElement;
          const slider = (valuePath && document.querySelector(`input[type="range"][data-path="${valuePath}"]`))
            || row?.querySelector('input[type="range"]') || null;
          output.dataset.auditIndex = String(rows.length);
          rows.push({
            kind: "readout", auditIndex: rows.length, id: output.id || null, valuePath, resolved, label: labelFor(output), group: groupFor(output),
            text: output.textContent.trim(), editable: output.classList.contains("editable-value"),
            title: output.title || null, visible: shown(output), rule, slider: sliderFacts(slider),
          });
        });
        document.querySelectorAll('input[type="number"], input[type="text"]').forEach((input) => {
          rows.push({
            kind: "field", id: input.id || null, label: labelFor(input), group: groupFor(input), value: input.value,
            min: input.min || null, max: input.max || null, step: input.step || null, visible: shown(input),
            disabled: input.disabled, type: input.type,
          });
        });
        return rows;
      });

      // Type into every readout that accepts it.
      for (const row of inventory) {
        if (row.kind !== "readout" || !row.editable) continue;
        const selector = `[data-audit-index="${row.auditIndex}"]`;
        const probes = [];
        if (row.rule) {
          const { min, max, decimals, entryScale = 1 } = row.rule;
          const inside = min + (max - min) * 0.3137;
          probes.push(["above", (max + Math.abs(max) + 12345) * entryScale], ["below", (min - Math.abs(min) - 12345) * entryScale],
            ["inside", Number((inside * entryScale).toFixed(4))], ["letters", "abc"]);
          if (row.slider && Number.isFinite(row.slider.max)) probes.push(["slider-max", row.slider.max * entryScale]);
          row.insideExpected = Math.round(inside * 10 ** decimals) / 10 ** decimals;
        } else probes.push(["above", 99999], ["below", -99999], ["inside", 0.37]);
        row.probes = {};
        const failuresBefore = apiFailures.length;
        for (const [name, typed] of probes) {
          row.probes[name] = await page.evaluate(([target, text]) => {
            const output = document.querySelector(target);
            if (!output) return { began: false, gone: true };
            const before = output.textContent.trim();
            output.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
            const began = output.dataset.editing === "true";
            if (!began) return { began, before };
            const seed = output.textContent;
            output.textContent = String(text);
            output.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
            updateControlReadouts();
            const valuePath = output.dataset.valuePath;
            const slider = (valuePath && document.querySelector(`input[type="range"][data-path="${valuePath}"]`))
              || output.closest(".control-row")?.querySelector('input[type="range"]') || null;
            return {
              began, before, seed, typed: String(text), after: output.textContent.trim(),
              stored: valuePath ? getValueByPath(state.adjustments, valuePath) : null,
              slider: slider ? Number(slider.value) : null,
              overflow: slider ? slider.closest(".range-shell")?.classList.contains("manual-overflow") : null,
            };
          }, [selector, typed]);
          await page.waitForTimeout(30);
        }
        // Let the typed values reach the backend, so a value it rejects shows up here.
        await page.evaluate(() => syncGlobalEditState?.()).catch(() => null);
        await page.waitForTimeout(120);
        row.apiFailures = apiFailures.slice(failuresBefore).map((failure) => `${failure.status} ${failure.url}`);
        // Put the control back so the next one starts from a sane picture.
        if (row.valuePath) {
          await page.evaluate((valuePath) => {
            const resolved = resolveAdjustmentPath(valuePath);
            setValueByPath(state.adjustments, resolved, getValueByPath(defaultAdjustments(), resolved));
            syncControlsFromState?.();
            updateControlReadouts();
          }, row.valuePath);
        }
      }
      await page.evaluate(() => syncGlobalEditState?.()).catch(() => null);

      // Do values typed beyond the slider survive a save and a lane round trip?
      const beyond = inventory.filter((row) => row.kind === "readout" && row.editable && row.rule && row.slider
        && row.resolved?.startsWith(`${lane}.`) && row.rule.max > row.slider.max + 1e-9);
      const typedBeyond = {};
      for (const row of beyond) {
        typedBeyond[row.resolved] = await page.evaluate(([valuePath, scale, max]) => {
          const output = document.querySelector(`[data-value-path="${valuePath}"]`);
          output.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
          if (output.dataset.editing !== "true") return null;
          output.textContent = String(max * scale);
          output.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
          return getValueByPath(state.adjustments, valuePath);
        }, [row.valuePath, row.rule.entryScale || 1, row.rule.max]);
      }
      await page.evaluate(() => syncGlobalEditState?.()).catch(() => null);
      await page.waitForTimeout(300);
      const other = lane === "hdr" ? "sdr" : "hdr";
      await page.evaluate((name) => switchLane(name), other);
      await page.waitForTimeout(600);
      await page.evaluate((name) => switchLane(name), lane);
      await page.waitForTimeout(600);
      result.beyondSlider = result.beyondSlider || {};
      result.beyondSlider[lane] = await page.evaluate((typed) => Object.fromEntries(Object.entries(typed).map(([resolved, value]) => [
        resolved, { typed: value, kept: getValueByPath(state.adjustments, resolved),
          shown: document.querySelector(`[data-value-path="${resolved}"], [data-value-path="current.${resolved.split(".").slice(1).join(".")}"]`)?.textContent.trim() },
      ])), typedBeyond);
      await page.evaluate((name) => queueEditCommand("revert_rendition", { lane: name }), lane).catch(() => null);
      await page.waitForTimeout(500);
      result.lanes[lane] = inventory;
    }
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 1));
    console.log(`Value entry audit written to ${outputPath}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
