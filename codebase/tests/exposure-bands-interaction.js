const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const minEv = -6;
const pqMaxEv = Math.log2(10000 / 100);

function graphPosition(box, inputEv, adjustmentEv = 0) {
  const left = 34;
  const right = 14;
  const top = 16;
  const bottom = 28;
  return {
    x: left + ((inputEv - minEv) / (pqMaxEv - minEv)) * (box.width - left - right),
    y: top + ((2 - adjustmentEv) / 4) * (box.height - top - bottom),
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
    await page.locator('[data-group="hdr-equalizer"] .group-toggle').click();

    const editor = page.locator("#tone-equalizer-editor");
    const nodeCount = () => page.evaluate(
      () => window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes.length,
    );
    if (await nodeCount() !== 5) throw new Error(`Expected five default exposure bands; received ${await nodeCount()}.`);

    const box = await editor.boundingBox();
    if (!box) throw new Error("Exposure Bands editor was not visible.");
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#tone-equalizer-editor");
      return canvas.width >= Math.floor(canvas.clientWidth * window.devicePixelRatio);
    });
    const highResolution = await editor.evaluate((canvas) => canvas.width >= Math.floor(canvas.clientWidth * window.devicePixelRatio));
    if (!highResolution) throw new Error("Exposure Bands backing resolution did not match its displayed size and device pixel ratio.");
    const newBand = graphPosition(box, -1.5);
    await page.mouse.move(box.x + newBand.x, box.y + newBand.y);
    await page.mouse.down();
    await page.mouse.move(box.x + newBand.x + 12, box.y + newBand.y - 16, { steps: 3 });
    await page.mouse.up();
    if (await nodeCount() !== 6) throw new Error("Pressing the Exposure Bands curve did not add a band.");
    const createdBand = await page.evaluate(() => {
      const nodes = window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes;
      return nodes.find(({ input_ev }) => input_ev > -1.5 && input_ev < 0);
    });
    if (!createdBand || createdBand.adjustment_ev <= 0) {
      throw new Error(`A newly created Exposure Band did not follow the original drag: ${JSON.stringify(createdBand)}`);
    }

    await editor.click({ button: "right", position: graphPosition(box, createdBand.input_ev, createdBand.adjustment_ev) });
    if (await nodeCount() !== 5) throw new Error("Right-clicking the new Exposure Band did not remove it.");

    const endpoint = graphPosition(box, -6);
    await editor.click({ button: "right", position: endpoint });
    if (await nodeCount() !== 5) throw new Error("A fixed endpoint band should not be removable.");

    const middleBand = await page.evaluate(() => {
      const nodes = window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes;
      return nodes.find(({ input_ev }) => Math.abs(input_ev) < 0.001);
    });
    if (!middleBand) throw new Error("The default 0 EV Exposure Band was missing.");
    const middle = graphPosition(box, middleBand.input_ev, middleBand.adjustment_ev);
    await page.mouse.move(box.x + middle.x, box.y + middle.y);
    await page.mouse.down();
    await page.mouse.move(box.x + middle.x + 8, box.y + middle.y - 10, { steps: 3 });
    await page.mouse.up();
    if (await nodeCount() !== 5) throw new Error("Dragging an Exposure Band should adjust it without changing the band count.");

    const hdrBandsBeforeMatch = await page.evaluate(
      () => JSON.stringify(window.HDRFinisherPerformance.authoringState().adjustments.hdr.tone_equalizer_nodes),
    );
    await page.click('[data-kind="sdr"]');
    await page.locator('[data-group="sdr-equalizer"] .group-toggle').click();
    const sdrEditor = page.locator("#sdr-tone-equalizer-editor");
    const sdrBox = await sdrEditor.boundingBox();
    if (!sdrBox) throw new Error("SDR Exposure Bands editor was not visible.");
    const editorGeometry = await page.evaluate(() => {
      const snapshot = (canvas) => {
        const style = getComputedStyle(canvas);
        const body = canvas.closest(".control-group-body");
        const bodyStyle = getComputedStyle(body);
        return {
          width: canvas.getBoundingClientRect().width,
          bodyWidth: body.getBoundingClientRect().width
            - Number.parseFloat(bodyStyle.paddingLeft)
            - Number.parseFloat(bodyStyle.paddingRight),
          display: style.display,
          aspectRatio: style.aspectRatio,
          backgroundColor: style.backgroundColor,
          borderTopWidth: style.borderTopWidth,
          cursor: style.cursor,
          touchAction: style.touchAction,
        };
      };
      return {
        hdr: snapshot(document.querySelector("#tone-equalizer-editor")),
        sdr: snapshot(document.querySelector("#sdr-tone-equalizer-editor")),
      };
    });
    if (Math.abs(editorGeometry.sdr.width - editorGeometry.sdr.bodyWidth) > 1) {
      throw new Error(`SDR Exposure Bands editor overflowed its control body: ${JSON.stringify(editorGeometry)}`);
    }
    for (const property of ["display", "aspectRatio", "backgroundColor", "borderTopWidth", "cursor", "touchAction"]) {
      if (editorGeometry.sdr[property] !== editorGeometry.hdr[property]) {
        throw new Error(`HDR/SDR Exposure Bands editor styling differs for ${property}: ${JSON.stringify(editorGeometry)}`);
      }
    }
    await page.click("#sdr-match-hdr-bands");
    const matched = await page.evaluate(() => {
      const { hdr, sdr } = window.HDRFinisherPerformance.authoringState().adjustments;
      return JSON.stringify(hdr.tone_equalizer_nodes) === JSON.stringify(sdr.tone_equalizer_nodes)
        && hdr.tone_equalizer_influence_radius === sdr.tone_equalizer_influence_radius
        && hdr.tone_equalizer_smoothing === sdr.tone_equalizer_smoothing;
    });
    if (!matched) throw new Error("Match HDR bands did not make a one-shot copy into SDR.");

    await page.locator("#sdr-tone-equalizer-band-value").fill("0.2");
    const independent = await page.evaluate((hdrBefore) => {
      const { hdr, sdr } = window.HDRFinisherPerformance.authoringState().adjustments;
      return JSON.stringify(hdr.tone_equalizer_nodes) === hdrBefore
        && JSON.stringify(sdr.tone_equalizer_nodes) !== hdrBefore;
    }, hdrBandsBeforeMatch);
    if (!independent) throw new Error("SDR Exposure Bands did not remain independent after matching HDR.");

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("HDR/SDR Exposure Bands and one-shot match browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
