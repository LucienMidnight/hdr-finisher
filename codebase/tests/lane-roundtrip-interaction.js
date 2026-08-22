const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function stableScope(scope) {
  return {
    preview_kind: scope.preview_kind,
    scope_type: scope.scope_type,
    stats: scope.stats,
    channels: scope.channels,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");

    await page.evaluate(() => {
      const bias = document.querySelector("#hdr-compression-bias");
      bias.value = "-100";
      bias.dispatchEvent(new Event("input", { bubbles: true }));
      bias.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      await settlePreview("hdr");
      await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "hdr" });
    });
    await page.waitForFunction(() => !state.globalEditDirty && !state.globalEditSyncPending && els.scopeFreshness.textContent === "Settled");
    const before = await page.evaluate(() => ({
      adjustments: JSON.parse(JSON.stringify(state.adjustments.hdr)),
      scope: {
        preview_kind: state.lastScope.preview_kind,
        scope_type: state.lastScope.scope_type,
        stats: state.lastScope.stats,
        channels: state.lastScope.channels,
      },
    }));

    await page.evaluate(async () => {
      await switchLane("sdr");
      await switchLane("hdr");
      await settlePreview("hdr");
      await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "hdr" });
    });
    await page.waitForFunction(() => els.scopeFreshness.textContent === "Settled" && state.currentView === "hdr");
    const after = await page.evaluate(() => ({
      adjustments: JSON.parse(JSON.stringify(state.adjustments.hdr)),
      scope: {
        preview_kind: state.lastScope.preview_kind,
        scope_type: state.lastScope.scope_type,
        stats: state.lastScope.stats,
        channels: state.lastScope.channels,
      },
    }));

    if (JSON.stringify(before.adjustments) !== JSON.stringify(after.adjustments)) {
      throw new Error("HDR adjustments changed during an HDR/SDR lane round trip.");
    }
    if (JSON.stringify(stableScope(before.scope)) !== JSON.stringify(stableScope(after.scope))) {
      throw new Error("Settled HDR scope data changed during an edit-free lane round trip.");
    }
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("HDR/SDR lane round-trip browser test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
