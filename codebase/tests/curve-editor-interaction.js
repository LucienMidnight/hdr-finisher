const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function curvePointPosition(box, x, y) {
  const left = 18;
  const right = 14;
  const top = 14;
  const bottom = 34;
  return {
    x: left + x * (box.width - left - right),
    y: box.height - bottom - y * (box.height - top - bottom),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");

    const controlOrder = async (lane) => page.evaluate((activeLane) => (
      [...document.querySelector(`[data-lane-panel="${activeLane}"]`).children]
        .map((element) => element.dataset.group)
        .filter(Boolean)
    ), lane);
    const expectedHdrOrder = ["denoise", "hdr-tone", "hdr-equalizer", "hdr-zones", "hdr-highlights", "curves", "hdr-color"];
    const hdrOrder = await controlOrder("hdr");
    if (JSON.stringify(hdrOrder) !== JSON.stringify(expectedHdrOrder)) {
      throw new Error(`Unexpected HDR control order: ${JSON.stringify(hdrOrder)}`);
    }
    const localPlacement = await page.evaluate(() => {
      const grading = document.querySelector('[data-group="color-grading"]');
      return grading?.nextElementSibling?.dataset.group;
    });
    if (localPlacement !== "local-adjustments") {
      throw new Error(`Local Adjustments did not follow Color Grading: ${localPlacement}`);
    }

    await page.click("#view-sdr");
    await page.waitForFunction(() => document.body.dataset.activeLane === "sdr");
    const expectedSdrOrder = ["denoise", "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-zones", "curves", "sdr-color"];
    const sdrOrder = await controlOrder("sdr");
    if (JSON.stringify(sdrOrder) !== JSON.stringify(expectedSdrOrder)) {
      throw new Error(`Unexpected SDR control order: ${JSON.stringify(sdrOrder)}`);
    }
    await page.click("#view-hdr");
    await page.waitForFunction(() => document.body.dataset.activeLane === "hdr");

    const gpuAvailable = await page.evaluate(() => Boolean(window.HDRFinisherPerformance.gpuSnapshot()?.available));
    if (gpuAvailable) await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    await page.locator('[data-group="curves"] .group-toggle').click();

    const curve = page.locator("#curve-editor");
    const pointCount = () => page.evaluate(
      () => window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve.length,
    );
    if (await pointCount() !== 5) {
      throw new Error(`Expected three editable default points plus two endpoints; received ${await pointCount()} total points.`);
    }

    const box = await curve.boundingBox();
    if (!box) throw new Error("Curve editor was not visible.");
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector("#curve-editor");
        return canvas && canvas.width >= Math.floor(canvas.clientWidth * window.devicePixelRatio);
      },
      null,
      { timeout: 2000 },
    );
    const addedPoint = curvePointPosition(box, 0.375, 0.375);
    await page.mouse.move(box.x + addedPoint.x, box.y + addedPoint.y);
    await page.mouse.down();
    await page.mouse.move(box.x + addedPoint.x + 16, box.y + addedPoint.y - 12, { steps: 3 });
    await page.mouse.up();
    if (await pointCount() !== 6) throw new Error("Pressing the curve line did not add a point.");
    const createdPoint = await page.evaluate(() => {
      const curve = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curve.find(([x]) => x > 0.375 && x < 0.5);
    });
    if (!createdPoint || createdPoint[0] <= 0.375 || createdPoint[1] <= 0.375) {
      throw new Error(`A newly created point did not follow the original drag: ${JSON.stringify(createdPoint)}`);
    }

    const movedPoint = curvePointPosition(box, createdPoint[0], createdPoint[1]);
    await curve.click({ position: movedPoint });
    if (await pointCount() !== 6) throw new Error("Left-clicking a point should select it without removing it.");

    await curve.click({ position: movedPoint, button: "right" });
    if (await pointCount() !== 5) throw new Error("Right-clicking the new point did not remove it.");

    const middle = curvePointPosition(box, 0.5, 0.5);
    await page.mouse.move(box.x + middle.x, box.y + middle.y);
    await page.mouse.down();
    await page.mouse.move(box.x + middle.x + 12, box.y + middle.y - 8, { steps: 3 });
    await page.mouse.up();
    if (await pointCount() !== 5) throw new Error("Dragging a point should adjust it without removing it.");

    await curve.focus();
    const beforeCtrlNudge = await page.evaluate(() => {
      const curveValues = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curveValues.reduce((nearest, point) => Math.abs(point[0] - 0.5) < Math.abs(nearest[0] - 0.5) ? point : nearest)[1];
    });
    await page.keyboard.press("Control+ArrowUp");
    const afterCtrlNudge = await page.evaluate(() => {
      const curveValues = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curveValues.reduce((nearest, point) => Math.abs(point[0] - 0.5) < Math.abs(nearest[0] - 0.5) ? point : nearest)[1];
    });
    if (!(afterCtrlNudge > beforeCtrlNudge && afterCtrlNudge - beforeCtrlNudge <= 0.0011)) {
      throw new Error(`Ctrl curve keyboard nudge was not fine: before=${beforeCtrlNudge}, after=${afterCtrlNudge}.`);
    }
    await page.keyboard.press("Shift+ArrowUp");
    const afterShiftNudge = await page.evaluate(() => {
      const curveValues = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curveValues.reduce((nearest, point) => Math.abs(point[0] - 0.5) < Math.abs(nearest[0] - 0.5) ? point : nearest)[1];
    });
    if (!(afterShiftNudge - afterCtrlNudge > 0.009 && afterShiftNudge - afterCtrlNudge < 0.011)) {
      throw new Error(`Shift should retain ordinary curve movement: ctrl=${afterCtrlNudge}, shift=${afterShiftNudge}.`);
    }

    if (gpuAvailable) {
      await page.waitForFunction(() => window.HDRFinisherPerformance.gpuSnapshot().renders.length > 0);
      const gpu = await page.evaluate(async () => {
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        return window.HDRFinisherPerformance.gpuSnapshot();
      });
      if (!gpu.renders.some((render) => render.lane === "hdr")) {
        throw new Error(`Curve edits did not render through WebGPU: ${JSON.stringify(gpu.renders)}`);
      }
      if (!gpu.stages.some((stage) => stage.stage === "grading")) {
        throw new Error("Curve edits did not submit a GPU grading pass.");
      }
    }

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(`Curve editor interaction browser test passed (WebGPU ${gpuAvailable ? "verified" : "unavailable in headless Chrome"}).`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
