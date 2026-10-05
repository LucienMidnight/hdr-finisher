const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
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
      const stack = document.querySelector(".local-stack-surface").getBoundingClientRect();
      const maskActions = document.querySelector(".local-mask-top-actions").getBoundingClientRect();
      const toolbar = document.querySelector(".local-stack-primary-actions").getBoundingClientRect();
      const ids = ["local-add-adjustment", "local-delete", "local-duplicate", "local-move-up", "local-move-down"];
      return {
        stackBottom: stack.bottom,
        actionsTop: maskActions.top,
        actionsBottom: maskActions.bottom,
        toolbarTop: toolbar.top,
        buttons: ids.map((id) => {
          const button = document.getElementById(id);
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return { id, x: rect.x, borderTop: style.borderTopWidth, borderLeft: style.borderLeftWidth };
        }),
      };
    });
    assert(layout.stackBottom <= layout.actionsTop && layout.actionsBottom <= layout.toolbarTop, `Mask actions are not directly below the stack: ${JSON.stringify(layout)}`);
    assert(layout.buttons.every((button, index, buttons) => !index || button.x > buttons[index - 1].x), `Position buttons are not to the right of Copy: ${JSON.stringify(layout.buttons)}`);
    assert(layout.buttons.every((button) => button.borderTop === "0px"), `Toolbar buttons retained box borders: ${JSON.stringify(layout.buttons)}`);
    assert(layout.buttons.slice(1).every((button) => button.borderLeft === "1px"), `Toolbar dividers are missing: ${JSON.stringify(layout.buttons)}`);

    const addButton = page.locator("#local-add-adjustment");
    await addButton.scrollIntoViewIfNeeded();
    const before = await page.locator(".grade-rail").evaluate((node) => node.scrollTop);
    await addButton.click();
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
