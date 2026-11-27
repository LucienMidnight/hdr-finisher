const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

async function verifyOverlayScrollbars(page) {
  const review = path.resolve(__dirname, "../output/review/overlay-scrollbars");
  fs.mkdirSync(review, { recursive: true });
  await page.locator("#file-input").setInputFiles(path.resolve(__dirname, "fixtures/sdr_gradient.png"));
  await page.waitForFunction(() => state.session && !state.importInProgress && document.body.dataset.workflow === "grade");
  const waitThumb = (selector, state) => page.waitForFunction(({ selector, state }) => {
    const rail = document.querySelector(selector);
    const thumb = rail.querySelector(":scope > .overlay-scrollbar-thumb");
    const opacity = Number(getComputedStyle(thumb).opacity);
    return state === "fits" ? !thumb.hasAttribute("data-scrollable") : thumb.hasAttribute("data-scrollable")
      && (state === "shown" ? opacity === 1 : opacity === 0);
  }, { selector, state });
  const away = () => page.mouse.move(340, 95);
  for (const theme of ["default-light", "modern-dark", "studio-gray"]) {
    await page.evaluate(theme => {
      HDRApplicationShell.openSettings("appearance");
      document.querySelector('[data-theme-option="' + theme + '"]').click();
    }, theme);
    await page.locator("#settings-close").click();
    for (const [stage, selector, dividers] of [
      ["grade", ".grade-rail", [".control-title-row", ".grade-folder-tabs", '[data-group="hdr-tone"] .control-group-header']],
      ["proof", "#proof-workflow-panel", [".workflow-rail-header"]],
    ]) {
      await page.locator('[data-workflow-tab="' + stage + '"]').click();
      const rail = page.locator(selector);
      const thumb = rail.locator(":scope > .overlay-scrollbar-thumb");
      const assertEdge = () => rail.evaluate((node, dividers) => {
        const end = node.getBoundingClientRect().right - parseFloat(getComputedStyle(node).borderRightWidth);
        return dividers.map(selector => Math.abs(node.querySelector(selector).getBoundingClientRect().right - end));
      }, dividers).then(errors => assert(errors.every(error => error <= 1), stage + " dividers stop short: " + errors));
      const shot = name => rail.screenshot({ path: path.join(review, [theme, stage, name].join("-") + ".png") });
      await away();
      await waitThumb(selector, "fits");
      await assertEdge();
      await shot("fits");
      if (stage === "grade") {
        await rail.locator('[data-group="hdr-tone"] .group-toggle').click();
      }
      // Exercise the same real controls with a compact panel viewport.
      await rail.evaluate(node => { node.style.maxBlockSize = "340px"; node.scrollTop = 0; });
      await waitThumb(selector, "idle");
      await assertEdge();
      await shot("overflow-idle");
      const box = await rail.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 130);
      await waitThumb(selector, "shown");
      const geometry = await rail.evaluate(node => {
        const thumb = node.querySelector(":scope > .overlay-scrollbar-thumb");
        const rect = thumb.getBoundingClientRect();
        const controls = [...node.querySelectorAll("button, input, select, textarea, output, a[href]")];
        const covered = controls.filter(control => {
          const r = control.getBoundingClientRect();
          return r.width && r.height && r.right > rect.left + .5 && r.left < rect.right
            && getComputedStyle(control).visibility === "visible";
        }).map(control => control.id || control.className || control.textContent.trim());
        const pseudo = getComputedStyle(thumb, "::after");
        return { covered, hit: rect.width, paint: parseFloat(pseudo.width), aria: thumb.getAttribute("aria-hidden"),
          gutter: node.offsetWidth - node.clientWidth - parseFloat(getComputedStyle(node).borderLeftWidth) - parseFloat(getComputedStyle(node).borderRightWidth) };
      });
      assert.deepEqual(geometry.covered, [], stage + " controls enter the thumb hit strip");
      assert.equal(geometry.gutter, 0);
      assert.equal(geometry.aria, "true");
      assert(geometry.hit > geometry.paint && geometry.paint > 0);
      await page.mouse.wheel(0, 130);
      await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, selector);
      await shot("scrolled-shown");

      if (theme === "default-light") {
        await rail.evaluate(node => { node.scrollTop = 0; });
        const r = await thumb.boundingBox();
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await page.mouse.down();
        await page.mouse.move(r.x - 18, r.y + r.height / 2 + 52, { steps: 8 });
        assert.equal(await thumb.getAttribute("data-dragging"), "", "Pointer capture keeps the thumb active");
        await page.mouse.up();
        assert(await rail.evaluate(node => node.scrollTop > 0), "Drag must move native scroll");
        await rail.evaluate(node => { node.scrollTop = 0; });
        const focus = stage === "grade" ? "#grade-mode-global" : '[data-proof-lane="hdr"]';
        await rail.locator(focus).focus();
        await page.keyboard.press("PageDown");
        await page.waitForFunction(selector => document.querySelector(selector).scrollTop > 0, selector);
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await thumb.evaluate(node => getComputedStyle(node).transitionDuration), "0s");
        await page.emulateMedia({ reducedMotion: "no-preference" });
      }
      await away();
      assert.equal(await thumb.getAttribute("data-active"), "", "Hold the thumb through the idle interval");
      await waitThumb(selector, "idle");
      await shot("scrolled-hidden");
      await rail.evaluate(node => { node.style.removeProperty("max-block-size"); node.scrollTop = 0; });
      if (stage === "grade") await rail.locator('[data-group="hdr-tone"] .group-toggle').click();
      await waitThumb(selector, "fits");
    }
  }
  console.log("PASS: Grade and Proof full-bleed dividers, overflow and fit, safe thumb hit targets, wheel, drag, keyboard, idle and reduced motion in three themes.");
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const output = path.resolve(__dirname, "../output/panel-alignment");
  fs.mkdirSync(output, { recursive: true });
  const near = (a, b, label) => assert(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
  const box = async (scope, selector) => scope.locator(selector).boundingBox();
  const drag = async (scope, selector, delta) => {
    // Frame bounding boxes are expressed in main-page coordinates.
    const rect = await box(scope, selector);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 90);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + delta, rect.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  try {
    await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765", { waitUntil: "networkidle" });
    if (process.argv.includes("--overlay-scrollbars")) {
      await verifyOverlayScrollbars(page);
      return;
    }
    const frame = page.frameLocator("#library-frame");
    await frame.locator(".library-toolbar").waitFor();
    const toolbar = await box(frame, ".library-toolbar");
    for (const selector of [".library-nav .library-heading", ".library-details .library-heading"]) {
      const header = await frame.locator(selector).first().boundingBox();
      near(header.y, toolbar.y, `Library top ${selector}`);
      near(header.y + header.height, toolbar.y + toolbar.height, `Library bottom ${selector}`);
    }
    for (const [side, rail, delta] of [["left", ".library-nav", 35], ["right", ".library-details", -35]]) {
      const before = await box(frame, rail);
      await drag(frame, `#library-${side}-splitter`, delta);
      near((await box(frame, rail)).width, before.width + 35, `Library ${side} drag`);
      await frame.locator(`#collapse-${side}`).click();
      await frame.locator(`#collapse-${side}`).click();
      near((await box(frame, rail)).width, before.width + 35, `Library ${side} reopen`);
      await frame.locator(`#library-${side}-splitter`).press("Home");
      near((await box(frame, rail)).width, 200, `Library ${side} keyboard`);
    }
    await frame.locator("#place-title").click();
    await page.mouse.move(1000, 600);
    await page.screenshot({ path: path.join(output, "library.png") });
    for (const stage of ["grade", "proof", "export"]) {
      await page.locator(`[data-workflow-tab="${stage}"]`).click();
      await page.waitForTimeout(200);
      const viewer = await box(page, ".viewer-bar");
      const left = stage === "export" ? ".batch-preset-rail" : ".source-rail";
      const right = stage === "grade" ? ".grade-rail" : stage === "proof" ? "#proof-workflow-panel" : "#export-sheet";
      const title = stage === "grade" ? ".control-title-row" : stage === "proof" ? "#proof-workflow-panel .workflow-rail-header" : "#export-sheet .sheet-header";
      near((await box(page, left)).y, viewer.y, `${stage} left top`);
      near((await box(page, right)).y, viewer.y, `${stage} right top`);
      const header = await box(page, title);
      near(header.y + header.height, viewer.y + viewer.height, `${stage} header bottom`);
      for (const [splitter, rail, delta] of [["#source-splitter", left, 24], ["#grade-splitter", right, -24]]) {
        const before = await box(page, rail);
        await drag(page, splitter, delta);
        near((await box(page, rail)).width, before.width + 24, `${stage} ${rail} drag`);
        await page.locator(splitter).dblclick();
      }
      await page.screenshot({ path: path.join(output, `${stage}.png`) });
      if (stage === "proof") await page.locator("#source-rail-expand").click();
    }
    console.log("PASS: aligned panel tops and header borders; left/right drag resizing on all four pages; Library keyboard sizing and collapse restoration.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
