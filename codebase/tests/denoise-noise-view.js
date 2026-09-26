// Denoise "Show noise": the preview shows only what Denoise removes.
//
//   node tests/denoise-noise-view.js --url http://127.0.0.1:8765
//   node tests/run-in-electron.js tests/denoise-noise-view.js
//
// The view replaces the graded picture with mid gray plus the removed
// difference, so the properties worth proving are:
//
//   - it is only offered while Denoise has a result to difference against;
//   - it really is the removed layer: flat gray at Amount 0, and busier as
//     Amount rises, on both the Direct and the Tiled route;
//   - it is view state: turning it off restores the exact graded pixels, and
//     nothing reaches the document or the edit history.

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const WIDTH = 2400;
const HEIGHT = 1600;

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const source = ensureLargeNoisySource(WIDTH, HEIGHT);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", source);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 300000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
    await page.click("#zoom-actual");

    const settled = async () => {
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
      await page.waitForTimeout(900);
    };
    // A patch from the middle of the visible viewer: status rows cover its top
    // edge and the navigator its bottom-right corner.
    const png = async () => {
      const frame = await page.locator("#dropzone").boundingBox();
      const clip = {
        x: Math.round(frame.x + frame.width * 0.2),
        y: Math.round(frame.y + frame.height * 0.4),
        width: Math.round(frame.width * 0.35),
        height: Math.round(frame.height * 0.25),
      };
      return (await page.screenshot({ clip })).toString("base64");
    };
    const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
    // Mean and spread of the capture's luma, decoded in the page because the
    // test tree carries no PNG decoder.
    const stats = (data) => page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      let squares = 0;
      const count = pixels.length / 4;
      for (let index = 0; index < pixels.length; index += 4) {
        const y = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
        sum += y;
        squares += y * y;
      }
      const mean = sum / count;
      return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)) };
    }, data);
    const setAmount = async (value) => {
      await page.evaluate((next) => {
        const input = document.querySelector("#denoise-amount");
        input.value = String(next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      await settled();
    };
    const control = () => page.evaluate(() => ({
      disabled: document.getElementById("denoise-show-noise").disabled,
      pressed: document.getElementById("denoise-show-noise").getAttribute("aria-pressed"),
      label: document.getElementById("denoise-show-noise").textContent.trim(),
      badge: !document.getElementById("noise-view-badge").classList.contains("hidden"),
    }));

    await page.evaluate(() => {
      const toggle = document.querySelector(".denoise-group .group-toggle");
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });

    // 1. Nothing to show until Denoise has a result.
    assert((await control()).disabled, "Show noise is offered before Denoise is on.");

    // Analysis started while the 100% source is still streaming is superseded
    // by that stream; let the zoom settle first, and allow one recalculation.
    await settled();
    await page.evaluate(() => document.querySelector("#denoise-bypass").click());
    const denoiseSettled = () => page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 300000 },
    );
    await denoiseSettled();
    if (await page.evaluate(() => state.denoiseRuntime[state.currentView].status) === "error") {
      await settled();
      await page.click("#denoise-recalculate");
      await denoiseSettled();
    }
    assert(await page.evaluate(() => state.denoiseRuntime[state.currentView].status) === "ready",
      "Denoise did not become ready: " + await page.evaluate(() => state.denoiseRuntime[state.currentView].error));
    await settled();
    assert(!(await control()).disabled, "Show noise stays disabled with Denoise ready.");

    const document0 = await page.evaluate(() => JSON.stringify(state.denoise));
    const amount0 = await page.evaluate(() => state.denoise[state.currentView].controls.amount);

    for (const route of ["direct", "tiled"]) {
      await page.evaluate((value) => applyExecutionOverride(value), route);
      await setAmount(1);
      await settled();
      const graded = await png();

      await page.click("#denoise-show-noise");
      await settled();
      const shown = await control();
      assert(shown.pressed === "true" && shown.label === "Hide noise" && shown.badge,
        `${route}: the control and badge do not report the noise view: ${JSON.stringify(shown)}`);
      const execution = await page.evaluate(() => state.acceptedPresentation?.execution || null);
      assert(execution === route, `${route}: the noise view presented through ${execution}.`);

      const strong = await stats(await png());
      await setAmount(0);
      const none = await stats(await png());
      await setAmount(1);

      // Mid gray is sRGB 0.5, about 128 in an 8-bit capture.
      assert(Math.abs(none.mean - 128) < 6 && none.spread < 2,
        `${route}: Amount 0 removes nothing, so the view must be flat mid gray: ${JSON.stringify(none)}`);
      assert(Math.abs(strong.mean - 128) < 20,
        `${route}: the removed layer should sit around mid gray: ${JSON.stringify(strong)}`);
      assert(strong.spread > none.spread + 2,
        `${route}: full Amount shows no more removed noise than none: ${JSON.stringify({ strong, none })}`);

      await page.click("#denoise-show-noise");
      await settled();
      const hidden = await control();
      assert(hidden.pressed === "false" && hidden.label === "Show noise" && !hidden.badge,
        `${route}: the noise view did not switch off: ${JSON.stringify(hidden)}`);
      assert(digest(await png()) === digest(graded),
        `${route}: turning the noise view off did not restore the graded picture exactly.`);
    }
    await page.evaluate(() => applyExecutionOverride(null));
    await setAmount(amount0);

    // 3. Switching Denoise off ends the view, rather than leaving a flat gray
    //    frame that looks like a broken preview.
    await page.click("#denoise-show-noise");
    await settled();
    await page.evaluate(() => document.querySelector("#denoise-bypass").click());
    await settled();
    const afterBypass = await control();
    assert(afterBypass.disabled && afterBypass.pressed === "false" && !afterBypass.badge,
      "Disabling Denoise left the noise view on: " + JSON.stringify(afterBypass));

    // 4. View state only. Amount is back where it started and Denoise was
    //    switched off by step 3, so everything else must match exactly.
    const document1 = await page.evaluate(() => JSON.stringify({
      ...state.denoise,
      [state.currentView]: { ...state.denoise[state.currentView], enabled: true },
    }));
    assert(document1 === document0,
      "The noise view changed the denoise document: " + JSON.stringify({ document0, document1 }));

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));
    console.log("Show noise: offered only with a Denoise result, flat at Amount 0 and busier at full "
      + "Amount on Direct and Tiled, restores the graded picture exactly, and stays out of the document.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
