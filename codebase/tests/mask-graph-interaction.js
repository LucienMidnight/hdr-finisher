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
    await created;
    await page.waitForFunction(() => selectedLocal()?.mask?.leaf?.type === "linear_gradient");

    await page.evaluate(async () => {
      const local = selectedLocal();
      local.hdr_grade.exposure = 1.25;
      local.mask = {
        operator: "union",
        leaf: null,
        children: [
          local.mask,
          {
            operator: "leaf",
            leaf: {
              type: "luminance_range",
              fade_in_start_ev: -3,
              full_start_ev: -1,
              full_end_ev: 2,
              fade_out_end_ev: 4,
              mask_feather: 0.01,
              mask_opacity: 0.65,
            },
            children: [],
            inverted: false,
          },
        ],
        inverted: false,
      };
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
    assert(maskRequests.some((request) => request.url.includes("mask_path=0") && request.status === 200), "The Gradient leaf was not fetched independently.");
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
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
