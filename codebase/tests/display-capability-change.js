// DISPLAY-01: a display capability change replaces an already-current frame.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const inherited = window.matchMedia.bind(window), listeners = new Set();
      let high = false;
      window.matchMedia = (query) => {
        const media = inherited(query);
        if (query !== "(dynamic-range: high)") return media;
        return new Proxy(media, { get(target, key) {
          if (key === "matches") return high;
          if (key === "addEventListener") return (type, callback) => {
            if (type === "change") listeners.add(callback);
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      window.changeTestDisplay = (value) => {
        high = value;
        for (const listener of listeners) listener({ matches: high });
      };
    });
    const url = process.env.HDR_FINISHER_URL;
    await page.goto(url, { waitUntil: "networkidle" });
    const input = ensureLargeNoisySource(1200, 800);
    const response = await page.request.post(`${url}/api/session`, { multipart: {
      file: { name: "display-change.tiff", mimeType: "image/tiff", buffer: fs.readFileSync(input) },
    } });
    assert.ok(response.ok());
    const { session } = await response.json();
    await page.evaluate((loaded) => activateDesktopSession(loaded, ""), session);
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready");
    const rows = [];
    for (const high of [true, false, true]) {
      const generation = await page.evaluate(() => state.acceptedPresentation.generation);
      await page.evaluate((value) => window.changeTestDisplay(value), high);
      await page.waitForFunction((previous) => state.acceptedPresentation?.generation > previous
        && state.acceptedPresentation.exact && viewerState().status === "ready", generation);
      const row = await page.evaluate(() => ({ generation: state.acceptedPresentation.generation,
        high: mediaQueryMatch("(dynamic-range: high)"), extended: state.gpuSurfaceHdr,
        transport: state.acceptedPresentation.transport }));
      assert.equal(row.high, high);
      assert.equal(row.extended, high);
      assert.equal(row.transport, "WebGPU");
      rows.push(row);
    }
    console.log(JSON.stringify(rows));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
