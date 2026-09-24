// Regression driver for the "Native region exact" refinement stall.
//
//   node tests/native-region-stall.js --url http://127.0.0.1:8799
//   node tests/run-in-electron.js tests/native-region-stall.js --packaged
//
// At zoom >= 100% the viewer requires the native processing edge and the
// coordinator runs refinement ("zoom-scale"/pan) passes whose sources arrive
// over the streaming transport. A long burst of zoom and pan input supersedes
// those loads while they are arriving. When one is abandoned in a state its
// currency check cannot observe, it holds its HTTP/1.1 connection; six of those
// exhaust the browser's per-origin pool, the next source fetch queues with no
// error, the coordinator's in-flight token never settles, `gpuDraftInFlight`
// stays set, and the preview watchdog deliberately refuses to re-arm while a
// render is nominally in flight. The viewer sits on "Preparing view/Updating —
// Native region exact" with an idle CPU and every later request queued.
//
// The driver records every fetch and body read from document start, watches the
// pool during the interaction, and requires the pool probe to answer and the
// viewer to converge. On failure it writes the in-flight attribution (URLs,
// reader state, marks) next to the state dump, so the abandoned layer is named
// by evidence, not guessed.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { ensureLargeNoisySource } = require("./large-noisy-tiff.js");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
const outputPath = path.resolve(option("--output", "output/performance/native-region-stall.json"));
const shotPath = path.resolve(option("--shot", "output/performance/native-region-stall.png"));
const convergeTimeoutMs = Math.max(10000, Number(option("--converge-ms", "150000")));
const stepMs = Math.max(60, Number(option("--step-ms", "150")));
// Withhold streamed source headers for this long before the application sees
// them. The real backend does the same while it builds a cold native mip; doing
// it here keeps the supersession window below deterministic across machines.
const headerDelayMs = Math.max(0, Number(option("--header-delay-ms", "500")));
// The injection must actually abandon source responses before a reader exists,
// or a pass proves nothing (a slow machine may not dispatch the native pass
// inside the step window). Pre-fix runs wedged after four such abandonments.
const minAbandons = Math.max(1, Number(option("--min-abandons", "4")));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Installed before every navigation; the same functions are re-run in the page
// by dumpProbe/captureViewer below. `headerDelayMs` withholds streamed source
// responses for that long before the application sees them, which is what a
// cold native mip build does to the real backend (headers wait for the first
// delivered rows). It makes the supersession window below deterministic.
const installProbe = (headerDelayMs) => {
  const probe = { startedAt: performance.now(), fetches: [] };
  window.__hdrFetchProbe = probe;
  window.__hdrSourceHeaderDelayMs = Math.max(0, Number(headerDelayMs) || 0);
  const short = (value) => String(value).replace(/^https?:\/\/[^/]+/, "");
  const originalFetch = window.fetch;
  window.fetch = function probedFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const headers = (init && init.headers) || {};
    const record = {
      id: probe.fetches.length,
      url: short(url),
      start: performance.now(),
      state: "pending",
      signal: Boolean(init && init.signal),
      probe: headers["x-hdr-probe"] === "1",
    };
    probe.fetches.push(record);
    if (init && init.signal) {
      init.signal.addEventListener("abort", () => { record.abortedAt = performance.now(); }, { once: true });
    }
    const pending = originalFetch.call(this, input, init);
    const isStreamSource = record.url.includes("/proxy-stream/")
      || record.url.includes("/source-tile/")
      || /\/proxy\/[a-z]+/.test(record.url);
    const delay = isStreamSource ? window.__hdrSourceHeaderDelayMs : 0;
    return pending.then((response) => {
      record.state = "headers";
      record.status = response.status;
      record.headersAt = performance.now();
      if (response.body) {
        try { response.body.__hdrFetchProbe = record; } catch { /* not extensible */ }
      }
      // `deliveredAt` is when the application actually receives the response.
      // A body is only "undrained" once the app had it and did nothing; one
      // still inside the injected delay is not the app's yet.
      const deliver = () => { record.deliveredAt = performance.now(); return response; };
      if (delay > 0 && response.ok) {
        return new Promise((resolve) => setTimeout(() => resolve(deliver()), delay));
      }
      return deliver();
    }, (error) => {
      record.state = "rejected";
      record.error = String((error && error.name) || error);
      record.endAt = performance.now();
      throw error;
    });
  };
  const originalGetReader = ReadableStream.prototype.getReader;
  ReadableStream.prototype.getReader = function probedGetReader(...rest) {
    const reader = originalGetReader.apply(this, rest);
    const record = this.__hdrFetchProbe || null;
    if (!record) return reader;
    record.hasReader = true;
    const originalRead = reader.read.bind(reader);
    const originalCancel = typeof reader.cancel === "function" ? reader.cancel.bind(reader) : null;
    reader.read = () => {
      record.pendingRead = true;
      record.readCount = (record.readCount || 0) + 1;
      return originalRead().then((result) => {
        record.pendingRead = false;
        if (result.done) {
          record.bodyDone = true;
          record.bodyDoneVia = "reader";
          record.endAt = performance.now();
        } else {
          record.bytes = (record.bytes || 0) + (result.value ? result.value.byteLength : 0);
          record.lastChunkAt = performance.now();
        }
        return result;
      }, (error) => {
        record.pendingRead = false;
        record.readError = String((error && error.name) || error);
        record.endAt = performance.now();
        throw error;
      });
    };
    if (originalCancel) {
      reader.cancel = (...cancelArgs) => {
        record.cancelAt = performance.now();
        return originalCancel(...cancelArgs).then((result) => {
          record.cancelDone = true;
          record.endAt = performance.now();
          return result;
        }, (error) => {
          record.cancelError = String((error && error.name) || error);
          throw error;
        });
      };
    }
    return reader;
  };
  // The ownership fix cancels a response body that never got a reader
  // (superseded before upload, geometry refusal, texture admission), so the
  // probe must see stream-level cancellation too.
  const originalStreamCancel = ReadableStream.prototype.cancel;
  if (typeof originalStreamCancel === "function") {
    ReadableStream.prototype.cancel = function probedStreamCancel(...rest) {
      const record = this.__hdrFetchProbe || null;
      if (record) record.streamCancelAt = performance.now();
      return originalStreamCancel.apply(this, rest).then((result) => {
        if (record) {
          record.cancelDone = true;
          record.endAt = performance.now();
        }
        return result;
      }, (error) => {
        if (record) record.cancelError = String((error && error.name) || error);
        throw error;
      });
    };
  }
  // Non-reader consumers: a response read via arrayBuffer()/json()/text()/blob()
  // is finished for connection purposes when that promise resolves.
  for (const method of ["arrayBuffer", "json", "text", "blob"]) {
    const original = Response.prototype[method];
    if (typeof original !== "function") continue;
    Response.prototype[method] = function probedBodyReader(...rest) {
      const record = this.body && this.body.__hdrFetchProbe;
      const finish = () => {
        if (record) {
          record.bodyDone = true;
          record.bodyDoneVia = method;
          record.endAt = performance.now();
        }
      };
      // A rejected read (bad JSON, aborted stream) still disturbed the body;
      // it is not an abandoned one.
      return original.apply(this, rest).then((result) => { finish(); return result; },
        (error) => { finish(); throw error; });
    };
  }
  // Live monitor used between interaction steps: pool health, unfinished
  // streamed bodies, and the coordinator's bookkeeping.
  // One definition shared by the live monitor and the final dump: a 200 the
  // application received (past the injected delay, plus a short grace for the
  // synchronous getReader() that follows) and neither read, cancelled nor
  // aborted.
  window.__hdrIsUndrained = (r, now = performance.now()) => r.state === "headers" && r.status === 200
    && r.deliveredAt !== undefined && now - r.deliveredAt > 250
    && !r.hasReader && !r.bodyDone && !r.cancelDone && !r.streamCancelAt && !r.abortedAt;
  // A pre-reader abandonment on a source route, fixed (cancelled) or not.
  window.__hdrIsPreReaderAbandon = (r) => /\/(proxy-stream|proxy)\//.test(r.url)
    && r.status === 200 && !r.hasReader && !r.bodyDone
    && (Boolean(r.streamCancelAt) || window.__hdrIsUndrained(r));
  const poolProbe = (timeoutMs) => Promise.race([
    fetch(`/api/session/${state.session?.session_id}`, {
      cache: "no-store", headers: { "x-hdr-probe": "1" },
    })
      .then((response) => ({ settled: true, status: response.status }))
      .catch((error) => ({ settled: true, error: String(error.name) })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), timeoutMs)),
  ]);
  window.__hdrMonitorSample = async () => {
    const records = probe.fetches.filter((r) => !r.probe);
    // A busy backend can miss a short probe without any pool problem; only a
    // second, longer miss counts as a wedge.
    let pool = await poolProbe(800);
    if (!pool.settled) pool = { ...(await poolProbe(5000)), firstMissMs: 800 };
    const lane = state.renderCoordinator?.laneState?.("hdr");
    return {
      pool,
      awaiting: records.filter((r) => r.state === "pending").length,
      unfinishedReads: records.filter((r) => r.hasReader && !r.bodyDone && !r.cancelDone
        && r.state === "headers").length,
      undrainedBodies: records.filter((r) => window.__hdrIsUndrained(r)).length,
      inFlightReason: lane?.inFlight ? lane.inFlight.request.reason : null,
      inFlightAgeMs: lane?.inFlight ? Math.round(performance.now() - lane.inFlight.submittedAt) : null,
      pending: Boolean(lane?.pending),
      gpuDraftInFlight: Boolean(state.gpuDraftInFlight),
      zoom: Math.round(state.zoomPercent),
    };
  };
};

