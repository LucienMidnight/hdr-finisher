const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    for (const width of [1800, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Load test pattern" }).click();
      await page.waitForFunction(() => state.session?.session_id, null, { timeout: 30000 });
      const rail = page.locator(".source-rail");
      if (width < 1600) await rail.hover();
      const railState = await rail.evaluate((element) => ({
        classes: element.className,
        display: getComputedStyle(element).display,
        visibility: getComputedStyle(element).visibility,
        rect: element.getBoundingClientRect().toJSON(),
        workflow: document.body.dataset.workflow,
      }));
      assert(await rail.isVisible(), `Source rail is not visible at ${width}px: ${JSON.stringify(railState)}`);
      for (const [toggleId, panelId] of [["source-settings-toggle", "source-settings-panel"], ["metadata-toggle", "metadata-panel"]]) {
        const toggle = page.locator(`#${toggleId}`);
        const panel = page.locator(`#${panelId}`);
        const toggleState = await toggle.evaluate((element) => ({
          display: getComputedStyle(element).display,
          visibility: getComputedStyle(element).visibility,
          rect: element.getBoundingClientRect().toJSON(),
        }));
        assert(await toggle.isVisible(), `${toggleId} is not visible at ${width}px: ${JSON.stringify({ railState, toggleState })}`);
        await toggle.click();
        assert(await toggle.getAttribute("aria-expanded") === "true", `${toggleId} did not expand at ${width}px.`);
        assert(await panel.isVisible(), `${panelId} did not become visible at ${width}px.`);
        await page.waitForTimeout(160);
        const transform = await toggle.evaluate((element) => getComputedStyle(element, "::before").transform);
        assert(transform !== "none" && !transform.includes("1, 0, 0, 1"), `${toggleId} chevron did not rotate at ${width}px.`);
        await toggle.click();
        assert(await toggle.getAttribute("aria-expanded") === "false", `${toggleId} did not collapse at ${width}px.`);
        assert(await panel.isHidden(), `${panelId} did not become hidden at ${width}px.`);
      }
      await page.close();
    }
    console.log(JSON.stringify({ browser: await browser.version(), viewports: [1800, 1440] }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
