const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let trackCpuFallback = false;
  const cpuFallbackRequests = [];
  page.on("request", (request) => {
    if (!trackCpuFallback || request.method() !== "POST") return;
    if (/\/preview\/(hdr|sdr)$/.test(new URL(request.url()).pathname)) cpuFallbackRequests.push(request.url());
  });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.detail !== "WebGPU has not been initialized");
    const gpu = await page.evaluate(() => ({
      available: state.gpuPreview?.available,
      detail: state.gpuPreview?.detail,
    }));
    if (!gpu.available) {
      throw new Error(`WebGPU shader initialization failed: ${gpu.detail || "unknown error"}`);
    }
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
    const detailOutput = await page.evaluate(async () => {
      const renderDetail = async (detail) => {
        Object.assign(state.adjustments.hdr.detail, {
          texture_amount: 0,
          clarity_amount: 0,
          clarity_radius_percent: 0.75,
          sharpen_amount: 0,
          sharpen_radius_px: 0.8,
          sharpen_threshold: 10,
        }, detail);
        const rendered = await renderGpuDraft("hdr", { longEdge: 512 });
        if (!rendered) return null;
        const scope = await state.gpuPreview.analyzeScope(els.previewCanvas, { width: 64, height: 32 });
        return [...(scope?.pixels || [])];
      };
      const difference = (left, right) => left.reduce(
        (total, value, index) => total + Math.abs(value - right[index]),
        0,
      ) / Math.max(1, left.length);
      const gradientEnergy = (values) => {
        const width = 64;
        const height = 32;
        let total = 0;
        let count = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 1; x < width; x += 1) {
            const current = (y * width + x) * 3;
            const previous = current - 3;
            for (let channel = 0; channel < 3; channel += 1) {
              total += Math.abs(values[current + channel] - values[previous + channel]);
              count += 1;
            }
          }
        }
        return total / Math.max(1, count);
      };
      const baseline = await renderDetail({});
      const texture = await renderDetail({ texture_amount: 25 });
      const claritySmall = await renderDetail({ clarity_amount: 60, clarity_radius_percent: 0.2 });
      const clarityLarge = await renderDetail({ clarity_amount: 60, clarity_radius_percent: 3.0 });
      const sharpenOne = await renderDetail({ sharpen_amount: 1, sharpen_radius_px: 0.8, sharpen_threshold: 10 });
      const sharpenTen = await renderDetail({ sharpen_amount: 10, sharpen_radius_px: 0.8, sharpen_threshold: 10 });
      const sharpenSmall = await renderDetail({ sharpen_amount: 80, sharpen_radius_px: 0.3, sharpen_threshold: 0 });
      const sharpenLarge = await renderDetail({ sharpen_amount: 80, sharpen_radius_px: 3.0, sharpen_threshold: 0 });
      const sharpenThreshold = await renderDetail({ sharpen_amount: 80, sharpen_radius_px: 3.0, sharpen_threshold: 80 });
      const sharpenSuppressed = await renderDetail({ sharpen_amount: 1, sharpen_radius_px: 0.8, sharpen_threshold: 100 });
      const sharpenActivation = await renderDetail({ sharpen_amount: 0.0002, sharpen_radius_px: 0.8, sharpen_threshold: 100 });
      const values = texture || [];
      const variants = [baseline, texture, claritySmall, clarityLarge, sharpenOne, sharpenTen, sharpenSmall, sharpenLarge, sharpenThreshold, sharpenSuppressed, sharpenActivation];
      return {
        rendered: Boolean(baseline && texture && claritySmall && clarityLarge && sharpenSmall && sharpenLarge && sharpenThreshold),
        finite: variants.every((variant) => variant?.every(Number.isFinite)),
        maximum: values.length ? Math.max(...values.map(Math.abs)) : 0,
        nonzero: values.filter((value) => Math.abs(value) > 0.000001).length,
        clarityRadiusDifference: difference(claritySmall, clarityLarge),
        sharpenRadiusDifference: difference(sharpenSmall, sharpenLarge),
        sharpenThresholdDifference: difference(sharpenLarge, sharpenThreshold),
        suppressedDifference: difference(baseline, sharpenSuppressed),
        activationDifference: difference(baseline, sharpenActivation),
        baselineGradient: gradientEnergy(baseline),
        sharpenOneGradient: gradientEnergy(sharpenOne),
        sharpenTenGradient: gradientEnergy(sharpenTen),
        sharpenGradient: gradientEnergy(sharpenLarge),
      };
    });
    if (!detailOutput.rendered || !detailOutput.finite || detailOutput.maximum <= 0.000001 || detailOutput.nonzero === 0) {
      throw new Error(`Active Detail produced an empty or invalid GPU frame: ${JSON.stringify(detailOutput)}`);
    }
    if (detailOutput.clarityRadiusDifference <= 0.000001
      || detailOutput.sharpenRadiusDifference <= 0.000001
      || detailOutput.sharpenThresholdDifference <= 0.000001) {
      throw new Error(`Detail radius or threshold controls did not change the GPU result: ${JSON.stringify(detailOutput)}`);
    }
    if (detailOutput.sharpenGradient + 0.000001 < detailOutput.baselineGradient) {
      throw new Error(`Positive sharpening reduced horizontal edge energy: ${JSON.stringify(detailOutput)}`);
    }
    if (!(detailOutput.baselineGradient < detailOutput.sharpenOneGradient
      && detailOutput.sharpenOneGradient < detailOutput.sharpenTenGradient
      && detailOutput.sharpenTenGradient < detailOutput.sharpenGradient)) {
      throw new Error(`Sharpen Amount response is not continuous and monotonic: ${JSON.stringify(detailOutput)}`);
    }
    if (detailOutput.activationDifference > 0.00001) {
      throw new Error(`Activating Sharpen changes pixels before a visible adjustment is applied: ${JSON.stringify(detailOutput)}`);
    }

    trackCpuFallback = true;
    const localDetailOutput = await page.evaluate(async () => {
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 0,
        clarity_amount: 0,
        sharpen_amount: 0,
      });
      const pathNode = (x, y) => ({ x, y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" });
      const first = newLocalAdjustment("path");
      first.name = "GPU Detail left";
      first.mask.leaf.nodes = [pathNode(0, 0), pathNode(0.45, 0), pathNode(0.45, 1), pathNode(0, 1)];
      first.mask.leaf.feather = 0;
      first.hdr_grade.exposure = 0.2;
      Object.assign(first.hdr_grade.detail, {
        texture_amount: 45,
        clarity_amount: 35,
        clarity_radius_percent: 0.7,
        sharpen_amount: 55,
        sharpen_radius_px: 0.8,
        sharpen_threshold: 10,
      });
      const second = newLocalAdjustment("path");
      second.name = "GPU Detail right";
      second.mask.leaf.nodes = [pathNode(0.25, 0), pathNode(0.75, 0), pathNode(0.75, 1), pathNode(0.25, 1)];
      second.mask.leaf.feather = 0;
      second.hdr_grade.exposure = -0.15;
      Object.assign(second.hdr_grade.detail, {
        texture_amount: -25,
        clarity_amount: 50,
        clarity_radius_percent: 1.4,
        sharpen_amount: 30,
        sharpen_radius_px: 1.6,
        sharpen_threshold: 10,
      });
      if (!await queueEditCommand("create_local", { local: first })) throw new Error("Could not create first Detail local");
      if (!await queueEditCommand("create_local", { local: second })) throw new Error("Could not create second Detail local");

      state.gpuPreview.setInstrumentationEnabled(true);
      const detailControl = document.querySelector('[data-local-grade="detail.texture_amount"]');
      const renderCountBeforeDrag = state.gpuPreview.diagnosticsSnapshot().renders.length;
      detailControl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
      for (let index = 0; index < 24; index += 1) {
        detailControl.value = String(index < 23 ? 60 - index * 2 : 0);
        detailControl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      detailControl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await state.gpuPreview.waitForSubmittedWork();
      const renderCountAfterDrag = state.gpuPreview.diagnosticsSnapshot().renders.length;
      const rapidDrag = {
        inputCount: 24,
        renderCount: renderCountAfterDrag - renderCountBeforeDrag,
        transport: state.acceptedPresentation?.transport,
        finalValue: Number(detailControl.value),
      };
      while (state.localMaskCommitDepth > 0) await new Promise((resolve) => setTimeout(resolve, 20));
      await syncGlobalEditState();
      const maskResponse = await fetch(`/api/session/${state.session.session_id}/local-mask/${first.id}?long_edge=512&edit_revision=${state.editRevision}&spatial_only=true`);
      const maskBytes = new Uint8Array(await maskResponse.arrayBuffer());
      const maskProbe = {
        status: maskResponse.status,
        maximum: maskBytes.length ? Math.max(...maskBytes) : 0,
        sum: maskBytes.reduce((total, value) => total + value, 0),
      };

      const renderedLocalCounts = [];
      const read = async () => {
        const rendered = await renderGpuDraft("hdr", { longEdge: 512, tier: "settled" });
        if (!rendered) return null;
        await state.gpuPreview.waitForSubmittedWork();
        renderedLocalCounts.push(state.gpuPreview.diagnosticsSnapshot().renders.at(-1)?.localCount ?? -1);
        const scope = await state.gpuPreview.analyzeScope(els.previewCanvas, { width: 64, height: 32 });
        return [...(scope?.pixels || [])];
      };
      const difference = (left, right) => left.reduce(
        (total, value, index) => total + Math.abs(value - right[index]),
        0,
      ) / Math.max(1, left.length);
      const columnEnergy = (baseline, candidate, start, end) => {
        let total = 0;
        let count = 0;
        for (let y = 0; y < 32; y += 1) {
          for (let x = start; x < end; x += 1) {
            const offset = (y * 64 + x) * 3;
            for (let channel = 0; channel < 3; channel += 1) {
              const delta = Math.abs(candidate[offset + channel] - baseline[offset + channel]);
              if (Number.isFinite(delta)) {
                total += delta;
                count += 1;
              }
            }
          }
        }
        return { energy: total / Math.max(1, count), samples: count };
      };

      const locals = state.editDocument.local_adjustments;
      const saved = locals.splice(0, locals.length);
      const baseline = await read();
      locals.push(first);
      const firstOnly = await read();
      locals.push(second);
      const ordered = await read();
      locals.splice(0, locals.length, second, first);
      const reversed = await read();

      locals.splice(0, locals.length, first);
      first.hdr_grade.detail.sharpen_radius_px = 0.3;
      first.hdr_grade.detail.sharpen_threshold = 0;
      const thresholdZero = await read();
      first.hdr_grade.detail.sharpen_threshold = 10;
      const thresholdTen = await read();
      first.hdr_grade.detail.sharpen_threshold = 100;
      const thresholdHundred = await read();
      first.hdr_grade.detail.sharpen_threshold = 10;
      first.hdr_grade.detail.sharpen_radius_px = 3;
      const radiusLarge = await read();

      // Exercise global and local Detail together. Both graphs must safely
      // reuse the same pair of scratch textures in their encoded order.
      Object.assign(state.adjustments.hdr.detail, { texture_amount: 20, clarity_amount: 15 });
      locals.splice(0, locals.length, first, second);
      const globalAndLocal = await read();

      const gpuDataUrl = els.previewCanvas.toDataURL("image/png");
      const gpuImage = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = gpuDataUrl;
      });
      const gpuCanvas = document.createElement("canvas");
      gpuCanvas.width = els.previewCanvas.width;
      gpuCanvas.height = els.previewCanvas.height;
      const gpuContext = gpuCanvas.getContext("2d");
      gpuContext.drawImage(gpuImage, 0, 0);
      const gpuPixels = gpuContext.getImageData(0, 0, gpuCanvas.width, gpuCanvas.height).data;
      const cpuResponse = await fetch(`/api/session/${state.session.session_id}/preview-raw/hdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustments: state.adjustments,
          local_adjustments: JSON.parse(JSON.stringify(locals)),
          include_locals: true,
          long_edge: 512,
          hdr_display: false,
        }),
      });
      if (!cpuResponse.ok) throw new Error(`Local Detail CPU parity reference failed with HTTP ${cpuResponse.status}`);
      const cpuWidth = Number(cpuResponse.headers.get("X-Image-Width"));
      const cpuHeight = Number(cpuResponse.headers.get("X-Image-Height"));
      const cpuPixels = new Uint8ClampedArray(await cpuResponse.arrayBuffer());
      let parityTotal = 0;
      const paritySamples = Math.min(gpuPixels.length, cpuPixels.length);
      for (let index = 0; index < paritySamples; index += 1) parityTotal += Math.abs(gpuPixels[index] - cpuPixels[index]);
      const parityMeanAbsoluteError = parityTotal / Math.max(1, paritySamples) / 255;

      const supported = state.gpuPreview.supportsLocalAdjustments("hdr", [first, second]);
      const inside = columnEnergy(baseline, firstOnly, 0, 8);
      const outside = columnEnergy(baseline, firstOnly, 56, 64);
      locals.splice(0, locals.length, ...saved);
      return {
        supported,
        finite: [baseline, firstOnly, ordered, reversed, thresholdZero, thresholdTen, thresholdHundred, radiusLarge, globalAndLocal]
          .every((pixels) => pixels?.every(Number.isFinite)),
        inside,
        outside,
        orderedDifference: difference(ordered, reversed),
        thresholdZeroTen: difference(thresholdZero, thresholdTen),
        thresholdTenHundred: difference(thresholdTen, thresholdHundred),
        radiusDifference: difference(thresholdTen, radiusLarge),
        globalAndLocalDifference: difference(ordered, globalAndLocal),
        parityGeometry: [gpuCanvas.width, gpuCanvas.height, cpuWidth, cpuHeight],
        parityMeanAbsoluteError,
        rapidDrag,
        renderedLocalCounts,
        compareWithoutLocals: state.compareWithoutLocals,
        maskProbe,
      };
    });
    trackCpuFallback = false;
    if (!localDetailOutput.supported || !localDetailOutput.finite
      || localDetailOutput.inside.samples !== 32 * 8 * 3
      || localDetailOutput.outside.samples !== 32 * 8 * 3
      || Math.max(localDetailOutput.inside.energy, localDetailOutput.outside.energy) <= 0.000001
      || Math.abs(localDetailOutput.inside.energy - localDetailOutput.outside.energy) <= 0.000001
      || localDetailOutput.orderedDifference <= 0.000001
      || localDetailOutput.thresholdZeroTen <= 0.00000001
      || localDetailOutput.thresholdTenHundred <= 0.000001
      || localDetailOutput.radiusDifference <= 0.000001
      || localDetailOutput.globalAndLocalDifference <= 0.000001
      || localDetailOutput.parityGeometry[0] !== localDetailOutput.parityGeometry[2]
      || localDetailOutput.parityGeometry[1] !== localDetailOutput.parityGeometry[3]
      || localDetailOutput.parityMeanAbsoluteError > 0.06
      || localDetailOutput.rapidDrag.transport !== "WebGPU"
      || localDetailOutput.rapidDrag.finalValue !== 0
      || localDetailOutput.rapidDrag.renderCount >= localDetailOutput.rapidDrag.inputCount) {
      throw new Error(`Local Detail GPU graph failed its pixel contract: ${JSON.stringify(localDetailOutput)}`);
    }
    if (cpuFallbackRequests.length) {
      throw new Error(`Local Detail escaped to a CPU preview: ${JSON.stringify(cpuFallbackRequests)}`);
    }
    console.log(JSON.stringify({ ...gpu, detailOutput, localDetailOutput }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
