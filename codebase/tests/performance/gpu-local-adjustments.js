const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
const phase = option("--phase", process.env.HDR_FINISHER_BENCHMARK_PHASE || "phase0");
const outputPath = path.resolve(option("--output", `output/performance/gpu-local-adjustments-${phase}.json`));

function percentile(values, amount) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * amount))];
}

function summarize(values) {
  const valid = values.filter(Number.isFinite);
  return {
    samples: valid.length,
    medianMs: percentile(valid, 0.5),
    p95Ms: percentile(valid, 0.95),
    maxMs: valid.length ? Math.max(...valid) : null,
  };
}

async function exerciseControl(page, selector, value, commit = true) {
  const result = await page.evaluate(async ({ selector: controlSelector, value: nextValue, commit: shouldCommit }) => {
    const control = document.querySelector(controlSelector);
    if (!control) throw new Error(`Benchmark control was not found: ${controlSelector}`);
    const once = (name, timeoutMs) => new Promise((resolve) => {
      let timer = 0;
      const handler = (event) => {
        clearTimeout(timer);
        resolve({ received: true, detail: event.detail });
      };
      window.addEventListener(name, handler, { once: true });
      timer = window.setTimeout(() => {
        window.removeEventListener(name, handler);
        resolve({ received: false, detail: null });
      }, timeoutMs);
    });
    const preview = once("hdrfinisher:preview-presented", 4000);
    const mask = once("hdrfinisher:mask-presented", 1500);
    const scope = once("hdrfinisher:scope-presented", 4000);
    const inputAt = performance.now();
    control.value = String(nextValue);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    if (shouldCommit) control.dispatchEvent(new Event("change", { bubbles: true }));
    const [previewEvent, maskEvent, scopeEvent] = await Promise.all([preview, mask, scope]);
    return {
      inputAt,
      previewMs: previewEvent.received ? previewEvent.detail.presentedAt - inputAt : null,
      maskMs: maskEvent.received ? maskEvent.detail.presentedAt - inputAt : null,
      scopeMs: scopeEvent.received ? scopeEvent.detail.presentedAt - inputAt : null,
      preview: previewEvent.detail,
      mask: maskEvent.detail,
      scope: scopeEvent.detail,
    };
  }, { selector, value, commit });
  if (commit) {
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 10000 });
  }
  await page.waitForTimeout(180);
  return result;
}

