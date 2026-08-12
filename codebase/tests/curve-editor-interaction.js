const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function curvePointPosition(box, x, y) {
  const scaleX = box.width / 320;
  const scaleY = box.height / 220;
  const paddingX = 18 * scaleX;
  const paddingY = 18 * scaleY;
  return {
    x: paddingX + x * (box.width - paddingX * 2),
    y: box.height - paddingY - y * (box.height - paddingY * 2),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    const addedPoint = curvePointPosition(box, 0.375, 0.375);
    await curve.click({ position: addedPoint });
    if (await pointCount() !== 6) throw new Error("Clicking the curve line did not add a point.");

    await curve.click({ position: addedPoint });
    if (await pointCount() !== 5) throw new Error("Clicking the new point did not remove it.");

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
