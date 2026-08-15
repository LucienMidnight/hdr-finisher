const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
const outputPath = path.resolve(option("--output", "output/performance/many-local-layers.json"));

function percentile(values, amount) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))] ?? null;
}

function summary(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  };
}

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
    if (/\/local-mask\/[^/]+\?/.test(response.url()) && response.request().method() === "GET") maskRequests.push(response.url());
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const browserVersion = await browser.version();
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);

    const allLocals = await page.evaluate(() => Array.from({ length: 64 }, (_, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      const x = 0.05 + column * 0.12;
      const y = 0.08 + row * 0.11;
      return {
        id: `scale-local-${String(index + 1).padStart(2, "0")}`,
        name: `Scale local ${index + 1}`,
        enabled: true,
        opacity: 0.35 + (index % 5) * 0.1,
        mask: {
          operator: "leaf",
          leaf: {
            type: "linear_gradient",
            start: { x: Math.min(0.98, x), y: Math.min(0.98, y) },
            end: { x: Math.min(0.99, x + 0.18), y: Math.min(0.99, y + 0.08) },
            gradient_midpoint_1: 0.28,
            gradient_midpoint_2: 0.72,
            gradient_fan: ((index % 3) - 1) * 0.25,
            mask_opacity: 0.8,
          },
          children: [],
          inverted: index % 7 === 0,
        },
        hdr_grade: { exposure: ((index % 5) - 2) * 0.08, saturation: ((index % 3) - 1) * 0.03 },
        sdr_grade: { exposure: ((index % 5) - 2) * 0.04 },
      };
    }));

    const tiers = [];
    for (const count of [16, 32, 64]) {
      await page.evaluate(async ({ locals, count }) => {
        const document = JSON.parse(JSON.stringify(state.editDocument));
        document.local_adjustments = locals.slice(0, count);
        await queueEditCommand("replace_document", { document }, null, { refreshPreview: false });
        window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      }, { locals: allLocals, count });
      await page.waitForFunction((expected) => localAdjustments().length === expected, count);
      maskRequests.length = 0;
      await page.evaluate(async () => {
        await renderGpuDraft("hdr", { longEdge: 962 });
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
      });
      const warmMaskRequests = maskRequests.length;
      maskRequests.length = 0;

      const measurements = await page.evaluate(async () => {
        const submissions = [];
        const completions = [];
        for (let index = 0; index < 12; index += 1) {
          const locals = localAdjustments();
          locals[index % locals.length].opacity = 0.35 + (index % 6) * 0.1;
          const startedAt = performance.now();
          const rendered = await renderGpuDraft("hdr", { longEdge: 962 });
          const submittedAt = performance.now();
          if (!rendered) throw new Error("The many-layer WebGPU render was not presented.");
          await state.gpuPreview.device.queue.onSubmittedWorkDone();
          submissions.push(submittedAt - startedAt);
          completions.push(performance.now() - startedAt);
        }
        return {
          submissions,
          completions,
          gpu: window.HDRFinisherPerformance.gpuSnapshot(),
        };
      });

      tiers.push({
        localCount: count,
        warmMaskRequests,
        interactionMaskRequests: maskRequests.length,
        submission: summary(measurements.submissions),
        queueComplete: summary(measurements.completions),
        resources: measurements.gpu.resources,
      });
      assert(maskRequests.length === 0, `${count}-layer influence edits regenerated masks.`);
      assert(measurements.gpu.resources.localMaskBytes <= 96 * 1024 * 1024, `${count}-layer mask residency exceeded the interactive budget.`);
    }

    assert(pageErrors.length === 0, `Browser errors occurred: ${pageErrors.join(" | ")}`);
    const report = {
      recordedAt: new Date().toISOString(),
      environment: { browser: browserVersion, viewport: { width: 1440, height: 1000 }, proxyLongEdge: 962 },
      tiers,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
