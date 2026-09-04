const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);

    const group = page.locator('[data-group="perspective"]');
    if (await group.evaluate((element) => element.classList.contains("collapsed"))) {
      await group.locator(".group-toggle").click();
    }
    const moduleNumber = await group.locator(".control-group-header").evaluate(
      (element) => getComputedStyle(element, "::before").content,
    );
    assert(moduleNumber === '"04"', `Perspective has the wrong module number: ${moduleNumber}`);

    const initial = await page.evaluate(() => ({
      revision: state.editRevision,
      geometry: structuredClone(state.adjustments.shared.geometry),
    }));
    await page.locator("#perspective-vertical-tool").click();
    await page.locator(".perspective-guide-handle").first().waitFor({ state: "visible" });
    await page.locator(".perspective-guide-handle").first().press("Shift+ArrowRight");
    assert(await page.locator(".perspective-guide-handle").first().evaluate((handle) => document.activeElement === handle),
      "Guide movement replaced the focused handle, breaking repeated keyboard input and pointer capture.");
    await page.waitForFunction(() => state.perspectiveGuidesDirty === true);
    const staged = await page.evaluate(() => ({
      draft: state.perspectiveMode,
      touched: state.perspectiveGuidesTouched.vertical,
      dirty: state.perspectiveGuidesDirty,
      revision: state.editRevision,
      geometry: structuredClone(state.adjustments.shared.geometry),
    }));
    assert(staged.draft && staged.touched && staged.dirty, `Keyboard guide editing did not stage a pending draft: ${JSON.stringify(staged)}`);
    assert(staged.revision === initial.revision, "Guided correction persisted before Apply.");
    assert(JSON.stringify(staged.geometry) === JSON.stringify(initial.geometry), "Guide placement solved live instead of staging.");
    assert(
      await page.locator("#perspective-guide-apply").isEnabled(),
      "Apply Guides button did not enable once a guide was moved.",
    );

    await page.locator("#perspective-guide-apply").click();
    await page.waitForFunction(() => /aligned|could not|cannot/.test(document.querySelector("#perspective-status")?.textContent || ""));
    assert(await page.evaluate(() => state.perspectiveGuidesDirty === false), "Apply Guides did not clear the pending state.");
    await page.locator("#perspective-cancel").click();
    const cancelledGuide = await page.evaluate(() => state.adjustments.shared.geometry);
    assert(JSON.stringify(cancelledGuide) === JSON.stringify(initial.geometry), "Cancel did not restore the complete pre-guide geometry.");

    const solveRequests = [];
    const solveResponses = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/perspective-solve")) {
        solveRequests.push(JSON.parse(request.postData() || "{}"));
      }
    });
    page.on("response", async (response) => {
      if (response.request().method() === "POST" && response.url().includes("/perspective-solve")) {
        solveResponses.push({ status: response.status(), body: await response.text().catch(() => "") });
      }
    });
    await page.locator("#perspective-vertical-tool").click();
    await page.locator(".perspective-guide-handle").first().waitFor({ state: "visible" });
    await page.locator(".perspective-guide-handle").first().press("Shift+ArrowRight");
    await page.waitForFunction(() => state.perspectiveGuidesDirty === true);
    await page.locator("#perspective-guide-apply").click();
    await page.waitForFunction(() => state.perspectiveGuidesDirty === false).catch(async (error) => {
      const ui = await page.evaluate(() => ({
        status: document.querySelector("#perspective-status")?.textContent,
        geometry: structuredClone(state.adjustments.shared.geometry),
        guides: structuredClone(state.perspectiveGuides),
        touched: structuredClone(state.perspectiveGuidesTouched),
      }));
      throw new Error(`${error.message}; requests=${JSON.stringify(solveRequests)}; responses=${JSON.stringify(solveResponses)}; ui=${JSON.stringify(ui)}`);
    });
    assert(solveRequests.length === 1, `Expected one solve call after applying vertical guides, got ${solveRequests.length}`);
    assert(
      solveRequests[0].vertical_guides.length > 0 && solveRequests[0].horizontal_guides.length === 0,
      "Applying vertical guides alone should not send horizontal guides.",
    );

    await page.locator("#perspective-horizontal-tool").click();
    await page.locator(".perspective-guide-handle").first().waitFor({ state: "visible" });
    await page.locator(".perspective-guide-handle").first().press("Shift+ArrowRight");
    await page.waitForFunction(() => state.perspectiveGuidesDirty === true);
    await page.locator("#perspective-guide-apply").click();
    await page.waitForFunction(() => state.perspectiveGuidesDirty === false).catch((error) => {
      throw new Error(`${error.message}; requests=${JSON.stringify(solveRequests)}; responses=${JSON.stringify(solveResponses)}`);
    });
    assert(solveRequests.length === 2, `Expected a second solve call after applying horizontal guides, got ${solveRequests.length}`);
    assert(
      solveRequests[1].vertical_guides.length > 0 && solveRequests[1].horizontal_guides.length > 0,
      "Applying horizontal guides did not stack with the already-applied vertical guides.",
    );

    const preReset = await page.evaluate(() => state.adjustments.shared.geometry.straighten_angle);
    await page.locator('[data-reset-group="perspective"]').click();
    const resetState = await page.evaluate(() => ({
      touched: structuredClone(state.perspectiveGuidesTouched),
      dirty: state.perspectiveGuidesDirty,
      horizontal: state.adjustments.shared.geometry.perspective_horizontal,
      vertical: state.adjustments.shared.geometry.perspective_vertical,
      straighten: state.adjustments.shared.geometry.straighten_angle,
      straightenControl: Number(document.getElementById("crop-straighten")?.value),
    }));
    assert(!resetState.touched.vertical && !resetState.touched.horizontal, "Reset did not clear the staged guide placement.");
    assert(!resetState.dirty, "Reset left a pending guide Apply outstanding.");
    assert(resetState.horizontal === 0 && resetState.vertical === 0, "Reset did not restore the default perspective values.");
    assert(resetState.straighten === 0, `Reset left straighten_angle at ${resetState.straighten} (was ${preReset} before reset) instead of restoring it to 0.`);
    assert(resetState.straightenControl === 0, "Reset did not sync the Crop & Rotate straighten slider back to 0.");
    assert(
      await page.locator("#perspective-cancel").isDisabled(),
      "Cancel stayed enabled right after Reset -- pressing it would silently discard the reset and bring back the old values.",
    );

    // Switching to another geometry tool (e.g. Crop & Rotate's own Rotate tool)
    // used to call the same silent-discard path as Cancel, so a pending Reset
    // would resurrect a previously-committed perspective correction the moment
    // the user clicked anywhere that navigated away. Simulate that: commit a
    // nonzero perspective correction, reopen and Reset it, then switch tools.
    await page.evaluate(() => {
      state.adjustments.shared.geometry.perspective_horizontal = 20;
      state.adjustments.shared.geometry.perspective_vertical = -15;
      state.adjustments.shared.geometry.perspective_rotate = 3;
      syncControlsFromState();
      renderControlState();
    });
    await page.locator("#perspective-vertical-tool").click();
    await page.locator('[data-reset-group="perspective"]').click();
    await page.waitForFunction(() => state.adjustments.shared.geometry.perspective_horizontal === 0
      && state.adjustments.shared.geometry.perspective_vertical === 0
      && state.adjustments.shared.geometry.perspective_rotate === 0);
    const geometryGroup = page.locator('[data-group="geometry"]');
    if (await geometryGroup.evaluate((element) => element.classList.contains("collapsed"))) {
      await geometryGroup.locator(".group-toggle").click();
    }
    await page.locator("#rotate-tool-toggle").click();
    const afterToolSwitch = await page.evaluate(() => structuredClone(state.adjustments.shared.geometry));
    assert(
      afterToolSwitch.perspective_horizontal === 0
        && afterToolSwitch.perspective_vertical === 0
        && afterToolSwitch.perspective_rotate === 0,
      `Switching tools after Reset resurrected the old committed perspective correction: ${JSON.stringify(afterToolSwitch)}`,
    );
    if (await page.locator("#rotate-cancel").isVisible().catch(() => false)) {
      await page.locator("#rotate-cancel").click();
    }

    await page.locator("#perspective-horizontal").evaluate((control) => {
      control.value = "24";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => Boolean(state.perspectivePreviewUrl), null, { timeout: 30000 });
    const sliderDraft = await page.evaluate(() => ({
      value: state.adjustments.shared.geometry.perspective_horizontal,
      revision: state.editRevision,
      draft: state.perspectiveMode,
    }));
    assert(sliderDraft.value === 24 && sliderDraft.draft, `Slider did not produce a Perspective draft: ${JSON.stringify(sliderDraft)}`);
    assert(sliderDraft.revision === initial.revision, "Slider draft persisted before Apply.");
    assert(
      await page.locator("#perspective-cancel").isEnabled(),
      "Cancel did not re-enable after a real edit following Reset.",
    );
    await page.locator("#perspective-cancel").click();
    assert(await page.evaluate(() => state.adjustments.shared.geometry.perspective_horizontal) === 0, "Slider Cancel did not restore zero.");

    await page.locator("#perspective-vertical").evaluate((control) => {
      control.value = "-18";
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#perspective-apply").click();
    await page.waitForFunction(
      (revision) => state.editRevision > revision && !state.geometryPresentationPending,
      initial.revision,
      { timeout: 30000 },
    );
    assert(await page.evaluate(() => state.adjustments.shared.geometry.perspective_vertical) === -18, "Apply lost the Perspective value.");

    await page.evaluate(() => queueEditCommand("undo"));
    await page.waitForFunction(() => state.adjustments.shared.geometry.perspective_vertical === 0, null, { timeout: 30000 });
    await page.evaluate(() => queueEditCommand("redo"));
    await page.waitForFunction(() => state.adjustments.shared.geometry.perspective_vertical === -18, null, { timeout: 30000 });
    await page.locator("#view-sdr").click();
    assert(
      await page.evaluate(() => state.currentView === "sdr" && state.adjustments.shared.geometry.perspective_vertical === -18),
      "HDR/SDR lane switch did not retain shared Perspective geometry.",
    );

    console.log("Perspective draft, guides, apply, lane parity, and undo/redo passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
