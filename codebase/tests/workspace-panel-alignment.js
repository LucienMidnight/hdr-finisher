const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");

async function verifyScrollbars(page) {
  const review = path.resolve(__dirname, "../output/review/overlay-scrollbars");
  fs.mkdirSync(review, { recursive: true });
  const photo = path.resolve(__dirname, "fixtures/sdr_gradient.png");
  const shot = (theme, name) => path.join(review, theme + "-" + name + ".png");
  const close = (a, b, label) => assert(Math.abs(a - b) <= 1, label + ": " + a + " vs " + b);
  async function checkLane(rail, overflowing, dividers = []) {
    const result = await rail.evaluate((node, dividers) => {
      const css = getComputedStyle(node), rect = node.getBoundingClientRect();
      const edge = rect.left + node.clientLeft + node.clientWidth;
      return {
        overflow: node.scrollHeight > node.clientHeight,
        heights: [node.scrollHeight, node.clientHeight],
        width: node.offsetWidth - node.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth),
        edges: dividers.map(selector => {
          const row = node.querySelector(selector);
          const style = getComputedStyle(row);
          const line = [style.borderTopWidth, style.borderBottomWidth].includes("1px")
            || style.boxShadow.includes("0px -1px 0px 0px inset");
          return { delta: row.getBoundingClientRect().right - edge, line, selector, shadow: style.boxShadow };
        }),
      };
    }, dividers);
    assert.equal(result.overflow, overflowing, String(rail) + " " + JSON.stringify(result));
    assert.equal(result.width, overflowing ? 15 : 0, String(rail));
    for (const edge of result.edges) {
      close(edge.delta, 0, String(rail) + " divider meets content edge");
      assert(edge.line, String(rail) + " divider is drawn: " + JSON.stringify(edge));
    }
  }
  async function capturePanel(rail, file, maxHeight) {
    const box = await rail.boundingBox();
    await page.screenshot({ path: file, clip: {
      x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxHeight),
    } });
  }
  async function checkLanePaint(rail) {
    const box = await rail.boundingBox();
    const geometry = await rail.evaluate(node => {
      const css = getComputedStyle(node);
      return { x: node.clientLeft + node.clientWidth, panel: css.getPropertyValue("--panel"),
        hairline: css.getPropertyValue("--hairline") };
    });
    const strip = await page.screenshot({ scale: "css", clip: {
      x: Math.round(box.x + geometry.x), y: Math.round(box.y + 22), width: 2, height: 16,
    } });
    const paint = await page.evaluate(async ({ strip, geometry }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + strip;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 2; canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, 2, img.height).data;
      ctx.fillStyle = geometry.panel;
      ctx.fillRect(0, 0, 2, 1);
      ctx.fillStyle = geometry.hairline;
      ctx.fillRect(0, 0, 1, 1);
      const reference = ctx.getImageData(0, 0, 2, 1).data;
      return Array.from({ length: img.height }, (_, y) =>
        reference.every((value, i) => Math.abs(value - pixels[y * 8 + i]) <= 2)).filter(Boolean).length;
    }, { strip: strip.toString("base64"), geometry });
    assert(paint >= 12, String(rail) + " has a painted left hairline separate from the track: " + paint);
  }
  async function status(theme, workflow) {
    const dock = page.locator("#viewer-status-dock");
    await dock.waitFor();
    const chrome = await dock.evaluate(node => {
      const css = getComputedStyle(node);
      const sample = document.createElement("i");
      sample.style.color = "var(--hairline)";
      node.append(sample);
      const expected = getComputedStyle(sample).color;
      sample.remove();
      const bottom = node.getBoundingClientRect().bottom;
      const childBottom = node.querySelector(".application-status-entries").getBoundingClientRect().bottom;
      return { border: [css.borderTopWidth, css.borderTopStyle, css.borderTopColor, expected], spill: childBottom - bottom };
    });
    assert.deepEqual(chrome.border.slice(0, 3), ["1px", "solid", chrome.border[3]], workflow);
    assert(chrome.spill <= 0, workflow + " entries extend over the next divider");
    const lower = workflow === "library" ? page.frameLocator("#library-frame").locator(".library-footer")
      : workflow === "export" ? page.locator(".batch-statusbar") : null;
    if (lower) {
      const edge = await lower.evaluate(node => {
        const css = getComputedStyle(node);
        return [css.borderTopWidth, css.borderTopStyle, css.borderTopColor];
      });
      assert.deepEqual(edge, ["1px", "solid", chrome.border[3]], workflow + " lower divider");
    }
    const box = await dock.boundingBox();
    await page.screenshot({ path: shot(theme, workflow + "-status"),
      clip: { x: box.x + 1, y: box.y - 5, width: box.width - 2, height: box.height + 28 } });
  }
  const positiveScroll = (rail, gesture) => rail.evaluate((node, gesture) => new Promise((resolve, reject) => {
    if (node.scrollTop > 0) return resolve();
    const scrolled = () => { if (node.scrollTop > 0) { clearTimeout(timer); node.removeEventListener("scroll", scrolled); resolve(); } };
    node.addEventListener("scroll", scrolled);
    const timer = setTimeout(() => {
      node.removeEventListener("scroll", scrolled);
      reject(new Error(gesture + " did not scroll " + (node.id || node.className)));
    }, 1800);
  }), gesture);
  async function dragThumb(rail, keyControl) {
    const box = await rail.boundingBox();
    const before = await rail.evaluate(node => {
      node.scrollTop = 0;
      return { border: node.offsetWidth - node.clientLeft - node.clientWidth - 15, top: node.clientTop };
    });
    const x = box.x + box.width - before.border - 7.5;
    const y = box.y + before.top + 26;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 52, { steps: 8 });
    try {
      await positiveScroll(rail, "Thumb drag");
    } finally {
      await page.mouse.up();
    }
    const dragTop = await rail.evaluate(node => node.scrollTop);
    await page.mouse.click(x, box.y + before.top + 7);
    await rail.evaluate((node, previous) => new Promise((resolve, reject) => {
      if (node.scrollTop < previous) return resolve();
      const scrolled = () => {
        if (node.scrollTop < previous) {
          clearTimeout(timer);
          node.removeEventListener("scroll", scrolled);
          resolve();
        }
      };
      node.addEventListener("scroll", scrolled);
      const timer = setTimeout(() => {
        node.removeEventListener("scroll", scrolled);
        reject(new Error("Top arrow did not scroll " + (node.id || node.className)));
      }, 1800);
    }), dragTop);
    await rail.evaluate(node => { node.scrollTop = 0; });
    await page.mouse.move(box.x + box.width / 2, box.y + 62);
    await page.mouse.wheel(0, 92);
    await positiveScroll(rail, "Wheel");
    if (keyControl) {
      await keyControl.focus();
      await rail.evaluate(node => { node.scrollTop = 0; });
      await page.keyboard.press("PageDown");
      await positiveScroll(rail, "PageDown");
    }
    await rail.evaluate(node => { node.scrollTop = 0; });
  }
  const library = page.frameLocator("#library-frame");
  const grid = library.locator("#library-grid");
  const grade = page.locator(".grade-rail");
  const proof = page.locator("#proof-workflow-panel");
  const scope = page.locator(".scope-readings");
  const workflow = stage => page.locator('[data-workflow-tab="' + stage + '"]').click();
  const cap = (rail, value) => rail.evaluate((node, value) => {
    node.style.maxBlockSize = value;
    node.scrollTop = 0;
  }, value);
  const samples = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-scrollbar-fixture-"));
  try {
    const one = path.join(samples, "One photo");
    const many = path.join(samples, "Many photos");
    fs.mkdirSync(one);
    fs.mkdirSync(many);
    const thumbnail = path.join(__dirname, "fixtures/library_photo.png");
    fs.copyFileSync(thumbnail, path.join(one, "Sample.png"));
    for (let i = 0; i < 80; i++) fs.copyFileSync(thumbnail, path.join(many, "Sample " + (i + 1) + ".png"));
    const host = page.locator("#library-frame");
    const browse = async (folder, count) => {
      await host.evaluate((iframe, folder) => {
        return iframe.contentWindow.HDRLibrary.browse(folder);
      }, folder);
      await page.waitForFunction(count => document.querySelector("#library-frame").contentWindow.HDRLibrary.getSnapshot().count === count, count)
        .catch(async error => { throw new Error("Could not open " + path.basename(folder) + ": " + await library.locator("#library-status").textContent(), { cause: error }); });
    };
    await page.locator("#file-input").setInputFiles(photo);
    await page.waitForFunction(() => state.session && !state.importInProgress && document.body.dataset.workflow === "grade");
    for (const theme of ["default-light", "modern-dark", "studio-gray"]) {
      await page.evaluate(theme => {
        HDRApplicationShell.openSettings("appearance");
        document.querySelector('[data-theme-option="' + theme + '"]').click();
      }, theme);
      await page.locator("#settings-close").click();
      await workflow("import");
      await library.locator('html[data-theme="' + theme + '"]').waitFor({ state: "attached" });
      await browse(one, 1);
      await checkLane(grid, false);
      const size = library.locator("#thumbnail-size");
      await size.evaluate(input => {
        input.value = "250";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await browse(many, 80);
      await library.locator(".library-cell canvas[data-picture-key]").first().waitFor();
      await checkLane(grid, true);
      await checkLanePaint(grid);
      const gridBox = await grid.boundingBox();
      await page.mouse.move(20, 20);
      await page.screenshot({ path: shot(theme, "library"), clip: {
        x: Math.floor(gridBox.x + gridBox.width - 350), y: Math.floor(gridBox.y - 40), width: 470, height: 395,
      } });
      await status(theme, "library");
      if (theme === "default-light") await dragThumb(grid);

      await workflow("grade");
      await status(theme, "grade");
      const gradeEdges = [".control-title-row", ".grade-folder-tabs", '[data-group="hdr-tone"]'];
      await checkLane(grade, false, gradeEdges);
      await capturePanel(grade, shot(theme, "grade-fits"), 705);
      await cap(grade, "340px");
      await checkLane(grade, true, gradeEdges);
      await checkLanePaint(grade);
      if (theme === "default-light") await dragThumb(grade, grade.locator("#grade-mode-global"));
      await page.mouse.move(20, 20);
      await grade.screenshot({ path: shot(theme, "grade-overflow") });
      for (const mode of ["local", "retouch"]) {
        await page.locator("#grade-mode-" + mode).click();
        await cap(grade, "240px");
        await checkLane(grade, true, [".control-title-row"]);
      }
      await page.locator("#grade-mode-global").click();
      await cap(grade, "");
      await checkLane(grade, false, gradeEdges);

      const source = page.locator(".source-rail");
      if (await source.evaluate(node => node.classList.contains("collapsed"))) await page.locator("#source-rail-expand").click();
      await cap(source, "90px");
      await checkLane(source, true, [".rail-title-row"]);
      await cap(source, "");

      await cap(scope, "100px");
      await page.waitForFunction(() => document.querySelector(".scope-readings").scrollHeight > 100);
      await checkLane(scope, true, [".scope-reading-status"]);
      await checkLanePaint(scope);
      await scope.screenshot({ path: shot(theme, "scopes") });
      await cap(scope, "");

      await workflow("proof");
      await status(theme, "proof");
      await checkLane(proof, false, [".workflow-rail-header"]);
      await cap(proof, "235px");
      await checkLane(proof, true, [".workflow-rail-header"]);
      await checkLanePaint(proof);
      if (theme === "default-light") await dragThumb(proof, proof.locator('[data-proof-lane="hdr"]'));
      await page.mouse.move(20, 20);
      await proof.screenshot({ path: shot(theme, "proof") });
      await cap(proof, "");

      await workflow("export");
      const batch = page.locator(".batch-settings-scroll");
      await batch.waitFor();
      await status(theme, "export");
      await cap(batch, "265px");
      await checkLane(batch, true);
      await checkLanePaint(batch);
      if (theme === "default-light") await dragThumb(batch);
      await page.mouse.move(20, 20);
      await capturePanel(page.locator("#export-sheet"), shot(theme, "export"), 470);
      await cap(batch, "");
    }
  } finally {
    fs.rmSync(samples, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log("PASS: Library, Grade modes, Metadata, Scopes, Proof and Export lanes; dividers, drag, arrows, wheel, keyboard and four status bars across all three themes.");
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
    if (process.argv.includes("--unified-scrollbars")) {
      await page.addInitScript(() => localStorage.setItem("hdr-finisher:library-show-all-files", "true"));
    }
    await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765", { waitUntil: "networkidle" });
    if (process.argv.includes("--unified-scrollbars")) {
      await verifyScrollbars(page);
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
