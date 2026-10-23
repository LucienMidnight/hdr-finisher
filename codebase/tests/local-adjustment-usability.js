const { chromium } = require("playwright");
const { importTestPattern } = require("./helpers/import-test-pattern");
const { selectLocalDraft } = require("./helpers/local-adjustments");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importTestPattern(page);
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();

    const created = await page.evaluate(async () => {
      const local = newLocalAdjustment("path");
      local.mask.leaf.nodes = [
        { x: .25, y: .25, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" },
        { x: .75, y: .25, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" },
        { x: .75, y: .75, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" },
        { x: .25, y: .75, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" },
      ];
      state.selectedLocalId = local.id;
      state.selectedSubMaskId = null;
      state.localTool = "path";
      const ok = await queueEditCommand("create_local", { local });
      renderLocalAdjustments();
      return ok;
    });
    assert(created, "The Path fixture could not be created.");

    const box = await page.evaluate(() => activePreviewElement().getBoundingClientRect().toJSON());
    await page.mouse.click(box.x + box.width * .25, box.y + box.height * .25);
    const smoothResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await page.locator(".path-node-mode-smooth").click();
    assert((await smoothResponse).ok(), "Changing the selected node to Smooth did not commit.");

    // A short/strong tangent can visually overlap the neighbouring node. The
    // node must win that hit-test; otherwise the old Smooth node stays selected
    // and makes the profile button behave like a persistent drawing mode.
    await page.evaluate(() => {
      const leaf = firstMaskLeaf(selectedLocal().mask, "path");
      leaf.nodes[0].out_x = leaf.nodes[1].x;
      leaf.nodes[0].out_y = leaf.nodes[1].y;
      renderLocalMaskOverlay();
    });

    // Wait for the preceding Smooth edit's viewer/mask work before calculating
    // a pointer coordinate; processing-size changes invalidate geometry maps.
    await page.waitForFunction(() => viewerState().status === "ready"
      && !state.gpuDraftInFlight && !state.previewScheduler?.frameInFlight
      && !state.localMaskDraftController && !state.localMaskDraftPending
      && !state.localMaskDraftTimer, null, { timeout: 30000 });
    await page.evaluate(async () => { await ensureGeometryCoordinateMap(); });
    await page.waitForFunction(() => Boolean(currentGeometryCoordinateMap()));
    const secondNodeTarget = await page.evaluate(() => {
      const nodes = activePathNodes(firstMaskLeaf(selectedLocal().mask, "path"));
      const rect = activePreviewElement().getBoundingClientRect();
      const display = sourcePointToDisplay(nodes[1]);
      const clientX = rect.left + rect.width * display.x;
      const clientY = rect.top + rect.height * display.y;
      return { clientX, clientY, overlapping: nodes[0].out_x === nodes[1].x && nodes[0].out_y === nodes[1].y, hit: pathTargetAtPointer({ clientX, clientY }, nodes, state.selectedPathNode) };
    });
    assert(secondNodeTarget.overlapping, "The overlapping tangent fixture was lost during setup");
    assert(secondNodeTarget.hit?.type === "node" && secondNodeTarget.hit.index === 1, `The second node did not hit-test as itself: ${JSON.stringify(secondNodeTarget)}`);
    await page.mouse.click(secondNodeTarget.clientX, secondNodeTarget.clientY);
    const nodeSelection = await page.evaluate(() => {
      const leaf = firstMaskLeaf(selectedLocal().mask, "path");
      return {
        selected: state.selectedPathNode,
        first: leaf.nodes[0].node_type,
        second: leaf.nodes[1].node_type,
        sharpPressed: document.querySelector(".path-node-mode-sharp")?.getAttribute("aria-pressed"),
        smoothPressed: document.querySelector(".path-node-mode-smooth")?.getAttribute("aria-pressed"),
      };
    });
    assert(nodeSelection.selected === 1, `The second node was not selected: ${JSON.stringify(nodeSelection)}`);
    assert(nodeSelection.first === "smooth" && nodeSelection.second === "sharp", `Smooth leaked to the next node: ${JSON.stringify(nodeSelection)}`);
    assert(nodeSelection.sharpPressed === "true" && nodeSelection.smoothPressed === "false", `The profile buttons did not follow the selected node: ${JSON.stringify(nodeSelection)}`);

    const tile = page.locator("#local-adjustment-list button[data-local-id]").first();
    await tile.dblclick();
    const renameInput = page.locator(".local-adjustment-name-input");
    assert(await renameInput.isVisible(), "Double-click did not start inline renaming.");
    await renameInput.fill("Window dodge");
    const renameResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST",
    );
    await renameInput.press("Enter");
    assert((await renameResponse).ok(), "Inline rename did not commit.");
    assert(await tile.locator(".local-adjustment-copy > span").textContent() === "Window dodge", "The tile did not show the committed inline name.");
    assert(await page.locator("#local-rename").count() === 0, "The obsolete Rename button is still present.");

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing layout element: ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, visible: bounds.width > 0 && bounds.height > 0 };
      };
      const ids = ["local-delete", "local-duplicate", "local-move-up", "local-move-down"];
      return {
        heading: rect("#local-adjustments-panel .local-stack-heading"),
        title: rect("#local-adjustments-panel .local-stack-heading > span"),
        actions: rect("#local-adjustments-panel .local-stack-primary-actions"),
        stack: rect("#local-adjustments-panel .local-stack-surface"),
        toolStrip: rect("#local-adjustments-panel .local-tool-strip"),
        buttons: ids.map((id) => ({ id, ...rect(`#${id}`) })),
      };
    });
    assert(layout.heading.visible && layout.title.visible && layout.actions.visible, `Adjustment heading actions are not visible: ${JSON.stringify(layout)}`);
    assert(layout.heading.top <= layout.stack.top, `Adjustment heading is not above the stack: ${JSON.stringify(layout)}`);
    assert(layout.title.right <= layout.actions.left || layout.actions.right <= layout.title.left, `Adjustment title overlaps its actions: ${JSON.stringify(layout)}`);
    assert(layout.buttons.every((button) => button.visible), `A primary adjustment action is not visible: ${JSON.stringify(layout.buttons)}`);
    assert(layout.toolStrip.visible && layout.stack.bottom <= layout.toolStrip.top, `Mask tools are not below the adjustment stack: ${JSON.stringify(layout)}`);

    const addButton = page.locator('[data-local-tool="brush"]');
    await addButton.scrollIntoViewIfNeeded();
    const before = await page.locator(".grade-rail").evaluate((node) => node.scrollTop);
    const revisionBeforeDraft = await page.evaluate(() => state.editRevision);
    await selectLocalDraft(page, "brush");
    assert(await page.evaluate(() => state.editRevision) === revisionBeforeDraft, "An unused row entered history.");
    const after = await page.locator(".grade-rail").evaluate((node) => node.scrollTop);
    assert(after === before, `Adding a row moved the surrounding control panel (${before} to ${after}).`);

    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ nodeSelection, layout, controlPanelScroll: { before, after } }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
