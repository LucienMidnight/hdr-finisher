// Resolve an untagged source through the same controls a person must use.
// Defaults match hdr_headroom.tiff; callers declare other fixture encodings.
async function resolveInterpretation(page, {
  primaries = "linear_srgb", transfer = "linear", reference = "scene_0_18",
} = {}) {
  await page.waitForFunction(() => Boolean(state.session?.session_id) && !state.importInProgress,
    null, { timeout: 120000 });
  if (!await page.evaluate(() => Boolean(state.session.analysis?.needs_color_override))) return;
  await page.locator('[data-workflow-tab="grade"]').click();
  // The review notice's "Set manually" action opens the (possibly collapsed)
  // source rail in manual mode, as a person would.
  const action = page.locator("#manual-interpretation");
  if (await action.isVisible().catch(() => false)) await action.click();
  else await page.evaluate(() => openManualInterpretation()); // same action, notice folded away
  await page.locator("#interpretation-color-space").waitFor({ state: "visible" });
  await page.locator("#interpretation-color-space").selectOption(primaries);
  await page.locator("#interpretation-transfer").selectOption(transfer);
  if (transfer === "linear") {
    await page.locator("#interpretation-linear-reference").selectOption(reference);
  }
  const sessionId = await page.evaluate(() => state.session.session_id);
  // Watch the actual Apply response before waiting for the UI. A successful
  // interpretation can still be unresolved (for example a linear TIFF without
  // HDR headroom); waiting longer cannot clear that classification.
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/session/${sessionId}/interpretation`,
      { timeout: 120000 }),
    page.locator("#apply-interpretation").click(),
  ]);
  const payload = await response.json();
  if (!response.ok() || payload.session?.analysis?.needs_color_override !== false) {
    const current = await page.evaluate(() => ({ source: state.session?.source, analysis: state.session?.analysis }));
    throw new Error(`Source interpretation did not resolve: ${JSON.stringify({
      status: response.status(), request: response.request().postDataJSON(),
      source: payload.session?.source, analysis: payload.session?.analysis, detail: payload.detail, current,
    })}`);
  }
  await page.waitForFunction(id => state.session?.session_id === id && state.session.analysis?.needs_color_override === false,
    sessionId, { timeout: 120000 });
  await page.locator("#interpretation-gate").waitFor({ state: "hidden", timeout: 120000 });
}

module.exports = { resolveInterpretation };
