/**
 * Measurement-only baseline for a real, already-graded HDR Finisher project.
 *
 * Run through the disposable-profile Electron harness:
 *
 *   node tests/run-in-electron.js tests/performance/heavy-project-baseline.js \
 *     --project "D:\\Photos\\Play_Raw\\Fantastic light over village - AdamFromCanada\\DSC00950.hdrfinisher"
 *
 * The driver opens the project through the desktop grant path and never saves
 * it. The Electron harness discards the in-memory document when it terminates.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
function option(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

const projectPath = path.resolve(option("--project"));
const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799";
const edgeFallback = args.includes("--edge");
const outputPath = path.resolve(option(
  "--output",
  path.join("output", "performance", "review", "heavy-project-baseline.json"),
));
const viewportText = option("--viewport", "2560x1440");
const [viewportWidth, viewportHeight] = viewportText.split("x").map(Number);
const viewport = {
  width: Number.isFinite(viewportWidth) ? viewportWidth : 2560,
  height: Number.isFinite(viewportHeight) ? viewportHeight : 1440,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function gitValue(...gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: path.resolve(__dirname, "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summarize(values) {
  const clean = values.filter(Number.isFinite);
  return {
    samples: clean.length,
    medianMs: percentile(clean, 0.5),
    p95Ms: percentile(clean, 0.95),
    maximumMs: clean.length ? Math.max(...clean) : null,
  };
}

function commandOutput(executable, commandArgs) {
  try {
    const output = execFileSync(executable, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      windowsHide: true,
    }).trim();
    return { ok: true, value: output || null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function commandJson(executable, commandArgs) {
  const result = commandOutput(executable, commandArgs);
  if (!result.ok || !result.value) return result;
  try {
    return { ok: true, value: JSON.parse(result.value) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON from ${executable}: ${error.message}` };
  }
}

function windowsProcessTreeSnapshot(rootPid) {
  if (process.platform !== "win32" || !Number.isFinite(rootPid)) return null;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$processes = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime",
    "$processes | ConvertTo-Json -Compress -Depth 3",
  ].join("; ");
  const result = commandJson("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (!result.ok) return result;
  const all = Array.isArray(result.value) ? result.value : result.value ? [result.value] : [];
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of all) {
      const pid = Number(item.ProcessId);
      const parentPid = Number(item.ParentProcessId);
      if (!included.has(pid) && included.has(parentPid)) {
        included.add(pid);
        changed = true;
      }
    }
  }
  const processes = all
    .filter((item) => included.has(Number(item.ProcessId)))
    .map((item) => ({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId),
      name: item.Name || null,
      commandLine: item.CommandLine || null,
      workingSetBytes: Number(item.WorkingSetSize) || 0,
      kernelTime100ns: Number(item.KernelModeTime) || 0,
      userTime100ns: Number(item.UserModeTime) || 0,
    }));
  return {
    ok: true,
    rootPid,
    totalWorkingSetBytes: processes.reduce((total, item) => total + item.workingSetBytes, 0),
    processes,
  };
}

function nvidiaSnapshot() {
  if (process.platform !== "win32") return null;
  const result = commandOutput("nvidia-smi.exe", [
    "--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,power.draw",
    "--format=csv,noheader,nounits",
  ]);
  if (!result.ok || !result.value) return result;
  const rows = result.value.split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, driverVersion, memoryTotalMiB, memoryUsedMiB, utilizationPercent, powerDrawWatts] = line
      .split(",")
      .map((part) => part.trim());
    return {
      name,
      driverVersion,
      memoryTotalMiB: Number(memoryTotalMiB),
      memoryUsedMiB: Number(memoryUsedMiB),
      utilizationPercent: Number(utilizationPercent),
      powerDrawWatts: Number(powerDrawWatts),
    };
  });
  return { ok: true, value: rows };
}

function osSnapshot() {
  const rootPid = Number(process.env.HDR_FINISHER_ELECTRON_MAIN_PID);
  return {
    capturedAt: new Date().toISOString(),
    electronTree: windowsProcessTreeSnapshot(rootPid),
    nvidia: nvidiaSnapshot(),
  };
}

function summarizeNetwork(requests) {
  const completed = requests.filter((request) => Number.isFinite(request.durationMs));
  return {
    requests: requests.length,
    completed: completed.length,
    totalCompletedRequestMs: completed.reduce((total, request) => total + request.durationMs, 0),
    slowest: completed
      .slice()
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 8)
      .map(({ method, path: requestPath, query, status, durationMs }) => ({
        method,
        path: requestPath,
        query,
        status,
        durationMs,
      })),
  };
}

async function installProbe(page) {
  await page.evaluate(() => {
    window.__heavyProjectProbe = { previews: [], scopes: [], marks: [] };
    window.addEventListener("hdrfinisher:preview-presented", (event) => {
      window.__heavyProjectProbe.previews.push({
        observedAt: performance.now(),
        ...JSON.parse(JSON.stringify(event.detail || {})),
      });
    });
    window.addEventListener("hdrfinisher:scope-presented", (event) => {
      window.__heavyProjectProbe.scopes.push({
        observedAt: performance.now(),
        ...JSON.parse(JSON.stringify(event.detail || {})),
      });
    });
  });
}

async function mark(page, name) {
  return page.evaluate((label) => {
    const record = {
      name: label,
      at: performance.now(),
      lane: typeof state !== "undefined" ? state.currentView : null,
      generation: typeof state !== "undefined" && state.currentView
        ? state.previewGeneration[state.currentView]
        : null,
      previewIndex: window.__heavyProjectProbe.previews.length,
      scopeIndex: window.__heavyProjectProbe.scopes.length,
    };
    window.__heavyProjectProbe.marks.push(record);
    return record;
  }, name);
}

async function compactSnapshot(page) {
  return page.evaluate(() => {
    const performanceApi = window.HDRFinisherPerformance;
    const gpu = performanceApi?.gpuSnapshot?.() || null;
    const authoring = performanceApi?.authoringState?.() || null;
    const allocator = gpu?.resources?.memory?.allocator || null;
    const accepted = typeof state !== "undefined" && state.acceptedPresentation
      ? { ...state.acceptedPresentation }
      : null;
    const tail = (items, count = 12) => Array.isArray(items) ? items.slice(-count) : [];
    return {
      capturedAt: new Date().toISOString(),
      now: performance.now(),
      sessionId: performanceApi?.sessionId?.() || null,
      authoring: authoring ? {
        lane: authoring.lane,
        requestedTier: authoring.requestedTier,
        presentedTier: authoring.presentedTier,
        presentedGeneration: authoring.presentedGeneration,
        currentGeneration: authoring.currentGeneration,
        executionMode: authoring.executionMode,
        gpuBudget: authoring.gpuBudget,
        previewResolution: authoring.previewResolution,
        previewPreference: authoring.previewPreference,
        previewMaxDimension: authoring.previewMaxDimension,
        previewDimensions: authoring.previewDimensions,
        longEdge: authoring.longEdge,
        renderPlan: authoring.renderPlan,
        allocationBackoff: authoring.allocationBackoff,
      } : null,
      acceptedPresentation: accepted,
      viewerStatus: document.getElementById("preview-status-copy")?.textContent || null,
      scopeFreshness: document.getElementById("scope-freshness")?.textContent || null,
      gpu: gpu ? {
        available: gpu.available,
        adapter: gpu.adapter,
        detail: gpu.detail,
        budget: gpu.resources?.budget || null,
        allocator,
        memory: gpu.resources?.memory ? {
          resident: gpu.resources.memory.resident,
          cached: gpu.resources.memory.cached,
          transient: gpu.resources.memory.transient,
          totals: gpu.resources.memory.totals,
        } : null,
        resources: gpu.resources ? {
          proxies: gpu.resources.proxies,
          proxyBytes: gpu.resources.proxyBytes,
          sceneLuminanceTextures: gpu.resources.sceneLuminanceTextures,
          localMasks: gpu.resources.localMasks,
          localMaskBytes: gpu.resources.localMaskBytes,
          maskGraphs: gpu.resources.maskGraphs,
          scopePools: gpu.resources.scopePools,
          scopeBuffers: gpu.resources.scopeBuffers,
          scopeBytes: gpu.resources.scopeBytes,
          gradingIntermediateBytes: gpu.resources.gradingIntermediateBytes,
          denoiseTextures: gpu.resources.denoiseTextures,
          denoiseBytes: gpu.resources.denoiseBytes,
          plan: gpu.resources.plan,
          allocationBackoff: gpu.resources.allocationBackoff,
          sourceTransport: gpu.resources.sourceTransport,
          sourceTransportMode: gpu.resources.sourceTransportMode,
          tiledExecution: gpu.resources.tiledExecution,
          tileScheduler: gpu.resources.tileScheduler,
        } : null,
        recentRenders: tail(gpu.renders),
        recentScopes: tail(gpu.scopes),
        recentStages: tail(gpu.stages, 30),
        recentPresentations: tail(gpu.presentations),
        denoise: gpu.denoise,
      } : null,
      scheduler: performanceApi?.snapshot?.() || null,
      coordinator: performanceApi?.renderCoordinator?.() || null,
      jsHeap: performance.memory ? {
        usedBytes: performance.memory.usedJSHeapSize,
        totalBytes: performance.memory.totalJSHeapSize,
        limitBytes: performance.memory.jsHeapSizeLimit,
      } : null,
    };
  });
}

async function eventsSince(page, operationMark) {
  return page.evaluate((started) => ({
    previews: window.__heavyProjectProbe.previews.slice(started.previewIndex),
    scopes: window.__heavyProjectProbe.scopes.slice(started.scopeIndex),
  }), operationMark);
}

async function sessionDiagnostics(page) {
  const sessionId = await page.evaluate(() => window.HDRFinisherPerformance?.sessionId?.() || null);
  if (!sessionId) return null;
  const response = await page.request.get(`${baseUrl}/api/session/${sessionId}/diagnostics`);
  return {
    status: response.status(),
    ok: response.ok(),
    body: response.ok() ? await response.json() : await response.text(),
  };
}

async function measure(page, name, action, {
  network = [],
  requireNewGeneration = false,
  timeoutMs = 360_000,
} = {}) {
  const osBefore = osSnapshot();
  const networkStartIndex = network.length;
  const started = await mark(page, name);
  const wallStartedAt = Date.now();
  await action(started);
  if (requireNewGeneration) {
    await page.waitForFunction((begin) => {
      const lane = state.currentView;
      const exact = state.acceptedPresentation?.lane === lane
        && state.acceptedPresentation?.generation === state.previewGeneration[lane]
        && state.acceptedPresentation?.exact === true;
      const preview = window.__heavyProjectProbe.previews
        .slice(begin.previewIndex)
        .some((event) => event.lane === lane && event.generation === state.previewGeneration[lane]);
      const scope = window.__heavyProjectProbe.scopes
        .slice(begin.scopeIndex)
        .some((event) => event.lane === lane);
      return exact && preview && scope;
    }, started, { timeout: timeoutMs });
  }
  const endedAt = await page.evaluate(() => performance.now());
  const operationNetwork = network.slice(networkStartIndex);
  return {
    name,
    wallMs: Date.now() - wallStartedAt,
    pageMs: endedAt - started.at,
    started,
    events: await eventsSince(page, started),
    network: operationNetwork,
    networkSummary: summarizeNetwork(operationNetwork),
    os: {
      before: osBefore,
      after: osSnapshot(),
    },
    snapshot: await compactSnapshot(page),
    backendDiagnostics: await sessionDiagnostics(page),
  };
}

async function setAdjustment(page, pathText, value) {
  await page.evaluate(({ adjustmentPath, nextValue }) => {
    commitAdjustmentValue(adjustmentPath, nextValue, { manual: true });
    state.previewScheduler?.endInteraction();
  }, { adjustmentPath: pathText, nextValue: value });
}

async function main() {
  assert(option("--project"), "--project is required");
  assert(fs.existsSync(projectPath), `Project does not exist: ${projectPath}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromium.launch(edgeFallback ? {
    headless: false,
    channel: "msedge",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  } : { headless: false });
  const page = await browser.newPage({ viewport });
  const memoryTimeline = [];
  const rootPid = Number(process.env.HDR_FINISHER_ELECTRON_MAIN_PID || 0);
  const memorySampler = rootPid ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "sample-process-memory.ps1"), "-RootProcessId", String(rootPid)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) : null;
  let samplerBuffer = "";
  const samplerErrors = [];
  memorySampler?.stdout.on("data", (chunk) => {
    samplerBuffer += chunk.toString();
    let newline;
    while ((newline = samplerBuffer.indexOf("\n")) >= 0) {
      const line = samplerBuffer.slice(0, newline).trim();
      samplerBuffer = samplerBuffer.slice(newline + 1);
      if (line) { try { memoryTimeline.push(JSON.parse(line)); } catch { samplerErrors.push(line); } }
    }
  });
  memorySampler?.stderr.on("data", (chunk) => samplerErrors.push(chunk.toString()));
  const network = [];
  const pendingRequests = new Map();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/")) return;
    const postData = request.postData();
    let selectedBodyFields = null;
    if (postData) {
      try {
        const body = JSON.parse(postData);
        const selected = {};
        for (const key of [
          "action", "expected_revision", "kind", "lane", "long_edge", "max_long_edge",
          "mode", "preview_long_edge", "tier",
        ]) {
          if (body && Object.hasOwn(body, key)) selected[key] = body[key];
        }
        if (Object.keys(selected).length) selectedBodyFields = selected;
      } catch { /* Non-JSON request body; byte count is still useful. */ }
    }
    const record = {
      method: request.method(),
      path: url.pathname,
      query: url.search,
      postDataBytes: postData ? Buffer.byteLength(postData) : 0,
      selectedBodyFields,
      startedAt: Date.now(),
    };
    network.push(record);
    pendingRequests.set(request, record);
  });
  page.on("response", (response) => {
    const record = pendingRequests.get(response.request());
    if (!record) return;
    const headers = response.headers();
    record.status = response.status();
    record.durationMs = Date.now() - record.startedAt;
    record.response = Object.fromEntries([
      "content-length", "x-cpu-mask-ms", "x-image-height", "x-image-width",
      "x-mask-batch-bytes", "x-mask-batch-compiles", "x-mask-batch-entries",
      "x-sdr-match-timing", "x-source-level-state",
    ].filter((key) => headers[key] !== undefined).map((key) => [key, headers[key]]));
    pendingRequests.delete(response.request());
  });
  page.on("requestfailed", (request) => {
    const record = pendingRequests.get(request);
    if (!record) return;
    record.durationMs = Date.now() - record.startedAt;
    record.failure = request.failure()?.errorText || "request failed";
    pendingRequests.delete(request);
  });

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot?.()?.available === true, null, {
      timeout: 180_000,
    });
    await installProbe(page);
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));

    const operations = [];
    const openOperation = await measure(page, "open-mature-project", async () => {
      const result = await page.evaluate(async (targetPath) => {
        if (typeof desktop !== "undefined" && desktop?.grantProjectPath) {
          const selection = await desktop.grantProjectPath(targetPath, "project-open");
          await openProjectFromPath(selection);
        } else {
          const { response, payload } = await projectIo.openPathProject(fetch, { path: targetPath });
          if (!response.ok || !payload?.session) throw new Error(payload?.detail || "Project open failed");
          await activateDesktopSession(payload.session, targetPath);
        }
        return {
          projectPath: state.projectPath,
          sessionId: state.session?.session_id || null,
          lane: state.currentView,
        };
      }, projectPath);
      assert(result.sessionId, "Project open did not create a session");
    }, { network, timeoutMs: 600_000 });
    operations.push(openOperation);

    operations.push(await measure(page, "hdr-to-sdr-cold-switch", async () => {
      await page.evaluate(() => switchLane("sdr"));
    }, { network, timeoutMs: 360_000 }));

    operations.push(await measure(page, "sdr-to-hdr-warm-switch", async () => {
      await page.evaluate(() => switchLane("hdr"));
    }, { network, timeoutMs: 360_000 }));

    const originalExposure = await page.evaluate(() => state.adjustments.hdr.exposure);
    operations.push(await measure(page, "hdr-exposure-warm-edit", async () => {
      await setAdjustment(page, "hdr.exposure", Math.min(4, originalExposure + 0.05));
    }, { network, requireNewGeneration: true, timeoutMs: 360_000 }));
    operations.push(await measure(page, "hdr-exposure-restore", async () => {
      await setAdjustment(page, "hdr.exposure", originalExposure);
    }, { network, requireNewGeneration: true, timeoutMs: 360_000 }));

    operations.push(await measure(page, "prepare-sdr-before-match", async () => {
      await page.evaluate(() => switchLane("sdr"));
    }, { network, timeoutMs: 360_000 }));
    operations.push(await measure(page, "match-entire-hdr-grade", async () => {
      const matched = await page.evaluate(() => setSdrMatch("match"));
      assert(matched, "Match entire HDR grade returned false");
    }, { network, timeoutMs: 900_000 }));

    const replayCycles = Math.max(0, Number(option("--replay-cycles", "0")));
    for (let cycle = 1; cycle <= replayCycles; cycle += 1) {
      for (const lane of ["hdr", "sdr"]) {
        operations.push(await measure(page, `replay-${cycle}-${lane}-switch`, () => page.evaluate((next) => switchLane(next), lane), { network }));
        const value = await page.evaluate((active) => state.adjustments[active].exposure, lane);
        for (let edit = 0; edit < 4; edit += 1) {
          operations.push(await measure(page, `replay-${cycle}-${lane}-edit-${edit}`, () => setAdjustment(page, `${lane}.exposure`, edit % 2 ? value : Math.min(4, value + .05)), { network, requireNewGeneration: true }));
        }
      }
    }

    const finalSnapshot = await compactSnapshot(page);
    for (const operation of operations) {
      operation.networkSummary = summarizeNetwork(operation.network);
    }
    const report = {
      schemaVersion: 1,
      purpose: "GPU performance review heavy-project baseline",
      measurementPolicy: "Measurement only; no project save and no product optimization",
      createdAt: new Date().toISOString(),
      host: {
        shell: edgeFallback ? "Microsoft Edge diagnostic fallback" : "Electron",
        platform: process.platform,
        release: os.release(),
        architecture: os.arch(),
        cpu: os.cpus()[0]?.model || null,
        logicalCpuCount: os.cpus().length,
        totalSystemMemoryBytes: os.totalmem(),
        powerMode: process.env.HDR_FINISHER_POWER_MODE || "unknown",
        viewport,
      },
      source: {
        projectPath,
        projectBytes: fs.statSync(projectPath).size,
      },
      revision: {
        commit: gitValue("rev-parse", "HEAD"),
        branch: gitValue("branch", "--show-current"),
        dirty: Boolean(gitValue("status", "--porcelain")),
      },
      operations,
      memoryTimeline,
      samplerErrors,
      operationSummary: Object.fromEntries(operations.map((operation) => [operation.name, {
        pageMs: operation.pageMs,
        wallMs: operation.wallMs,
        previewEventCount: operation.events.previews.length,
        scopeEventCount: operation.events.scopes.length,
        previewEventLatency: summarize(operation.events.previews.map((event) => event.observedAt - operation.started.at)),
        scopeEventLatency: summarize(operation.events.scopes.map((event) => event.observedAt - operation.started.at)),
        network: operation.networkSummary,
        electronTreeWorkingSetBeforeBytes: operation.os.before?.electronTree?.totalWorkingSetBytes ?? null,
        electronTreeWorkingSetAfterBytes: operation.os.after?.electronTree?.totalWorkingSetBytes ?? null,
      }])),
      network,
      finalSnapshot,
      notes: [
        "This first run has one sample per operation and is diagnostic, not a stable percentile baseline.",
        edgeFallback
          ? "The saved project is opened through the localhost project API and is never saved by this driver."
          : "The saved project is opened through a desktop grant and is never saved by this driver.",
        "Whole-board NVIDIA memory is a device-wide sample and is not attributed to this app.",
        "Electron/backend working sets are point-in-time post-operation samples; they are not peak RSS.",
      ],
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ outputPath, operationSummary: report.operationSummary }, null, 2)}\n`);
  } finally {
    memorySampler?.kill();
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
