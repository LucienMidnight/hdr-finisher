const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const url = process.argv[2] || "http://127.0.0.1:8765";
  const input = process.argv[3] || path.join(__dirname, "..", "tests", "fixtures", "hdr_headroom.tiff");
  const output = process.argv[4] || path.join(__dirname, "..", "output", "proofing-qa-chrome");
  fs.mkdirSync(output, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  const executablePath = browserExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: "msedge" }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => localStorage.removeItem("hdr-finisher-chrome-proof-v1"));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator("#file-input").setInputFiles(input);
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", { timeout: 30000 });
    const gate = page.locator("#interpretation-gate");
    if (await gate.isVisible()) await page.locator("#accept-interpretation").click();

    if (await page.locator('[data-proof-mode="matrix"], #delivery-matrix-view, #live-browser-view').count()) {
      throw new Error("Legacy proofing tabs are still present.");
    }
    const workflowLabels = await page.locator("[data-workflow-tab]").evaluateAll((tabs) => tabs.map((tab) => tab.dataset.workflowTab));
    if (workflowLabels.join(",") !== "import,grade,proof,export") {
      throw new Error(`Unexpected workflow tabs: ${workflowLabels.join(", ")}`);
    }
    await page.locator('[data-workflow-tab="proof"]').click();
    const proofFormat = await page.locator("#chrome-proof-format option:not([disabled])").first().getAttribute("value");
    await page.locator("#chrome-proof-format").selectOption(proofFormat);
    await page.locator("#chrome-proof-target").selectOption("1000");
    await page.locator("#chrome-proof-toggle").click();
    await page.locator("#chrome-proof-image").waitFor({ state: "visible", timeout: 120000 });
    await page.locator("#chrome-proof-image").evaluate((image) => image.decode());
    await page.waitForFunction(() => {
      const building = document.getElementById("chrome-proof-refresh")?.textContent === "Building proof…";
      const stale = document.getElementById("chrome-proof-status")?.textContent.startsWith("STALE PROOF");
      return !building && !stale;
    }, { timeout: 120000 });
    const firstProofUrl = await page.locator("#chrome-proof-image").getAttribute("src");
    await page.locator('[data-proof-preview="sdr"]').click();
    const sdrProofUrl = await page.locator("#chrome-proof-image").getAttribute("src");
    if (!sdrProofUrl || sdrProofUrl === firstProofUrl) throw new Error("SDR proof base did not replace the HDR adaptation.");
    await page.locator('[data-proof-preview="hdr"]').click();
    if (await page.locator("#chrome-proof-image").getAttribute("src") !== firstProofUrl) throw new Error("HDR proof adaptation did not restore.");
    await page.screenshot({ path: path.join(output, "chrome-proof.png"), fullPage: true });

    await page.locator('[data-workflow-tab="grade"]').click();
    await page.locator('[data-path="hdr.exposure"]').evaluate((control) => {
      control.value = String(Math.min(Number(control.max), Number(control.value) + 0.25));
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator('[data-workflow-tab="proof"]').click();
    const visibleWhileStale = await page.locator("#chrome-proof-image").isVisible();
    const staleStatus = await page.locator("#chrome-proof-status").textContent();
    const staleProofUrl = await page.locator("#chrome-proof-image").getAttribute("src");
    if (staleProofUrl !== firstProofUrl || !staleStatus.startsWith("STALE PROOF")) {
      throw new Error(`Proof rebuilt during grading: ${staleStatus}`);
    }
    await page.locator("#chrome-proof-refresh").click();
    await page.waitForFunction(
      (previous) => {
        const image = document.getElementById("chrome-proof-image");
        const building = document.getElementById("chrome-proof-refresh")?.textContent === "Building proof…";
        const stale = document.getElementById("chrome-proof-status")?.textContent.startsWith("STALE PROOF");
        return image?.getAttribute("src") !== previous && !building && !stale;
      },
      firstProofUrl,
      { timeout: 120000 },
    );

    await page.locator('[data-workflow-tab="grade"]').click();
    await page.locator('[data-kind="sdr"]').click();
    await page.locator('[data-workflow-tab="proof"]').click();
    const entersOnHdr = await page.locator('[data-proof-lane="hdr"]').getAttribute("aria-pressed") === "true";
    await page.locator('[data-proof-lane="sdr"]').click();
    const suspended = {
      imageVisible: await page.locator("#chrome-proof-image").isVisible(),
      status: await page.locator("#chrome-proof-status").textContent(),
    };
    await page.locator('[data-proof-lane="hdr"]').click();
    const resumedVisible = await page.locator("#chrome-proof-image").isVisible();
    await page.locator("#chrome-proof-toggle").click();
    const authoredVisible = await page.evaluate(() => [...document.querySelectorAll("#preview-image, #preview-canvas")]
      .some((element) => getComputedStyle(element).display !== "none"));

    await page.locator('[data-workflow-tab="export"]').click();
    await page.screenshot({ path: path.join(output, "export-rail.png"), fullPage: true });
    const alternateFormat = proofFormat === "avif_gain_map" ? "jpeg_ultrahdr" : "avif_gain_map";
    const alternate = page.locator(`input[name="export-format-choice"][value="${alternateFormat}"]`);
    let mismatchStatus = "alternate encoder unavailable";
    if (!await alternate.isDisabled()) {
      await alternate.evaluate((control) => {
        control.checked = true;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
      mismatchStatus = await page.locator("#export-proof-status").textContent();
      await page.locator("#review-chrome-proof").click();
      if (!await page.locator("#proof-workflow-panel").isVisible()) throw new Error("Review action did not open the Proof stage.");
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(output, "chrome-proof-1280.png"), fullPage: true });
    const result = await page.evaluate(({ proofFormat, workflowLabels, mismatchStatus, visibleWhileStale, suspended, entersOnHdr, resumedVisible, authoredVisible }) => ({
      proofFormat,
      workflowLabels,
      mismatchStatus,
      visibleWhileStale,
      suspended,
      entersOnHdr,
      resumedVisible,
      authoredVisible,
      targetOptions: [...document.querySelectorAll("#chrome-proof-target option")].map((option) => option.textContent),
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      userAgent: navigator.userAgent,
    }), { proofFormat, workflowLabels, mismatchStatus, visibleWhileStale, suspended, entersOnHdr, resumedVisible, authoredVisible });
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    if (
      consoleErrors.length
      || pageErrors.length
      || !staleStatus.startsWith("STALE PROOF")
      || !visibleWhileStale
      || !entersOnHdr
      || suspended.imageVisible
      || !suspended.status.includes("suspended")
      || !resumedVisible
      || result.horizontalOverflow > 1
      || (!mismatchStatus.includes("Proofed") && mismatchStatus !== "alternate encoder unavailable")
    ) {
      throw new Error(JSON.stringify(result));
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
