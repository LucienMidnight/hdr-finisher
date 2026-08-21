const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

const expected = {
  avif_gain_map: {
    web_default: ["85", "10", "420", "444", "85", "full"],
    web_optimized: ["75", "10", "420", "422", "70", "half"],
    maximum_fidelity: ["100", "12", "444", "444", "100", "full"],
  },
  jpeg_ultrahdr: {
    web_default: ["85", "90", "full", "420", "copyright"],
    web_optimized: ["75", "80", "half", "420", "none"],
    maximum_fidelity: ["100", "100", "full", "444", "all_except_location"],
  },
  jpegxl_hdr: {
    web_default: ["90", "uint12", "copyright"],
    web_optimized: ["80", "uint10", "none"],
    maximum_fidelity: ["100", "uint16", "all_except_location"],
  },
  sdr_jpegxl: {
    web_default: ["90", "auto", "copyright"],
    web_optimized: ["80", "auto", "none"],
    maximum_fidelity: ["100", "subtle", "all_except_location"],
  },
  sdr_png: {
    web_default: ["100", "8", "auto", "copyright"],
    web_optimized: ["100", "8", "auto", "none"],
    maximum_fidelity: ["100", "16", "off", "all_except_location"],
  },
  sdr_jpeg: {
    web_default: ["85", "420", "auto", "copyright"],
    web_optimized: ["75", "420", "auto", "none"],
    maximum_fidelity: ["100", "444", "subtle", "all_except_location"],
  },
};

async function valuesFor(page, format) {
  const selectors = {
    avif_gain_map: ["#export-quality", "#avif-bit-depth", "#avif-chroma-subsampling", "#avif-gain-map-chroma-subsampling", "#avif-gain-map-quality", "#avif-gain-map-scale"],
    jpeg_ultrahdr: ["#export-quality", "#jpeg-gain-map-quality", "#jpeg-gain-map-scale", "#jpeg-ultrahdr-chroma-subsampling", "#export-metadata-policy"],
    jpegxl_hdr: ["#export-quality", "#jpegxl-precision", "#export-metadata-policy"],
    sdr_jpegxl: ["#export-quality", "#export-dithering", "#export-metadata-policy"],
    sdr_png: ["#export-quality", "#sdr-png-bit-depth", "#export-dithering", "#export-metadata-policy"],
    sdr_jpeg: ["#export-quality", "#jpeg-chroma-subsampling", "#export-dithering", "#export-metadata-policy"],
  }[format];
  return Promise.all(selectors.map((selector) => page.locator(selector).inputValue()));
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#test-pattern-button").click();
    await page.waitForFunction(() => document.getElementById("session-name")?.textContent !== "No active image", null, { timeout: 120000 });
    await page.locator('[data-workflow-tab="export"]').click();
    const advanced = page.locator("#jpeg-advanced-settings");
    if (await advanced.getAttribute("open") !== null) throw new Error("Advanced settings must start collapsed.");
    await advanced.locator("summary").press("Enter");
    if (await advanced.getAttribute("open") === null) throw new Error(`Advanced disclosure did not respond to keyboard activation. Page errors: ${errors.join(" | ")}`);

    for (const [format, presets] of Object.entries(expected)) {
      await page.locator("#export-format").selectOption(format);
      for (const [preset, values] of Object.entries(presets)) {
        await page.locator("#export-preset").selectOption(preset);
        const actual = await valuesFor(page, format);
        if (JSON.stringify(actual) !== JSON.stringify(values)) {
          throw new Error(`${format}/${preset}: expected ${JSON.stringify(values)}, got ${JSON.stringify(actual)}`);
        }
        if (!await page.locator("#export-resolved-encoding").textContent()) throw new Error(`${format}/${preset}: missing encoding summary`);
      }
    }

    await page.locator("#export-format").selectOption("sdr_jpeg");
    await page.locator("#export-preset").selectOption("web_default");
    await page.locator("#jpeg-chroma-subsampling").selectOption("444");
    if (await page.locator("#export-preset").inputValue() !== "custom") throw new Error("Manual divergence did not select Custom.");
    if (!(await page.locator('#jpeg-chroma-subsampling option[value="420"]').textContent()).endsWith("· Web Default")) {
      throw new Error("Web Default option label is missing.");
    }
    if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    console.log(JSON.stringify({ formats: Object.keys(expected).length, presetsPerFormat: 3, customState: true, keyboardDisclosure: true }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
