const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let sdrProxyRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/proxy/sdr?")) sdrProxyRequests += 1;
  });
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.available === true);
    const fixturePath = path.join(__dirname, "fixtures", "hdr_headroom.tiff");
    const sessionResponse = await page.request.post(`${baseUrl}/api/session`, {
      multipart: {
        file: {
          name: path.basename(fixturePath),
          mimeType: "image/tiff",
          buffer: fs.readFileSync(fixturePath),
        },
      },
    });
    if (!sessionResponse.ok()) throw new Error(`Fixture session failed with HTTP ${sessionResponse.status()}.`);
    const { session } = await sessionResponse.json();
    await page.evaluate((loadedSession) => activateDesktopSession(loadedSession, ""), session);
    const matched = await page.evaluate(async () => {
      state.currentView = "sdr";
      renderLaneChrome();
      return setSdrMatch("match");
    });
    if (!matched) {
      const badge = await page.locator("#badge").textContent();
      throw new Error(`SDR Match did not complete: ${badge}`);
    }

    const initial = await page.evaluate(() => ({
      eligible: gpuPreviewEligible("sdr"),
      active: state.editDocument?.sdr_match?.active,
      transport: state.previewInfoByLane.sdr?.transport,
      mediaType: state.previewInfoByLane.sdr?.mediaType,
      canvasVisible: els.previewCanvas.style.display !== "none",
      settledLongEdge: settledProxyLongEdge(),
    }));
    if (!initial.eligible || !initial.active || !initial.canvasVisible
      || initial.transport !== "GPU texture" || initial.mediaType !== "WebGPU canvas") {
      throw new Error(`Matched SDR did not settle on WebGPU: ${JSON.stringify(initial)}`);
    }

    const requestsAfterMatch = sdrProxyRequests;
    const trim = await page.evaluate(async (longEdge) => {
      state.adjustments.sdr.exposure += 0.1;
      const startedAt = performance.now();
      const rendered = await renderGpuDraft("sdr", { longEdge });
      return {
        rendered,
        elapsedMs: performance.now() - startedAt,
        transport: state.previewInfoByLane.sdr?.transport,
      };
    }, initial.settledLongEdge);
    if (!trim.rendered || trim.transport !== "GPU texture") {
      throw new Error(`SDR trim did not render through WebGPU: ${JSON.stringify(trim)}`);
    }
    if (sdrProxyRequests !== requestsAfterMatch) {
      throw new Error(`An SDR-only trim reloaded the matched base (${requestsAfterMatch} -> ${sdrProxyRequests}).`);
    }

    const resolutionRematch = await page.evaluate(async () => {
      // The compact fixture is intentionally tiny. Advertise 4K source
      // geometry here so this check can verify the requested preview tier
      // without adding a large binary fixture to the repository.
      state.session.source.width = 4096;
      state.session.source.height = 2160;
      applyPreviewResolution("4096", { schedule: false });
      state.gpuPreview.setInstrumentationEnabled(true);
      const rematched = await setSdrMatch("rematch");
      const diagnostics = state.gpuPreview.diagnosticsSnapshot();
      const targetRequest = [...diagnostics.stages].reverse().find((entry) => (
        entry.stage === "proxy-request" && entry.lane === "sdr" && entry.longEdge === 4096
      ));
      return {
        rematched,
        selectedTarget: refinementProxyLongEdge(),
        requestedTarget: targetRequest?.longEdge || null,
        acceptedTier: state.acceptedPresentation?.tier,
      };
    });
    if (!resolutionRematch.rematched || resolutionRematch.selectedTarget !== 4096
      || resolutionRematch.requestedTarget !== 4096 || resolutionRematch.acceptedTier !== "refinement") {
      throw new Error(`SDR Rematch did not render the selected preview tier directly: ${JSON.stringify(resolutionRematch)}`);
    }

    const preload = await page.evaluate(async () => {
      state.currentView = "hdr";
      renderLaneChrome();
      state.gpuPreview.resetSession(state.session.session_id);
      const longEdge = settledProxyLongEdge();
      await preloadInactiveLane("sdr", state.previewGeneration.sdr);
      return { longEdge, prepared: state.gpuPreparedLane.sdr };
    });
    const requestsAfterPreload = sdrProxyRequests;
    const preloadedRender = await page.evaluate(async (longEdge) => renderGpuDraft("sdr", {
      longEdge,
      allowInactive: true,
    }), preload.longEdge);
    if (!preload.prepared || !preloadedRender) {
      throw new Error(`Matched SDR inactive preload failed: ${JSON.stringify({ preload, preloadedRender })}`);
    }
    if (sdrProxyRequests !== requestsAfterPreload) {
      throw new Error(`Activating a preloaded matched SDR proxy caused a duplicate load (${requestsAfterPreload} -> ${sdrProxyRequests}).`);
    }

    const denoise = await page.evaluate(async () => {
      state.currentView = "sdr";
      renderLaneChrome();
      state.gpuPreview.setInstrumentationEnabled(true);
      state.denoise.sdr.enabled = true;
      state.denoise.sdr.controls = {
        amount: 0.72,
        luminance: 1,
        color_noise: 1,
        detail_recovery: 0.5,
      };
      state.denoiseRuntime.sdr.dirty = true;
      const ready = await recalculateDenoise();
      const sourceIdentity = gpuPreviewSourceOptions("sdr")?.identity || "source";
      const rendered = await renderGpuDraft("sdr", { longEdge: refinementProxyLongEdge() });
      const diagnostics = state.gpuPreview.diagnosticsSnapshot();
      const grading = [...diagnostics.stages].reverse().find((entry) => entry.stage === "grading");
      const selector = state.gpuPreview.denoiseSourceSelector;
      const readTexture = async (entry) => {
        const width = entry.width;
        const height = entry.height;
        const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
        const buffer = state.gpuPreview.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = state.gpuPreview.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: entry.texture },
          { buffer, bytesPerRow, rowsPerImage: height },
          { width, height },
        );
        state.gpuPreview.device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint16Array(buffer.getMappedRange());
        const stride = bytesPerRow / 2;
        const packed = new Uint16Array(width * height * 4);
        for (let y = 0; y < height; y += 1) {
          packed.set(source.subarray(y * stride, y * stride + width * 4), y * width * 4);
        }
        buffer.unmap();
        buffer.destroy();
        return packed;
      };
      const [original, resolved] = await Promise.all([
        readTexture(selector.original),
        readTexture(selector.resolved),
      ]);
      let differentComponents = 0;
      let absoluteDifference = 0;
      let maximumDifference = 0;
      const originalMeans = [0, 0, 0, 0];
      const resolvedMeans = [0, 0, 0, 0];
      const halfToNumber = (value) => {
        const sign = (value & 0x8000) ? -1 : 1;
        const exponent = (value >> 10) & 0x1f;
        const fraction = value & 0x03ff;
        if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
        if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
        return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
      };
      for (let index = 0; index < original.length; index += 1) {
        const originalValue = halfToNumber(original[index]);
        const resolvedValue = halfToNumber(resolved[index]);
        if (Number.isFinite(originalValue)) originalMeans[index % 4] += originalValue;
        if (Number.isFinite(resolvedValue)) resolvedMeans[index % 4] += resolvedValue;
        if (original[index] !== resolved[index]) {
          differentComponents += 1;
          const delta = Math.abs(originalValue - resolvedValue);
          if (Number.isFinite(delta)) {
            absoluteDifference += delta;
            maximumDifference = Math.max(maximumDifference, delta);
          }
        }
      }
      return {
        ready,
        rendered,
        expectedSuffix: `:${sourceIdentity}`,
        identity: diagnostics.denoise.identity,
        selectedSource: diagnostics.denoise.selectedSource,
        controls: diagnostics.denoise.controls,
        gradingSource: grading?.source,
        differentComponents,
        componentCount: original.length,
        meanAbsoluteDifference: absoluteDifference / original.length,
        maximumDifference,
        originalMeans: originalMeans.map((value) => value / (original.length / 4)),
        resolvedMeans: resolvedMeans.map((value) => value / (resolved.length / 4)),
      };
    });
    if (!denoise.ready || !denoise.rendered || !denoise.identity?.endsWith(denoise.expectedSuffix)
      || denoise.selectedSource !== "resolved" || denoise.gradingSource !== "resolved"
      || denoise.controls?.amount !== 0.72 || denoise.controls?.luminance !== 1
      || denoise.controls?.colorNoise !== 1 || denoise.controls?.detailRecovery !== 0.5
      || denoise.differentComponents === 0) {
      throw new Error(`Matched SDR denoise did not bind to its grading proxy: ${JSON.stringify(denoise)}`);
    }

    const bypassRace = await page.evaluate(async () => {
      const gpu = state.gpuPreview;
      const originalLoadProxy = gpu.loadProxy.bind(gpu);
      gpu.loadProxy = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return originalLoadProxy(...args);
      };
      state.denoise.sdr.enabled = true;
      state.denoiseRuntime.sdr.dirty = true;
      const pending = recalculateDenoise();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await setDenoiseEnabled(false);
      const recalculated = await pending;
      gpu.loadProxy = originalLoadProxy;
      await renderGpuDraft("sdr", { longEdge: refinementProxyLongEdge() });
      const diagnostics = gpu.diagnosticsSnapshot();
      const grading = [...diagnostics.stages].reverse().find((entry) => entry.stage === "grading");
      return {
        recalculated,
        enabled: state.denoise.sdr.enabled,
        status: state.denoiseRuntime.sdr.status,
        selectedSource: diagnostics.denoise.selectedSource,
        gradingSource: grading?.source,
        cancelRecorded: diagnostics.stages.some((entry) => entry.stage === "denoise-cancel"),
      };
    });
    if (bypassRace.recalculated || bypassRace.enabled || bypassRace.status !== "off"
      || bypassRace.selectedSource !== "original" || bypassRace.gradingSource !== "original"
      || !bypassRace.cancelRecorded) {
      throw new Error(`SDR denoise bypass lost an in-flight race: ${JSON.stringify(bypassRace)}`);
    }

    console.log(JSON.stringify({ initial, trim, resolutionRematch, preload, denoise, bypassRace, sdrProxyRequests }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
