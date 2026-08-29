const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    console.log(JSON.stringify({ ...gpu, detailOutput }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
