const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveInterpretation } = require("./helpers/resolve-interpretation.js");
const root = path.resolve("output/review/encoding-drift-avif-jxl");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    const base = new URL(page.url()).origin;
    const response = await page.request.post(`${base}/api/session`, { multipart: {
      file: { name: "floor.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(path.join(__dirname, "fixtures/hdr_match_scene.tiff")) },
    } });
    assert.ok(response.ok(), await response.text());
    await page.evaluate(session => activateDesktopSession(session, ""), (await response.json()).session);
    await resolveInterpretation(page);
    await page.locator('[data-workflow-tab="grade"]').click();
    await page.evaluate(() => {
      setGradeMode("global");
      document.querySelector('[data-group="hdr-highlights"]').classList.remove("collapsed");
    });
    await page.evaluate(() => switchLane("hdr"));
    const checks = [];
    const deliveries = [];
    for (const reference of [203, 100]) {
      assert.equal(await page.evaluate(value => queueEditCommand("set_hdr_reference_white", { hdr_reference_white_nits: value }), reference), true);
      for (const [width, height] of [[1408, 794], [1100, 720]]) {
        await page.setViewportSize({ width, height });
        const control = page.locator("#hdr-compression-target");
        await control.scrollIntoViewIfNeeded();
        assert.equal(await control.getAttribute("min"), "225");
        await control.focus();
        await control.press("Home");
        await control.press("Tab");
        assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 225);
        const output = page.locator('output[data-value-path="hdr.highlight_compression_target_nits"]');
        await output.dblclick();
        await output.fill("203");
        await output.press("Enter");
        assert.equal(await page.evaluate(() => state.adjustments.hdr.highlight_compression_target_nits), 225);
        const normalized = await page.evaluate(() => {
          state.adjustments.hdr.highlight_compression_target_nits = 100;
          state.adjustments.hdr.highlight_compression_start_nits = 400;
          syncControlsFromState();
          return { peak: state.adjustments.hdr.highlight_compression_target_nits,
            start: state.adjustments.hdr.highlight_compression_start_nits,
            first: document.querySelector('[data-group="hdr-highlights"] .control-row').dataset.controlPath,
            tooltip: document.querySelector('label[for="hdr-compression-target"]').dataset.tooltip,
            manualMinimum: MANUAL_VALUE_RULES["hdr.highlight_compression_target_nits"].min };
        });
        assert.equal(normalized.peak, 225);
        assert.equal(normalized.start, 224);
        assert.equal(normalized.first, "hdr.highlight_compression_target_nits");
        assert.equal(normalized.manualMinimum, 225);
        assert.match(normalized.tooltip, /HDR headroom/);
        checks.push({ reference, width, height, ...normalized });
        await page.screenshot({ path: path.join(root, `floor-${reference}-${width}.png`) });
      }
      await page.evaluate(async () => {
        state.adjustments.hdr.highlight_section_enabled = true;
        state.adjustments.hdr.highlight_compression_mode = "clip";
        state.adjustments.hdr.highlight_compression_start_nits = 90;
        state.adjustments.hdr.highlight_compression_target_nits = 225;
        markGlobalEditDirty();
        if (!await syncGlobalEditState()) throw Error("Peak floor did not settle");
      });
      const id = await page.evaluate(() => state.session.session_id);
      for (const forceCpu of [false, true]) {
        await page.request.post(`${base}/api/delivery/preferences`, { data: { force_cpu: forceCpu } });
        for (const [format, extension] of [["jpeg_ultrahdr", "jpg"], ["avif_gain_map", "avif"], ["jpegxl_hdr", "jxl"]]) {
          const destination = path.join(root, `minimum-${reference}-${forceCpu}.${extension}`);
          await global.HDRFinisherElectronTestHarness.selectExportPath(destination);
          const grant = await page.evaluate(suffix => window.hdrFinisherDesktop.chooseExportPath({ extension: suffix, suggestedName: `floor.${suffix}` }), extension);
          const settings = { format, quality: 95, dithering: "off", jpeg_gain_map_scale: "full",
            output_finishing: { resize_mode: "original", sharpening: "off" } };
          const response = await page.request.post(`${base}/api/session/${id}/export`, { data: {
            ...settings, output_path: destination, path_grant: grant.grant,
          }, timeout: 120000 });
          const exported = await response.json();
          assert.ok(exported.accepted, JSON.stringify(exported));
          assert.equal(exported.renderer, forceCpu ? "cpu" : "gpu");
          for (const fullSize of [true, false]) {
            const response = await page.request.post(`${base}/api/session/${id}/proof/artifact`, {
              data: { ...settings, full_size: fullSize, long_edge: 256 }, timeout: 120000,
            });
            const proof = await response.json();
            assert.ok(response.ok(), JSON.stringify(proof));
            assert.equal(proof.renderer, exported.renderer);
            const bytes = await page.request.get(`${base}/api/proof/artifact/${proof.artifact_id}.${extension}`);
            assert.ok(bytes.ok());
            if (fullSize) assert.ok(fs.readFileSync(destination).equals(await bytes.body()), "Full-size Proof equals export bytes");
          }
          deliveries.push({ reference, format, renderer: exported.renderer, fullProofEqual: true, reducedProof: true });
          fs.rmSync(destination, { force: true });
        }
      }
    }
    fs.writeFileSync(path.join(root, "minimum-delivery.json"), JSON.stringify(deliveries, null, 2));
    fs.writeFileSync(path.join(root, "ui.json"), JSON.stringify(checks, null, 2));
    console.log("Peak slider, typed entry, pasted-state normalization, both references/layouts and all-codec CPU/GPU export/Proof passed.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