async function rapidDrag(page, selector, values, intervalMs = 16) {
  return page.evaluate(async ({ selector: controlSelector, values: dragValues, intervalMs: interval }) => {
    const control = document.querySelector(controlSelector);
    if (!control) throw new Error(`Benchmark control was not found: ${controlSelector}`);
    const waitFor = (name, timeoutMs) => new Promise((resolve) => {
      let timer = 0;
      const handler = (event) => {
        clearTimeout(timer);
        resolve({ received: true, detail: event.detail });
      };
      window.addEventListener(name, handler, { once: true });
      timer = window.setTimeout(() => {
        window.removeEventListener(name, handler);
        resolve({ received: false, detail: null });
      }, timeoutMs);
    });
    const previewSerials = [];
    const scopeGenerations = [];
    const scopeFingerprints = [];
    const recordPreview = (event) => previewSerials.push(event.detail?.serial);
    const recordScope = (event) => {
      scopeGenerations.push(event.detail?.generation);
      scopeFingerprints.push(event.detail?.fingerprint);
    };
    window.addEventListener("hdrfinisher:preview-presented", recordPreview);
    window.addEventListener("hdrfinisher:scope-presented", recordScope);
    const startedAt = performance.now();
    for (const value of dragValues.slice(0, -1)) {
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    const preview = waitFor("hdrfinisher:preview-presented", 5000);
    const scope = waitFor("hdrfinisher:scope-presented", 5000);
    const finalInputAt = performance.now();
    control.value = String(dragValues.at(-1));
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, interval));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    const [previewEvent, scopeEvent] = await Promise.all([preview, scope]);
    window.removeEventListener("hdrfinisher:preview-presented", recordPreview);
    window.removeEventListener("hdrfinisher:scope-presented", recordScope);
    const strictlyIncreasing = (samples) => samples.every((value, index) => index === 0 || value > samples[index - 1]);
    return {
      inputCount: dragValues.length,
      durationMs: finalInputAt - startedAt,
      finalInputToPreviewMs: previewEvent.received ? previewEvent.detail.presentedAt - finalInputAt : null,
      finalInputToScopeMs: scopeEvent.received ? scopeEvent.detail.presentedAt - finalInputAt : null,
      presentationOrder: {
        previewSerials,
        scopeGenerations,
        distinctScopeFingerprints: new Set(scopeFingerprints.filter(Number.isFinite)).size,
        previewStrictlyIncreasing: strictlyIncreasing(previewSerials.filter(Number.isFinite)),
        scopeStrictlyIncreasing: strictlyIncreasing(scopeGenerations.filter(Number.isFinite)),
      },
    };
  }, { selector, values, intervalMs });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const requests = [];
  const requestStartedAt = new WeakMap();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => requestStartedAt.set(request, performance.now()));
  page.on("response", async (response) => {
    const url = response.url();
    let kind = null;
    if (/\/local-mask\/.+\/preview$/.test(url)) kind = "mask-draft";
    else if (/\/local-mask\/.+\?/.test(url)) kind = "mask-committed";
    else if (url.includes("/scopes?")) kind = "scope";
    else if (url.includes("/edit-commands")) kind = "edit-command";
    if (!kind) return;
    const request = response.request();
    const timing = request.timing();
    const observedStart = requestStartedAt.get(request);
    let requestLocals = null;
    if (kind === "scope") {
      try {
        const body = request.postDataJSON();
        requestLocals = body?.local_adjustments ?? null;
      } catch {
        requestLocals = null;
      }
    }
    const firstMask = Array.isArray(requestLocals) ? requestLocals[0]?.mask?.leaf : null;
    requests.push({
      kind,
      url,
      status: response.status(),
      at: Date.now(),
      responseMs: Number.isFinite(observedStart) ? performance.now() - observedStart
        : timing.responseStart >= 0 ? timing.responseStart - timing.startTime : null,
      cpuMaskMs: Number(response.headers()["x-cpu-mask-ms"]) || null,
      localAdjustmentCount: Array.isArray(requestLocals) ? requestLocals.length : null,
      localMaskOpacity: firstMask?.mask_opacity ?? null,
      localMaskFeather: firstMask?.mask_feather ?? null,
    });
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const browserVersion = await browser.version();
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#preview-status").waitFor({ state: "hidden", timeout: 60000 }).catch(() => null);
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator('[data-local-tool="luminance_range"]').click();
    await page.locator("#local-add-adjustment").click();
    await created;
    await page.waitForFunction(() => selectedLocal()?.mask?.leaf?.type === "luminance_range");
    await page.evaluate(async () => {
      const local = selectedLocal();
      local.hdr_grade.exposure = 1;
      Object.assign(local.mask.leaf, {
        fade_in_start_ev: -2,
        full_start_ev: -1,
        full_end_ev: 1,
        fade_out_end_ev: 2,
      });
      window.HDRFinisherPerformance.enableGpuInstrumentation(true);
      await commitSelectedLocal();
    });
    await page.waitForFunction(() => state.localMaskCommitDepth === 0);
    await page.waitForTimeout(400);

    requests.length = 0;
    const opacity = [];
    for (const value of [90, 35, 80, 20, 65, 45, 75, 25, 55, 40]) {
      opacity.push(await exerciseControl(page, '[data-local-mask-param="mask_opacity"]', value));
    }

    const feather = [];
    for (const value of [10, 35, 60, 20, 50, 25]) {
      feather.push(await exerciseControl(page, '[data-local-mask-param="mask_feather"]', value));
    }

    const opacityRequestStart = requests.length;
    const rapidOpacity = await rapidDrag(page, '[data-local-mask-param="mask_opacity"]', Array.from({ length: 30 }, (_, index) => {
      const phase = index % 18;
      return 20 + (phase <= 9 ? phase : 18 - phase) * 7;
    }));
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 10000 });
    await page.waitForTimeout(350);
    const rapidOpacityRequests = requests.slice(opacityRequestStart);

    const featherRequestStart = requests.length;
    const rapidFeather = await rapidDrag(page, '[data-local-mask-param="mask_feather"]', Array.from({ length: 30 }, (_, index) => (index * 3) % 80));
    await page.waitForFunction(() => state.localMaskCommitDepth === 0, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const rapidFeatherRequests = requests.slice(featherRequestStart);

    const raw = await page.evaluate(async () => {
      await state.gpuPreview.device.queue.onSubmittedWorkDone();
      const adapter = window.HDRFinisherPerformance.gpuSnapshot();
      const diagnostics = await fetch(`/api/session/${state.session.session_id}/diagnostics`).then((response) => response.json());
      return {
        userAgent: navigator.userAgent,
        platform: navigator.userAgentData?.platform || navigator.platform,
        devicePixelRatio: window.devicePixelRatio,
        source: state.session.source,
        previewLongEdge: settledProxyLongEdge(),
        interactiveLongEdge: interactiveProxyLongEdge(),
        scopeLongEdge: scopeLongEdge("interactive"),
        scheduler: window.HDRFinisherPerformance.snapshot(),
        gpu: adapter,
        diagnostics,
      };
    });

    const report = {
      phase,
      recordedAt: new Date().toISOString(),
      environment: {
        browser: browserVersion,
        userAgent: raw.userAgent,
        platform: raw.platform,
        viewport: { width: 1440, height: 1000, devicePixelRatio: raw.devicePixelRatio },
        adapter: raw.gpu?.adapter,
        source: raw.source,
        preview: {
          settledLongEdge: raw.previewLongEdge,
          interactiveLongEdge: raw.interactiveLongEdge,
          scopeLongEdge: raw.scopeLongEdge,
        },
        percentileMethod: "nearest-rank floor((n - 1) * percentile) after ascending sort",
      },
      isolated: {
        opacity: {
          inputToPreview: summarize(opacity.map((sample) => sample.previewMs)),
          inputToMaskOverlay: summarize(opacity.map((sample) => sample.maskMs)),
          inputToScope: summarize(opacity.map((sample) => sample.scopeMs)),
          distinctScopeFingerprints: new Set(opacity.map((sample) => sample.scope?.fingerprint).filter(Number.isFinite)).size,
          scopeSources: [...new Set(opacity.map((sample) => sample.scope?.source).filter(Boolean))],
          scopePeakValues: opacity.map((sample) => sample.scope?.peakValue).filter(Number.isFinite),
        },
        feather: {
          inputToPreview: summarize(feather.map((sample) => sample.previewMs)),
          inputToMaskOverlay: summarize(feather.map((sample) => sample.maskMs)),
          inputToScope: summarize(feather.map((sample) => sample.scopeMs)),
          distinctScopeFingerprints: new Set(feather.map((sample) => sample.scope?.fingerprint).filter(Number.isFinite)).size,
          scopeSources: [...new Set(feather.map((sample) => sample.scope?.source).filter(Boolean))],
          scopePeakValues: feather.map((sample) => sample.scope?.peakValue).filter(Number.isFinite),
        },
      },
      rapidDrag: {
        opacity: {
          ...rapidOpacity,
          requests: Object.fromEntries(["mask-draft", "mask-committed", "scope", "edit-command"].map((kind) => [kind, rapidOpacityRequests.filter((request) => request.kind === kind).length])),
          scopeRequestsWithDraftLocals: rapidOpacityRequests.filter((request) => request.kind === "scope" && request.localAdjustmentCount > 0).length,
        },
        feather: {
          ...rapidFeather,
          requests: Object.fromEntries(["mask-draft", "mask-committed", "scope", "edit-command"].map((kind) => [kind, rapidFeatherRequests.filter((request) => request.kind === kind).length])),
          scopeRequestsWithDraftLocals: rapidFeatherRequests.filter((request) => request.kind === "scope" && request.localAdjustmentCount > 0).length,
        },
      },
      attribution: {
        schedulerQueue: summarize(raw.scheduler.queueDelayMs),
        schedulerRender: summarize(raw.scheduler.renderMs),
        gpuSubmission: summarize(raw.gpu.renders.map((entry) => entry.submissionMs)),
        gpuMaskAwait: summarize(raw.gpu.renders.map((entry) => entry.maskAwaitMs)),
        gpuTimestamp: summarize(raw.gpu.renders.map((entry) => entry.gpuMs)),
        gpuQueueCompletion: summarize(raw.gpu.renders.map((entry) => entry.queueCompleteMs)),
        maskCpu: summarize(requests.map((request) => request.cpuMaskMs)),
        maskTransport: summarize(requests.filter((request) => request.kind.startsWith("mask-")).map((request) => request.responseMs)),
        scopeTransport: summarize(requests.filter((request) => request.kind === "scope").map((request) => request.responseMs)),
        gpuScopeTotal: summarize((raw.gpu.scopes || []).map((entry) => entry.totalMs)),
        gpuScopeEncode: summarize((raw.gpu.scopes || []).map((entry) => entry.encodeMs)),
        gpuScopeReadback: summarize((raw.gpu.scopes || []).map((entry) => entry.mapReadbackMs)),
        gpuScopeUnpack: summarize((raw.gpu.scopes || []).map((entry) => entry.unpackMs)),
      },
      gpuResources: raw.gpu.resources,
      gpuLumaCache: {
        events: raw.gpu.maskEvents?.length || 0,
        sceneLuminanceCreates: (raw.gpu.maskEvents || []).filter((entry) => entry.sceneLuminanceCreated).length,
        baseRegenerations: (raw.gpu.maskEvents || []).filter((entry) => entry.baseRegenerated).length,
        refinements: (raw.gpu.maskEvents || []).filter((entry) => entry.refinementRan).length,
        cpuMaskRequests: (raw.gpu.maskEvents || []).filter((entry) => entry.cpuMaskRequest).length,
        encodeSubmit: summarize((raw.gpu.maskEvents || []).map((entry) => entry.encodeSubmitMs)),
      },
      requestCounts: Object.fromEntries(["mask-draft", "mask-committed", "scope", "edit-command"].map((kind) => [kind, requests.filter((request) => request.kind === kind).length])),
      scopeDraftContent: {
        requestsWithDraftLocals: requests.filter((request) => request.kind === "scope" && request.localAdjustmentCount > 0).length,
        observedMaskOpacities: [...new Set(requests.filter((request) => request.kind === "scope").map((request) => request.localMaskOpacity).filter(Number.isFinite))],
        observedMaskFeathers: [...new Set(requests.filter((request) => request.kind === "scope").map((request) => request.localMaskFeather).filter(Number.isFinite))],
      },
      cache: raw.diagnostics.render_cache,
      stale: {
        schedulerResults: raw.scheduler.staleResults,
        backendCancellations: raw.diagnostics.render_cache.stale_cancellations,
      },
      errors: pageErrors,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    if (!rapidOpacity.presentationOrder.previewStrictlyIncreasing || !rapidOpacity.presentationOrder.scopeStrictlyIncreasing) {
      throw new Error("Back-and-forth opacity drag presented an out-of-order preview or scope generation.");
    }
    if (!rapidFeather.presentationOrder.previewStrictlyIncreasing || !rapidFeather.presentationOrder.scopeStrictlyIncreasing) {
      throw new Error("Back-and-forth feather drag presented an out-of-order preview or scope generation.");
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
