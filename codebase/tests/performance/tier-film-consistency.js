/**
 * Compare the visible contribution of spatial film effects at 4K and Full.
 *
 * The page compositor is sampled rather than drawImage(canvas): Chromium may
 * return zeroes when a presented WebGPU canvas is copied through 2D canvas.
 * Usage:
 *   node tests/performance/tier-film-consistency.js --url http://127.0.0.1:8000 --input <large image>
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = path.resolve(argument("--input",
    "local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr"));
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const configure = (scenario) => page.evaluate((selected) => {
    const look = state.adjustments.hdr.film_look;
    const bloom = selected === "bloom" || selected === "diffusion" || selected === "combined";
    const halation = selected === "halation" || selected === "combined";
    Object.assign(look, {
      look_strength: 100,
      grain_enabled: false,
      grain_amount: 0,
      halation_enabled: halation,
      halation_amount: halation ? 70 : 0,
      halation_radius: 1.2,
      halation_sensitivity: 60,
      bloom_enabled: bloom,
      bloom_amount: bloom ? 55 : 0,
      bloom_radius: 3,
      bloom_sensitivity: 75,
      bloom_highlight_detail: selected === "diffusion" ? 0 : 100,
      image_structure_enabled: false,
      image_softness: 0,
      microcontrast: 0,
      film_resolution: 100,
    });
  }, scenario);

  const captureTier = async (tier) => {
    await page.evaluate((value) => {
      const select = document.querySelector("#preview-resolution");
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, tier);
    await page.waitForFunction((value) => (
      viewerState().status === "ready"
      && state.acceptedPresentation?.exact === true
      && state.acceptedPresentation?.requestedTier === value
    ), tier, { timeout: 900000 });
    await page.evaluate(async () => state.gpuPreview.device.queue.onSubmittedWorkDone());
    // Queue completion makes the texture ready; the browser compositor can
    // still be presenting the preceding canvas frame until its next commit.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    )));
    const canvas = page.locator("#preview-canvas");
    const box = await canvas.boundingBox();
    if (!box || box.width < 2 || box.height < 2) throw new Error(`No visible canvas at ${tier}`);
    // Element capture keeps fractional layout coordinates stable between tier
    // changes. With the interpretation gate dismissed below, the compositor
    // has no UI layer overlapping this element, so these are picture pixels.
    let previous = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const shot = await canvas.screenshot();
      if (previous?.equals(shot)) return shot.toString("base64");
      previous = shot;
      await page.waitForTimeout(100);
    }
    throw new Error(`WebGPU compositor did not settle at ${tier}`);
  };

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", input);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    // This fixture has no chromaticities. Accept the application's disclosed
    // fallback explicitly so the interpretation warning no longer overlaps
    // the canvas: compositor capture is required for WebGPU, but UI chrome is
    // not picture data and must not dilute the per-pixel measurements.
    const interpretationGate = page.locator("#interpretation-gate");
    if (await interpretationGate.isVisible()) {
      await page.click("#accept-interpretation");
      await interpretationGate.waitFor({ state: "hidden" });
    }

    await configure("neutral");
    const neutral4k = await captureTier("4096");
    const neutralFull = await captureTier("full");
    const scenarios = {};
    for (const scenario of ["bloom", "diffusion", "halation", "combined"]) {
      await configure(scenario);
      scenarios[scenario] = {
        tier4k: await captureTier("4096"),
        full: await captureTier("full"),
      };
    }
    const outputDirectory = path.resolve("output/tier-film-consistency");
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputShots = { neutral4k, neutralFull };
    for (const [scenario, shots] of Object.entries(scenarios)) {
      outputShots[`${scenario}4k`] = shots.tier4k;
      outputShots[`${scenario}Full`] = shots.full;
    }
    for (const [name, shot] of Object.entries(outputShots)) {
      fs.writeFileSync(path.join(outputDirectory, `${name}.png`), Buffer.from(shot, "base64"));
    }

    const metrics = await page.evaluate(async ({ neutral4k: neutral4kShot, neutralFull: neutralFullShot, scenarios: scenarioShots }) => {
      const decode = async (base64) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [n4, nf] = await Promise.all([decode(neutral4kShot), decode(neutralFullShot)]);
      if (nf.width !== n4.width || nf.height !== n4.height) {
        return { error: "Compositor sample dimensions differ" };
      }
      const results = {};
      for (const [scenario, shots] of Object.entries(scenarioShots)) {
        const [e4, ef] = await Promise.all([decode(shots.tier4k), decode(shots.full)]);
        if (![e4, ef].every((image) => image.width === n4.width && image.height === n4.height)) {
          return { error: `Compositor sample dimensions differ for ${scenario}` };
        }
      let effect4 = 0;
      let effectFull = 0;
      let disagreement = 0;
      let affected = 0;
      let peakDisagreement = 0;
      let peakX = 0;
      let peakY = 0;
      const pixels = n4.width * n4.height;
      for (let offset = 0; offset < n4.data.length; offset += 4) {
        let local4 = 0;
        let localFull = 0;
        let localDisagreement = 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const delta4 = e4.data[offset + channel] - n4.data[offset + channel];
          const deltaFull = ef.data[offset + channel] - nf.data[offset + channel];
          local4 += Math.abs(delta4);
          localFull += Math.abs(deltaFull);
          localDisagreement += Math.abs(delta4 - deltaFull);
        }
        effect4 += local4 / 3;
        effectFull += localFull / 3;
        disagreement += localDisagreement / 3;
        if (localDisagreement / 3 > peakDisagreement) {
          peakDisagreement = localDisagreement / 3;
          const pixel = offset / 4;
          peakX = pixel % n4.width;
          peakY = Math.floor(pixel / n4.width);
        }
        if (local4 > 3 || localFull > 3) affected += 1;
      }
        results[scenario] = {
        width: n4.width,
        height: n4.height,
        meanEffect4k: effect4 / pixels,
        meanEffectFull: effectFull / pixels,
        meanContributionDisagreement: disagreement / pixels,
        peakContributionDisagreement: peakDisagreement,
        peakAt: [peakX, peakY],
        affectedPixels: affected,
      };
      }
      return results;
    }, { neutral4k, neutralFull, scenarios });

    console.log(JSON.stringify(metrics, null, 2));
    if (metrics.error) throw new Error(metrics.error);
    // Keep the proportional regression guard intact. Chromium is the
    // authoritative harness for this test and the dense-kernel change passes
    // here; the earlier Electron-only failure came from that harness's fixed
    // window geometry, not evidence that this threshold needed relaxing.
    if (metrics.diffusion.meanContributionDisagreement
      > metrics.bloom.meanContributionDisagreement * 1.25
      || metrics.diffusion.peakContributionDisagreement
      > metrics.bloom.peakContributionDisagreement * 1.25) {
      throw new Error(
        "Bloom diffusion adds a tier-sensitive hard-edge echo: "
        + JSON.stringify({ bloom: metrics.bloom, diffusion: metrics.diffusion }),
      );
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
