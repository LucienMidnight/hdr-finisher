const { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  safeSuggestedName,
} = require("./lib/validation");
const { backendCommand: resolveBackendCommand } = require("./lib/runtime");
const { DEFAULT_WINDOW_BOUNDS, clampWindowBounds } = require("./lib/window-bounds");

const APP_ID = "org.hdrfinisher.app";
const SOURCE_FILTERS = [
  { name: "HDR images", extensions: ["exr", "tif", "tiff", "hdr", "pfm", "heic", "heif", "avif", "png", "jpg", "jpeg"] },
  { name: "All files", extensions: ["*"] },
];
const PROJECT_FILTERS = [{ name: "HDR Finisher Project", extensions: ["hdrfinisher"] }];

if (process.env.HDR_FINISHER_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.HDR_FINISHER_USER_DATA_DIR));
}
if (process.env.HDR_FINISHER_DISABLE_GPU === "1") {
  app.commandLine.appendSwitch("in-process-gpu");
  app.disableHardwareAcceleration();
}

let backend = null;
let mainWindow = null;
let forceClose = false;
let shuttingDown = false;
let quitRequested = false;
let documentState = { path: "", dirty: false, displayName: "Untitled" };
let renderingMode = "auto";
let pendingOpenPaths = [];
const knownProjectPaths = new Set();
const grantedExportPaths = new Set();

function renderingPreferencePath() {
  return path.join(app.getPath("userData"), "rendering-preferences.json");
}

function loadRenderingPreference() {
  try {
    const value = JSON.parse(fs.readFileSync(renderingPreferencePath(), "utf8"));
    if (["auto", "gpu", "cpu"].includes(value.renderingMode)) renderingMode = value.renderingMode;
  } catch {}
}

function setRenderingMode(mode) {
  if (!["auto", "gpu", "cpu"].includes(mode)) return false;
  renderingMode = mode;
  fs.writeFileSync(renderingPreferencePath(), JSON.stringify({ renderingMode }));
  buildMenu();
  sendCommand("rendering-mode", { mode });
  return true;
}

function randomSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function applicationArgs(argv) {
  return argv.filter((value) => isProjectPath(value));
}

function backendCommand() {
  return resolveBackendCommand({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    desktopDirectory: __dirname,
  });
}

async function startBackend() {
  const authoringSecret = randomSecret();
  const controlSecret = randomSecret();
  const command = backendCommand();
  const logsDirectory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logsDirectory, { recursive: true });
  const logPath = path.join(logsDirectory, "backend.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      HDR_FINISHER_DESKTOP_SECRET: authoringSecret,
      HDR_FINISHER_DESKTOP_CONTROL_SECRET: controlSecret,
      HDR_FINISHER_APP_DATA_DIR: app.getPath("userData"),
      PYTHONUNBUFFERED: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.pipe(log, { end: false });

  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The image-processing backend did not become ready in time.")), 30000);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      log.write(`${line}\n`);
      if (!line.startsWith("HDR_FINISHER_READY ")) return;
      try {
        const record = JSON.parse(line.slice("HDR_FINISHER_READY ".length));
        clearTimeout(timeout);
        resolve(record);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The image-processing backend exited during startup (${code ?? "unknown"}).`));
    });
  });

  if (ready.protocol_version !== 1 || ready.backend_version !== app.getVersion()) {
    child.kill();
    throw new Error(`Desktop/backend version mismatch (${app.getVersion()} / ${ready.backend_version}).`);
  }
  const url = `http://127.0.0.1:${ready.port}`;
  const health = await fetch(`${url}/health`);
  const healthPayload = await health.json();
  if (!health.ok || healthPayload.status !== "ok") {
    child.kill();
    throw new Error("The image-processing backend failed its health check.");
  }
  backend = { authoringSecret, controlSecret, child, log, logPath, url };
  child.once("exit", (code) => {
    if (!shuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "HDR Finisher backend stopped",
        message: "The image-processing backend stopped unexpectedly.",
        detail: `Exit code: ${code ?? "unknown"}\n\nLog: ${logPath}`,
        buttons: ["Quit"],
      }).finally(() => beginShutdown());
    }
  });
}

