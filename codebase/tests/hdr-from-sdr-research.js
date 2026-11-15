const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { resolveInterpretation } = require("./helpers/resolve-interpretation.js");

const output = path.resolve("output/review/n5-start-hdr");
const python = require("../tools/lib/platform.cjs").pythonExecutable();
const pythonEnv = { ...process.env, PYTHONPATH: path.resolve("backend") };
const harness = global.HDRFinisherElectronTestHarness;

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const deliveryOutput = fs.mkdtempSync(path.join(output, "delivery-"));
  const measurementPath = path.join(output, "driver-measurements.json");
  execFileSync(python, ["tools/measure-hdr-from-sdr.py", "--synthetic-only", "--output", measurementPath],
    { env: pythonEnv, stdio: "pipe" });
  const proposals = JSON.parse(fs.readFileSync(measurementPath, "utf8")).rows;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1408, height: 794 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const api = async (route, data, method = "POST") => {
    const reply = await harness.fetch(route, { method, headers: { "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    assert.ok(reply.ok, await reply.clone().text());
    return reply.json();
  };
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.waitForFunction(() => state.gpuPreview?.available);
    const fixture = path.join(__dirname, "fixtures/hdr_headroom.tiff");
    const uploaded = await page.request.post(new URL("/api/session", page.url()).href, { multipart: {
      file: { name: "research-headroom.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(fixture) },
    } });
    assert.ok(uploaded.ok(), await uploaded.text());
    await page.evaluate(session => activateDesktopSession(session, ""), (await uploaded.json()).session);
    await resolveInterpretation(page);
    await page.evaluate(async () => { await switchLane("hdr"); await syncGlobalEditState(); });
    const sessionId = await page.evaluate(() => state.session.session_id);
    const getState = () => api(`/api/session/${sessionId}/edit-state`, undefined, "GET");
    const before = await getState();
    const layouts = [];
    for (const [width, height] of [[1408, 794], [1100, 720]]) {
      await browser.newPage({ viewport: { width, height } });
      await page.evaluate(() => {
        const group = document.querySelector('[data-group="hdr-tone"]');
        if (group.classList.contains("collapsed")) group.querySelector(".group-toggle").click();
      });
      await page.locator('[data-path="hdr.exposure"]').scrollIntoViewIfNeeded();
      assert.equal(await page.getByRole("button", { name: /Start HDR from SDR/i }).count(), 0);
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(viewport.width, width);
      assert.equal(viewport.height, height);
      assert.equal(viewport.overflow, false);
      await page.screenshot({ path: path.join(output, `unexposed-${width}x${height}.png`) });
      layouts.push(viewport);
    }
    await browser.newPage({ viewport: { width: 1408, height: 794 } });
    const results = [];
    for (const proposal of proposals) {
      await page.evaluate(async recipe => {
        const adjustments = structuredClone(state.adjustments);
        adjustments.hdr = recipe;
        if (!await queueEditCommand("set_global_adjustments", { adjustments })) throw Error("Candidate install failed");
      }, proposal.recipe);
      const installed = await getState();
      assert.deepEqual(installed.document.global_adjustments.sdr, before.document.global_adjustments.sdr);
      await page.evaluate(async () => { if (!await queueEditCommand("undo", {})) throw Error("Undo failed"); });
      assert.deepEqual((await getState()).document, before.document);
      await page.evaluate(async () => { if (!await queueEditCommand("redo", {})) throw Error("Redo failed"); });
      for (const forceCpu of [false, true]) {
        const renderer = forceCpu ? "cpu" : "gpu";
        await api("/api/delivery/preferences", { force_cpu: forceCpu });
        const file = path.join(deliveryOutput, `${proposal.stock}-${renderer}.jpg`);
        await harness.selectExportPath(file);
        const destination = await page.evaluate(() => window.hdrFinisherDesktop.chooseExportPath({
          extension: "jpg", suggestedName: "n5-research.jpg",
        }));
        const settings = { format: "jpeg_ultrahdr", quality: 95, jpeg_chroma_subsampling: "444",
          jpeg_gain_map_quality: 95, jpeg_gain_map_scale: "full", dithering: "off", guarantee_hdr_peak: true,
          output_finishing: { resize_mode: "long_edge", long_edge: 128, sharpening: "standard" } };
        const exported = await api(`/api/session/${sessionId}/export`, {
          ...settings, output_path: file, path_grant: destination.grant,
        });
        assert.ok(exported.accepted);
        assert.equal(exported.renderer, renderer);
        const proof = await api(`/api/session/${sessionId}/proof/artifact`, { ...settings, full_size: true });
        assert.equal(proof.renderer, renderer);
        const proofBytes = await harness.fetch(`/api/proof/artifact/${proof.artifact_id}.jpg`);
        assert.ok(proofBytes.ok);
        assert.ok(fs.readFileSync(file).equals(Buffer.from(await proofBytes.arrayBuffer())));
        const peak = JSON.parse(execFileSync(python, ["-c",
          "import json,sys;from pathlib import Path;from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling;print(json.dumps(check_decoded_hdr_ceiling(Path(sys.argv[1]),'jpeg_ultrahdr',float(sys.argv[2]))))",
          file, String(proposal.recipe.highlight_compression_target_nits)], { env: pythonEnv, encoding: "utf8" }));
        results.push({ stock: proposal.stock, renderer, peak, file, proofByteIdentical: true, bodyAccepted: false });
      }
      await page.evaluate(async () => { if (!await queueEditCommand("undo", {})) throw Error("Cleanup Undo failed"); });
      assert.deepEqual((await getState()).document, before.document);
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, "app-check.json"), JSON.stringify({
      status: "unexposed", layouts, results, documentSwapUndo: true,
      note: "Existing document-swap Undo only; X2 action/consent/eligibility are not built or qualified.",
    }, null, 2) + "\n");
    console.log("N5 unexposed research check PASS", JSON.stringify(results));
  } finally {
    await api("/api/delivery/preferences", { force_cpu: false }).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
