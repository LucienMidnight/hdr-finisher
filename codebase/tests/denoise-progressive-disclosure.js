// PRD 6.3 -- progressive disclosure for the Denoise controls.
//
// Amount and Detail Recovery are always visible; Luminance and Colour Noise
// sit behind Advanced; the method/preset selector stays visible; the Custom
// analysis settings stay behind Custom.
//
//   node tests/denoise-progressive-disclosure.js --url http://127.0.0.1:8765
//
// The constraint 6.3 attaches to this is the one worth testing: it must not
// change results silently. Hiding a control is only safe if the control keeps
// its value, keeps applying, and keeps reaching the render. So the layout
// assertions are the cheap half, and the expensive half is proving that a
// value set while the panel is shut still moves pixels, and that opening and
// closing the panel moves none.

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

// Small enough to import quickly, noisy enough that denoise has work to do.
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

    // 1. Layout. The adjustment groups do not expand without a session,
    //    so the source is imported first.
    const shown = (id) => page.evaluate(
      (target) => document.getElementById(target).getClientRects().length > 0,
      id,
    );
    await page.evaluate(() => {
      const toggle = document.querySelector(".denoise-group .group-toggle");
      if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    });

    assert(await shown("denoise-amount"), "Amount is not always visible.");
    assert(await shown("denoise-detail"), "Detail Recovery is not always visible.");
    assert(await shown("denoise-method"), "The method/preset selector is not visible.");
    assert(!await shown("denoise-luminance"), "Luminance is visible before Advanced is opened.");
    assert(!await shown("denoise-color"), "Colour Noise is visible before Advanced is opened.");
    assert(!await shown("denoise-levels"),
      "The Custom analysis settings are visible while a preset is selected.");

    await page.click("#denoise-advanced-toggle");
    assert(await shown("denoise-luminance"), "Advanced did not reveal Luminance.");
    assert(await shown("denoise-color"), "Advanced did not reveal Colour Noise.");
    assert(await page.evaluate(
      () => document.getElementById("denoise-advanced-toggle").getAttribute("aria-expanded"),
    ) === "true", "Advanced did not report itself expanded.");
    await page.click("#denoise-advanced-toggle");
    assert(!await shown("denoise-luminance"), "Advanced did not hide Luminance again.");

    // Recalculate stays reachable outside Custom. 6.3 reads as though it
    // belongs inside, but changing a *preset* also marks the analysis dirty,
    // so putting Recalculate behind Custom would strand a dirty preset with
    // no way to recalculate it.
    assert(await shown("denoise-recalculate"),
      "Recalculate is not reachable while a preset is selected.");

    // 2. The part that matters: nothing changed silently.

    const enableDenoise = async () => {
      await page.evaluate(() => {
        const group = document.querySelector(".denoise-group .group-toggle");
        if (group.getAttribute("aria-expanded") !== "true") group.click();
        const bypass = document.querySelector("#denoise-bypass");
        if (bypass.getAttribute("aria-pressed") !== "true") bypass.click();
      });
      await page.waitForFunction(
        () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
        null, { timeout: 300000 },
      );
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
      await page.waitForTimeout(1200);
    };
    await enableDenoise();

    const capture = async () => (await page.locator("#preview-canvas").screenshot({
      clip: { x: 0, y: 0, width: 384, height: 384 },
    })).toString("base64");
    const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
    const settled = async () => {
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 300000 });
      await page.waitForTimeout(900);
    };

    const before = await capture();
    const documentBefore = await page.evaluate(
      () => JSON.stringify(state.denoise[state.currentView].controls),
    );

    // Opening and closing Advanced must move nothing at all.
    await page.click("#denoise-advanced-toggle");
    await settled();
    await page.click("#denoise-advanced-toggle");
    await settled();
    const afterToggle = await capture();
    const documentAfterToggle = await page.evaluate(
      () => JSON.stringify(state.denoise[state.currentView].controls),
    );

    assert(digest(before) === digest(afterToggle),
      "Opening and closing Advanced changed the rendered picture.");
    assert(documentBefore === documentAfterToggle,
      "Opening and closing Advanced changed the stored controls: "
      + JSON.stringify({ documentBefore, documentAfterToggle }));

    // A control that is hidden must still apply. Drive Luminance to an
    // extreme with the panel shut; the picture has to move. If disclosure had
    // quietly detached the control, this is what would catch it.
    const luminanceHidden = await shown("denoise-luminance");
    assert(!luminanceHidden, "Luminance should be hidden for this step.");
    await page.evaluate(() => {
      const input = document.querySelector("#denoise-luminance");
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settled();
    const afterHiddenEdit = await capture();
    const storedLuminance = await page.evaluate(
      () => state.denoise[state.currentView].controls.luminance,
    );

    assert(storedLuminance === 0,
      "A hidden control did not reach the document: luminance is " + storedLuminance);
    assert(digest(before) !== digest(afterHiddenEdit),
      "Luminance made no difference to the picture while hidden, so disclosure "
      + "has detached it from the render.");

    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));
    console.log("Denoise progressive disclosure matches 6.3, and changes no results: "
      + "toggling Advanced is pixel-identical, and a hidden control still renders.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
