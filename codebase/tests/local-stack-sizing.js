const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();

    const surface = page.locator(".local-stack-surface");
    const metrics = () => surface.evaluate((node) => ({
      height: node.getBoundingClientRect().height,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    const empty = await metrics();
    assert(empty.height <= 74, `The empty adjustment stack is not compact: ${JSON.stringify(empty)}`);
    assert(empty.clientHeight === empty.scrollHeight, `The empty adjustment stack scrolls: ${JSON.stringify(empty)}`);

    const heights = [];
    for (let count = 1; count <= 5; count += 1) {
      const response = page.waitForResponse((candidate) =>
        candidate.url().includes("/edit-commands")
        && candidate.request().method() === "POST"
        && candidate.status() === 200,
      );
      if (count === 1) {
        await page.locator('[data-local-tool="brush"]').click();
        await page.locator("#local-add-adjustment").click();
      } else {
        await page.locator("#local-add-adjustment").click();
        await page.locator('[data-local-tool="brush"]').click();
      }
      await response;
      await page.waitForFunction((expected) => document.querySelectorAll("#local-adjustment-list > li").length === expected, count);
      heights.push(await metrics());
      if (count === 1) {
        const beforeMenu = await metrics();
        await page.getByRole("button", { name: "More actions for Local Adjustment 1" }).click();
        const menu = page.getByRole("menu", { name: "Actions for Local Adjustment 1" });
        const menuGeometry = await menu.evaluate((node) => {
          const surface = node.closest(".local-stack-surface");
          const menuRect = node.getBoundingClientRect();
          const surfaceRect = surface.getBoundingClientRect();
          return {
            position: getComputedStyle(node).position,
            menuBottom: menuRect.bottom,
            surfaceBottom: surfaceRect.bottom,
          };
        });
        const afterMenu = await metrics();
        assert(menuGeometry.position === "fixed", `The adjustment menu is not a floating popover: ${JSON.stringify(menuGeometry)}`);
        assert(menuGeometry.menuBottom > menuGeometry.surfaceBottom, `The adjustment menu is still clipped to the stack: ${JSON.stringify(menuGeometry)}`);
        assert(afterMenu.height === beforeMenu.height && afterMenu.scrollHeight === beforeMenu.scrollHeight, `Opening the menu changed the stack scroll geometry: ${JSON.stringify({ beforeMenu, afterMenu })}`);
        await page.getByRole("button", { name: "More actions for Local Adjustment 1" }).click();
      }
    }
    assert(heights[1].height > heights[0].height, `The stack did not grow with its second row: ${JSON.stringify(heights)}`);
    assert(heights[3].height > heights[2].height, `The stack did not grow with its fourth row: ${JSON.stringify(heights)}`);
    assert(heights[4].height <= 222, `The adjustment stack exceeded its height cap: ${JSON.stringify(heights)}`);
    assert(
      heights[4].scrollHeight > heights[4].clientHeight && heights[4].overflowY === "auto",
      `The adjustment stack did not become scrollable at the cap: ${JSON.stringify(heights[4])}`,
    );
    console.log(JSON.stringify({ empty, heights }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
