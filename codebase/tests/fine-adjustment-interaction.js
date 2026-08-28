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

async function dragRange(page, slider, distance, { ctrl = false, shift = false, alt = false } = {}) {
  const box = await slider.boundingBox();
  if (!box) throw new Error("Fine-adjustment slider was not visible.");
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (ctrl) await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + distance, y, { steps: 5 });
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  if (shift) await page.keyboard.up("Shift");
  if (ctrl) await page.keyboard.up("Control");
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
    await dragRange(page, exposure, 70, { ctrl: true });
    const fineSliderDelta = Math.abs(Number(await exposure.inputValue()));
    const sliderRatio = ordinarySliderDelta / fineSliderDelta;
    if (!(fineSliderDelta > 0 && sliderRatio >= 7 && sliderRatio <= 13)) {
      throw new Error(`Ctrl slider drag was not approximately 10× finer: ordinary=${ordinarySliderDelta}, fine=${fineSliderDelta}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await exposure.focus();
    await page.keyboard.press("Control+ArrowRight");
    const keyboardValue = Number(await exposure.inputValue());
    if (Math.abs(keyboardValue - 0.005) > 0.0001) {
      throw new Error(`Ctrl+ArrowRight did not use one-tenth of the slider step: ${keyboardValue}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await exposure.focus();
    await page.keyboard.press("Shift+ArrowRight");
    if (Number(await exposure.inputValue()) !== 1) throw new Error("Shift+ArrowRight did not move to the next EV landing position.");
    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await page.keyboard.press("Control+Shift+ArrowRight");
    if (Number(await exposure.inputValue()) !== 1) throw new Error("Shift snapping did not win for Ctrl+Shift+ArrowRight.");

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await dragRange(page, exposure, 70, { alt: true });
    const altSliderDelta = Math.abs(Number(await exposure.inputValue()));
    if (Math.abs(altSliderDelta - ordinarySliderDelta) > 0.1) {
      throw new Error(`Alt still acted as a fine-adjustment alias: ordinary=${ordinarySliderDelta}, alt=${altSliderDelta}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    const sliderBox = await exposure.boundingBox();
    const sliderX = sliderBox.x + sliderBox.width / 2;
    const sliderY = sliderBox.y + sliderBox.height / 2;
    await page.mouse.move(sliderX, sliderY);
    await page.mouse.down();
    await page.mouse.move(sliderX + 24, sliderY, { steps: 3 });
    const beforeLiveShift = Number(await exposure.inputValue());
    await page.keyboard.down("Control");
    await page.mouse.move(sliderX + 48, sliderY, { steps: 3 });
    const afterLiveShift = Number(await exposure.inputValue());
    await page.keyboard.up("Control");
    await page.mouse.move(sliderX + 48, sliderY);
    const afterCtrlReleaseAtSamePointer = Number(await exposure.inputValue());
    await page.mouse.move(sliderX + 54, sliderY, { steps: 2 });
    const afterOrdinaryResume = Number(await exposure.inputValue());
    await page.mouse.up();
    const firstLeg = Math.abs(beforeLiveShift);
    const fineLeg = Math.abs(afterLiveShift - beforeLiveShift);
    if (!(firstLeg > 0 && fineLeg > 0 && firstLeg / fineLeg >= 7)) {
      throw new Error(`Pressing Ctrl during a slider drag was not applied live: first=${firstLeg}, fine=${fineLeg}.`);
    }
    if (Math.abs(afterCtrlReleaseAtSamePointer - afterLiveShift) > 1e-8 || !(afterOrdinaryResume > afterCtrlReleaseAtSamePointer)) {
      throw new Error(`Releasing Ctrl during a slider drag jumped or failed to resume ordinary movement: fine=${afterLiveShift}, release=${afterCtrlReleaseAtSamePointer}, resumed=${afterOrdinaryResume}.`);
    }

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await page.mouse.move(sliderX, sliderY);
    await page.mouse.down();
    await page.mouse.move(sliderX + 17, sliderY, { steps: 3 });
    await page.keyboard.down("Shift");
    await page.mouse.move(sliderX + 42, sliderY, { steps: 4 });
    const liveSnapValue = Number(await exposure.inputValue());
    await page.mouse.up();
    await page.keyboard.up("Shift");
    if (!Number.isInteger(liveSnapValue)) throw new Error(`Shift did not engage semantic EV snapping during a live drag: ${liveSnapValue}.`);

    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await dragRange(page, exposure, 70, { ctrl: true, shift: true });
    const combinedPointerValue = Number(await exposure.inputValue());
    if (!Number.isInteger(combinedPointerValue) || combinedPointerValue === 0) {
      throw new Error(`Shift snapping did not win during a Ctrl+Shift pointer drag: ${combinedPointerValue}.`);
    }

    const snapProfiles = await page.evaluate(() => {
      const inspect = (selector) => {
        const control = document.querySelector(selector);
        const values = rangeSnapProfile(control);
        return {
          min: Number(control.min), max: Number(control.max),
          values,
          home: rangeControlHome(control, Number(control.min), Number(control.max)),
          visualMarks: control.closest(".range-shell").querySelectorAll(".slider-ticks, .home-tick, .center-tick").length,
        };
      };
      return {
        ev: inspect('[data-path="hdr.exposure"]'),
        narrowEv: inspect('[data-path="current.color_grading.shadows.luminance_ev"]'),
        kelvin: inspect('[data-path="hdr.white_balance_kelvin"]'),
        nits: inspect('[data-path="hdr.highlight_compression_start_nits"]'),
        degrees: inspect('[data-path="shared.geometry.straighten_angle"]'),
        percentage: inspect('[data-path="current.color_grading.blending"]'),
        asymmetric: inspect('[data-local-grade="saturation"]'),
      };
    });
    if (!snapProfiles.ev.values.includes(0) || !snapProfiles.ev.values.includes(1)) throw new Error(`EV snap profile lacked authored stops: ${JSON.stringify(snapProfiles.ev)}.`);
    if (snapProfiles.narrowEv.values.length < 5 || !snapProfiles.narrowEv.values.includes(-0.5) || !snapProfiles.narrowEv.values.includes(0.5)) throw new Error(`Narrow EV snap profile lacked five useful landing positions: ${JSON.stringify(snapProfiles.narrowEv)}.`);
    if (!snapProfiles.kelvin.values.includes(6500)) throw new Error(`Kelvin snap profile lacked the declared 6500 K home: ${JSON.stringify(snapProfiles.kelvin)}.`);
    if (!snapProfiles.nits.values.includes(203) || !snapProfiles.nits.values.includes(400)) throw new Error(`Nits snap profile lacked delivery/home targets: ${JSON.stringify(snapProfiles.nits)}.`);
    if (!snapProfiles.degrees.values.includes(-45) || !snapProfiles.degrees.values.includes(0) || !snapProfiles.degrees.values.includes(45)) throw new Error(`Degree snap profile lacked authored angles: ${JSON.stringify(snapProfiles.degrees)}.`);
    if (!snapProfiles.percentage.values.includes(0) || !snapProfiles.percentage.values.includes(25) || !snapProfiles.percentage.values.includes(50) || !snapProfiles.percentage.values.includes(75) || !snapProfiles.percentage.values.includes(100)) throw new Error(`Percentage snap profile lacked five landing positions: ${JSON.stringify(snapProfiles.percentage)}.`);
    if (snapProfiles.asymmetric.values.length < 5 || !snapProfiles.asymmetric.values.includes(0)) throw new Error(`Asymmetric default profile did not retain five unique positions and home: ${JSON.stringify(snapProfiles.asymmetric)}.`);
    for (const profile of Object.values(snapProfiles)) {
      if (!profile.values.includes(profile.home)) throw new Error(`Snap profile did not retain its home position: ${JSON.stringify(profile)}.`);
      if (profile.visualMarks !== 0) throw new Error(`Semantic snapping leaked visual marks into the empty rail: ${JSON.stringify(profile)}.`);
    }

    await page.locator("#settings-open").click();
    await page.locator('[data-settings-tab="shortcuts"]').click();
    await page.locator("#shortcut-search").fill("hdr.exposure");
    const exposureIncrease = page.locator(".shortcut-row").filter({ hasText: "Increase Exposure" }).first();
    await exposureIncrease.locator(".shortcut-record").click();
    await page.keyboard.press("i");
    await page.locator("#settings-close").click();
    await resetRange(page, '[data-path="hdr.exposure"]', 0);
    await page.keyboard.press("i");
    await page.keyboard.press("Control+i");
    const assignedFineValue = Number(await exposure.inputValue());
    if (Math.abs(assignedFineValue - 0.055) > 0.0001) throw new Error(`Assigned continuous command did not use Ctrl precision: ${assignedFineValue}.`);
    await page.keyboard.press("Control+Shift+i");
    const assignedCombinedValue = Number(await exposure.inputValue());
    if (Math.abs(assignedCombinedValue - 0.06) > 0.0001) throw new Error(`Ctrl precision was lost when Shift accompanied an assigned continuous command: ${assignedCombinedValue}.`);
    await page.keyboard.press("Shift+i");
    await page.keyboard.press("Alt+i");
    if (Math.abs(Number(await exposure.inputValue()) - assignedCombinedValue) > 0.0001) {
      throw new Error("Shift or Alt remained an undocumented precision alias for assigned continuous commands.");
    }

    await page.locator('[data-group="curves"] .group-toggle').click();
    const curve = page.locator("#curve-editor");
    const curveBox = await curve.boundingBox();
    if (!curveBox) throw new Error("Curve editor was not visible.");
    const middleCurvePoint = curvePointPosition(curveBox, 0.5, 0.5);
    await page.keyboard.down("Control");
    await page.mouse.move(curveBox.x + middleCurvePoint.x, curveBox.y + middleCurvePoint.y);
    await page.mouse.down();
    await page.mouse.move(curveBox.x + middleCurvePoint.x + 60, curveBox.y + middleCurvePoint.y - 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    const shiftedCurvePoint = await page.evaluate(() => {
      const curveValues = window.HDRFinisherPerformance.authoringState().adjustments.hdr.luma_curve;
      return curveValues.reduce((closest, point) => Math.abs(point[0] - 0.5) < Math.abs(closest[0] - 0.5) ? point : closest);
    });
    const curveDeltaX = shiftedCurvePoint[0] - 0.5;
    const curveDeltaY = shiftedCurvePoint[1] - 0.5;
    if (!(curveDeltaX > 0.005 && curveDeltaX < 0.06 && curveDeltaY > 0.002 && curveDeltaY < 0.05)) {
      throw new Error(`Ctrl curve-point drag was not fine-grained: ${JSON.stringify(shiftedCurvePoint)}.`);
    }

    await page.locator('[data-group="hdr-equalizer"] .group-toggle').click();
    const bands = page.locator("#tone-equalizer-editor");
    const bandsBox = await bands.boundingBox();
    if (!bandsBox) throw new Error("Exposure Bands editor was not visible.");
    const middleBand = exposureBandPosition(bandsBox, 0, 0);
    await page.keyboard.down("Control");
    await page.mouse.move(bandsBox.x + middleBand.x, bandsBox.y + middleBand.y);
    await page.mouse.down();
    await page.mouse.move(bandsBox.x + middleBand.x + 60, bandsBox.y + middleBand.y - 60, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    const shiftedBand = await page.evaluate(() => {
      const nodes = window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes;
      return nodes.reduce((closest, node) => Math.abs(node.input_ev) < Math.abs(closest.input_ev) ? node : closest);
    });
    if (!(Math.abs(shiftedBand.input_ev) < 0.8 && shiftedBand.adjustment_ev > 0.02 && shiftedBand.adjustment_ev < 0.3)) {
      throw new Error(`Ctrl Exposure Band drag was not fine-grained: ${JSON.stringify(shiftedBand)}.`);
    }

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Ctrl fine adjustment and Shift slider snapping passed for sliders, Curves, and Exposure Bands.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
