const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const startup = await page.evaluate(() => ({
      dockVisible: getComputedStyle(document.getElementById("viewer-status-dock")).visibility === "visible",
      dockLive: document.getElementById("viewer-status-dock").hasAttribute("aria-live"),
      ready: document.querySelector('[data-status-id="application"]')?.textContent,
    }));
    assert(startup.dockVisible, "The status bar must remain visible with no image loaded.");
    assert(!startup.dockLive, "The status bar container must not duplicate live-region announcements.");
    assert(startup.ready === "Ready", "The empty workspace should expose a Ready status entry.");

    await page.evaluate(() => {
      HDRStatus.post({ id: "save-test", severity: "progress", message: "Saving…", progress: 25 });
      HDRStatus.post({ id: "export-test", severity: "progress", message: "Exporting…", progress: "indeterminate" });
      HDRStatus.update("save-test", { message: "Saving revision 2…", progress: 60 });
    });
    assert(await page.locator('[data-status-id="save-test"]').count() === 1, "Updating a channel must replace its entry.");
    assert(await page.locator('[data-status-id="export-test"]').count() === 1, "Save and export channels must coexist.");
    assert((await page.locator('[data-status-id="save-test"] progress').getAttribute("value")) === "60", "Determinate progress did not update.");

    const result = await page.evaluate(async () => {
      const host = document.createElement("div");
      host.id = "status-manager-test-host";
      document.body.append(host);
      const manager = HDRStatusManager.create(host, {
        successTimeoutMs: 220,
        focusFallback: () => document.getElementById("project-open"),
      });
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      manager.post({ id: "retry", severity: "error", message: "Save failed" });
      await wait(300);
      const errorPersistent = Boolean(host.querySelector('[data-status-id="retry"][role="alert"]'));
      manager.post({ id: "retry", severity: "success", message: "Saved" });
      const replacedBySuccess = host.querySelectorAll('[data-status-id="retry"]').length === 1
        && host.querySelector('[data-status-id="retry"]')?.getAttribute("role") === "status";
      await wait(280);
      const retryDismissed = !host.querySelector('[data-status-id="retry"]');

      manager.post({ id: "hover", severity: "success", message: "Hover me" });
      const hover = host.querySelector('[data-status-id="hover"]');
      hover.dispatchEvent(new MouseEvent("mouseenter"));
      await wait(300);
      const hoverPaused = hover.isConnected;
      hover.dispatchEvent(new MouseEvent("mouseleave"));
      await wait(260);
      const hoverDismissed = !hover.isConnected;

      manager.post({ id: "focus", severity: "success", message: "Focus me" });
      const focused = host.querySelector('[data-status-id="focus"]');
      focused.focus();
      await wait(300);
      const focusPaused = focused.isConnected;
      document.getElementById("project-open").focus();
      await wait(260);
      const focusDismissed = !focused.isConnected;

      window.__statusActionRan = false;
      manager.post({
        id: "action",
        severity: "attention",
        message: "Decision needed",
        action: { label: "Act", run: () => { window.__statusActionRan = true; } },
      });
      host.querySelector('[data-status-id="action"] button').click();
      const actionRan = window.__statusActionRan;

      manager.post({ id: "dismiss", severity: "error", message: "Dismiss me" });
      const dismiss = host.querySelector('[data-status-id="dismiss"] .status-entry-dismiss');
      dismiss.focus();
      dismiss.click();
      const dismissRemoved = !host.querySelector('[data-status-id="dismiss"]');
      const dismissFocusRestored = document.activeElement === document.getElementById("project-open");
      host.remove();
      return {
        errorPersistent, replacedBySuccess, retryDismissed,
        hoverPaused, hoverDismissed, focusPaused, focusDismissed,
        actionRan, dismissRemoved, dismissFocusRestored,
      };
    });

    for (const [name, passed] of Object.entries(result)) assert(passed, `Status manager lifecycle failed: ${name}`);
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Status manager interaction checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
