const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? { width: box.width, height: box.height, x: box.x, y: box.y } : null;
    };
    const gradeTrack = document.querySelector('[data-path="hdr.exposure"]')?.getBoundingClientRect();
    return {
      source: rect(".source-rail"),
      grade: rect(".grade-rail"),
      dock: rect("#analysis-dock"),
      gradeTrackWidth: gradeTrack?.width || 0,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      stored: JSON.parse(localStorage.getItem("hdr-finisher-layout:1280") || "null"),
    };
  });
}

async function main() {
  const url = argValue("--url", "http://127.0.0.1:8000");
  const inputPath = argValue("--input");
  const screenshot = argValue("--screenshot", path.join("output", "design-qa", "layout-1280.png"));
  const resultPath = argValue("--result", path.join("output", "design-qa", "layout-qa.json"));
  const executablePath = edgeExecutable();
  const consoleErrors = [];
  const pageErrors = [];
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: executablePath || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".app-shell").waitFor();

    const initial = await shellMetrics(page);
    await page.locator("#source-splitter").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator("#grade-splitter").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator("#dock-splitter").focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(180);
    const adjusted = await shellMetrics(page);

    await page.reload({ waitUntil: "networkidle" });
    const restored = await shellMetrics(page);
    await page.locator('[data-dock-tab="technical"]').click();
    await page.reload({ waitUntil: "networkidle" });
    const tabPersistence = await page.evaluate(() => ({
      activeTab: document.querySelector(".dock-tab.active")?.dataset.dockTab,
      technicalVisible: !document.getElementById("technical-view")?.classList.contains("hidden"),
      storedTab: JSON.parse(localStorage.getItem("hdr-finisher-layout:1280") || "null")?.dockTab,
    }));
    await page.locator('[data-dock-tab="histogram"]').click();
    await page.locator("#source-splitter").dblclick();
    await page.locator("#grade-splitter").dblclick();
    await page.locator("#dock-splitter").dblclick();
    await page.waitForTimeout(180);
    const reset = await shellMetrics(page);

    await page.locator("#dock-collapse").click();
    const collapsedHeight = await page.locator("#analysis-dock").evaluate((dock) => dock.getBoundingClientRect().height);
    await page.locator("#dock-collapse").click();
    const reopenedHeight = await page.locator("#analysis-dock").evaluate((dock) => dock.getBoundingClientRect().height);

    let sliderCheck = null;
    if (inputPath) {
      await page.locator("#file-input").setInputFiles(inputPath);
      await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", { timeout: 30000 });
      const gate = page.locator("#interpretation-gate");
      if (await gate.isVisible()) await page.locator("#accept-interpretation").click();
      await page.locator("#preview-image").waitFor({ state: "visible", timeout: 120000 });
      const requests = [];
      page.on("request", (request) => {
        if (/\/(preview|scopes)\?/.test(request.url())) requests.push(request.url());
      });
      const slider = page.locator('[data-path="hdr.exposure"]');
      const box = await slider.boundingBox();
      if (!box) throw new Error("Exposure slider has no bounding box");
      await page.keyboard.down("Alt");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 20 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(180);
      sliderCheck = {
        value: Number(await slider.inputValue()),
        previewRequests: requests.length,
        modified: await slider.locator("xpath=ancestor::*[contains(@class,'control-row')][1]").evaluate((row) => row.classList.contains("modified")),
      };
    }

    await page.screenshot({ path: screenshot, fullPage: true });
    const checks = {
      noHorizontalOverflow: reset.horizontalOverflow <= 0,
      minimumTrackWidth: reset.gradeTrackWidth >= 180,
      keyboardResize: adjusted.source.width === initial.source.width + 8
        && adjusted.grade.width === initial.grade.width + 8
        && adjusted.dock.height === initial.dock.height + 8,
      persistence: restored.source.width === adjusted.source.width
        && restored.grade.width === adjusted.grade.width
        && restored.dock.height === adjusted.dock.height,
      tabPersistence: tabPersistence.activeTab === "technical" && tabPersistence.technicalVisible && tabPersistence.storedTab === "technical",
      doubleClickReset: reset.source.width === 268 && reset.grade.width === 320 && reset.dock.height === 208,
      collapseRestore: collapsedHeight === 28 && reopenedHeight === 208,
      precisionDrag: !sliderCheck || (Math.abs(sliderCheck.value) <= 0.2 && sliderCheck.value !== 0),
      previewCadence: !sliderCheck || sliderCheck.previewRequests <= 2,
      modifiedState: !sliderCheck || sliderCheck.modified,
      noBrowserErrors: consoleErrors.length === 0 && pageErrors.length === 0,
    };
    const result = { ok: Object.values(checks).every(Boolean), url, viewport: { width: 1280, height: 820, deviceScaleFactor: 1 }, initial, adjusted, restored, tabPersistence, reset, collapsedHeight, reopenedHeight, sliderCheck, checks, consoleErrors, pageErrors, screenshot };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