async function stopBackend() {
  if (!backend) return;
  const current = backend;
  backend = null;
  if (current.child.exitCode === null) {
    current.child.kill();
    await Promise.race([
      new Promise((resolve) => current.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (current.child.exitCode === null) {
      if (process.platform === "win32") {
        spawn("taskkill.exe", ["/PID", String(current.child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        current.child.kill("SIGKILL");
      }
    }
  }
  current.log.end();
}

async function grantPath(filePath, intent) {
  const response = await fetch(`${backend.url}/api/desktop/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HDR-Finisher-Control": backend.controlSecret },
    body: JSON.stringify({ path: filePath, intent }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || "The selected path could not be authorized.");
  return payload;
}

function validateSender(event) {
  if (!backend || !event.senderFrame) throw new Error("Missing desktop sender.");
  const sender = new URL(event.senderFrame.url);
  const expected = new URL(backend.url);
  if (sender.origin !== expected.origin || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Desktop request rejected from an unexpected frame.");
  }
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
    validateSender(event);
    return callback(...args);
  });

  handle("desktop:environment", () => ({
    apiVersion: 1,
    platform: process.platform,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    renderingMode,
  }));
  handle("desktop:set-rendering-mode", (mode) => setRenderingMode(mode));
  handle("desktop:open-source", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Import source image", properties: ["openFile"], filters: SOURCE_FILTERS });
    return result.canceled ? null : grantPath(result.filePaths[0], "source-open");
  });
  handle("desktop:open-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Open project", properties: ["openFile"], filters: PROJECT_FILTERS });
    if (result.canceled) return null;
    knownProjectPaths.add(path.resolve(result.filePaths[0]));
    return grantPath(result.filePaths[0], "project-open");
  });
  handle("desktop:relink-source", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Relink original source", properties: ["openFile"], filters: SOURCE_FILTERS });
    return result.canceled ? null : grantPath(result.filePaths[0], "source-relink");
  });
  handle("desktop:save-project", async (options = {}) => {
    const saveAs = Boolean(options.saveAs);
    if (!saveAs && documentState.path && knownProjectPaths.has(path.resolve(documentState.path))) {
      return grantPath(documentState.path, "project-save");
    }
    const suggested = safeSuggestedName(options.suggestedName, "Untitled.hdrfinisher");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: saveAs ? "Save Project As" : "Save Project",
      defaultPath: documentState.path || path.join(app.getPath("documents"), suggested),
      filters: PROJECT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    const projectPath = isProjectPath(result.filePath) ? result.filePath : `${result.filePath}.hdrfinisher`;
    knownProjectPaths.add(path.resolve(projectPath));
    return grantPath(projectPath, "project-save");
  });
  handle("desktop:choose-export-directory", async (initialPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose export folder",
      defaultPath: typeof initialPath === "string" && initialPath ? initialPath : app.getPath("pictures"),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("desktop:choose-export-path", async (options = {}) => {
    const extension = typeof options.extension === "string" ? options.extension.replace(/^\./, "") : "jpg";
    const suggested = safeSuggestedName(options.suggestedName, `hdr_finisher_export.${extension}`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export finished image",
      defaultPath: path.join(typeof options.directory === "string" && options.directory ? options.directory : app.getPath("pictures"), suggested),
      filters: [{ name: typeof options.formatName === "string" ? options.formatName : "Finished image", extensions: [extension] }],
    });
    if (result.canceled || !result.filePath || !isExportPath(result.filePath)) return null;
    const resolved = path.resolve(result.filePath);
    grantedExportPaths.add(resolved);
    return grantPath(resolved, "export-file");
  });
  handle("desktop:resolve-dropped-files", async (paths) => {
    if (!Array.isArray(paths) || paths.length > 16) throw new Error("Invalid dropped-file request.");
    const results = [];
    for (const filePath of paths) {
      if (isProjectPath(filePath)) {
        knownProjectPaths.add(path.resolve(filePath));
        results.push({ kind: "project", ...(await grantPath(filePath, "project-open")) });
      } else if (isSourcePath(filePath)) {
        results.push({ kind: "source", ...(await grantPath(filePath, "source-open")) });
      }
    }
    return results;
  });
  handle("desktop:reveal-path", async (filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    if (!grantedExportPaths.has(resolved)) throw new Error("Only exports created in this run can be revealed.");
    shell.showItemInFolder(resolved);
    return true;
  });
  handle("desktop:open-path", async (filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    if (!grantedExportPaths.has(resolved)) throw new Error("Only exports created in this run can be opened.");
    return shell.openPath(resolved);
  });
  handle("desktop:open-proof", async (url) => {
    if (!allowedProofUrl(url, backend.url)) throw new Error("Only local read-only proof URLs can be opened.");
    await shell.openExternal(url);
    return true;
  });
  handle("desktop:set-document-state", (next = {}) => {
    const nextPath = typeof next.path === "string" ? next.path : "";
    if (nextPath && !knownProjectPaths.has(path.resolve(nextPath))) throw new Error("Unknown project path.");
    documentState = {
      path: nextPath,
      dirty: Boolean(next.dirty),
      displayName: safeSuggestedName(next.displayName, "Untitled"),
    };
    if (documentState.path) app.addRecentDocument(documentState.path);
    updateWindowDocumentState();
    if (!documentState.dirty && mainWindow?.pendingCloseAfterSave) {
      mainWindow.pendingCloseAfterSave = false;
      if (quitRequested) beginShutdown();
      else {
        forceClose = true;
        mainWindow.close();
      }
    }
    return true;
  });
  ipcMain.on("desktop:set-operation-progress", (event, progress = {}) => {
    validateSender(event);
    const value = Number(progress.value);
    mainWindow?.setProgressBar(Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : -1, {
      mode: ["normal", "paused", "error", "indeterminate"].includes(progress.state) ? progress.state : "normal",
    });
  });
}

function updateWindowDocumentState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const marker = documentState.dirty ? " *" : "";
  mainWindow.setTitle(`${documentState.displayName}${marker} — HDR Finisher`);
  if (process.platform === "darwin") {
    mainWindow.setDocumentEdited(documentState.dirty);
    mainWindow.setRepresentedFilename(documentState.path || "");
  }
  buildMenu();
}

function sendCommand(command, payload = null) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:menu-command", { command, payload });
}

function buildMenu() {
  const hasDocument = Boolean(documentState.displayName && documentState.displayName !== "Untitled");
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Import Source…", accelerator: "CmdOrCtrl+O", click: () => sendCommand("open-source") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+Shift+O", click: () => sendCommand("open-project") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", enabled: hasDocument, click: () => sendCommand("save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", enabled: hasDocument, click: () => sendCommand("save-as") },
        { type: "separator" },
        { label: "Export…", accelerator: "CmdOrCtrl+E", enabled: hasDocument, click: () => sendCommand("export") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", enabled: hasDocument, click: () => sendCommand("undo") },
        { label: "Redo", accelerator: "CmdOrCtrl+Shift+Z", enabled: hasDocument, click: () => sendCommand("redo") },
        { type: "separator" },
        {
          label: "Rendering Mode",
          submenu: [
            { label: "Auto (Recommended)", type: "radio", checked: renderingMode === "auto", click: () => setRenderingMode("auto") },
            { label: "GPU Preferred", type: "radio", checked: renderingMode === "gpu", click: () => setRenderingMode("gpu") },
            { label: "CPU Compatibility", type: "radio", checked: renderingMode === "cpu", click: () => setRenderingMode("cpu") },
          ],
        },
        { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
    {
      label: "Help",
      submenu: [
        { label: "Open Logs", click: () => shell.showItemInFolder(backend.logPath) },
        { label: "About HDR Finisher", click: () => dialog.showMessageBox(mainWindow, { title: "HDR Finisher", message: `HDR Finisher ${app.getVersion()}`, detail: "Offline HDR finishing and gain-map export.", buttons: ["OK"] }) },
      ],
    },
  ];
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function restoredBounds() {
  const statePath = path.join(app.getPath("userData"), "window-state.json");
  try {
    const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const display = screen.getAllDisplays().find((candidate) => {
      const area = candidate.workArea;
      return value.x < area.x + area.width && value.x + value.width > area.x && value.y < area.y + area.height && value.y + value.height > area.y;
    });
    if (display) return clampWindowBounds(value, display.workArea);
  } catch {}
  const primary = screen.getPrimaryDisplay();
  return clampWindowBounds(DEFAULT_WINDOW_BOUNDS, primary.workArea);
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const statePath = path.join(app.getPath("userData"), "window-state.json");
  fs.writeFileSync(statePath, JSON.stringify(mainWindow.getNormalBounds()));
}

async function createWindow() {
  forceClose = false;
  const bounds = restoredBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: "#101415",
    title: "HDR Finisher",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(backend.url).origin) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    saveWindowBounds();
    if (forceClose) return;
    event.preventDefault();
    requestClose();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!shuttingDown) forceClose = false;
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(backend.url);
  updateWindowDocumentState();
  await dispatchPendingOpenPaths();
}

async function dispatchPendingOpenPaths() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const paths = pendingOpenPaths;
  pendingOpenPaths = [];
  for (const filePath of paths) {
    if (!isProjectPath(filePath)) continue;
    knownProjectPaths.add(path.resolve(filePath));
    app.addRecentDocument(path.resolve(filePath));
    try {
      const selection = await grantPath(filePath, "project-open");
      mainWindow.webContents.send("desktop:open-request", { kind: "project", ...selection });
    } catch (error) {
      await dialog.showMessageBox(mainWindow, { type: "error", message: "The project could not be opened.", detail: error.message, buttons: ["OK"] });
    }
  }
}

async function requestClose() {
  if (!documentState.dirty) {
    if (quitRequested) {
      beginShutdown();
      return;
    }
    forceClose = true;
    mainWindow.close();
    return;
  }
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Save changes?",
    message: `Save changes to ${documentState.displayName}?`,
    detail: "Unsaved editing changes will be lost if you close now.",
    buttons: ["Save", "Discard", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice.response === 0) {
    mainWindow.pendingCloseAfterSave = true;
    sendCommand("save");
  } else if (choice.response === 1) {
    if (quitRequested) beginShutdown();
    else {
      forceClose = true;
      mainWindow.close();
    }
  }
}

async function beginShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  quitRequested = true;
  forceClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  await stopBackend();
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingOpenPaths.push(...applicationArgs(process.argv));
  app.on("second-instance", (_event, argv) => {
    pendingOpenPaths.push(...applicationArgs(argv));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      dispatchPendingOpenPaths();
    }
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (!isProjectPath(filePath)) return;
    pendingOpenPaths.push(filePath);
    if (mainWindow) dispatchPendingOpenPaths();
  });
  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    quitRequested = true;
    if (mainWindow && !mainWindow.isDestroyed()) requestClose();
    else beginShutdown();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") beginShutdown();
  });
  app.on("activate", () => {
    if (backend && !mainWindow) createWindow();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    loadRenderingPreference();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    try {
      await startBackend();
      const activeBackend = backend;
      session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${activeBackend.url}/*`] }, (details, callback) => {
        details.requestHeaders["X-HDR-Finisher-Token"] = activeBackend.authoringSecret;
        callback({ requestHeaders: details.requestHeaders });
      });
      registerIpc();
      buildMenu();
      await createWindow();
    } catch (error) {
      await dialog.showMessageBox({ type: "error", title: "HDR Finisher could not start", message: "HDR Finisher could not start its image-processing backend.", detail: error.message, buttons: ["Quit"] });
      beginShutdown();
    }
  });
}
