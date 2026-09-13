const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.HDR_FINISHER_BROWSER_CHANNEL || "msedge",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 30000 });

    const cacheSize = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const context = canvas.getContext("2d");
      for (let index = 0; index < LOCAL_BRUSH_MASK_CACHE_LIMIT + 12; index += 1) {
        const leaf = newMaskLeaf("brush");
        leaf.strokes = [{
          points: [{ x: 0.1, y: 0.1 }, { x: 0.2 + index / 1000, y: 0.2 }],
          radius: 0.02,
          hardness: 0.8,
          flow: 1,
          opacity: 1,
          erase: false,
        }];
        drawBrushMaskOverlay(context, leaf, null, (value) => value * 256, (value) => value * 256, false, { localId: `cache-${index}` });
      }
      return localBrushMaskCanvasCache.size;
    });
    assert(cacheSize === 8, `Brush mask canvas cache exceeded its limit: ${cacheSize}`);

    const retired = await page.evaluate(() => {
      let draftAborted = false;
      let requestAborted = false;
      state.selectedLocalId = "old-local";
      state.selectedSubMaskId = "old-child";
      state.pendingLocalAdjustment = { id: "pending" };
      state.pendingSubMask = { id: "pending-child" };
      state.localTool = "brush";
      state.localCreationTool = "path";
      state.localPointerGesture = { type: "brush" };
      state.localPathDraft = { localId: "old-local" };
      state.localMaskDraftDirty = true;
      state.localMaskDraftPending = { localId: "old-local" };
      state.localMaskDraftController = { abort: () => { draftAborted = true; } };
      localAuthoritativeMaskRequests.set("old", { controller: { abort: () => { requestAborted = true; } } });
      localAuthoritativeMaskCache.set("old-local", { canvas: document.createElement("canvas") });
      localComparisonMaskCache.set("old-local:child:parent", { canvas: document.createElement("canvas") });
      retireActiveSession();
      return {
        draftAborted,
        requestAborted,
        selectedLocalId: state.selectedLocalId,
        selectedSubMaskId: state.selectedSubMaskId,
        pendingLocalAdjustment: state.pendingLocalAdjustment,
        pendingSubMask: state.pendingSubMask,
        localTool: state.localTool,
        localCreationTool: state.localCreationTool,
        localPointerGesture: state.localPointerGesture,
        localPathDraft: state.localPathDraft,
        localMaskDraftDirty: state.localMaskDraftDirty,
        caches: [localBrushMaskCanvasCache.size, localAuthoritativeMaskCache.size, localComparisonMaskCache.size],
      };
    });
    assert(retired.draftAborted && retired.requestAborted, `Session retirement did not abort mask work: ${JSON.stringify(retired)}`);
    assert(retired.selectedLocalId === null && retired.selectedSubMaskId === null, `Old selection survived retirement: ${JSON.stringify(retired)}`);
    assert(retired.pendingLocalAdjustment === null && retired.pendingSubMask === null, `Pending rows survived retirement: ${JSON.stringify(retired)}`);
    assert(retired.localTool === null && retired.localCreationTool === null && retired.localPointerGesture === null && retired.localPathDraft === null, `Old tools survived retirement: ${JSON.stringify(retired)}`);
    assert(!retired.localMaskDraftDirty && retired.caches.every((size) => size === 0), `Old mask state survived retirement: ${JSON.stringify(retired)}`);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 30000 });
    const sessionBeforeDrop = await page.evaluate(() => state.session.session_id);
    await page.evaluate(() => { state.documentDirty = true; });
    let sessionPosts = 0;
    const countPosts = (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/session") sessionPosts += 1;
    };
    page.on("request", countPosts);
    page.on("dialog", (dialog) => dialog.dismiss());
    await page.locator("body").dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array([1, 2, 3])], "cancelled.png", { type: "image/png" }));
        return transfer;
      }),
    });
    await page.waitForTimeout(200);
    page.off("request", countPosts);
    assert(sessionPosts === 0, `Cancelled browser drop still uploaded ${sessionPosts} source(s).`);
    assert(await page.evaluate(() => state.session.session_id) === sessionBeforeDrop, "Cancelled browser drop replaced the active frontend session.");

    await page.evaluate(() => { state.documentDirty = false; });
    const uploadOrder = await page.evaluate(async () => {
      const originalFetch = window.fetch;
      const template = JSON.parse(JSON.stringify(state.session));
      const posts = [];
      window.fetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/session" && init.method === "POST") {
          const file = init.body.get("file");
          posts.push(file.name);
          await new Promise((resolve) => setTimeout(resolve, file.name === "A.png" ? 250 : 10));
          const session = JSON.parse(JSON.stringify(template));
          session.source.filename = file.name;
          return new Response(JSON.stringify({ session }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(input, init);
      };
      const a = uploadFile(new File([new Uint8Array([1])], "A.png", { type: "image/png" }));
      await new Promise((resolve) => setTimeout(resolve, 25));
      const b = uploadFile(new File([new Uint8Array([2])], "B.png", { type: "image/png" }));
      await Promise.all([a, b]);
      window.fetch = originalFetch;
      return { posts, active: state.session.source.filename };
    });
    assert(JSON.stringify(uploadOrder.posts) === JSON.stringify(["A.png", "B.png"]), `Byte uploads were not serialized: ${JSON.stringify(uploadOrder)}`);
    assert(uploadOrder.active === "B.png", `Superseded upload became active: ${JSON.stringify(uploadOrder)}`);

    const failedPreparation = await page.evaluate(async () => {
      const originalFetch = window.fetch;
      const sessionId = state.session.session_id;
      window.fetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/session" && init.method === "POST") {
          return new Response(JSON.stringify({ detail: "Synthetic decode failure" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(input, init);
      };
      const imported = await uploadFile(new File([new Uint8Array([3])], "broken.png", { type: "image/png" }));
      window.fetch = originalFetch;
      return {
        imported,
        sameSession: state.session.session_id === sessionId,
        previewVisible: Boolean(activePreviewElement() && getComputedStyle(activePreviewElement()).display !== "none"),
      };
    });
    assert(!failedPreparation.imported && failedPreparation.sameSession && failedPreparation.previewVisible, `Failed preparation damaged the current document: ${JSON.stringify(failedPreparation)}`);

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ cacheSize, retired, uploadOrder, failedPreparation }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
