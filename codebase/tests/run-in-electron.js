/**
 * Run any Playwright preview test inside Electron.
 *
 *   node tests/run-in-electron.js tests/full-tier-preview.js [--tile-sizes 256,512]
 *   node tests/run-in-electron.js tests/performance/packaged-baselines.js --packaged
 *
 * `--packaged` launches the electron-builder output (dist-electron/win-unpacked)
 * instead of the development tree; that packaged app is the §8 reference setup.
 * Every run gets a disposable user-data profile so tests that assert fresh
 * startup state behave as they do under a Playwright-launched Chromium, and
 * the owner's real application profile is never touched.
 *
 * The GPU tests are written against `chromium.launch`, which is the right
 * default: it is fast and it runs the app the way a browser does. But a
 * Chromium that Playwright launches does not always expose WebGPU -- in a
 * sandbox or on a headless box `navigator.gpu` can be absent outright, and
 * then every GPU test fails for a reason that has nothing to do with the code
 * under test. Electron ships its own Chromium with the app's own GPU flags,
 * so it has an adapter wherever the application itself does.
 *
 * Nothing in the tests changes. This launches the desktop app, waits for the
 * window and the backend sidecar it starts, points HDR_FINISHER_URL at that
 * sidecar, and then loads the test with `chromium.launch` replaced by a stub
 * that hands back the window already open. A test that asks for a URL gets it
 * rewritten onto the sidecar's origin, so `--url` and a stale server on the
 * default port are both out of the picture.
 *
 * Caveats, all of them consequences of there being one real window:
 *   - `newPage` returns that window every time, and the viewport it is given
 *     is ignored; the window's size comes from the app.
 *   - A test that needs two pages at once is not supported here. Run it under
 *     Chromium, where it was already working.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const playwright = require("playwright");

const DESKTOP_DIRECTORY = path.resolve(__dirname, "..", "desktop");
const DEFAULT_PACKAGED_EXECUTABLE = path.resolve(
  __dirname, "..", "dist-electron", "win-unpacked", "HDR Finisher.exe",
);

function electronExecutable() {
  // The `electron` package exports the path to its own binary when required
  // from Node, which is platform-correct without guessing at a file name.
  const resolved = require(path.join(DESKTOP_DIRECTORY, "node_modules", "electron"));
  return typeof resolved === "string" ? resolved : undefined;
}

function packagedExecutable() {
  // `--packaged` runs the same drivers against the electron-builder output,
  // which is the §8 reference setup: the packaged app with the bundled
  // backend. `HDR_FINISHER_PACKAGED_EXECUTABLE` names a build elsewhere.
  const requested = process.env.HDR_FINISHER_PACKAGED_EXECUTABLE || DEFAULT_PACKAGED_EXECUTABLE;
  if (!fs.existsSync(requested)) {
    throw new Error(`Packaged executable not found: ${requested}. Run npm run pack:dir in desktop/ first.`);
  }
  return requested;
}

(async () => {
  const [testPath, ...rest] = process.argv.slice(2);
  if (!testPath) {
    console.error("usage: node tests/run-in-electron.js <test.js> [--packaged] [test args...]");
    process.exit(2);
  }
  const packaged = rest.includes("--packaged");
  const testArguments = rest.filter((argument) => argument !== "--packaged");

  // A test that asserts fresh startup state needs a fresh profile, exactly as
  // a Playwright-launched Chromium gets one; the app's real profile would make
  // the result depend on whoever ran the app last. Each run also gets its own
  // disposable profile so the runner never writes to the owner's app state.
  const userDataDirectory = process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA
    || fs.mkdtempSync(path.join(os.tmpdir(), "hdr-finisher-electron-test-"));

  // The §8 reference setup names a 2560x1440 viewport. The app restores its
  // window bounds from `window-state.json` in userData and a runtime resize
  // does not stick (the app re-applies the restored bounds when it shows the
  // window), so the reference size is seeded before launch instead.
  if (process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE) {
    const [width, height] = process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE.split("x").map(Number);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      fs.writeFileSync(
        path.join(userDataDirectory, "window-state.json"),
        JSON.stringify({ x: 0, y: 0, width, height }),
      );
    }
  }

  // Some editors and agent hosts export ELECTRON_RUN_AS_NODE=1 into every
  // child process. Electron then starts as plain Node: `require("electron")`
  // returns the package path, `main.js` throws on `app.isPackaged`, and the
  // debugger lines Playwright waits for never appear (or the DevTools socket
  // resets when the crash kills the process). The app is launched with that
  // variable removed so the runner behaves the same in any host shell.
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  launchEnvironment.HDR_FINISHER_USER_DATA_DIR = userDataDirectory;
  if (process.env.HDR_FINISHER_RUNNER_DEBUG === "1") {
    console.error(`[runner] env ${JSON.stringify({
      runnerVar: process.env.HDR_FINISHER_USER_DATA_DIR || null,
      testVar: process.env.HDR_FINISHER_ELECTRON_TEST_USER_DATA || null,
      launchVar: launchEnvironment.HDR_FINISHER_USER_DATA_DIR,
      tempProfile: userDataDirectory,
    })}`);
  }

  const diagnosticGpuArgs = process.env.HDR_FINISHER_ELECTRON_DISABLE_GPU_SANDBOX === "1"
    ? ["--disable-gpu-sandbox"]
    : [];
  const launchStarted = Date.now();
  const app = await playwright._electron.launch({
    // An absolute app path. `.` is not enough: Electron falls back to its own
    // `resources/app` when the app argument is not resolved, and this
    // checkout's Electron distribution carries a leftover review launcher
    // there (it forces a review profile and re-requires the desktop main.js).
    args: packaged ? diagnosticGpuArgs : [...diagnosticGpuArgs, DESKTOP_DIRECTORY],
    cwd: DESKTOP_DIRECTORY,
    executablePath: packaged ? packagedExecutable() : electronExecutable(),
    env: launchEnvironment,
    timeout: 180000,
  });
  app.on("window", page => { page.on("console", msg => { if(msg.type()==="error")console.error("[renderer]",msg.text()); }); page.on("pageerror", error=>console.error("[renderer]",error)); });
  let window = await app.firstWindow({ timeout: 180000 });
  const visible = app.windows().find(page => !page.url().includes("gpu-delivery.html"));
  if (visible) window = visible;
  if (process.env.HDR_FINISHER_RUNNER_DEBUG === "1") console.error("[runner] initial", window.url());
  if (testPath.replaceAll("\\", "/").endsWith("startup-state.js")) {
    await window.locator('[role="status"]').waitFor({timeout:10000});
    const starting = await window.locator('[role="status"]').textContent();
    if (starting !== "Starting…") throw Error(`Expected calm startup screen, got ${starting}`);
    fs.mkdirSync(path.resolve(DESKTOP_DIRECTORY,"../output"),{recursive:true});
    await window.screenshot({path:path.resolve(DESKTOP_DIRECTORY,"../output/starting-screen.png")});
  }
  await require("./electron-initial-load").waitForInitialLoad(app, window);
  if (testPath.replaceAll("\\", "/").endsWith("startup-state.js")) {
    const log = fs.readFileSync(path.join(userDataDirectory,"logs/backend.log"),"utf8");
    const line = log.split("\n").find(line => line.includes("[library] window_visible"));
    const timing = Math.round(JSON.parse(line.slice(line.indexOf("{"))).time * 1000 - launchStarted);
    console.log(`Window visible: ${timing} ms (limit 1500 ms); Starting… screen verified.`);
    if (timing > 1500) throw Error(`Window visibility exceeded 1500 ms: ${timing}`);
  }
  if (process.env.HDR_FINISHER_RUNNER_DEBUG === "1") console.error("[runner] loaded", window.url());
  // The launcher pid Playwright tracks is the shell on Windows; the main
  // process pid is what owns the window and the backend sidecar, so shutdown
  // is anchored to it.
  const electronMainProcessId = await app.evaluate(() => process.pid);

  // When the window goes away mid-driver, Playwright only says "Target page,
  // context or browser has been closed". These lines tell the causes apart: a
  // renderer or GPU crash, the app closing its window or quitting, the main
  // process dying, or the debugging connection dropping while the app runs on.
  let runnerStopping = false;
  const mainEventsPath = path.join(userDataDirectory, "logs", "runner-main-events.log");
  await app.evaluate(({ app: electronApp, BrowserWindow, webContents }, logPath) => {
    const fs = process.getBuiltinModule("node:fs");
    fs.mkdirSync(process.getBuiltinModule("node:path").dirname(logPath), { recursive: true });
    const record = (event, details = {}) => {
      try { fs.appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), uptime: process.uptime(), event, ...details })}\n`); } catch { /* best effort */ }
    };
    const watch = contents => {
      contents.on("render-process-gone", (_event, details) => record("render-process-gone", { url: contents.getURL(), reason: details.reason, exitCode: details.exitCode }));
      contents.on("destroyed", () => record("webcontents-destroyed", { id: contents.id }));
    };
    webContents.getAllWebContents().forEach(watch);
    electronApp.on("web-contents-created", (_event, contents) => watch(contents));
    for (const win of BrowserWindow.getAllWindows()) win.on("closed", () => record("window-closed", { id: win.id }));
    electronApp.on("browser-window-created", (_event, win) => win.on("closed", () => record("window-closed", { id: win.id })));
    electronApp.on("child-process-gone", (_event, details) => record("child-process-gone", details));
    for (const name of ["before-quit", "will-quit", "quit", "window-all-closed"]) electronApp.on(name, () => record(name));
    process.on("uncaughtException", error => record("uncaught-exception", { message: String(error?.stack || error) }));
    process.on("exit", code => record("main-exit", { code }));
    if (process.env.HDR_FINISHER_RUNNER_HEARTBEAT === "1") {
      // Opt-in memory heartbeat: shows growth before a silent death.
      setInterval(() => {
        const metrics = electronApp.getAppMetrics().map(item => `${item.type}:${item.pid}:${Math.round(item.memory.workingSetSize / 1024)}MB`);
        record("heartbeat", { rssMB: Math.round(process.memoryUsage().rss / 2 ** 20), heapMB: Math.round(process.memoryUsage().heapUsed / 2 ** 20), metrics });
      }, 2000).unref();
    }
    record("runner-diagnostics-installed", { pid: process.pid });
  }, mainEventsPath);
  const mainAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const reportGone = (what) => {
    if (runnerStopping) return;
    const report = () => {
      let events = "";
      try { events = fs.readFileSync(mainEventsPath, "utf8").trim(); } catch { /* none */ }
      console.error(`[runner] ${what}; Electron main process ${mainAlive(electronMainProcessId) ? "still running" : "gone"}; main-process events:\n${events || "(none)"}`);
    };
    // Give the main process a moment to write what it saw.
    setTimeout(report, 1500).unref?.();
  };
  window.on("crash", () => reportGone("page crashed (renderer)"));
  window.on("close", () => reportGone("page closed"));
  app.on("close", () => reportGone("Electron application connection closed"));
  // Performance drivers are loaded below, after launch. Expose the real tree
  // root so they can take read-only OS memory snapshots without guessing from
  // Playwright's Windows launcher process.
  process.env.HDR_FINISHER_ELECTRON_MAIN_PID = String(electronMainProcessId);
  // Power mode is part of every §8 latency report and only the main process
  // can see it.
  process.env.HDR_FINISHER_POWER_MODE = await app.evaluate(({ powerMonitor }) => (
    powerMonitor.isOnBatteryPower() ? "battery" : "ac"
  )).catch(() => "unknown");
  if (process.env.HDR_FINISHER_RUNNER_DEBUG === "1") {
    const debugInfo = await app.evaluate(({ app: electronApp }) => ({
      pid: process.pid,
      appPath: electronApp.getAppPath(),
      userData: electronApp.getPath("userData"),
      userDataEnvironment: process.env.HDR_FINISHER_USER_DATA_DIR || null,
      runAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
      packaged: electronApp.isPackaged,
    }));
    console.error(`[runner] ${JSON.stringify(debugInfo)}`);
  }
  const origin = new URL(window.url()).origin;

  // Every address the test knows about is the sidecar's. A test reads this at
  // module load, which is why the module is required below and not above.
  process.env.HDR_FINISHER_URL = origin;

  // Several tests decode a screenshot by fetching it back as a data: URL.
  // Electron refuses that under the app's content policy, where a browser
  // allows it, so the fetch is taught to answer data: URLs itself. This runs
  // on the next navigation, which the test performs with its own goto.
  await window.addInitScript(() => {
    const inherited = window.fetch;
    window.fetch = function fetchWithDataUrls(input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      if (typeof url !== "string" || !url.startsWith("data:")) {
        return inherited.call(this, input, init);
      }
      const separator = url.indexOf(",");
      const header = url.slice(5, separator);
      const payload = url.slice(separator + 1);
      const base64 = header.endsWith(";base64");
      const type = (base64 ? header.slice(0, -7) : header) || "application/octet-stream";
      const binary = base64 ? atob(payload) : decodeURIComponent(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return Promise.resolve(new Response(bytes, { headers: { "Content-Type": type } }));
    };
  });

  // The desktop app authenticates to its sidecar with a per-run secret that
  // the main process staples onto requests leaving the renderer's session.
  // Playwright's `page.request` does not travel that path, so a test that
  // posts a fixture through it is answered 401. The secret is a main-process
  // local and cannot be read out directly, so it is lifted off a request the
  // renderer itself makes and then stapled onto the API context by hand.
  const authoringToken = await (async () => {
    let seen = null;
    const capture = async (request) => {
      if (seen || !request.url().startsWith(origin)) return;
      try { seen = await request.headerValue("x-hdr-finisher-token"); } catch { /* gone */ }
    };
    window.on("request", capture);
    await window.reload({ waitUntil: "load" });
    for (let attempt = 0; attempt < 40 && !seen; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    window.off("request", capture);
    return seen;
  })();
  if (authoringToken) {
    const api = window.request;
    for (const method of ["fetch", "get", "post", "put", "patch", "delete", "head"]) {
      const inherited = api[method].bind(api);
      api[method] = (url, options = {}) => inherited(url, {
        ...options,
        headers: { ...(options.headers || {}), "X-HDR-Finisher-Token": authoringToken },
      });
    }
  }

  // The app polls its sidecar for as long as it is open (grade saving, GPU
  // delivery, Library workers), so Playwright's `networkidle` never arrives
  // and a driver that asks for it times out before testing anything. Every
  // `networkidle` wait is served instead by the page's `load` event plus the
  // app's own start-up signals: the shell's `body[data-ready]` and the
  // Library frame's `window.HDRLibrary`. Pages other than the app shell get
  // `load` alone.
  const appReady = async (response) => {
    const shell = await window.evaluate(() => !!document.getElementById("library-frame")).catch(() => false);
    if (!shell) return response;
    await window.waitForFunction(() => document.body?.dataset.ready === "true"
      && document.getElementById("library-frame")?.contentWindow?.HDRLibrary, null, { timeout: 60000 });
    return response;
  };
  const settled = (options) => options?.waitUntil === "networkidle" ? { ...options, waitUntil: "load" } : options;
  const navigate = window.goto.bind(window);
  window.goto = async (url, options) => {
    const target = new URL(String(url), origin);
    const response = await navigate(`${origin}${target.pathname}${target.search}${target.hash}`, settled(options));
    return options?.waitUntil === "networkidle" ? appReady(response) : response;
  };
  const reload = window.reload.bind(window);
  window.reload = async (options) => {
    const response = await reload(settled(options));
    return options?.waitUntil === "networkidle" ? appReady(response) : response;
  };
  const waitForLoadState = window.waitForLoadState.bind(window);
  window.waitForLoadState = async (state, options) => {
    if (state !== "networkidle") return waitForLoadState(state, options);
    await waitForLoadState("load", options);
    return appReady();
  };
  // The window is the app; closing it is the runner's job, not the test's.
  window.close = async () => {};

  // A test leaves the document dirty, and the app asks "Save changes?" from
  // the main process when its window closes. That is a native dialog: the
  // page cannot dismiss it, a graceful close waits on it forever, and the
  // prompt is left sitting on the desktop of whoever ran the test. So the
  // harness answers only that unsaved-project prompt with Discard, which is
  // response 1 of ["Save", "Discard", "Cancel"]. A test run must never write
  // over somebody's file, and it must never block on a question.
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog);
    const originalSync = dialog.showMessageBoxSync.bind(dialog);
    const isUnsaved = args => JSON.stringify(args.at(-1)?.buttons)
      === JSON.stringify(['Save', 'Discard', 'Cancel']);
    dialog.showMessageBox = async (...args) => isUnsaved(args)
      ? { response: dialog.hdrFinisherTestUnsavedResponse ?? 1, checkboxChecked: false } : original(...args);
    dialog.showMessageBoxSync = (...args) => isUnsaved(args) ? (dialog.hdrFinisherTestUnsavedResponse ?? 1) : originalSync(...args);
  }).catch(() => { /* older Electron surface; the kill below still applies */ });

  // Shutdown is a kill of the whole tree rather than `app.close()`, for the
  // same reason: a graceful quit runs the app's close path. Electron leaves
  // its renderer and GPU children behind on a bare signal under Windows, so
  // the tree goes with it.
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    runnerStopping = true;
    const child = app.process();
    // The launcher command is a shell on Windows; killing it can orphan the
    // Electron tree. The main process pid is the tree root that matters.
    const pid = electronMainProcessId || (child && child.pid);
    if (process.platform === "win32" && pid) {
      try { execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); return; } catch { /* fall through */ }
    }
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  };

  // The tests all end with `finally { await browser.close() }`, so closing the
  // stub is what releases Electron's handles and lets the process exit. The
  // exit code is then the test's own: its explicit `process.exitCode`, or the
  // non-zero an unhandled rejection produces. Nothing here overrides it.
  const browserFacade = {
    // A viewport is a request to the browser; here it has to become a resize
    // of the real window, because more than one test asserts on geometry that
    // follows the preview's size.
    newPage: async (options = {}) => {
      const viewport = options && options.viewport;
      if (viewport && viewport.width && viewport.height) {
        const handle = await app.browserWindow(window).catch(() => null);
        if (handle) {
          // A no-op resize is still a resize: the app reacts to the event and
          // can re-plan an expensive frame, so the current size is compared
          // first and a request that already matches is left alone.
          const current = await handle.evaluate((browserWindow) => {
            const [width, height] = browserWindow.getContentSize();
            return { width, height };
          }).catch(() => null);
          const differs = !current
            || Math.abs(current.width - viewport.width) > 1
            || Math.abs(current.height - viewport.height) > 1;
          if (differs) {
            await handle.evaluate((browserWindow, size) => {
              browserWindow.setContentSize(Math.round(size.width), Math.round(size.height));
            }, viewport).catch(() => { /* the window manager may refuse the size */ });
            await window.waitForTimeout(250);
          }
        }
      }
      // Opt-in benchmark placement: keep a test window wholly on the named
      // primary display, rather than straddling mixed HDR/SDR monitors.
      const displayContext = await app.evaluate(({ screen, BrowserWindow }, pinPrimary) => {
        const win = BrowserWindow.getAllWindows().find(win => !win.webContents.getURL().includes("gpu-delivery.html"));
        if (pinPrimary && win) {
          const area = screen.getPrimaryDisplay().workArea;
          if (win.isMaximized()) win.unmaximize();
          const bounds = win.getBounds();
          win.setBounds({ x: area.x, y: area.y, width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) });
        }
        const bounds = win?.getBounds();
        const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
        return { pinnedPrimary: pinPrimary, bounds, display, displays: screen.getAllDisplays(), primaryId: screen.getPrimaryDisplay().id };
      }, process.env.HDR_FINISHER_REVIEW_PRIMARY_DISPLAY === '1'
        || (process.env.HDR_FINISHER_REVIEW_PRIMARY_DISPLAY !== '0'
          && /heavy-project-(drag-review|long-session)\.js$/.test(testPath)));
      process.env.HDR_FINISHER_REVIEW_DISPLAY_CONTEXT = JSON.stringify(displayContext);
      return window;
    },
    close: async () => { stop(); },
    // Playwright reports the browser build here and several drivers put it in
    // their report. Electron's Chromium version is the honest answer.
    version: async () => {
      try {
        return await app.evaluate(() => process.versions.chrome || process.versions.electron || "unknown");
      } catch {
        return "unknown";
      }
    },
    contexts: () => [],
    isConnected: () => true,
  };
  require("./electron-browser-context").installSequentialContexts(browserFacade, window, navigate, origin);
  playwright.chromium.launch = async () => browserFacade;
  // Desktop tests resolve a separate Playwright installation. Share the same
  // supported browser branch so a release never needs a temporary adapter.
  require(require.resolve("playwright", { paths: [DESKTOP_DIRECTORY] })).chromium.launch = playwright.chromium.launch;
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => { stop(); process.exit(130); });
  }

  // API-only drivers use Node fetch rather than the page's authenticated
  // fetch. Expose a same-origin test capability without exposing its token.
  const nodeFetch = global.fetch.bind(global);
  global.HDRFinisherElectronTestHarness = {
    fetch: (input, options = {}) => {
      const target = new URL(String(input), origin);
      if (target.origin !== origin) throw new Error("Test API request must use the disposable sidecar origin");
      const headers = new Headers(options.headers || {});
      if (authoringToken) headers.set("X-HDR-Finisher-Token", authoringToken);
      return nodeFetch(target, { ...options, headers });
    },
    selectUnsavedResponse: async (response) => {
      if (![1, 2].includes(response)) throw new Error('Tests may Discard or Cancel, never Save fixtures');
      await app.evaluate(({ dialog }, value) => { dialog.hdrFinisherTestUnsavedResponse = value; }, response);
    },
    selectExportDirectory: async (selectedDirectory) => {
      const resolved = path.resolve(selectedDirectory);
      if (!fs.statSync(resolved).isDirectory()) throw new Error('Test export destination must be an existing directory');
      await app.evaluate(({ dialog }, directory) => {
        const previous = dialog.showOpenDialog;
        dialog.showOpenDialog = async (...args) => {
          // Consume only the batch folder picker, then restore the real dialog.
          const options = args.at(-1);
          if (options?.title !== "Choose export folder" || !options?.properties?.includes("openDirectory")) return previous.apply(dialog, args);
          dialog.showOpenDialog = previous;
          return { canceled: false, filePaths: [directory] };
        };
      }, resolved);
    },
    selectExportPath: async (selectedPath) => {
      if (fs.existsSync(selectedPath)) throw new Error('Test export destination must be new');
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      }, path.resolve(selectedPath));
    },
    close: async () => stop(),
  };

  if (process.env.HDR_FINISHER_RUNNER_DEBUG === "1") console.error("[runner] start driver");
  process.argv = [process.argv[0], path.resolve(testPath), ...testArguments];
  // Set require.main as a direct Node invocation would, including drivers
  // whose standalone entry point is guarded by require.main === module.
  require("node:module")._load(path.resolve(testPath), null, true);
})().catch((error) => { console.error(error); process.exit(1); });
