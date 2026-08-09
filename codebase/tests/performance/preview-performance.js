const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function percentile(values, amount) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function summarize(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  };
}

function edgeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EDGE_PATH,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function setControl(page, selector, value, waitForScope = true) {
  return page.evaluate(({ selector, value, waitForScope }) => new Promise((resolve) => {
    const control = document.querySelector(selector);
    if (!control) {
      resolve({ error: `Missing control ${selector}` });
      return;
    }
    const started = performance.now();
    let frameMs = null;
    let scopeMs = null;
    let settledMs = null;
    let done = false;
    const finish = () => {
      if (done || frameMs === null || (waitForScope && scopeMs === null)) return;
      done = true;
      observer?.disconnect();
      resolve({ frameMs, scopeMs, settledMs });
    };
    const freshness = document.getElementById("scope-freshness");
    const observer = waitForScope && freshness ? new MutationObserver(() => {
      const elapsed = performance.now() - started;
      if (freshness.textContent === "Preview" && scopeMs === null) scopeMs = elapsed;
      if (["Settled", "Refined"].includes(freshness.textContent)) {
        if (scopeMs === null) scopeMs = elapsed;
        settledMs = elapsed;
      }
      finish();
    }) : null;
    observer?.observe(freshness, { childList: true, subtree: true, attributes: true });
    control.value = String(value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => {
      frameMs = performance.now() - started;
      finish();
    });
    if (!waitForScope) scopeMs = 0;
    setTimeout(() => {
      if (scopeMs === null) scopeMs = performance.now() - started;
      finish();
    }, 3000);
  }), { selector, value, waitForScope });
}

async function exerciseControls(page, repetitions) {
  const frame = [];
  const scope = [];
  const settled = [];
  for (let index = 0; index < repetitions; index += 1) {
    const value = index % 2 ? 0.35 : -0.35;
    const timing = await setControl(page, '[data-path="hdr.exposure"]', value);
    if (timing.error) throw new Error(timing.error);
    frame.push(timing.frameMs);
    scope.push(timing.scopeMs);
    if (timing.settledMs !== null) settled.push(timing.settledMs);
  }

  const representative = [
    ['[data-path="hdr.contrast"]', 0.2],
    ['[data-path="hdr.saturation"]', 0.15],
    ['[data-path="hdr.tone_equalizer_smoothing"]', 0.65],
  ];
  for (const [selector, value] of representative) {
    await page.locator(selector).evaluate((control, next) => {
      if (control.type === "checkbox") control.checked = Boolean(next);
      else control.value = String(next);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
  await page.locator('[data-path="shared.overlay_mode"]').selectOption("zebra", { force: true });
  await page.locator('[data-path="shared.overlay_mode"]').dispatchEvent("input");
  await page.locator('[data-path="shared.overlay_mode"]').selectOption("off", { force: true });
  await page.locator('[data-path="shared.overlay_mode"]').dispatchEvent("input");
  await page.locator('[data-kind="sdr"]').click();
  await page.locator('[data-kind="hdr"]').click();
  await page.waitForTimeout(650);

  return { frame: summarize(frame), scope: summarize(scope), settled: summarize(settled) };
}

async function stressSettles(page, repetitions) {
  if (!repetitions) return;
  await page.evaluate(async (count) => {
    const control = document.querySelector('[data-path="hdr.exposure"]');
    for (let index = 0; index < count; index += 1) {
      control.value = String(index % 2 ? 0.2 : -0.2);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }, repetitions);
  await page.waitForFunction(() => document.getElementById("scope-freshness")?.textContent !== "Updating", null, { timeout: 10000 });
}

async function cacheDiagnostics(page) {
  return page.evaluate(async () => {
    const sessionId = window.HDRFinisherPerformance?.sessionId?.();
    if (!sessionId) return null;
    const response = await fetch(`/api/session/${sessionId}/diagnostics`);
    return response.ok ? response.json() : null;
  });
}

async function runScenario(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (options.forceNoWebGPU) {
    await context.addInitScript(() => Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined }));
  }
  const page = await context.newPage();
  const requests = [];
  const pending = new Map();
  const consoleErrors = [];
  const expectedAborts = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/AbortError:.*aborted/i.test(message.text())) expectedAborts.push(message.text());
    else consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (/\/(preview|preview-raw|scopes|proxy)\//.test(request.url()) || /\/scopes\?/.test(request.url())) {
      pending.set(request, performance.now());
    }
  });
  page.on("response", async (response) => {
    const request = response.request();
    if (!pending.has(request)) return;
    const started = pending.get(request);
    pending.delete(request);
    const headers = await response.allHeaders();
    requests.push({
      url: new URL(response.url()).pathname,
      status: response.status(),
      durationMs: performance.now() - started,
      bytes: Number(headers["content-length"] || 0),
      proxyFormat: headers["x-pixel-format"] || null,
    });
  });

  await page.addInitScript(() => {
    window.__hdrLongTasks = [];
    new PerformanceObserver((list) => {
      window.__hdrLongTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })));
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(options.url, { waitUntil: "networkidle" });
  const loadStarted = performance.now();
  await page.locator("#file-input").setInputFiles(options.input);
  await page.waitForFunction(() => {
    const canvas = document.getElementById("preview-canvas");
    const image = document.getElementById("preview-image");
    return getComputedStyle(canvas).display !== "none" || getComputedStyle(image).display !== "none";
  }, null, { timeout: 120000 });
  const loadReadyMs = performance.now() - loadStarted;

  if (options.highQuality) {
    await page.locator("#high-quality-preview").evaluate((control) => {
      control.checked = true;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(700);
  }
  const timings = await exerciseControls(page, options.repetitions);
  await page.waitForFunction(() => document.getElementById("scope-freshness")?.textContent !== "Updating", null, { timeout: 10000 });
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
  const cacheBefore = await cacheDiagnostics(page);
  await stressSettles(page, options.memoryRepetitions);
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize || null);
  const cacheAfter = await cacheDiagnostics(page);
  const browserMetrics = await page.evaluate(() => ({
    scheduler: window.HDRFinisherPerformance?.snapshot?.() || null,
    longTasks: window.__hdrLongTasks || [],
    webgpu: Boolean(navigator.gpu),
    freshness: document.getElementById("scope-freshness")?.textContent,
  }));
  await context.close();
  return {
    mode: options.forceNoWebGPU ? "cpu-fallback" : options.highQuality ? "high-quality" : "fast",
    input: options.input,
    loadReadyMs,
    timings,
    memoryRepetitions: options.memoryRepetitions,
    requests,
    heapBefore,
    heapAfter,
    heapGrowthFraction: heapBefore && heapAfter ? (heapAfter - heapBefore) / heapBefore : null,
    cacheBefore,
    cacheAfter,
    managedGrowthFraction: cacheBefore?.render_cache?.managed_bytes && cacheAfter?.render_cache?.managed_bytes
      ? (cacheAfter.render_cache.managed_bytes - cacheBefore.render_cache.managed_bytes) / cacheBefore.render_cache.managed_bytes
      : null,
    ...browserMetrics,
    consoleErrors,
    expectedAborts,
    pageErrors,
  };
}

