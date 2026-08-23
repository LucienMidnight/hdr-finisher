const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("hdr-finisher:high-quality-preview:v1", "true");
    localStorage.setItem("hdr-finisher:scope-zoom:v1", "10000");
    localStorage.setItem("hdr-finisher:compare-layout:v1", "side-vertical");
    localStorage.setItem("hdr-finisher-source-collapsed", "true");
    localStorage.setItem("hdr-finisher-layout:1280", JSON.stringify({ railW: 380, gradeW: 420, dockH: 340, dockOpen: false, dockTab: "technical" }));
    localStorage.setItem("hdr-finisher-chrome-proof-v1", JSON.stringify({ format: "avif_gain_map", target: "4000", showWatermark: false }));
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const groupState = await page.locator("section.control-group").evaluateAll((groups) => groups.map((group) => ({
      collapsed: group.classList.contains("collapsed"),
      expanded: group.querySelector(".group-toggle")?.getAttribute("aria-expanded"),
    })));
    if (!groupState.length || groupState.some((group) => !group.collapsed || group.expanded !== "false")) {
      throw new Error(`Every grade group should start collapsed: ${JSON.stringify(groupState)}`);
    }

    const startup = await page.evaluate(() => ({
      previewResolution: document.querySelector("#preview-resolution")?.value,
      scopeZoom: document.querySelector("#scope-zoom")?.value,
      compareLayout: document.querySelector("#preview-stage")?.dataset.compareLayout,
      sourceCollapsed: document.querySelector(".source-rail")?.classList.contains("collapsed"),
      sourceSettingsExpanded: document.querySelector("#source-settings-toggle")?.getAttribute("aria-expanded"),
      metadataExpanded: document.querySelector("#metadata-toggle")?.getAttribute("aria-expanded"),
      proofFormat: document.querySelector("#chrome-proof-format")?.value,
      proofTarget: document.querySelector("#chrome-proof-target")?.value,
      proofWatermark: document.querySelector("#chrome-proof-watermark-toggle")?.checked,
      stalePreferences: Object.keys(localStorage).filter((key) => key.startsWith("hdr-finisher")),
    }));

    const expected = {
      previewResolution: "1024",
      scopeZoom: "4000",
      compareLayout: "single",
      sourceCollapsed: true,
      sourceSettingsExpanded: "false",
      metadataExpanded: "false",
      proofFormat: "jpeg_ultrahdr",
      proofTarget: "auto",
      proofWatermark: true,
      stalePreferences: [],
    };
    if (JSON.stringify(startup) !== JSON.stringify(expected)) {
      throw new Error(`Startup did not return to defaults. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(startup)}.`);
    }

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Ephemeral startup-state browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
