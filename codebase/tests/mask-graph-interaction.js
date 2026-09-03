const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const maskRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (/\/local-mask\/[^/]+\?/.test(response.url()) && response.request().method() === "GET") {
      maskRequests.push({ url: response.url(), status: response.status() });
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    await page.locator("#grade-mode-local").click();

    const created = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.locator('[data-local-tool="linear_gradient"]').click();
    await page.locator("#local-add-adjustment").click();
    await created;
    await page.waitForFunction(() => selectedLocal()?.mask?.leaf?.type === "linear_gradient");
    assert(
      await page.locator('[data-local-tool="linear_gradient"]').isDisabled(),
      "The assigned parent tool was not locked after creation.",
    );
    assert(
      await page.locator('[data-local-tool="brush"]').isDisabled(),
      "Another tool remained clickable on a locked parent mask.",
    );

    const parentMenu = page.getByRole("button", { name: "More actions for Local Adjustment 1" });
    await parentMenu.click();
    await page.getByRole("menuitem", { name: "Create sub-mask" }).click();
    const pendingSubMask = page.locator("#local-adjustment-list > li.is-sub-mask.is-pending");
    assert(await pendingSubMask.getByText("Pick a tool", { exact: true }).isVisible(), "The pending sub-mask did not ask the user to pick a tool.");
    const subMaskCreated = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.locator('[data-local-tool="luminance_range"]').click();
    await subMaskCreated;
    await page.waitForFunction(() => selectedLocal()?.mask?.children?.[1]?.leaf?.type === "luminance_range");
    assert(
      await page.locator('[data-local-tool="linear_gradient"]').isDisabled(),
      "The parent tool remained clickable on a locked sub-mask.",
    );
    assert(
      await page.evaluate(() => selectedMaskExpression(selectedLocal())?.leaf?.type === "luminance_range"),
      "The selected sub-mask did not exclusively own the active editor tool.",
    );
    assert(await page.locator("#local-adjustment-list > li.is-sub-mask").count() === 1, "The sub-mask was not rendered as an indented child row.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      const childId = state.selectedSubMaskId;
      return localComparisonMaskEntry(local, childId, "parent") && localComparisonMaskEntry(local, childId, "child");
    }, null, { timeout: 30000 });
    assert(
      await page.locator(".local-mask-comparison-legend span").allTextContents().then((labels) => labels.join("|") === "Parent|Child|Overlap"),
      "The child editor did not explain the parent, child, and overlap colors.",
    );
    const comparisonColors = await page.evaluate(() => {
      const mask = (alpha) => {
        const canvas = document.createElement("canvas");
        canvas.width = 3;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        const pixels = context.createImageData(3, 1);
        alpha.forEach((value, index) => { pixels.data[index * 4 + 3] = value; });
        context.putImageData(pixels, 0, 0);
        return canvas;
      };
      const target = document.createElement("canvas");
      target.width = 3;
      target.height = 1;
      drawLocalMaskComparison(
        target.getContext("2d"),
        { key: "test-parent", canvas: mask([255, 255, 0]) },
        { key: "test-child", canvas: mask([0, 255, 255]) },
        (value) => value * 3,
        (value) => value,
      );
      const pixels = target.getContext("2d").getImageData(0, 0, 3, 1).data;
      return [0, 1, 2].map((index) => [...pixels.slice(index * 4, index * 4 + 4)]);
    });
    assert(comparisonColors[0][0] > 240 && comparisonColors[0][2] < 80, `Parent-only coverage was not red: ${JSON.stringify(comparisonColors)}`);
    assert(comparisonColors[1][0] > 240 && comparisonColors[1][2] > 200, `Overlapping coverage was not magenta: ${JSON.stringify(comparisonColors)}`);
    assert(comparisonColors[2][2] > 240 && comparisonColors[2][0] < 80, `Child-only coverage was not blue: ${JSON.stringify(comparisonColors)}`);

    const leakedChildGradientGizmos = await page.evaluate(() => {
      const local = selectedLocal();
      const previousMask = local.mask;
      const previousSubMaskId = state.selectedSubMaskId;
      const previousDrawGradient = drawLinearGradientGizmo;
      let draws = 0;
      local.mask = {
        id: crypto.randomUUID(),
        enabled: true,
        operator: "union",
        leaf: null,
        children: [newMaskExpression("brush"), newMaskExpression("linear_gradient")],
        inverted: false,
      };
      state.selectedSubMaskId = null;
      drawLinearGradientGizmo = () => { draws += 1; };
      try {
        renderLocalMaskOverlay();
      } finally {
        drawLinearGradientGizmo = previousDrawGradient;
        local.mask = previousMask;
        state.selectedSubMaskId = previousSubMaskId;
        renderLocalMaskOverlay();
      }
      return draws;
    });
    assert(leakedChildGradientGizmos === 0, "A child Gradient gizmo leaked into its selected Brush parent's editor.");

    await page.locator('.local-adjustment-select:not([data-sub-mask-id])').click();
    assert(
      await page.evaluate(() => selectedMaskExpression(selectedLocal())?.leaf?.type === "linear_gradient"),
      "Selecting the parent did not restore the parent's tool as the exclusive editor gizmo.",
    );
    await page.waitForFunction(() => {
      const local = selectedLocal();
      const cached = localAuthoritativeMaskCache.get(local.id);
      return !state.selectedSubMaskId && cached?.signature === localMaskSpatialSignature(local.mask);
    }, null, { timeout: 30000 });
    await page.locator('.local-adjustment-select[data-sub-mask-id]').click();

    const subMaskMenu = page.getByRole("button", { name: "More actions for Sub-mask 1" });
    await subMaskMenu.click();
    assert(await page.getByRole("menuitem", { name: "Create sub-mask" }).count() === 0, "A sub-mask incorrectly allowed another nested sub-mask.");
    assert(await page.getByRole("menuitemradio").allTextContents().then((labels) => labels.join("|") === "Union|Intersection|Subtract"), "The sub-mask blend modes are incomplete.");
    const subtractResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.getByRole("menuitemradio", { name: "Subtract" }).click();
    await subtractResponse;
    assert(await page.evaluate(() => selectedLocal().mask.operator === "subtract"), "The sub-mask blend mode did not persist.");

    const bypassResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.getByRole("button", { name: "Bypass Sub-mask 1" }).click();
    await bypassResponse;
    assert(await page.evaluate(() => selectedLocal().mask.enabled === false), "The sub-mask bypass state did not persist.");
    const restoreResponse = page.waitForResponse((response) =>
      response.url().includes("/edit-commands") && response.request().method() === "POST" && response.status() === 200,
    );
    await page.getByRole("button", { name: "Show Sub-mask 1" }).click();
    await restoreResponse;

    await page.evaluate(async () => {
      const local = selectedLocal();
      local.hdr_grade.exposure = 1.25;
      local.mask.operator = "union";
      local.mask.children[1].leaf.fade_in_start_ev = -3;
      local.mask.children[1].leaf.full_start_ev = -1;
      local.mask.children[1].leaf.full_end_ev = 2;
      local.mask.children[1].leaf.fade_out_end_ev = 4;
      local.mask.children[1].leaf.mask_feather = 0.01;
      local.mask.children[1].leaf.mask_opacity = 0.65;
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      scheduleLocalPreview({ spatialMaskChanged: true });
      await commitSelectedLocal();
    });
    await page.waitForFunction(() => state.localMaskCommitDepth === 0);
    await page.waitForTimeout(600);

    const initial = await page.evaluate(async () => {
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      return window.HDRFinisherPerformance.gpuSnapshot();
    });
    assert(initial.available, `WebGPU was unavailable: ${initial.detail}`);
    assert(initial.resources.maskGraphs > 0, `The retained Boolean graph was not created: ${JSON.stringify(initial.resources)}`);
    const initialMaskGraphCount = initial.resources.maskGraphs;
    assert(initial.maskEvents.some((event) => event.kind === "gpu-mask-graph" && event.passCount === 1), "The Boolean graph did not execute its retained GPU pass.");
    assert(
      !maskRequests.some((request) => request.url.includes("mask_path=0") && request.status !== 200),
      "The Gradient leaf could not be reused or fetched independently.",
    );
    assert(!maskRequests.some((request) => request.url.includes("mask_path=1")), "The GPU Luma leaf unexpectedly used CPU mask transport.");

    maskRequests.length = 0;
    const mutations = [
      { operator: "union", opacity: 0.2, inverted: false },
      { operator: "intersect", opacity: 0.85, inverted: false },
      { operator: "subtract", opacity: 0.45, inverted: false },
      { operator: "subtract", opacity: 0.7, inverted: true },
    ];
    for (const mutation of mutations) {
      await page.evaluate(async (next) => {
        const local = selectedLocal();
        local.mask.operator = next.operator;
        local.mask.children[0].leaf.mask_opacity = next.opacity;
        local.mask.inverted = next.inverted;
        scheduleLocalPreview();
        await commitSelectedLocal();
      }, mutation);
      await page.waitForFunction(() => state.localMaskCommitDepth === 0);
      await page.waitForTimeout(180);
    }
    assert(maskRequests.length === 0, `Influence-only graph edits regenerated leaf masks: ${JSON.stringify(maskRequests)}`);

    const beforeUndo = await page.evaluate(() => ({ revision: state.editRevision, mask: JSON.parse(JSON.stringify(selectedLocal().mask)) }));
    await page.keyboard.press("Control+z");
    await page.waitForFunction((revision) => state.editRevision > revision, beforeUndo.revision);
    const afterUndo = await page.evaluate(() => JSON.parse(JSON.stringify(selectedLocal().mask)));
    assert(afterUndo.inverted === false, "Undo did not restore the previous graph inversion state.");
    const undoRevision = await page.evaluate(() => state.editRevision);
    await page.keyboard.press("Control+y");
    await page.waitForFunction((revision) => state.editRevision > revision, undoRevision);
    const afterRedo = await page.evaluate(() => JSON.parse(JSON.stringify(selectedLocal().mask)));
    assert(afterRedo.inverted === true, "Redo did not restore the retained graph state.");

    const settled = await page.evaluate(async () => {
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const server = await fetch(`/api/session/${state.session.session_id}/edit-state`).then((response) => response.json());
      return {
        gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        frontend: JSON.parse(JSON.stringify(selectedLocal().mask)),
        server: server.document.local_adjustments.find((local) => local.id === state.selectedLocalId).mask,
      };
    });
    assert(JSON.stringify(settled.frontend) === JSON.stringify(settled.server), "The retained graph did not converge with serialized server state.");
    assert(settled.gpu.resources.maskGraphs === initialMaskGraphCount, `Graph resources grew across influence edits: ${JSON.stringify(settled.gpu.resources)}`);
    assert(pageErrors.length === 0, `Browser errors occurred: ${pageErrors.join(" | ")}`);

    console.log(JSON.stringify({
      initialResources: initial.resources,
      settledResources: settled.gpu.resources,
      maskRequestsDuringInfluenceEdits: maskRequests.length,
      undoRedo: true,
      operators: mutations.map((mutation) => mutation.operator),
      comparisonColors,
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
