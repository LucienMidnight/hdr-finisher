// Path Feather drag must never cache the committed mask under a newer leaf.
//
// Run current GPU rasterization by default, or --mask-route cpu to preserve
// the reachable CPU fallback's draft/acknowledgement regression coverage.
// The GPU caches each CPU-rasterized mask under the identity of the leaf it is
// rendering, but `/local-mask/{id}` rasterizes the backend's committed local,
// and a Feather drag commits only on release. Fetching that endpoint mid-drag
// stored the pre-drag mask under every intermediate Feather value, so the
// resolution in use (usually Fit) kept showing a narrower falloff than the
// slider said, while other zoom levels, fetched later, looked right.
//
//   node tests/path-feather-mask-cache.js   (HDR_FINISHER_URL, default :8765)

const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const routeIndex = process.argv.indexOf("--mask-route");
const maskRoute = routeIndex >= 0 ? process.argv[routeIndex + 1] : "gpu";
if (!["gpu", "cpu"].includes(maskRoute)) throw new Error("--mask-route must be gpu or cpu");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--enable-unsafe-webgpu"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    const gpu = await page.evaluate(() => Boolean(state.gpuPreview?.available));
    if (!gpu) {
      console.log("SKIP: WebGPU preview unavailable; the mask cache is GPU-only.");
      return;
    }
    await page.locator("#grade-mode-local").click();
    await page.locator("#local-add-adjustment").click();
    await page.locator('[data-local-tool="path"]').click();
    const box = await page.evaluate(() => activePreviewElement().getBoundingClientRect().toJSON());
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
    for (const [x, y] of [[.3, .3], [.7, .3], [.65, .7], [.35, .7]]) {
      await page.mouse.click(...at(x, y));
    }
    let response = page.waitForResponse((r) => r.url().includes("/edit-commands") && r.request().method() === "POST");
    await page.mouse.click(...at(.3, .3));
    assert((await response).ok(), "Closing the Path did not commit.");
    response = page.waitForResponse((r) => r.url().includes("/edit-commands") && r.request().method() === "POST");
    await page.evaluate(() => {
      const local = selectedLocal();
      local.hdr_grade.exposure = 2;
      commitSelectedLocal();
    });
    assert((await response).ok(), "Local exposure did not commit.");
    await page.waitForTimeout(1500);

    // Log every mask request the renderer makes, and every acknowledged commit.
    await page.evaluate((route) => {
      window.__maskLog = [];
      window.__gpuMaskLog = [];
      // The CPU route is still reachable on analytic-raster refusal. Exercise
      // it deliberately instead of requiring CPU traffic from the normal GPU path.
      state.gpuPreview.gpuAnalyticMasksEnabled = route === "gpu";
      const renderer = state.gpuPreview;
      const originalGpuLeaf = renderer.loadGpuAnalyticLeaf;
      const entries = new WeakMap();
      let nextEntry = 0;
      renderer.loadGpuAnalyticLeaf = function(sessionId, expression, edge, geometry, current) {
        const result = originalGpuLeaf.call(this, sessionId, expression, edge, geometry, current);
        if (result && expression.leaf?.type === "path") {
          if (!entries.has(result)) entries.set(result, ++nextEntry);
          window.__gpuMaskLog.push({ feather: expression.leaf.feather,
            liveFeather: firstMaskLeaf(selectedLocal()?.mask, "path")?.feather,
            acknowledgedFeather: window.__acknowledgedFeather, entry: entries.get(result), edge, geometry });
        }
        return result;
      };
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const method = (init?.method || "GET").toUpperCase();
        const feather = () => firstMaskLeaf(selectedLocal()?.mask, "path")?.feather;
        let entry = null;
        if (url.includes("/local-mask/") && !url.includes("/preview") && method === "GET") {
          entry = { kind: "committed-endpoint", leafFeather: feather() };
        } else if (url.includes("/local-mask/") && url.includes("/preview") && String(init?.body || "").includes("geometry_signature")) {
          entry = { kind: "draft-endpoint", requestFeather: JSON.parse(init.body).mask?.leaf?.feather };
        } else if (url.includes("/edit-commands") && method === "POST") {
          entry = { kind: "commit", payloadFeather: JSON.parse(init.body).commands?.[0]?.payload?.local?.mask?.leaf?.feather };
        }
        if (entry) {
          entry.acknowledgedFeather = window.__acknowledgedFeather;
          window.__maskLog.push(entry);
        }
        const result = await original(input, init);
        if (entry?.kind === "commit" && result.ok && entry.payloadFeather !== undefined) window.__acknowledgedFeather = entry.payloadFeather;
        return result;
      };
      window.__acknowledgedFeather = firstMaskLeaf(selectedLocal().mask, "path").feather;
    }, maskRoute);

    // A real pointer drag of the Feather slider: renders run during it.
    const slider = page.locator('input[type="range"][data-default-value="4"]');
    await slider.scrollIntoViewIfNeeded();
    const sliderBox = await slider.boundingBox();
    const sliderX = (value) => sliderBox.x + 8 + (sliderBox.width - 16) * value / 100;
    const y = sliderBox.y + sliderBox.height / 2;
    const startValue = Number(await slider.inputValue());
    await page.mouse.move(sliderX(startValue), y);
    await page.mouse.down();
    for (let value = startValue + 1; value <= startValue + 14; value += 1) {
      await page.mouse.move(sliderX(value), y, { steps: 3 });
      await page.waitForTimeout(120);
    }
    await page.mouse.up();
    await page.waitForTimeout(5000);

    const log = await page.evaluate(() => window.__maskLog);
    const finalFeather = await page.evaluate(() => firstMaskLeaf(selectedLocal().mask, "path").feather);
    assert(finalFeather > .02 + .04, `The Feather drag did not move the slider (${finalFeather}).`);
    const stale = log.filter((entry) => entry.kind === "committed-endpoint" && entry.leafFeather !== entry.acknowledgedFeather);
    assert(!stale.length,
      `Committed-mask requests were made for a Feather the backend had not acknowledged: ${JSON.stringify(stale)}`);
    const drafts = log.filter((entry) => entry.kind === "draft-endpoint");
    const gpuMasks = await page.evaluate(() => window.__gpuMaskLog);
    if (maskRoute === "cpu") {
      assert(drafts.length > 0, `No mid-drag CPU frame rasterized its own leaf: ${JSON.stringify(log)}`);
    } else {
      const intermediate = gpuMasks.filter((entry) => entry.feather !== entry.acknowledgedFeather);
      assert(intermediate.length > 0, `No mid-drag GPU frame rasterized its own leaf: ${JSON.stringify(gpuMasks)}`);
      assert(intermediate.every((entry) => entry.feather === entry.liveFeather),
        `GPU rasterization used a stale live leaf: ${JSON.stringify(intermediate)}`);
      const identities = new Map();
      for (const entry of gpuMasks) {
        const previous = identities.get(entry.entry);
        assert(previous === undefined || previous === entry.feather,
          `A GPU mask cache entry was reused for a different Feather: ${JSON.stringify(entry)}`);
        identities.set(entry.entry, entry.feather);
      }
      assert(gpuMasks.some((entry) => entry.feather === finalFeather),
        "The GPU did not rasterize the final committed Feather.");
    }
    assert(log.some((entry) => entry.kind === "commit" && entry.payloadFeather === finalFeather),
      "The final Feather was not committed.");
    assert(!pageErrors.length, `Page errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ maskRoute, finalFeather, drafts: drafts.length, gpuMasks,
      committedRequests: log.filter((e) => e.kind === "committed-endpoint").length }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
