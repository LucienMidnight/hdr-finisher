// PRD 6.3 -- progressive disclosure for the Denoise controls.
//
// Amount, Luminance, Color Noise and Detail Recovery are always visible; the
// noise sizes sit behind Advanced. Clean Grain offers an optional colour correction.
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
    assert(await page.locator("#denoise-detail").inputValue() === "0.5", "A new project did not start Detail Recovery at 50%.");
    assert(await page.locator("#denoise-detail-value").textContent() === "50%", "The new Detail Recovery default was not displayed as 50%.");
    for (const key of ["amount", "color"]) {
      assert(await page.locator(`#denoise-${key}`).inputValue() === "0.75", `${key} did not start at 75%.`);
      assert(await page.locator(`#denoise-${key}-value`).textContent() === "75%", `${key} did not display 75%.`);
    }
    for (const removed of ["denoise-algorithm", "denoise-levels"]) {
      assert(await page.locator(`#${removed}`).count() === 0, `The removed control #${removed} is still in the panel.`);
    }
    const method = page.locator("#denoise-method");
    assert(await method.inputValue() === "clean_grain", "A new photo should select Clean Grain.");
    const options = await method.locator("option").evaluateAll(options =>
      options.map(option => [option.value, option.textContent.trim()]));
    assert(JSON.stringify(options.slice(0, 2)) === JSON.stringify([
      ["clean_grain", "Clean Grain"], ["standard", "Simple"],
    ]) && options[2]?.[0] === "micro_grain" && options.length === 3, "The Denoise menu changed.");
    // Steve, November 25: Color Noise moved out of Advanced, and Color
    // Splotches at 0% replaced the Clean color splotches checkbox.
    assert(await page.locator("#denoise-clean-splotches").count() === 0, "The Clean color splotches checkbox is back.");
    assert(await shown("denoise-splotches") && await page.locator("#denoise-splotches").inputValue() === "1",
      "Clean Grain should start with Color Splotches at 100%.");
    assert(!await page.locator("#denoise-protect-edges").isChecked(), "Protect color edges should start off.");
    assert(await shown("denoise-color"), "Color Noise is not in the main panel.");
    assert(await shown("denoise-luminance"), "Luminance is not in the main panel.");
    assert(!await shown("denoise-finest"), "Noise sizes are visible before Advanced is opened.");

    await page.click("#denoise-advanced-toggle");
    assert(await shown("denoise-finest"), "Advanced did not reveal the noise sizes.");
    assert(await page.evaluate(
      () => document.getElementById("denoise-advanced-toggle").getAttribute("aria-expanded"),
    ) === "true", "Advanced did not report itself expanded.");
    await page.click("#denoise-advanced-toggle");
    assert(!await shown("denoise-finest"), "Advanced did not hide the noise sizes again.");

    assert(await shown("denoise-recalculate"), "Recalculate is not reachable.");

    // 2. The part that matters: nothing changed silently.

    const enableDenoise = async () => {
      await page.evaluate(() => {
        const original = state.gpuPreview.analyzeDenoiseProxy;
        state.gpuPreview.analyzeDenoiseProxy = function (...args) {
          this.analyzeDenoiseProxy = original;
          window.denoiseEditableWhilePreparing = !els.denoiseAmount.disabled && !els.denoiseSplotchSize.disabled
            && els.denoiseRecalculate.disabled;
          return original.apply(this, args);
        };
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
    assert(await page.evaluate(() => window.denoiseEditableWhilePreparing),
      "Denoise should allow editing Amount and Splotch Size during preparation.");

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

    // A control that is hidden must still apply. Drive Finest to an
    // extreme with the panel shut; the picture has to move. If disclosure had
    // quietly detached the control, this is what would catch it.
    const finestHidden = await shown("denoise-finest");
    assert(!finestHidden, "Finest should be hidden for this step.");
    await page.evaluate(() => {
      const input = document.querySelector("#denoise-finest");
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settled();
    const afterHiddenEdit = await capture();
    const storedFinest = await page.evaluate(
      () => state.denoise[state.currentView].controls.finest_noise,
    );

    assert(storedFinest === 0,
      "A hidden control did not reach the document: finest_noise is " + storedFinest);
    assert(digest(before) !== digest(afterHiddenEdit),
      "Finest made no difference to the picture while hidden, so disclosure "
      + "has detached it from the render.");

    // A grade saved with the old checkbox off shows Color Splotches at 0%.
    // Raising the slider must prepare the splotch pass and reach the render.
    await page.evaluate(() => commitDenoiseControl("clean_splotches", false));
    await page.waitForFunction(() => state.denoiseRuntime[state.currentView].status === "ready"
      && state.gpuPreview.denoiseSourceSelector?.controls?.cleanSplotches === false, null, { timeout: 300000 });
    assert(await page.locator("#denoise-splotches").inputValue() === "0", "Splotches off did not show 0%.");
    assert(await page.locator("#denoise-splotch-size").isDisabled(), "Splotch Size stayed enabled at 0%.");
    await page.evaluate(() => {
      const input = document.querySelector("#denoise-splotches");
      input.value = "0.6";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const controls = state.gpuPreview.denoiseSourceSelector?.controls;
      return state.denoiseRuntime[state.currentView].status === "ready"
        && controls?.cleanSplotches === true && controls.colorSplotches === 0.6;
    }, null, { timeout: 300000 });
    const raised = await page.evaluate(() => state.denoise[state.currentView].controls);
    assert(raised.clean_splotches === true && raised.color_splotches === 0.6,
      "Raising Color Splotches from 0% did not turn splotch cleanup back on: " + JSON.stringify(raised));
    assert(!await page.locator("#denoise-splotch-size").isDisabled(), "Splotch Size stayed disabled above 0%.");

    // The reset routes must agree with the fresh-photo values, including
    // Advanced controls. Dispatch the actual double-click handler.
    const resetDefaults = await page.evaluate(() => {
      const expected = { method: "clean_grain", amount: 0.75, luminance: 0.5, color_noise: 0.75,
        detail_recovery: 0.5, finest_noise: 0.5, fine_noise: 0.5,
        medium_noise: 0.5, coarse_noise: 0.5 };
      const lane = state.currentView;
      for (const [id, key] of [["amount", "amount"], ["color", "color_noise"], ["detail", "detail_recovery"]]) {
        const control = document.getElementById(`denoise-${id}`);
        control.value = "0.1";
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        if (state.denoise[lane].controls[key] !== expected[key]) return false;
      }
      state.denoise[lane].controls.amount = 0.1;
      resetControlGroup("denoise");
      const preset = builtInGroupPresets({ group: "denoise", lane })[0];
      return Object.entries(expected).every(([key, value]) =>
        state.denoise[lane].controls[key] === value
        && preset.values[`denoise.${lane}.controls`][key] === value);
    });
    assert(resetDefaults, "Group reset, double-click reset and Default preset disagree with the approved defaults.");

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
