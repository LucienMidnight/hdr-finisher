/* Focused Stage A check. All generated photos live in disposable test output. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "library-stage-a");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const fixture = path.join(root, "tests", "fixtures", "sdr_gradient.png");
for (let index = 0; index < 3000; index++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(index).padStart(4,"0")}.png`));
fs.mkdirSync(path.join(folder, "nested"));
fs.mkdirSync(path.join(folder, "empty-folder"));
fs.copyFileSync(fixture, path.join(folder, "nested", "nested.png"));
fs.writeFileSync(path.join(folder, "broken.png"), "unreadable test file");
fs.writeFileSync(path.join(folder, "ignored.hdrf"), "sidecar stays untouched");
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.log("[pageerror]", error.message); });
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof state !== "undefined" && state.activeWorkflow === "import");
    const library = page.frame({ url: /\/library(?:\?|$)/ }); assert.ok(library);
    await library.waitForFunction(() => Boolean(window.HDRLibrary));
    const framePage = await page.request.get(library.url());
    assert.equal(framePage.headers()["cache-control"], "no-store");
    assert.ok(framePage.headers()["content-security-policy"].includes("frame-ancestors 'self'"));
    assert.equal(await library.evaluate(() => [...document.querySelectorAll("script[src],link[rel=stylesheet]")].every(element => new URL(element.src || element.href).searchParams.has("v"))), true);
    assert.ok(!(await framePage.text()).includes("__HDR_FINISHER_ASSET_VERSION__"));
    await library.evaluate(async folder => {
      const response = await fetch("/api/library/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [folder] }) });
      if (!response.ok) throw new Error(await response.text());
      await HDRLibrary.browse(folder);
    }, folder);
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 60000 });
    await library.waitForFunction(() => HDRLibrary.getSnapshot().count === 3001, null, { timeout: 60000 });
    let snapshot = await library.evaluate(() => HDRLibrary.getSnapshot());
    assert.ok(snapshot.visible > 0 && snapshot.visible < 150, JSON.stringify(snapshot));
    assert.equal(snapshot.selection.length, 1, "Hiding an unreadable first file must select the first readable photo");
    assert.equal(await page.locator(".workspace-main").isVisible(), false);
    assert.equal(await page.locator("#viewer-status-dock").isVisible(), false);
    await library.locator("#add-folder").click();
    await library.locator("#picker-view-list").click();
    await library.locator("#picker-path").fill(folder);
    await library.locator("#picker-go").click();
    await library.waitForFunction(() => document.querySelector("#picker-list button"));
    await library.waitForFunction(() => document.querySelectorAll("#picker-list .file").length === 3002);
    const folders = library.locator("#picker-list .directory");
    await folders.nth(0).click(); await folders.nth(1).click({ modifiers: ["Control"] });
    assert.equal(await library.locator('#picker-list .directory[aria-selected="true"]').count(), 2);
    await folders.nth(0).click({ modifiers: ["Control"] }); await folders.nth(1).click({ modifiers: ["Control"] });
    assert.equal(await library.locator('#picker-list .directory[aria-selected="true"]').count(), 0);
    await library.locator("#picker-list .file.supported").filter({ hasText: "photo-0000.png" }).click();
    await library.waitForFunction(() => { const image = document.getElementById("picker-preview"); return !image.hidden && image.naturalWidth > 0; });
    assert.equal(await library.locator("#picker-preview-name").textContent(), "photo-0000.png");
    const bounds = await library.locator("#picker-list").boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 700);
    await library.waitForFunction(() => document.getElementById("picker-list").scrollTop > 0);
    assert.equal(await library.evaluate(() => { const dialog = document.getElementById("folder-picker"); return dialog.scrollHeight <= dialog.clientHeight; }), true);
    await page.screenshot({ path: path.join(output, "picker.png") });
    await library.locator("#picker-pin").click();
    await library.waitForFunction(() => !document.getElementById("folder-picker").open);
    const icon = await library.evaluate(() => {
      const button = document.querySelector(".expand-folder"), style = getComputedStyle(button, "::before");
      return { width: style.width, token: getComputedStyle(button).getPropertyValue("--panel-collapse-button-icon-size").trim(), colour: style.backgroundColor, foreground: getComputedStyle(button).color };
    });
    assert.equal(icon.width, icon.token); assert.equal(icon.colour, icon.foreground); assert.notEqual(icon.colour, "rgb(0, 0, 0)");
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 60000 });
    await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas").length > 0 && [...document.querySelectorAll("#grid-space canvas")].every(canvas => canvas.dataset.pictureKey), null, { timeout: 60000 });
    await page.screenshot({ path: path.join(output, "grid.png") });
    const first = await library.locator("#grid-space .library-cell").first().getAttribute("data-path");
    const cache = await library.evaluate(async photo => {
      return (await fetch("/api/library/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: photo, edge: 512, quality: "quick" }) })).json();
    }, first);
    assert.equal(cache.cache_hit, true); assert.ok(cache.stored_bytes > 0);
    await library.evaluate(() => { const grid = document.getElementById("library-grid"); grid.scrollTop = grid.scrollHeight; });
    await library.waitForFunction(first => ![...document.querySelectorAll("#grid-space .library-cell")].some(cell => cell.dataset.path === first), first);
    await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 30000 });
    snapshot = await library.evaluate(() => HDRLibrary.getSnapshot()); assert.ok(snapshot.visible < 150);
    console.log("[library] virtual grid", snapshot, "thumbnail bytes", cache.stored_bytes);
    await library.locator("#single-view").click();
    await library.waitForSelector("#single-picture[data-picture-key]", { timeout: 60000 });
    const pixels = await library.evaluate(async () => {
      const canvas = document.getElementById("single-picture");
      // Decode the GPU canvas snapshot into a separate 2D canvas.
      const image = new Image();
      image.src = canvas.toDataURL("image/png");
      await image.decode();
      const surface = document.createElement("canvas");
      surface.width = canvas.width; surface.height = canvas.height;
      const context = surface.getContext("2d");
      context.drawImage(image, 0, 0);
      return [...context.getImageData(Math.floor(surface.width/2), Math.floor(surface.height/2), 1, 1).data];
    });
    assert.ok(pixels.slice(0,3).some(value => value > 10), JSON.stringify(pixels));
    await page.screenshot({ path: path.join(output, "single.png") });
    const previous = await library.evaluate(() => HDRLibrary.getSnapshot().selected);
    await library.locator("#single-picture").click(); await page.keyboard.press("ArrowRight");
    await library.waitForFunction(previous => HDRLibrary.getSnapshot().selected !== previous && document.getElementById("single-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected, previous, { timeout: 30000 });
    await page.keyboard.press("f");
    await library.waitForFunction(() => HDRLibrary.getSnapshot().review);
    await page.waitForFunction(() => document.body.classList.contains("library-review"));
    await page.screenshot({ path: path.join(output, "review.png") });
    await page.keyboard.press("Escape");
    await library.waitForFunction(() => !HDRLibrary.getSnapshot().review);
    await library.locator("#single-picture").click(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => state.session && state.activeWorkflow === "grade", null, { timeout: 60000 });
    await page.waitForFunction(() => state.acceptedPresentation?.exact && viewerState().status === "ready", null, { timeout: 60000 });
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().active), false);
    // Keep the production leave policy; supply deterministic native-dialog choices.
    await page.evaluate(async () => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = .5;
      await queueEditCommand("set_global_adjustments", { adjustments });
      window.libraryGateCount = 0;
      window.libraryGateChoice = "cancel";
      const policy = window.HDRPhotoTransition;
      window.HDRPhotoTransition = { leaveCurrentPhoto: options => {
        window.libraryGateCount++;
        return policy.leaveCurrentPhoto({ ...options, choose: async () => window.libraryGateChoice });
      } };
    });
    assert.equal(await page.evaluate(() => state.documentDirty), true);
    const currentSession = await page.evaluate(() => state.session.session_id);
    await page.evaluate(() => activateWorkflowTab("import"));
    await library.waitForFunction(() => HDRLibrary.getSnapshot().active);
    await library.locator("#single-picture").click(); await page.keyboard.press("ArrowRight");
    await library.waitForFunction(() => document.getElementById("single-picture").dataset.picturePath === HDRLibrary.getSnapshot().selected);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.libraryGateCount === 1);
    assert.equal(await page.evaluate(() => state.session.session_id), currentSession);
    assert.equal(await page.evaluate(() => state.activeWorkflow), "import");
    await page.evaluate(() => { window.libraryGateChoice = "discard"; });
    await library.locator("#single-picture").click(); await page.keyboard.press("Enter");
    await page.waitForFunction(old => state.session && state.activeWorkflow === "grade" && state.session.session_id !== old, currentSession, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.libraryGateCount), 2);
    assert.equal(fs.readFileSync(path.join(folder, "ignored.hdrf"), "utf8"), "sidecar stays untouched");
    assert.equal(fs.readdirSync(folder).filter(name => name.endsWith(".hdrf")).length, 1);
    // Local real-photo check: copy samples to output, never write to originals.
    const rawSources = [
      "D:/Photos/HDR Test Images/DSC00264.ARW",
      "D:/Photos/HDR Test Images/DJI Samples/DSC00264_DxO-optical-corr-only.dng",
      "D:/Photos/HDR Test Images/Test Suite Images/iphone_16_pro_IMG_3324.HEIC",
    ];
    if (rawSources.every(source => fs.existsSync(source))) {
      const rawFolder = fs.mkdtempSync(path.join(output, "formats-"));
      for (const source of rawSources) fs.copyFileSync(source, path.join(rawFolder, path.basename(source)));
      await page.evaluate(() => activateWorkflowTab("import"));
      await library.waitForFunction(() => HDRLibrary.getSnapshot().active);
      await library.evaluate(folder => HDRLibrary.browse(folder), rawFolder);
      await library.waitForFunction(() => document.querySelectorAll("#grid-space canvas").length === 3 && [...document.querySelectorAll("#grid-space canvas")].every(canvas => canvas.dataset.pictureKey), null, { timeout: 60000 });
      assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().count), 3);
      await page.screenshot({ path: path.join(output, "real-formats.png") });
      for (const source of rawSources) {
        const cached = await library.evaluate(async photo => (await fetch("/api/library/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: photo, edge: 512, quality: /\.heic$/i.test(photo) ? "fast" : "quick" }) })).json(), path.join(rawFolder, path.basename(source)));
        assert.equal(cached.cache_hit, true);
        console.log("[library format]", path.basename(source), cached.route);
      }
    } else console.log("[library format] local real samples unavailable; synthetic route checks only");
    // Cold real-folder startup must draw pixels while other photos are still queued.
    if (fs.existsSync("D:/Photos/HDR Test Images")) {
      // Temporary diagnosis: compare page events, protocol timestamps and fetch lifetimes.
      const trace = { page: [], protocol: [] }, protocolRequests = new Map();
      const protocol = await page.context().newCDPSession(page);
      await protocol.send("Network.enable");
      protocol.on("Network.requestWillBeSent", event => {
        if (new URL(event.request.url).pathname !== "/api/library/picture") return;
        const body = JSON.parse(event.request.postData || "{}");
        protocolRequests.set(event.requestId, body);
        trace.protocol.push({ kind: "start", id: event.requestId, time: event.timestamp, ...body });
      });
      for (const [eventName, kind] of [["Network.loadingFinished", "done"], ["Network.loadingFailed", "failed"]]) {
        protocol.on(eventName, event => {
          if (protocolRequests.has(event.requestId)) trace.protocol.push({ kind, id: event.requestId, time: event.timestamp, error: event.errorText, cancelled: event.canceled });
        });
      }
      await library.evaluate(() => {
        const original = window.fetch.bind(window), events = window.__coldFetchTrace = [];
        let next = 0;
        window.fetch = async (input, options = {}) => {
          if (new URL(typeof input === "string" ? input : input.url, location.href).pathname !== "/api/library/picture") return original(input, options);
          const id = ++next, body = JSON.parse(options.body || "{}");
          const record = kind => events.push({ kind, id, time: performance.now(), ...body });
          let settled = false;
          const end = kind => { if (!settled) { settled = true; record(kind); } };
          record("start");
          options.signal?.addEventListener("abort", () => { if (!settled) record("abort"); }, { once: true });
          try {
            const response = await original(input, options), json = response.json.bind(response);
            record("headers");
            response.json = async () => { try { return await json(); } finally { end("done"); } };
            return response;
          } catch (error) { end("failed"); throw error; }
        };
      });
      let firstPixels = null, firstMeta = null, finished = 0, active = 0, peak = 0;
      const started = Date.now();
      const pending = new Set();
      const request = req => {
        if (new URL(req.url()).pathname === "/api/library/picture") { pending.add(req); peak = Math.max(peak, ++active); trace.page.push({kind:"start",time:Date.now(),active,...req.postDataJSON()}); }
        if (/\/api\/library\/(?:pixels|kept-pixels|raw-thumbnail)\//.test(req.url()) && firstPixels == null) firstPixels = Date.now() - started;
      };
      const done = req => { if (pending.delete(req)) { active--; trace.page.push({kind:"done",time:Date.now(),active,failure:req.failure(),timing:req.timing(),...req.postDataJSON()}); } };
      const response = res => { if (res.url().endsWith("/api/library/picture")) { firstMeta ??= Date.now() - started; finished++; } };
      page.on("request", request); page.on("requestfinished", done); page.on("requestfailed", done); page.on("response", response);
      await library.evaluate(() => HDRLibrary.browse("D:/Photos/HDR Test Images"));
      await library.waitForSelector("#grid-space canvas[data-picture-key]", { timeout: 60000 });
      trace.renderer = await library.evaluate(() => window.__coldFetchTrace);
      trace.peak = peak;
      const traceFile = path.join(output, "cold-request-trace-" + started + ".json");
      fs.writeFileSync(traceFile, JSON.stringify(trace, null, 2));
      console.log("[cold request diagnosis]", traceFile, "page peak", peak);
      await protocol.detach();
      assert.ok(firstPixels != null); assert.ok(peak <= 4, `Picture request peak ${peak}`);
      assert.ok(finished < await library.evaluate(() => HDRLibrary.getSnapshot().visible), "First picture must precede the rest of the visible decodes");
      console.log("[library cold folder] first metadata", firstMeta, "ms; first pixels requested", firstPixels, "ms; first completed picture", Date.now() - started, "ms; maximum picture requests", peak);
      page.off("request", request); page.off("requestfinished", done); page.off("requestfailed", done); page.off("response", response);
    }
    assert.deepEqual(errors, []);
    console.log("Stage A passed: folder picker, recursive folders, read-only browse, virtual grid/cache, single/filmstrip, arrows, review, Grade and Cancel/Discard gate.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
