// Proof size: a reduced proof says it is reduced, and a full-size proof is
// built at the source's own size (Viewport-Bounded GPU Preview PRD, section 3).
//
//   node tests/run-in-electron.js tests/proof-size-interaction.js
//
// The byte-for-byte equality of a full-size proof and an export is pinned in
// tests/test_proof_export_identity.py. This covers the part a person sees: the
// size choice, the labels, and that changing the size makes the proof stale.

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--enable-unsafe-webgpu"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const proofReady = () => page.waitForFunction(() => Boolean(state.proofArtifact)
    && state.proofDirty === false
    && document.querySelector("#chrome-proof-status")?.dataset.state === "idle", null, { timeout: 900000 });
  const read = () => page.evaluate(() => ({
    size: document.querySelector("#chrome-proof-size").value,
    fullSize: state.proofArtifact?.full_size ?? null,
    width: state.proofArtifact?.width ?? null,
    height: state.proofArtifact?.height ?? null,
    dirty: state.proofDirty,
    status: document.querySelector("#chrome-proof-status").textContent,
    watermark: document.querySelector("#chrome-proof-watermark").textContent,
    note: document.querySelector("#viewer-branch-note")?.textContent || els.viewerBranchNote.textContent,
    source: [state.session.source.width, state.session.source.height],
  }));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", ensureLargeNoisySource());
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForTimeout(500);
    if (await page.locator("#interpretation-gate").isVisible().catch(() => false)) await page.click("#accept-interpretation");
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    await page.evaluate(() => activateWorkflowTab("proof", { focus: false }));
    const initial = await read();
    assert(initial.size === "reduced", `Proof size should default to reduced: ${JSON.stringify(initial)}`);
    const longEdge = Math.max(...initial.source);
    assert(longEdge > 1600, `The fixture must be larger than a reduced proof: ${JSON.stringify(initial.source)}`);

    await page.click("#chrome-proof-refresh");
    await proofReady();
    const reduced = await read();
    assert(reduced.fullSize === false, `A reduced proof must not report full size: ${JSON.stringify(reduced)}`);
    assert(Math.max(reduced.width, reduced.height) === 1200, `Reduced proof long edge: ${JSON.stringify(reduced)}`);
    assert(/REDUCED PROOF/.test(reduced.status) && /not the export's pixels/.test(reduced.status),
      `The status must label a reduced proof: ${reduced.status}`);
    assert(reduced.watermark === "PROOF · REDUCED", `The watermark must label a reduced proof: ${reduced.watermark}`);
    assert(/REDUCED PROOF/.test(reduced.note), `The viewer note must label a reduced proof: ${reduced.note}`);

    await page.selectOption("#chrome-proof-size", "full");
    const stale = await read();
    assert(stale.dirty === true && /STALE PROOF/.test(stale.status),
      `Changing the size must make the proof stale: ${JSON.stringify(stale)}`);

    await page.click("#chrome-proof-refresh");
    await page.waitForFunction(() => state.proofArtifact?.full_size === true, null, { timeout: 900000 });
    await proofReady();
    const full = await read();
    assert(full.width === full.source[0] && full.height === full.source[1],
      `A full-size proof must be the source's size: ${JSON.stringify(full)}`);
    assert(/Full size/.test(full.status) && /same pixels as export/.test(full.status),
      `The status must say what a full-size proof is: ${full.status}`);
    assert(full.watermark === "PROOF", `A full-size proof carries the plain watermark: ${full.watermark}`);

    // Export resize and output sharpening are not part of a proof, and the
    // full-size label must stop claiming the export's pixels when either is on.
    await page.evaluate(() => {
      els.exportSharpening.value = "standard";
      els.exportSharpening.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const sharpened = await read();
    assert(/output sharpening are not included/.test(sharpened.status),
      `The label must disclose finishing the proof does not carry: ${sharpened.status}`);
    await page.evaluate(() => {
      els.exportSharpening.value = "off";
      els.exportSharpening.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const output = path.resolve("output", "proof-size-interaction");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "full-size-proof.png") });
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ reduced, full, sharpenedStatus: sharpened.status }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
