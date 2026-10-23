const assert = require("node:assert/strict");

// A tool click creates a session-only row. Tests inspecting empty controls must
// keep that row unused; persistence starts with the first authored mask content.
async function selectLocalDraft(page, type) {
  await page.locator("#grade-mode-local").click();
  await page.locator(`[data-local-tool="${type}"]`).click();
  await page.waitForFunction(tool => state.localUnusedAdjustment?.id === state.selectedLocalId
    && selectedMaskLeaf()?.type === tool, type);
  return page.evaluate(() => state.selectedLocalId);
}

async function createLocalAdjustment(page, type) {
  const id = await selectLocalDraft(page, type);
  return commitLocalDraft(page, type, id);
}

async function commitLocalDraft(page, type, id) {
  id ??= await page.evaluate(() => state.selectedLocalId);
  const responsePromise = page.waitForResponse(response => {
    if (!response.url().includes("/edit-commands") || response.request().method() !== "POST") return false;
    return response.request().postDataJSON()?.commands?.some(command =>
      command.command_type === "create_local" && command.payload?.local?.id === id);
  });
  const author = async () => {
    if (type === "luminance_range") {
      await page.locator('.luma-reference-range input[data-range-handle="0"]').evaluate(input => {
        input.value = String(Math.min(Number(input.max) - 0.01, Number(input.value) + 0.1));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return;
    }
    // Use the actual picture rectangle, not the surrounding letterboxed pane.
    await page.evaluate(async () => { await ensureGeometryCoordinateMap(); });
    const box = await page.evaluate(() => activePreviewElement().getBoundingClientRect().toJSON());
    assert(box.width > 0 && box.height > 0, "Local mask picture is not drawable");
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
    if (type === "path") {
      for (const point of [[.3, .3], [.7, .3], [.7, .7], [.3, .7]]) await page.mouse.click(...at(...point));
      await page.locator("#local-mask-overlay").focus();
      await page.keyboard.press("Enter");
    } else {
      assert(["brush", "linear_gradient"].includes(type), `Unsupported mask tool ${type}`);
      await page.mouse.move(...at(.3, .4));
      await page.mouse.down();
      await page.mouse.move(...at(.7, .6), { steps: 6 });
      await page.mouse.up();
    }
  };
  const [response] = await Promise.all([responsePromise, author()]);
  assert(response.ok(), `Creating ${type} failed: ${response.status()} ${await response.text()}`);
  await page.waitForFunction(localId => !state.localMaskCommitDepth
    && state.localUnusedAdjustment?.id !== localId
    && state.editDocument.local_adjustments.some(local => local.id === localId), id);
  return response;
}

module.exports = { selectLocalDraft, createLocalAdjustment, commitLocalDraft };
