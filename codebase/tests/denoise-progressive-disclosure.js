// PRD 6.3 -- progressive disclosure for the Denoise controls.
//
// Amount and Detail Recovery are always visible; Luminance and Colour Noise
// sit behind Advanced. There is one method, so no method selector.
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
    // HDR screenshots can clip this synthetic fixture to white on an HDR
    // display. Use the SDR rendition so noise changes remain observable.
    await page.evaluate(() => switchLane("sdr"));
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
    assert(await page.locator("#denoise-detail").inputValue() === "0", "A new project did not start Detail Recovery at 0%.");
    assert(await page.locator("#denoise-detail-value").textContent() === "0%", "The new Detail Recovery default was not displayed as 0%.");
    for (const removed of ["denoise-algorithm", "denoise-method", "denoise-levels"]) {
      assert(await page.locator(`#${removed}`).count() === 0, `The removed control #${removed} is still in the panel.`);
    }
    assert(!await shown("denoise-luminance"), "Luminance is visible before Advanced is opened.");
    assert(!await shown("denoise-color"), "Colour Noise is visible before Advanced is opened.");

    await page.click("#denoise-advanced-toggle");
    assert(await shown("denoise-luminance"), "Advanced did not reveal Luminance.");
    assert(await shown("denoise-color"), "Advanced did not reveal Colour Noise.");
    assert(await page.evaluate(
      () => document.getElementById("denoise-advanced-toggle").getAttribute("aria-expanded"),
    ) === "true", "Advanced did not report itself expanded.");
    await page.click("#denoise-advanced-toggle");
    assert(!await shown("denoise-luminance"), "Advanced did not hide Luminance again.");

    assert(await shown("denoise-recalculate"), "Recalculate is not reachable.");

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

    // Capture only the visible image region. A locator screenshot of the
    // oversized zoomed canvas also captures page controls lying over it.
    const capture = async () => {
      const clip = await page.evaluate(() => {
        const pane = els.dropzone.getBoundingClientRect();
        return { x: pane.x + pane.width / 2 - 192,
          y: pane.y + pane.height / 2 - 192, width: 384, height: 384 };
      });
      return (await page.screenshot({ clip })).toString("base64");
    };
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