const dumpProbe = () => {
  const probe = window.__hdrFetchProbe;
  const now = performance.now();
  const decorate = (record) => ({ ...record, ageMs: Math.round(now - record.start) });
  const sourceRoute = (record) => record.url.includes("/proxy-stream/")
    || record.url.includes("/proxy/")
    || record.url.includes("/source-tile/");
  const records = probe ? probe.fetches.filter((r) => !r.probe) : [];
  return {
    now,
    fetchCount: records.length,
    awaitingResponse: records.filter((r) => r.state === "pending").map(decorate),
    unfinishedReads: records.filter((r) => r.hasReader && !r.bodyDone && !r.cancelDone
      && r.state === "headers").map(decorate),
    // A successful streaming response that was abandoned before any reader was
    // created: nothing consumes or cancels it, so its connection stays claimed
    // while the backend keeps writing into backpressure.
    undrainedBodies: records.filter((r) => window.__hdrIsUndrained(r, now)).map(decorate),
    // Coverage: how many source responses the injection actually abandoned
    // before a reader existed. Zero means the run exercised nothing.
    preReaderAbandons: records.filter((r) => window.__hdrIsPreReaderAbandon(r)).length,
    preReaderCancelled: records.filter((r) => window.__hdrIsPreReaderAbandon(r) && r.streamCancelAt).length,
    sourceRecent: records.filter(sourceRoute).slice(-24).map((r) => ({
      id: r.id,
      url: r.url.split("?")[0] + (r.url.match(/long_edge=(\d+)/) ? `?long_edge=${r.url.match(/long_edge=(\d+)/)[1]}` : ""),
      state: r.state,
      status: r.status ?? null,
      bytes: r.bytes ?? 0,
      ageMs: Math.round(now - r.start),
      signal: r.signal,
      hasReader: Boolean(r.hasReader),
      pendingRead: Boolean(r.pendingRead),
      aborted: Boolean(r.abortedAt),
      cancelled: Boolean(r.cancelAt),
      streamCancelled: Boolean(r.streamCancelAt),
      readError: r.readError ?? null,
      bodyDone: Boolean(r.bodyDone),
    })),
  };
};

