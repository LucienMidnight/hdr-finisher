const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROME_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  const url = argValue("--url", "http://127.0.0.1:8000");
  const screenshot = argValue("--screenshot", path.join("output", "playwright", "hdr-finisher-ui.png"));
  const resultPath = argValue("--result", path.join("output", "playwright", "preview-result.json"));
  const headed = hasFlag("--headed");
  const executablePath = chromeExecutable();
  const consoleErrors = [];
  const pageErrors = [];

  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: executablePath || undefined,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator(".app-shell").waitFor({ timeout: 10000 });

    const expectedSteps = {
      "hdr.exposure": 0.05,
      "hdr.highlight_rolloff": 0.01,
      "hdr.shadow_lift": 0.005,
      "hdr.lift": 0.005,
      "hdr.gamma": 0.005,
      "hdr.gain": 0.005,
      "hdr.contrast": 0.001,
      "hdr.contrast_pivot": 0.0005,
      "hdr.white_balance_kelvin": 50,
      "hdr.tint": 0.01,
      "sdr.exposure": 0.05,
      "sdr.highlight_recovery": 0.01,
      "sdr.shadow": 0.01,
      "sdr.lift": 0.005,
      "sdr.gamma": 0.005,
      "sdr.gain": 0.005,
      "sdr.contrast": 0.001,
      "sdr.contrast_pivot": 0.005,
      "shared.overlay_opacity": 0.01,
      "shared.overlay_threshold": 0.05,
    };
    const controlChecks = await page.locator('input[type="range"][data-path]').evaluateAll((controls, expected) => {
      return controls.map((control) => {
        const path = control.dataset.path;
        const actualStep = Number(control.step);
        const min = Number(control.min);
        const value = Number(control.value);
        const step = Number(control.step);
        const aligned = Math.abs(((value - min) / step) - Math.round((value - min) / step)) < 1e-6;
        return {
          path,
          expectedStep: expected[path],
          actualStep,
          aligned,
          ok: expected[path] === actualStep && aligned,
        };
      });
    }, expectedSteps);
    const failedControls = controlChecks.filter((control) => !control.ok);
    if (failedControls.length) {
      throw new Error(`Range control audit failed: ${JSON.stringify(failedControls)}`);
    }

    const resetChecks = await page.locator('input[type="range"]').evaluateAll((controls) => {
      return controls.map((control) => {
        const defaultValue = control.defaultValue;
        control.value = control.value === control.max ? control.min : control.max;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        return {
          path: control.dataset.path || control.id,
          defaultValue,
          resetValue: control.value,
          ok: control.value === defaultValue,
        };
      });
    });
    const failedResets = resetChecks.filter((control) => !control.ok);
    if (failedResets.length) {
      throw new Error(`Range reset audit failed: ${JSON.stringify(failedResets)}`);
    }

    await page.locator('[data-path="hdr.contrast"]').evaluate((control) => {
      control.value = String(Number(control.value) + Number(control.step));
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: screenshot, fullPage: true });

    const result = {
      ok: true,
      url: page.url(),
      title: await page.title(),
      browser: executablePath ? "installed Chrome/Edge executable" : "Playwright cached Chromium",
      executablePath,
      screenshot,
      controlChecks,
      resetChecks,
      consoleErrors,
      pageErrors,
    };
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
