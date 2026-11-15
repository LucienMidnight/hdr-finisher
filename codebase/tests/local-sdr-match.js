const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { resolveInterpretation } = require("./helpers/resolve-interpretation.js");

const output = path.resolve("output/review/n4-local-match");
const headroom = process.argv.includes("--headroom");
const baseline = process.argv.includes("--baseline");

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "n4-local-delivery-"));
  const fixture = path.join(scratch, "source.tiff");
  execFileSync(require("../tools/lib/platform.cjs").pythonExecutable(),
    [path.join(__dirname, "helpers/gpu_delivery_fixture.py"), "make", fixture],
    { env: { ...process.env, PYTHONPATH: path.resolve("backend") } });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1408, height: 794 } });
    await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
    await page.waitForFunction(() => state.gpuPreview?.available);
    const base = new URL(page.url()).origin;
    const response = await page.request.post(`${base}/api/session`, { multipart: {
      file: { name: "local-match.tiff", mimeType: "image/tiff",
        buffer: fs.readFileSync(headroom ? path.join(__dirname, "fixtures/hdr_match_scene.tiff") : fixture) },
    } });
    assert.ok(response.ok(), await response.text());
    await page.evaluate(session => activateDesktopSession(session, ""), (await response.json()).session);
    await resolveInterpretation(page);
    await page.evaluate(async () => {
      state.adjustments.sdr.exposure = -.15;
      state.adjustments.hdr.highlight_section_enabled = true;
      state.adjustments.hdr.highlight_compression_mode = "fixed_cap";
      markGlobalEditDirty();
      const ready = await syncGlobalEditState();
      if (!ready) throw Error("Global grade did not settle");
      const parent = newLocalAdjustment("linear_gradient");
      parent.name = "Window light";
      parent.hdr_grade.exposure = .05;
      const child = newMaskExpression("linear_gradient");
      parent.mask = { id: crypto.randomUUID(), operator: "union", children: [parent.mask, child], inverted: false };
      if (!await queueEditCommand("create_local", { local: parent })) throw Error("Could not create parent");
      state.selectedLocalId = parent.id;
      state.selectedSubMaskId = parent.mask.id;
      setGradeMode("local");
      await switchLane("sdr");
      renderLocalAdjustments();
    });
    await page.waitForFunction(() => state.acceptedPresentation?.exact
      && state.acceptedPresentation.lane === "sdr"
      && state.acceptedPresentation.generation === state.previewGeneration.sdr);
    const documentState = async () => {
      const sessionId = await page.evaluate(() => state.session.session_id);
      const reply = await page.request.get(`${base}/api/session/${sessionId}/edit-state`);
      assert.ok(reply.ok());
      return (await reply.json()).document;
    };
    const before = await documentState();
    assert.equal(before.global_adjustments.sdr.exposure, -.15);
    const button = page.locator("#local-sdr-match");
    const actions = page.locator("#local-sdr-match-actions");
    await actions.scrollIntoViewIfNeeded();
    assert.match(await button.getAttribute("aria-label"), /Window light/);
    const matching = page.waitForResponse(reply => reply.request().method() === "POST"
      && /\/local\/[^/]+\/sdr-match$/.test(new URL(reply.url()).pathname));
    await button.click();
    const matchedResponse = await matching;
    const result = await matchedResponse.json();
    assert.ok(matchedResponse.ok(), JSON.stringify(result));
    assert.equal(result.changed, true, JSON.stringify(result));
    await page.waitForFunction(() => !state.localSdrMatchBusy && selectedLocal()?.sdr_match);
    const matched = result.document;
    assert.deepEqual(matched.global_adjustments, before.global_adjustments);
    const withoutSdr = local => { const copy = structuredClone(local); delete copy.sdr_grade; delete copy.sdr_match; return copy; };
    assert.deepEqual(withoutSdr(matched.local_adjustments[0]), withoutSdr(before.local_adjustments[0]));
    for (const [width, height] of headroom ? [] : [[1408, 794], [1100, 720]]) {
      await browser.newPage({ viewport: { width, height } });
      await actions.scrollIntoViewIfNeeded();
      const box = await actions.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height);
      await page.screenshot({ path: path.join(output, `matched-${width}x${height}.png`) });
    }
    if (baseline) {
      assert.equal(await page.evaluate(() => {
        const local = selectedLocal();
        local.sdr_grade = defaultLocalGrade("sdr");
        return commitSelectedLocal();
      }), true);
    }
    const sessionId = await page.evaluate(() => state.session.session_id);
    const post = async (route, data) => {
      const reply = await page.request.post(`${base}${route}`, { data, timeout: 120000 });
      assert.ok(reply.ok(), await reply.text());
      return reply.json();
    };
    const deliverySettings = { format: "jpeg_ultrahdr", quality: 95, jpeg_chroma_subsampling: "444",
      jpeg_gain_map_quality: 95, jpeg_gain_map_scale: "full", dithering: "off", guarantee_hdr_peak: true,
      output_finishing: { resize_mode: "original", sharpening: "off" } };
    for (const forceCpu of [false, true]) {
      await post("/api/delivery/preferences", { force_cpu: forceCpu });
      const file = path.join(scratch, forceCpu ? "cpu.jpg" : "gpu.jpg");
      await global.HDRFinisherElectronTestHarness.selectExportPath(file);
      const grant = await page.evaluate(() => window.hdrFinisherDesktop.chooseExportPath({ extension: "jpg", suggestedName: "local-match.jpg" }));
      const exported = await post(`/api/session/${sessionId}/export`, { ...deliverySettings, output_path: file, path_grant: grant.grant });
      assert.equal(exported.accepted, true, JSON.stringify(exported));
      assert.equal(exported.renderer, forceCpu ? "cpu" : "gpu");
      const proof = await post(`/api/session/${sessionId}/proof/artifact`, { ...deliverySettings, full_size: true });
      assert.equal(proof.renderer, exported.renderer);
      const bytes = await page.request.get(`${base}/api/proof/artifact/${proof.artifact_id}.jpg`);
      assert.ok(bytes.ok());
      assert.ok(fs.readFileSync(file).equals(await bytes.body()), "Full-size Proof must equal delivered bytes");
    }
    await post("/api/delivery/preferences", { force_cpu: false });
    const delivery = JSON.parse(execFileSync(require("../tools/lib/platform.cjs").pythonExecutable(),
      [path.join(__dirname, "helpers/gpu_delivery_fixture.py"), "compare", scratch],
      { encoding: "utf8", env: { ...process.env, PYTHONPATH: path.resolve("backend") } }));
    const deliveryName = headroom ? `headroom-${baseline ? "baseline" : "matched"}.json` : "delivery.json";
    fs.writeFileSync(path.join(output, deliveryName), JSON.stringify(delivery, null, 2));
    if (baseline) {
      console.log("Neutral SDR delivery diagnostic only:", JSON.stringify(delivery));
      return;
    }
    assert.equal(delivery.hdr.passed, true, JSON.stringify(delivery));
    assert.equal(delivery.sdr.passed, true, JSON.stringify(delivery));
    assert.equal(await page.evaluate(() => queueEditCommand("undo")), true);
    assert.deepEqual(await documentState(), before);
    await actions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "undo-1100x720.png") });
    assert.equal(await page.evaluate(() => queueEditCommand("redo")), true);
    await page.evaluate(async () => {
      const local = selectedLocal();
      local.hdr_grade.exposure += .1;
      await commitSelectedLocal();
    });
    await page.waitForFunction(() => selectedLocal()?.sdr_match?.out_of_date);
    await actions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "out-of-date-1100x720.png") });
    await page.evaluate(() => setGradeMode("global"));
    const revision = await page.evaluate(() => state.editRevision);
    await page.locator("#sdr-match-entire").click();
    await page.locator("#app-dialog[open]").waitFor();
    assert.match(await page.locator("#app-dialog-message").innerText(), /individually matched or edited/);
    await page.screenshot({ path: path.join(output, "whole-match-confirmation.png") });
    await page.locator("#app-dialog-actions button").filter({ hasText: "Cancel" }).click();
    assert.equal(await page.evaluate(() => state.editRevision), revision);
    await page.evaluate(async () => { setGradeMode("local"); await switchLane("hdr"); });
    assert.equal(await page.locator("#local-sdr-match-actions").isVisible(), false);
    fs.writeFileSync(path.join(output, "interaction.json"), JSON.stringify({ passed: true,
      metrics: result.document.local_adjustments[0].sdr_match.metrics,
      checks: ["selected child targets parent", "only SDR local replaced", "1408x794", "1100x720", "one Undo", "Redo", "stale marker", "whole-Match cancel", "SDR-only action"] }, null, 2));
    console.log("Local Match button, parent, layouts, Undo/Redo, stale marker and overwrite confirmation pass.");
  } finally {
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
