const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  try {
    for (const dpr of [1, 2, 1]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      await context.addInitScript(value => { window.contextProbe = value; }, dpr);
      await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
      assert.deepEqual(await page.evaluate(() => ({ dpr: devicePixelRatio, probe: contextProbe,
        previous: localStorage.getItem("context-probe") })), { dpr, probe: dpr, previous: null });
      await page.evaluate(() => localStorage.setItem("context-probe", "previous context"));
      await context.close();
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => typeof window.contextProbe), "undefined");
    await context.close();
    for (const dpr of [2, 1]) {
      const direct = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
      await direct.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
      assert.equal(await direct.evaluate(() => devicePixelRatio), dpr);
    }
    console.log("Sequential contexts isolate storage and init scripts; context DPR 1, 2, 1 and direct page DPR 2, 1 verified.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
