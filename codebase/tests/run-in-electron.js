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

  const app = await playwright._electron.launch({
    // An absolute app path. `.` is not enough: Electron falls back to its own
    // `resources/app` when the app argument is not resolved, and this
    // checkout's Electron distribution carries a leftover review launcher
    // there (it forces a review profile and re-requires the desktop main.js).
    args: packaged ? [] : [DESKTOP_DIRECTORY],
    cwd: DESKTOP_DIRECTORY,
    executablePath: packaged ? packagedExecutable() : electronExecutable(),
    env: launchEnvironment,
    timeout: 180000,
  });
  const window = await app.firstWindow({ timeout: 180000 });
  await window.waitForLoadState("domcontentloaded");
  // The launcher pid Playwright tracks is the shell on Windows; the main
  // process pid is what owns the window and the backend sidecar, so shutdown
  // is anchored to it.
  const electronMainProcessId = await app.evaluate(() => process.pid);
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
    await window.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
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

  const navigate = window.goto.bind(window);
  window.goto = (url, options) => {
    const target = new URL(String(url), origin);
    return navigate(`${origin}${target.pathname}${target.search}${target.hash}`, options);
  };
  // The window is the app; closing it is the runner's job, not the test's.
  window.close = async () => {};

  // A test leaves the document dirty, and the app asks "Save changes?" from
  // the main process when its window closes. That is a native dialog: the
  // page cannot dismiss it, a graceful close waits on it forever, and the
  // prompt is left sitting on the desktop of whoever ran the test. So the
  // harness answers every main-process dialog itself, with Discard, which is
  // response 1 of ["Save", "Discard", "Cancel"]. A test run must never write
  // over somebody's file, and it must never block on a question.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    dialog.showMessageBoxSync = () => 1;
  }).catch(() => { /* older Electron surface; the kill below still applies */ });

  // Shutdown is a kill of the whole tree rather than `app.close()`, for the
  // same reason: a graceful quit runs the app's close path. Electron leaves
  // its renderer and GPU children behind on a bare signal under Windows, so
  // the tree goes with it.
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
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
  playwright.chromium.launch = async () => ({
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
      return window;
    },
    close: async () => { stop(); },
    contexts: () => [],
    isConnected: () => true,
  });
  process.on("exit", stop);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => { stop(); process.exit(130); });
  }

  process.argv = [process.argv[0], path.resolve(testPath), ...testArguments];
  require(path.resolve(testPath));
})().catch((error) => { console.error(error); process.exit(1); });
