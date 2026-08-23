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

function exposureBandPosition(box, inputEv, adjustmentEv = 0) {
  const minimumEv = -6;
  const maximumEv = Math.log2(10000 / 100);
  const left = 34;
  const right = 14;
  const top = 16;
  const bottom = 28;
  return {
    x: left + ((inputEv - minimumEv) / (maximumEv - minimumEv)) * (box.width - left - right),
    y: top + ((2 - adjustmentEv) / 4) * (box.height - top - bottom),
  };
}

async function resetRange(page, selector, value) {
  await page.locator(selector).evaluate((control, next) => {
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function dragRange(page, slider, distance, { shift = false } = {}) {
  const box = await slider.boundingBox();
  if (!box) throw new Error("Fine-adjustment slider was not visible.");
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + distance, y, { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
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

    await page.locator('[data-group="hdr-tone"] .group-toggle').click();
    const exposure = page.locator('[data-path="hdr.exposure"]');
    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await dragRange(page, exposure, 70);
    const ordinarySliderDelta = Math.abs(Number(await exposure.inputValue()));
    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await dragRange(page, exposure, 70, { shift: true });
    const fineSliderDelta = Math.abs(Number(await exposure.inputValue()));
    const sliderRatio = ordinarySliderDelta / fineSliderDelta;
    if (!(fineSliderDelta > 0 && sliderRatio >= 7 && sliderRatio <= 13)) {
      throw new Error(`Shift slider drag was not approximately 10× finer: ordinary=${ordinarySliderDelta}, fine=${fineSliderDelta}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await exposure.focus();
    await page.keyboard.press("Shift+ArrowRight");
    const keyboardValue = Number(await exposure.inputValue());
    if (Math.abs(keyboardValue - 0.005) > 0.0001) {
      throw new Error(`Shift+ArrowRight did not use one-tenth of the slider step: ${keyboardValue}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    const sliderBox = await exposure.boundingBox();
    const sliderX = sliderBox.x + sliderBox.width / 2;
    const sliderY = sliderBox.y + sliderBox.height / 2;
    await page.mouse.move(sliderX, sliderY);
    await page.mouse.down();
    await page.mouse.move(sliderX + 24, sliderY, { steps: 3 });
    const beforeLiveShift = Number(await exposure.inputValue());
    await page.keyboard.down("Shift");
    await page.mouse.move(sliderX + 48, sliderY, { steps: 3 });
    const afterLiveShift = Number(await exposure.inputValue());
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const firstLeg = Math.abs(beforeLiveShift);
    const fineLeg = Math.abs(afterLiveShift - beforeLiveShift);
    if (!(firstLeg > 0 && fineLeg > 0 && firstLeg / fineLeg >= 7)) {
      throw new Error(`Pressing Shift during a slider drag was not applied live: first=${firstLeg}, fine=${fineLeg}.`);
    }

    await page.locator('[data-group="curves"] .group-toggle').click();
    const curve = page.locator("#curve-editor");
    const curveBox = await curve.boundingBox();
    if (!curveBox) throw new Error("Curve editor was not visible.");
    const middleCurvePoint = curvePointPosition(curveBox, 0.5, 0.5);
    await page.keyboard.down("Shift");
    await page.mouse.move(curveBox.x + middleCurvePoint.x, curveBox.y + middleCurvePoint.y);
    await page.mouse.down();
    await page.mouse.move(curveBox.x + middleCurvePoint.x + 60, curveBox.y + middleCurvePoint.y - 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const shiftedCurvePoint = await page.evaluate(() => {
      const curveValues = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curveValues.reduce((closest, point) => Math.abs(point[0] - 0.5) < Math.abs(closest[0] - 0.5) ? point : closest);
    });
    const curveDeltaX = shiftedCurvePoint[0] - 0.5;
    const curveDeltaY = shiftedCurvePoint[1] - 0.5;
    if (!(curveDeltaX > 0.005 && curveDeltaX < 0.06 && curveDeltaY > 0.002 && curveDeltaY < 0.05)) {
      throw new Error(`Shift curve-point drag was not fine-grained: ${JSON.stringify(shiftedCurvePoint)}.`);
    }

    await page.locator('[data-group="hdr-equalizer"] .group-toggle').click();
    const bands = page.locator("#tone-equalizer-editor");
    const bandsBox = await bands.boundingBox();
    if (!bandsBox) throw new Error("Exposure Bands editor was not visible.");
    const middleBand = exposureBandPosition(bandsBox, 0, 0);
    await page.keyboard.down("Shift");
    await page.mouse.move(bandsBox.x + middleBand.x, bandsBox.y + middleBand.y);
    await page.mouse.down();
    await page.mouse.move(bandsBox.x + middleBand.x + 60, bandsBox.y + middleBand.y - 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const shiftedBand = await page.evaluate(() => {
      const nodes = window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes;
      return nodes.reduce((closest, node) => Math.abs(node.input_ev) < Math.abs(closest.input_ev) ? node : closest);
    });
    if (!(Math.abs(shiftedBand.input_ev) < 0.8 && shiftedBand.adjustment_ev > 0.02 && shiftedBand.adjustment_ev < 0.3)) {
      throw new Error(`Shift Exposure Band drag was not fine-grained: ${JSON.stringify(shiftedBand)}.`);
    }

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Shift fine-adjustment browser test passed for sliders, Curves, and Exposure Bands.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
