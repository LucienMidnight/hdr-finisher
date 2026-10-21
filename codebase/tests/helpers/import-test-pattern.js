// Use the normal byte-import path; the Library hides the retired Import rail.
async function importTestPattern(page) {
  const response = await page.request.get(new URL("/api/proof/test-pattern", page.url()).href);
  if (!response.ok()) throw new Error(`Test pattern failed with HTTP ${response.status()}.`);
  await page.locator("#file-input").setInputFiles({
    name: "hdr_delivery_proof_pattern.tiff", mimeType: "image/tiff", buffer: await response.body(),
  });
  await page.waitForFunction(() => Boolean(state.session) && !state.importInProgress
    && document.body.dataset.workflow === "grade", null, { timeout: 120000 });
}
module.exports = { importTestPattern };
