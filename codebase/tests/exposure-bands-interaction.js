const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const minEv = -6;
const pqMaxEv = Math.log2(10000 / 100);

function graphPosition(box, inputEv, adjustmentEv = 0) {
  const scaleX = box.width / 320;
  const scaleY = box.height / 220;
  const left = 26 * scaleX;
  const right = 14 * scaleX;
  const top = 16 * scaleY;
  const bottom = 28 * scaleY;
  return {
    x: left + ((inputEv - minEv) / (pqMaxEv - minEv)) * (box.width - left - right),
    y: top + ((2 - adjustmentEv) / 4) * (box.height - top - bottom),
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
    await page.locator('[data-group="hdr-equalizer"] .group-toggle').click();

    const editor = page.locator("#tone-equalizer-editor");
    const nodeCount = () => page.evaluate(
      () => window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes.length,
    );
    if (await nodeCount() !== 5) throw new Error(`Expected five default exposure bands; received ${await nodeCount()}.`);

    const box = await editor.boundingBox();
    if (!box) throw new Error("Exposure Bands editor was not visible.");
    const newBand = graphPosition(box, -1.5);
    await editor.click({ position: newBand });
    if (await nodeCount() !== 6) throw new Error("Left-clicking the Exposure Bands curve did not add a band.");

    await editor.click({ button: "right", position: newBand });
    if (await nodeCount() !== 5) throw new Error("Right-clicking the new Exposure Band did not remove it.");

    const endpoint = graphPosition(box, -6);
    await editor.click({ button: "right", position: endpoint });
    if (await nodeCount() !== 5) throw new Error("A fixed endpoint band should not be removable.");

    const middle = graphPosition(box, 0);
    await page.mouse.move(box.x + middle.x, box.y + middle.y);
    await page.mouse.down();
    await page.mouse.move(box.x + middle.x + 8, box.y + middle.y - 10, { steps: 3 });
    await page.mouse.up();
    if (await nodeCount() !== 5) throw new Error("Dragging an Exposure Band should adjust it without changing the band count.");

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Exposure Bands direct add/remove browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
