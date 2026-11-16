const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { resolveInterpretation } = require("../tests/helpers/resolve-interpretation.js");
const root = path.resolve("output/review/encoding-drift-avif-jxl");
const python = require("./lib/platform.cjs").pythonExecutable();
const env = { ...process.env, PYTHONPATH: path.resolve("backend") };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    const base = new URL(page.url()).origin;
    for (const photo of JSON.parse(fs.readFileSync(path.join(root, "photos.json")))) {
      const folder = path.join(root, photo.folder);
      const response = await page.request.post(`${base}/api/session`, { multipart: {
        file: { name: "highlight-crop.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(path.join(folder, "source.tiff")) },
      } });
      assert.ok(response.ok(), await response.text());
      await page.evaluate(session => activateDesktopSession(session, ""), (await response.json()).session);
      await resolveInterpretation(page, { primaries: "linear_acescg" });
      await page.evaluate(async () => {
        state.adjustments.hdr.highlight_section_enabled = true;
        state.adjustments.hdr.highlight_compression_mode = "fixed_cap";
        state.adjustments.hdr.highlight_compression_target_nits = 1000;
        state.adjustments.sdr.exposure = -.15;
        markGlobalEditDirty();
        if (!await syncGlobalEditState()) throw Error("Recipe did not settle");
      });
      const id = await page.evaluate(() => state.session.session_id);
      const edits = await page.request.get(`${base}/api/session/${id}/edit-state`);
      fs.writeFileSync(path.join(folder, "document.json"), JSON.stringify((await edits.json()).document));
      let renderer = page.context().pages().find(candidate => candidate.url().includes("gpu-delivery.html"));
      if (!renderer) {
        await page.request.post(`${base}/api/session/${id}/proof/artifact`, { data: { format: "jpeg_ultrahdr", quality: 95, full_size: true }, timeout: 120000 });
        renderer = page.context().pages().find(candidate => candidate.url().includes("gpu-delivery.html"));
      }
      assert.ok(renderer, "GPU delivery renderer is available");
      await renderer.waitForFunction(() => typeof HDRGpuDeliveryFinishing === "function");
      await renderer.evaluate(() => {
        window.__encodingCapture = [];
        window.__originalEncodingRead ||= HDRGpuDeliveryFinishing.prototype.read;
        HDRGpuDeliveryFinishing.prototype.read = async function(texture) {
          const pixels = await window.__originalEncodingRead.call(this, texture);
          window.__encodingCapture.push({ width: texture.width, height: texture.height, pixels: Array.from(pixels) });
          return pixels;
        };
      });
      const output = path.join(folder, "capture.jpg");
      await global.HDRFinisherElectronTestHarness.selectExportPath(output);
      const grant = await page.evaluate(() => window.hdrFinisherDesktop.chooseExportPath({ extension: "jpg", suggestedName: "capture.jpg" }));
      const exported = await page.request.post(`${base}/api/session/${id}/export`, { data: {
        format: "jpeg_ultrahdr", quality: 95, jpeg_chroma_subsampling: "444", jpeg_gain_map_quality: 95,
        jpeg_gain_map_scale: "full", dithering: "off", output_path: output, path_grant: grant.grant,
        output_finishing: { resize_mode: "original", sharpening: "off" },
      }, timeout: 120000 });
      const result = await exported.json();
      assert.ok(result.accepted, JSON.stringify(result));
      assert.equal(result.renderer, "gpu");
      const captured = await renderer.evaluate(() => window.__encodingCapture);
      assert.equal(captured.length, 2);
      fs.writeFileSync(path.join(folder, "finished.json"), JSON.stringify(captured));
      execFileSync(python, ["tools/encoding-drift.py", "capture", folder], { env, stdio: "inherit" });
      fs.rmSync(output, { force: true });
      console.log("Captured GPU/CPU finished lanes:", photo.name);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
