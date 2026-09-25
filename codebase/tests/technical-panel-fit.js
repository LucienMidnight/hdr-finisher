/**
 * The Technical scope type is a short, plain-language readout that fits the
 * scopes panel at its minimum height; Diagnostics carries the full list.
 *
 *   node tests/run-in-electron.js tests/technical-panel-fit.js
 *
 * Preview Responsiveness Tuning Sprint P5 (ledger 9.6). Technical used to list
 * about 45 rows across three columns, which did not fit at any panel height.
 * The owner's decision: Technical keeps 13 rows (Preview: View, Status, Detail,
 * Processing; Display: HDR on this display, Monitor; Source: File,
 * Interpretation, Encoding, Signal, Source peak, Reference white, Bit depth),
 * and a new Diagnostics entry in the scope-type dropdown shows everything.
 *
 * Checked with the panel at its minimum height: Technical shows exactly those
 * rows, in that order, with no row clipped and nothing to scroll; Diagnostics
 * exists and shows the full list (at least 40 rows, including the execution
 * route and the generation counters).
 */
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const EXPECTED = [
  "View", "Status", "Detail", "Processing",
  "HDR on this display", "Monitor",
  "File", "Interpretation", "Encoding", "Signal", "Source peak", "Reference white", "Bit depth",
];

async function readPanel(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const view = document.getElementById("technical-view");
    const box = view.getBoundingClientRect();
    const rows = [];
    for (const term of view.querySelectorAll("dt")) {
      if (term.offsetParent === null) continue;
      const value = term.nextElementSibling;
      const termBox = term.getBoundingClientRect();
      const valueBox = value?.getBoundingClientRect();
      rows.push({
        label: term.textContent.trim(),
        value: value?.textContent.trim() ?? "",
        clipped: termBox.bottom > box.bottom + 0.5 || (valueBox && valueBox.bottom > box.bottom + 0.5)
          || termBox.top < box.top - 0.5,
      });
    }
    return {
      visible: view.offsetParent !== null,
      height: Math.round(box.height),
      scrolls: view.scrollHeight > view.clientHeight + 1,
      dockHeight: Math.round(document.getElementById("analysis-dock").getBoundingClientRect().height),
      rows,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.click("#test-pattern-button");
    await page.waitForFunction(() => document.body.dataset.workflow === "grade");
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 60000 }).catch(() => null);
    // The scopes panel at its minimum height, set the way the splitter does.
    await page.evaluate(() => {
      state.layout.dockH = LAYOUT_LIMITS.dockH[0];
      document.documentElement.style.setProperty("--dock-h", `${state.layout.dockH}px`);
    });

    await page.locator("#scope-mode").selectOption("technical");
    const technical = await readPanel(page);
    const labels = technical.rows.map((row) => row.label);
    if (!technical.visible) failures.push("Technical view is not visible");
    if (JSON.stringify(labels) !== JSON.stringify(EXPECTED)) {
      failures.push(`Technical rows are ${labels.length} [${labels.join(", ")}], expected ${EXPECTED.length} [${EXPECTED.join(", ")}]`);
    }
    const clipped = technical.rows.filter((row) => row.clipped).map((row) => row.label);
    if (clipped.length) failures.push(`Technical rows clipped at minimum height: ${clipped.join(", ")}`);
    if (technical.scrolls) failures.push("Technical view scrolls at minimum height");
    const empty = technical.rows.filter((row) => !row.value || /undefined|null|NaN/.test(row.value)).map((row) => row.label);
    if (empty.length) failures.push(`Technical rows without a value: ${empty.join(", ")}`);

    const hasDiagnostics = await page.locator("#scope-mode option[value=diagnostics]").count() === 1;
    let diagnostics = null;
    if (!hasDiagnostics) {
      failures.push("No Diagnostics entry in the scope-type dropdown");
    } else {
      await page.locator("#scope-mode").selectOption("diagnostics");
      diagnostics = await readPanel(page);
      const diagnosticLabels = diagnostics.rows.map((row) => row.label);
      if (!diagnostics.visible) failures.push("Diagnostics view is not visible");
      if (diagnosticLabels.length < 40) failures.push(`Diagnostics shows only ${diagnosticLabels.length} rows`);
      for (const required of ["Execution", "Generation", "Processing scale", "HDR Presentation", "Source Space"]) {
        if (!diagnosticLabels.includes(required)) failures.push(`Diagnostics is missing ${required}`);
      }
      await page.locator("#scope-mode").selectOption("histogram");
      if (!(await page.locator("#scope-view").isVisible())) failures.push("Scope view did not return from Diagnostics");
    }
    if (pageErrors.length) failures.push(`Page errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({
      technical: { height: technical.height, dockHeight: technical.dockHeight, scrolls: technical.scrolls, rows: technical.rows },
      diagnostics: diagnostics && { rows: diagnostics.rows.length, scrolls: diagnostics.scrolls },
      failures,
    }, null, 2));
    if (failures.length) throw new Error(`${failures.length} failure(s):\n${failures.join("\n")}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