const captureViewer = () => {
  const lane = state.renderCoordinator?.laneState?.("hdr");
  const entry = lane?.inFlight || null;
  return {
    viewer: viewerState(),
    acceptedEdge: state.acceptedPresentation?.processedLongEdge ?? null,
    acceptedExact: state.acceptedPresentation?.exact === true,
    acceptedGeneration: state.acceptedPresentation?.generation ?? null,
    requiredEdge: requiredProcessingLongEdge(),
    zoomPercent: Math.round(state.zoomPercent * 100) / 100,
    zoomMode: state.zoomMode,
    previewGeneration: { ...state.previewGeneration },
    gpuDraftInFlight: Boolean(state.gpuDraftInFlight),
    gpuDraftInFlightTier: state.gpuDraftInFlightTier ?? null,
    inFlight: entry ? {
      tokenId: entry.token.id,
      tier: entry.request.tier,
      reason: entry.request.reason,
      ageMs: Math.round(performance.now() - entry.submittedAt),
    } : null,
    pending: lane?.pending ? {
      tier: lane.pending.request.tier,
      reason: lane.pending.request.reason,
    } : null,
    watchdog: window.HDRFinisherPerformance.previewWatchdog(),
    coordinator: window.HDRFinisherPerformance.renderCoordinator(),
    lastGpuDraftRefusal: state.lastGpuDraftRefusal,
    proxyInflight: state.gpuPreview?.proxyInflight ? Array.from(state.gpuPreview.proxyInflight.keys()) : [],
    activeRenderCount: state.gpuPreview?.activeRenderCount ?? null,
  };
};

const poolProbeInPage = (timeoutMs) => {
  const started = performance.now();
  const sessionId = state.session?.session_id;
  return Promise.race([
    fetch(`/api/session/${sessionId}`, { cache: "no-store", headers: { "x-hdr-probe": "1" } })
      .then((response) => ({ settled: true, status: response.status })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), timeoutMs)),
  ]).then((outcome) => ({ ...outcome, elapsedMs: Math.round(performance.now() - started) }));
};

