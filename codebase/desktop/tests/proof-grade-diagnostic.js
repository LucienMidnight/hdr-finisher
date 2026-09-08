const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron, chromium } = require("playwright");

const project = process.env.HDR_FINISHER_TEST_PROJECT || "C:\\Users\\Steve\\Desktop\\_DSC2743.hdrfinisher";

(async () => {
  const output = path.resolve(__dirname, "../output/proof-grade-diagnostic");
  fs.mkdirSync(output, { recursive: true });
  const userData = fs.mkdtempSync(path.join(output, "profile-"));
  fs.writeFileSync(path.join(userData, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1, renderingMode: "auto", updates: { checkAutomatically: false },
  }));
  const browserUrl = process.env.HDR_FINISHER_URL;
  const app = browserUrl ? null : await electron.launch({
      executablePath: require("electron"),
      args: [project],
      env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userData },
    });
  const browser = browserUrl ? await chromium.launch({
    headless: process.env.HDR_FINISHER_HEADED !== "1",
    channel: "msedge",
  }) : null;
  const page = browserUrl ? await browser.newPage({ viewport: { width: 1680, height: 1000 } }) : await app.firstWindow();
  try {
    if (browserUrl) {
      await page.goto(browserUrl, { waitUntil: "networkidle" });
      await page.evaluate(async (projectPath) => {
        const response = await fetch("/api/project/open", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(payload));
        await activateDesktopSession(payload.session, projectPath);
      }, project);
    }
    await page.waitForFunction(() => typeof state !== "undefined" && state.session?.session_id && state.acceptedPresentation, null, { timeout: 180000 });
    await page.evaluate(() => applyPreviewResolution("1024"));
    await page.waitForFunction(() => state.acceptedPresentation?.lane === "hdr"
      && state.acceptedPresentation?.generation === state.previewGeneration.hdr, null, { timeout: 120000 });
    await page.locator("#preview-primary-pane").screenshot({ path: path.join(output, "grade.png") });

    await page.locator('[data-workflow-tab="proof"]').click();
    await page.locator("#chrome-proof-watermark-toggle").uncheck();
    await page.locator("#chrome-proof-target").selectOption("1000");
    const formats = ["avif_gain_map", "jpeg_ultrahdr"];
    const results = {
      environment: await page.evaluate(() => ({
        userAgent: navigator.userAgent,
        dynamicRangeHigh: matchMedia("(dynamic-range: high)").matches,
        videoDynamicRangeHigh: matchMedia("(video-dynamic-range: high)").matches,
        gamutP3: matchMedia("(color-gamut: p3)").matches,
        gamutRec2020: matchMedia("(color-gamut: rec2020)").matches,
        screenColorDepth: screen.colorDepth,
        displayInfo: state.displayInfo,
        displayTelemetry: state.displayTelemetry,
        presentationCapability: state.presentationCapability,
      })),
    };
    for (const format of formats) {
      const option = page.locator(`#chrome-proof-format option[value="${format}"]`);
      if (await option.isDisabled()) continue;
      await page.locator("#chrome-proof-format").selectOption(format);
      await page.locator("#chrome-proof-refresh").click();
      await page.waitForFunction((selected) => !state.proofDirty && state.proofArtifact?.format === selected
        && state.proofReconstruction, format, { timeout: 240000 });
      for (const rendition of ["delivered", "hdr", "sdr"]) {
        await page.locator(`[data-proof-preview="${rendition}"]`).click();
        await page.waitForFunction(() => document.querySelector("#chrome-proof-image")?.complete
          && document.querySelector("#chrome-proof-image")?.naturalWidth > 0);
        await page.locator("#preview-primary-pane").screenshot({ path: path.join(output, `${format}-${rendition}.png`) });
      }
      results[format] = await page.evaluate(() => ({
        artifact: state.proofArtifact,
        reconstruction: state.proofReconstruction,
        sdr: state.proofSdrReconstruction,
      }));
    }
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(output);
  } finally {
    if (browser) await browser.close();
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      if (!app.process().killed) app.process().kill();
    }
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