async function main() {
  const url = argument("--url", "http://127.0.0.1:8000");
  const output = path.resolve(argument("--output", "output/performance/preview-performance.json"));
  const repetitions = Number(argument("--repetitions", "30"));
  const memoryRepetitions = Number(argument("--memory-repetitions", "100"));
  const defaultInputs = ["tests/fixtures/blender_linear_rec2020.exr", "tests/fixtures/hdr_headroom.tiff"];
  const inputs = argument("--inputs", defaultInputs.join(",")).split(",").map((input) => path.resolve(input.trim()));
  const executablePath = edgeExecutable();
  const browser = await chromium.launch({
    headless: !flag("--headed"),
    executablePath: executablePath || undefined,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const startedAt = new Date().toISOString();
  const scenarios = [];
  try {
    for (const input of inputs) {
      if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
      scenarios.push(await runScenario(browser, { url, input, repetitions, memoryRepetitions, highQuality: false, forceNoWebGPU: false }));
      scenarios.push(await runScenario(browser, { url, input, repetitions, memoryRepetitions, highQuality: true, forceNoWebGPU: false }));
      scenarios.push(await runScenario(browser, { url, input, repetitions, memoryRepetitions, highQuality: false, forceNoWebGPU: true }));
    }
  } finally {
    await browser.close();
  }

  const report = {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    url,
    platform: process.platform,
    node: process.version,
    repetitions,
    memoryRepetitions,
    scenarios,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, scenarios: scenarios.length }, null, 2));

  if (flag("--enforce")) {
    const failures = scenarios.flatMap((scenario) => {
      const result = [];
      if (scenario.mode !== "cpu-fallback" && scenario.timings.frame.p95Ms > 50) result.push(`${scenario.mode} frame p95 ${scenario.timings.frame.p95Ms} ms`);
      if (scenario.mode !== "cpu-fallback" && scenario.timings.scope.p95Ms > 100) result.push(`${scenario.mode} scope p95 ${scenario.timings.scope.p95Ms} ms`);
      if (scenario.consoleErrors.length || scenario.pageErrors.length) result.push(`${scenario.mode} browser errors`);
      return result;
    });
    if (failures.length) throw new Error(`Performance budgets failed: ${failures.join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
