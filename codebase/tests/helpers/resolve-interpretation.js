// Resolve an untagged source through the same controls a person must use.
// Defaults match hdr_headroom.tiff; callers declare other fixture encodings.
async function resolveInterpretation(page, {
  primaries = "linear_srgb", transfer = "linear", reference = "scene_0_18",
} = {}) {
  await page.waitForFunction(() => Boolean(state.session?.session_id) && !state.importInProgress,
    null, { timeout: 120000 });
  if (!await page.evaluate(() => Boolean(state.session.analysis?.needs_color_override))) return;
  await page.locator('[data-workflow-tab="grade"]').click();
  if (await page.locator("#source-settings-toggle").getAttribute("aria-expanded") !== "true") {
    await page.locator("#source-settings-toggle").click();
  }
  await page.locator("#interpretation-mode").selectOption("manual");
  await page.locator("#interpretation-color-space").selectOption(primaries);
  await page.locator("#interpretation-transfer").selectOption(transfer);
  if (transfer === "linear") {
    await page.locator("#interpretation-linear-reference").selectOption(reference);
  }
  await page.locator("#apply-interpretation").click();
  await page.waitForFunction(() => state.session?.analysis?.needs_color_override === false,
    null, { timeout: 120000 });
  await page.locator("#interpretation-gate").waitFor({ state: "hidden", timeout: 120000 });
}

module.exports = { resolveInterpretation };
