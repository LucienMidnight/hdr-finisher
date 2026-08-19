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
    const highResolution = await curve.evaluate((canvas) => canvas.width >= Math.floor(canvas.clientWidth * window.devicePixelRatio));
    if (!highResolution) throw new Error("Curve editor backing resolution did not match its displayed size and device pixel ratio.");
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

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Curve editor interaction browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