function establishedConnections(port) {
  if (process.platform !== "win32" || !port) return null;
  try {
    const output = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    return output.split(/\r?\n/).filter((line) => line.includes("ESTABLISHED")
      && (line.includes(`:${port} `) || line.includes(`:${port}\t`))).length;
  } catch {
    return null;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: option("--channel", "msedge") });
  // No viewport argument: under run-in-electron the window size comes from the
  // seeded window state (the §8 2560x1440 reference), and a viewport request
  // would only resize the window away from it.
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const port = new URL(baseUrl).port;
  let evidence = null;
  try {
    await page.addInitScript(installProbe, headerDelayMs);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#file-input").setInputFiles(ensureLargeNoisySource(7968, 5320));
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 300000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });

    // The deterministic injection: zoom passes at native edges start *cold*
    // source mips, so the backend holds the response headers while it builds.
    // Superseding the pass inside that window makes the render's currency check
    // fail the moment the headers arrive -- before any stream reader exists.
    // Each such abandoned 200 body keeps its HTTP/1.1 connection claimed while
    // the backend keeps writing into backpressure; six exhaust the per-origin
    // pool and the next source fetch queues forever. That queue is the wedge.
    const samples = [];
    let wedgeSample = null;
    let pairs = 0;
    for (let index = 0; index < 8 && !wedgeSample; index += 1) {
      const first = 183;
      const second = index % 2 === 0 ? 80 : 60;
      await page.evaluate((value) => setCustomZoom(value), first);
      await page.waitForTimeout(stepMs);
      await page.evaluate((value) => setCustomZoom(value), second);
      await page.waitForTimeout(stepMs * 2);
      pairs += 1;
      const sample = await page.evaluate(() => window.__hdrMonitorSample());
      samples.push({ pair: pairs, first, second, ...sample });
      if (!sample.pool.settled) wedgeSample = samples[samples.length - 1];
    }

    const finalPool = await page.evaluate(poolProbeInPage, 5000);
    const started = Date.now();
    let observed = null;
    while (Date.now() - started < convergeTimeoutMs) {
      await page.waitForTimeout(500);
      observed = await page.evaluate(captureViewer);
      if (observed.viewer.status === "ready" && observed.acceptedExact
        && observed.acceptedEdge === observed.requiredEdge) break;
    }
    const converged = Boolean(observed && observed.viewer.status === "ready" && observed.acceptedExact
      && observed.acceptedEdge === observed.requiredEdge);
    const probeState = await page.evaluate(dumpProbe);
    evidence = {
      recordedAt: new Date().toISOString(),
      baseUrl,
      pairs,
      sampleCount: samples.length,
      wedgeSample,
      samples: samples.slice(-40),
      converged,
      convergedMs: Date.now() - started,
      poolProbe: finalPool,
      finalState: observed,
      establishedConnections: establishedConnections(port),
      probe: probeState,
      pageErrors,
    };
    await page.screenshot({ path: shotPath, fullPage: false }).catch(() => null);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({
      converged,
      wedgeSample,
      poolProbe: finalPool,
      establishedConnections: evidence.establishedConnections,
      unfinishedReads: probeState.unfinishedReads?.map((r) => ({
        url: r.url.split("?")[0], ageMs: r.ageMs, pendingRead: r.pendingRead, bytes: r.bytes,
        cancelled: Boolean(r.cancelAt), aborted: Boolean(r.abortedAt),
      })),
      preReaderAbandons: probeState.preReaderAbandons,
      preReaderCancelled: probeState.preReaderCancelled,
      undrainedBodies: probeState.undrainedBodies?.map((r) => ({
        url: r.url.split("?")[0], ageMs: r.ageMs, bytes: r.bytes ?? 0,
        aborted: Boolean(r.abortedAt), cancelled: Boolean(r.cancelAt),
      })),
      awaitingResponse: probeState.awaitingResponse?.map((r) => ({
        url: r.url.split("?")[0], ageMs: r.ageMs, signal: r.signal, aborted: Boolean(r.abortedAt),
      })),
      inFlight: observed?.inFlight,
      pending: observed?.pending,
      outputPath,
      shotPath,
    }, null, 2));
    assert(probeState.preReaderAbandons >= minAbandons,
      `The injection abandoned only ${probeState.preReaderAbandons} source responses before a reader existed `
      + `(need ${minAbandons}); the run did not exercise the leak. Raise --header-delay-ms or --step-ms.`);
    assert(wedgeSample === null,
      `The connection pool wedged during the storm (pair ${wedgeSample?.pair}): ${JSON.stringify(wedgeSample)}`);
    assert((probeState.undrainedBodies || []).length === 0,
      `${probeState.undrainedBodies?.length} streamed 200 responses were abandoned without a reader: `
      + JSON.stringify(probeState.undrainedBodies?.map((r) => r.url.split("?")[0])));
    assert(finalPool.settled,
      `A cheap request never answered after the interaction (${finalPool.elapsedMs} ms): the connection pool is exhausted.`);
    assert(converged,
      `The viewer never converged after the native-region interaction: ${JSON.stringify(observed)}`);
    assert(pageErrors.length === 0, `Page errors occurred: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
