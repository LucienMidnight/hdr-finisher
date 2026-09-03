const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function sameBuffer(left, right) {
  return left.length === right.length && left.equals(right);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("dialog", (dialog) => dialog.accept());
  const interactionRequests = { tracking: false, cpuSdrPreviews: 0, sdrProxies: 0, sdrProxyUrls: [] };
  page.on("request", (request) => {
    if (!interactionRequests.tracking) return;
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/preview\/sdr$/.test(pathname)) interactionRequests.cpuSdrPreviews += 1;
    if (request.method() === "GET" && /\/proxy\/sdr$/.test(pathname)) {
      interactionRequests.sdrProxies += 1;
      interactionRequests.sdrProxyUrls.push(request.url());
    }
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.available === true);
    const fixturePath = path.join(__dirname, "fixtures", "hdr_headroom.tiff");
    const sessionResponse = await page.request.post(`${baseUrl}/api/session`, {
      multipart: { file: { name: path.basename(fixturePath), mimeType: "image/tiff", buffer: fs.readFileSync(fixturePath) } },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);

    const authored = await page.evaluate(async () => {
      state.adjustments.hdr.exposure = 0.35;
      state.adjustments.hdr.contrast = 0.18;
      state.adjustments.hdr.film_look.grain_amount = 12;
      state.adjustments.hdr.film_look.grain_size = 41;
      state.adjustments.hdr.film_look.highlight_desaturation = 18;
      markGlobalEditDirty();
      if (!await syncGlobalEditState()) return { prepared: false };
      const local = newLocalAdjustment("linear_gradient");
      local.name = "Masked lamp control";
      local.hdr_grade.exposure = 0.4;
      local.hdr_grade.highlights = 0.65;
      local.hdr_grade.saturation = 0.12;
      if (!await queueEditCommand("create_local", { local })) return { prepared: false };
      state.denoise.hdr.enabled = true;
      state.denoise.hdr.controls.amount = 0.72;
      state.denoise.hdr.controls.luminance = 0.81;
      if (!await persistDenoiseSettings()) return { prepared: false };
      return {
        prepared: true,
        revision: state.editRevision,
        beforeSdr: JSON.stringify(state.adjustments.sdr),
      };
    });
    if (!authored.prepared) throw new Error("Could not prepare the HDR Match browser fixture.");

    await page.locator("#view-sdr").click();
    const matchStartedAt = Date.now();
    const matchResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST" && /\/sdr-match$/.test(new URL(response.url()).pathname)
    ), { timeout: 120000 });
    await page.locator("#sdr-match-entire").click();
    const matchResponse = await matchResponsePromise;
    if (!matchResponse.ok()) {
      throw new Error(`HDR Match failed with HTTP ${matchResponse.status()}: ${await matchResponse.text()}`);
    }
    console.log(`HDR Match response: ${Date.now() - matchStartedAt} ms`);
    await page.waitForFunction((revision) => (
      state.editRevision > revision && state.editDocument?.sdr_match?.materialized_status && !els.sdrMatchEntire.disabled
    ), authored.revision, { timeout: 30000 });

    const matched = await page.evaluate(async () => {
      const match = state.editDocument.sdr_match;
      const local = state.editDocument.local_adjustments[0];
      const luma = state.adjustments.sdr.luma_curve;
      const localCurves = ["luma_curve", "red_curve", "green_curve", "blue_curve"];
      const globalRgbCurves = ["red_curve", "green_curve", "blue_curve"];
      const curveNeutral = (points) => points.every(([x, y]) => Math.abs(x - y) < 0.000001);
      state.gpuPreview.setInstrumentationEnabled(true);
      const rendered = await renderGpuDraft("sdr", { longEdge: settledProxyLongEdge() });
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const accepted = state.acceptedPresentation;
      const unsupportedCurveLocal = JSON.parse(JSON.stringify(local));
      unsupportedCurveLocal.sdr_grade.luma_curve = [[0, 0], [0.5, 0.6], [1, 1]];
      const unsupportedDetailLocal = JSON.parse(JSON.stringify(local));
      unsupportedDetailLocal.sdr_grade.detail.texture_amount = 1;
      const unsupportedWheelLocal = JSON.parse(JSON.stringify(local));
      unsupportedWheelLocal.sdr_grade.color_grading.highlights.luminance_ev = 0.1;
      return {
        revision: state.editRevision,
        generation: state.previewGeneration.sdr,
        active: match.active,
        status: match.materialized_status,
        metrics: match.materialized_metrics,
        renderingVersion: state.adjustments.sdr.rendering_version,
        highlightEnabled: state.adjustments.sdr.highlight_section_enabled,
        highlightMode: state.adjustments.sdr.highlight_compression_mode,
        lumaPoints: luma.length,
        lumaNeutral: curveNeutral(luma),
        rgbCurvesUsable: globalRgbCurves.every((name) => {
          const points = state.adjustments.sdr[name];
          return curveNeutral(points) || (points.length <= 7 && points.every((point, index) => (
            index === 0 || point[1] > points[index - 1][1]
          )));
        }),
        localPoints: local.sdr_grade.luma_curve.length,
        localCurvesNeutral: localCurves.every((name) => curveNeutral(local.sdr_grade[name])),
        localTonalMaterialized: ["exposure", "highlights", "midtones", "shadows", "blacks", "contrast"]
          .some((name) => Math.abs(Number(local.sdr_grade[name]) || 0) > 0.000001),
        localMaskPreserved: local.mask.leaf.type === "linear_gradient" && local.name === "Masked lamp control",
        denoiseCopied: JSON.stringify(state.denoise.sdr) === JSON.stringify(state.denoise.hdr),
        grainCopied: state.adjustments.sdr.film_look.grain_amount === state.adjustments.hdr.film_look.grain_amount
          && state.adjustments.sdr.film_look.grain_size === state.adjustments.hdr.film_look.grain_size,
        sourceOptions: gpuPreviewSourceOptions("sdr"),
        gpuEligible: gpuPreviewEligible("sdr"),
        gpuRendered: rendered,
        acceptedLane: accepted?.lane,
        acceptedGeneration: accepted?.generation,
        acceptedTransport: accepted?.transport,
        helperEligibilityCorrect: !state.gpuPreview.supportsLocalAdjustments("sdr", [unsupportedCurveLocal])
          && state.gpuPreview.supportsLocalAdjustments("sdr", [unsupportedDetailLocal])
          && !state.gpuPreview.supportsLocalAdjustments("sdr", [unsupportedWheelLocal]),
        recipe: JSON.stringify(state.adjustments.sdr),
      };
    });
    if (matched.active || !["matched", "needs_review"].includes(matched.status)
      || matched.renderingVersion !== "highlight_v2" || !matched.highlightEnabled
      || matched.highlightMode !== "peak_fit" || matched.lumaPoints !== 5
      || !matched.lumaNeutral || !matched.rgbCurvesUsable || matched.localPoints !== 5
      || !matched.localCurvesNeutral || !matched.localTonalMaterialized || !matched.localMaskPreserved
      || !matched.denoiseCopied || !matched.grainCopied || matched.sourceOptions !== null
      || !matched.gpuEligible || !matched.gpuRendered || matched.acceptedLane !== "sdr"
      || matched.acceptedGeneration !== matched.generation || matched.acceptedTransport !== "WebGPU"
      || !matched.helperEligibilityCorrect) {
      throw new Error(`Visible SDR materialization contract failed: ${JSON.stringify(matched)}`);
    }
    if (matched.metrics.p95_luma_error > 0.05 || matched.metrics.p95_oklab_error > 0.05) {
      throw new Error(`Committed match exceeded its safety gate: ${JSON.stringify(matched.metrics)}`);
    }

    const diagnosticsResponse = await page.request.get(`${baseUrl}/api/session/${session.session_id}/diagnostics`);
    const diagnostics = await diagnosticsResponse.json();
    if (diagnostics.render_cache.matched_sdr_base_entries !== 0) {
      throw new Error(`A hidden matched base was cached: ${JSON.stringify(diagnostics.render_cache)}`);
    }

    interactionRequests.tracking = true;
    const exposureInteraction = await page.evaluate(() => {
      const beforeGeneration = state.previewGeneration.sdr;
      const beforeExposure = state.adjustments.sdr.exposure;
      commitAdjustmentValue("sdr.exposure", Math.min(4, beforeExposure + 0.5), { manual: true });
      return { beforeGeneration, beforeExposure };
    });
    await page.waitForFunction(({ beforeGeneration }) => (
      state.previewGeneration.sdr > beforeGeneration
      && state.acceptedPresentation?.lane === "sdr"
      && state.acceptedPresentation?.generation === state.previewGeneration.sdr
      && state.acceptedPresentation?.transport === "WebGPU"
    ), exposureInteraction, { timeout: 15_000 });
    // Leave enough time for the settled scheduler to expose any late CPU
    // fallback that followed an optimistic GPU frame.
    await page.waitForTimeout(600);
    interactionRequests.tracking = false;
    const exposureResult = await page.evaluate(() => ({
      exposure: state.adjustments.sdr.exposure,
      generation: state.previewGeneration.sdr,
      acceptedGeneration: state.acceptedPresentation?.generation,
      acceptedTransport: state.acceptedPresentation?.transport,
      gpuEligible: gpuPreviewEligible("sdr"),
    }));
    if (exposureResult.exposure <= exposureInteraction.beforeExposure
      || exposureResult.acceptedGeneration !== exposureResult.generation
      || exposureResult.acceptedTransport !== "WebGPU" || !exposureResult.gpuEligible
      || interactionRequests.cpuSdrPreviews !== 0) {
      throw new Error(`Matched SDR exposure left the resident WebGPU path: ${JSON.stringify({
        exposureInteraction, exposureResult, interactionRequests,
      })}`);
    }

    const interactionCleanup = await page.evaluate(async (matchedRecipe) => {
      await syncGlobalEditState();
      const undone = await queueEditCommand("undo");
      return {
        undone,
        revision: state.editRevision,
        restored: JSON.stringify(state.adjustments.sdr) === matchedRecipe,
      };
    }, matched.recipe);
    if (!interactionCleanup.undone || !interactionCleanup.restored) {
      throw new Error(`Could not restore the matched recipe after the exposure performance check: ${JSON.stringify(interactionCleanup)}`);
    }

    const previewBody = { edit_revision: interactionCleanup.revision, long_edge: 768, hdr_display: false, include_locals: true };
    const firstPreview = await page.request.post(`${baseUrl}/api/session/${session.session_id}/preview/sdr`, {
      data: previewBody,
    });
    const secondPreview = await page.request.post(`${baseUrl}/api/session/${session.session_id}/preview/sdr`, {
      data: previewBody,
    });
    const firstBytes = await firstPreview.body();
    const secondBytes = await secondPreview.body();
    if (!firstPreview.ok() || !secondPreview.ok() || !sameBuffer(firstBytes, secondBytes)) {
      throw new Error(`Materialized SDR denoise/grain preview was not deterministic: ${JSON.stringify({
        firstStatus: firstPreview.status(), secondStatus: secondPreview.status(),
        firstLength: firstBytes.length, secondLength: secondBytes.length,
        firstPrefix: firstBytes.subarray(0, 32).toString("hex"),
        secondPrefix: secondBytes.subarray(0, 32).toString("hex"),
      })}`);
    }

    const history = await page.evaluate(async (matchedRecipe) => {
      const undone = await queueEditCommand("undo");
      const undoState = {
        undone,
        status: state.editDocument.sdr_match.materialized_status,
        sdr: JSON.stringify(state.adjustments.sdr),
      };
      const redone = await queueEditCommand("redo");
      return {
        undoState,
        redone,
        restored: JSON.stringify(state.adjustments.sdr) === matchedRecipe,
        active: state.editDocument.sdr_match.active,
        status: state.editDocument.sdr_match.materialized_status,
      };
    }, matched.recipe);
    if (!history.undoState.undone || history.undoState.status !== null
      || history.undoState.sdr !== authored.beforeSdr || !history.redone || !history.restored
      || history.active || !history.status) {
      throw new Error(`Match Undo/Redo was not atomic: ${JSON.stringify(history)}`);
    }

    const reset = await page.evaluate(async () => {
      state.adjustments.sdr = JSON.parse(JSON.stringify(defaultAdjustments().sdr));
      const applied = await queueEditCommand("set_global_adjustments", {
        adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      });
      return {
        applied,
        lumaNeutral: state.adjustments.sdr.luma_curve.every(([x, y]) => Math.abs(x - y) < 1e-7),
      };
    });
    const resetRevision = await page.evaluate(() => state.editRevision);
    const resetPreview = await page.request.post(`${baseUrl}/api/session/${session.session_id}/preview/sdr`, {
      data: { edit_revision: resetRevision, long_edge: 768, hdr_display: false, include_locals: true },
    });
    const resetBytes = await resetPreview.body();
    if (!reset.applied || !reset.lumaNeutral || sameBuffer(firstBytes, resetBytes)) {
      throw new Error(`Resetting visible modules did not remove the match effect: ${JSON.stringify(reset)}`);
    }

    console.log(JSON.stringify({
      preparedRevision: authored.revision,
      matchedRevision: matched.revision,
      status: matched.status,
      metrics: matched.metrics,
      visibleCurves: { global: matched.lumaPoints, local: matched.localPoints },
      directWebGpu: matched.gpuRendered && matched.acceptedGeneration === matched.generation,
      exposureInteraction: { ...exposureResult, requests: interactionRequests },
      undoRedo: history.undoState.undone && history.redone && history.restored,
      resetRemovedEffect: !sameBuffer(firstBytes, resetBytes),
      matchedBaseEntries: diagnostics.render_cache.matched_sdr_base_entries,
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
