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
      if (width < 1500) {
        const showButton = page.getByRole("button", { name: "Expand source metadata" });
        const collapsedLayout = await showButton.evaluate((element) => ({
          text: element.textContent,
          writingMode: getComputedStyle(element).writingMode,
          rect: element.getBoundingClientRect().toJSON(),
        }));
        assert(collapsedLayout.text === "Show", `Collapsed source action has the wrong label: ${JSON.stringify(collapsedLayout)}`);
        assert(collapsedLayout.writingMode === "horizontal-tb", `Collapsed Show action is vertical: ${JSON.stringify(collapsedLayout)}`);
        assert(collapsedLayout.rect.height <= 32, `Collapsed Show action is misplaced or oversized: ${JSON.stringify(collapsedLayout)}`);
        await showButton.click();
      }
      const railState = await rail.evaluate((element) => ({
        classes: element.className,
        display: getComputedStyle(element).display,
        visibility: getComputedStyle(element).visibility,
        rect: element.getBoundingClientRect().toJSON(),
        workflow: document.body.dataset.workflow,
      }));
      assert(await rail.isVisible(), `Source rail is not visible at ${width}px: ${JSON.stringify(railState)}`);
      const titleLayout = await page.locator(".rail-title-row").evaluate((row) => {
        const title = row.querySelector(".panel-title").getBoundingClientRect();
        const action = row.querySelector(".source-rail-expand").getBoundingClientRect();
        return { title: title.toJSON(), action: action.toJSON(), text: row.querySelector(".panel-title").textContent };
      });
      assert(titleLayout.text === "Metadata", `Metadata title changed unexpectedly: ${JSON.stringify(titleLayout)}`);
      assert(titleLayout.title.width >= 70, `Metadata title is squeezed: ${JSON.stringify(titleLayout)}`);
      assert(titleLayout.title.right + 4 <= titleLayout.action.left, `Metadata title overlaps Hide: ${JSON.stringify(titleLayout)}`);
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
        await page.waitForFunction((id) => {
          const element = document.querySelector(`#${id}`);
          const transform = element ? getComputedStyle(element, "::before").transform : "none";
          return transform !== "none" && !transform.includes("1, 0, 0, 1");
        }, toggleId);
        const chevron = await toggle.evaluate((element) => {
          const style = getComputedStyle(element, "::before");
          return { transform: style.transform, mask: style.webkitMaskImage, width: style.width };
        });
        assert(chevron.transform !== "none" && !chevron.transform.includes("1, 0, 0, 1"), `${toggleId} chevron did not rotate at ${width}px: ${JSON.stringify(chevron)}`);
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
