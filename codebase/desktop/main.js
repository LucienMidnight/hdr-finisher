const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {
  allowedDocumentationUrl,
  allowedProjectUrl,
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  pathKey,
  safeSuggestedName,
} = require("./lib/validation");
const { backendCommand: resolveBackendCommand } = require("./lib/runtime");
const { cachedUpdateResult } = require("./lib/updates");
const { DEFAULT_WINDOW_BOUNDS, clampWindowBounds } = require("./lib/window-bounds");

const APP_ID = "org.hdrfinisher.app";
const SOURCE_FILTERS = [
  { name: "HDR and camera images", extensions: ["exr", "tif", "tiff", "hdr", "pfm", "heic", "heif", "avif", "jxl", "png", "jpg", "jpeg", "dng", "arw", "cr2", "cr3", "nef", "nrw", "raf", "rw2", "orf", "ori", "pef", "srw"] },
  { name: "All files", extensions: ["*"] },
];
const PROJECT_FILTERS = [{ name: "HDR Finisher Project", extensions: ["hdrfinisher"] }];
const GRADING_PRESET_GROUPS = new Set([
  "hdr-tone", "hdr-highlights", "hdr-equalizer", "hdr-color", "hdr-zones",
  "sdr-base", "sdr-tone", "sdr-equalizer", "sdr-color", "sdr-zones",
  "hdr-curves", "sdr-curves", "hdr-color-grading", "sdr-color-grading",
  "hdr-film-look", "sdr-film-look", "hdr-vignette", "sdr-vignette",
  "hdr-denoise", "sdr-denoise",
]);

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
let applicationPreferences = null;
let updateCheckCache = null;
let pendingOpenPaths = [];
let rendererReady = false;
const knownProjectPaths = new Set();
const grantedExportPaths = new Set();

const DEFAULT_APPLICATION_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  defaultReferenceWhiteNits: 203,
  renderingMode: "auto",
  folders: { projectSave: "", projectImport: "", fileSave: "", fileImport: "", presetSave: "" },
  shortcuts: {},
  shortcutPresets: {},
  updates: { checkAutomatically: true, dismissedVersion: "" },
});

function applicationPreferencesPath() {
  return path.join(app.getPath("userData"), "application-preferences.json");
}

function updateCheckCachePath() {
  return path.join(app.getPath("userData"), "update-check-cache.json");
}

function cleanFolderPreferences(value) {
  return Object.fromEntries(["projectSave", "projectImport", "fileSave", "fileImport", "presetSave"].map((key) => {
    const candidate = typeof value?.[key] === "string" ? value[key] : "";
    return [key, candidate.length <= 4096 ? candidate : ""];
  }));
}

function cleanShortcutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([action, shortcut]) => (
    typeof action === "string" && action.length <= 240 && typeof shortcut === "string" && shortcut.length <= 100
  )).slice(0, 1000));
}

function sanitizeApplicationPreferences(value = {}) {
  const presets = value.shortcutPresets && typeof value.shortcutPresets === "object" && !Array.isArray(value.shortcutPresets)
    ? Object.fromEntries(Object.entries(value.shortcutPresets).filter(([name, shortcuts]) => (
      typeof name === "string" && name.trim() && name.length <= 80 && shortcuts && typeof shortcuts === "object"
    )).slice(0, 50).map(([name, shortcuts]) => [name, cleanShortcutMap(shortcuts)]))
    : {};
  return {
    schemaVersion: 1,
    defaultReferenceWhiteNits: Number(value.defaultReferenceWhiteNits) === 100 ? 100 : 203,
    renderingMode: ["auto", "gpu", "cpu"].includes(value.renderingMode) ? value.renderingMode : "auto",
    folders: cleanFolderPreferences(value.folders),
    shortcuts: cleanShortcutMap(value.shortcuts),
    shortcutPresets: presets,
    updates: {
      checkAutomatically: value.updates?.checkAutomatically !== false,
      dismissedVersion: typeof value.updates?.dismissedVersion === "string" && value.updates.dismissedVersion.length <= 40
        ? value.updates.dismissedVersion
        : "",
    },
  };
}

function persistApplicationPreferences() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const destination = applicationPreferencesPath();
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(applicationPreferences, null, 2));
  fs.renameSync(temporary, destination);
}

function loadApplicationPreferences() {
  try {
    applicationPreferences = sanitizeApplicationPreferences(JSON.parse(fs.readFileSync(applicationPreferencesPath(), "utf8")));
  } catch {
    applicationPreferences = sanitizeApplicationPreferences(DEFAULT_APPLICATION_PREFERENCES);
    try {
      const legacy = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "rendering-preferences.json"), "utf8"));
      if (["auto", "gpu", "cpu"].includes(legacy.renderingMode)) applicationPreferences.renderingMode = legacy.renderingMode;
    } catch {}
  }
  renderingMode = applicationPreferences.renderingMode;
}

function setRenderingMode(mode) {
  if (!["auto", "gpu", "cpu"].includes(mode)) return false;
  renderingMode = mode;
  applicationPreferences.renderingMode = mode;
  persistApplicationPreferences();
  buildMenu();
  sendCommand("rendering-mode", { mode });
  return true;
}

function directoryPreference(key, fallbackName) {
  return applicationPreferences?.folders?.[key] || app.getPath(fallbackName);
}

function ensurePresetLibrary(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(directory, "Keyboard Shortcuts"), { recursive: true });
  fs.mkdirSync(path.join(directory, "Grading"), { recursive: true });
  return directory;
}

function defaultPresetDirectory() {
  const candidates = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) candidates.push(path.join(path.resolve(process.env.PORTABLE_EXECUTABLE_DIR), "HDR Finisher Presets"));
  if (app.isPackaged && process.platform !== "darwin") candidates.push(path.join(path.dirname(app.getPath("exe")), "HDR Finisher Presets"));
  for (const candidate of candidates) {
    try {
      fs.accessSync(path.dirname(candidate), fs.constants.W_OK);
      ensurePresetLibrary(candidate);
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {}
  }
  return ensurePresetLibrary(path.join(app.getPath("userData"), "HDR Finisher Presets"));
}

function gradingPresetDirectory() {
  const library = ensurePresetLibrary(applicationPreferences?.folders?.presetSave || defaultPresetDirectory());
  return path.join(library, "Grading");
}

function cleanGradingPresetPayload(value) {
  const groupId = typeof value?.groupId === "string" ? value.groupId : "";
  const name = typeof value?.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  if (!GRADING_PRESET_GROUPS.has(groupId)) throw new Error("Unknown grading preset group.");
  if (!name || name.length > 80) throw new Error("Preset names must contain 1 to 80 characters.");
  if (!value.values || typeof value.values !== "object" || Array.isArray(value.values)) throw new Error("Invalid grading preset values.");
  const values = JSON.parse(JSON.stringify(value.values));
  if (JSON.stringify(values).length > 200000) throw new Error("The grading preset is too large.");
  return { groupId, name, values };
}

function gradingPresetFilename(groupId, name) {
  const slug = name.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "preset";
  const identity = crypto.createHash("sha256").update(`${groupId}\0${name.toLocaleLowerCase("en-US")}`).digest("hex").slice(0, 12);
  return `${groupId}--${slug}--${identity}.hdrf-grade.json`;
}

function listGradingPresets(groupId) {
  if (!GRADING_PRESET_GROUPS.has(groupId)) throw new Error("Unknown grading preset group.");
  const directory = gradingPresetDirectory();
  return fs.readdirSync(directory).filter((filename) => filename.endsWith(".hdrf-grade.json")).slice(0, 500).flatMap((filename) => {
    try {
      const source = fs.readFileSync(path.join(directory, filename), "utf8");
      if (source.length > 200000) return [];
      const preset = cleanGradingPresetPayload(JSON.parse(source));
      if (preset.groupId !== groupId) return [];
      return [{ id: filename, ...preset }];
    } catch {
      return [];
    }
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function saveGradingPreset(value) {
  const preset = cleanGradingPresetPayload(value);
  const directory = gradingPresetDirectory();
  const filename = gradingPresetFilename(preset.groupId, preset.name);
  const destination = path.join(directory, filename);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, ...preset }, null, 2));
  fs.renameSync(temporary, destination);
  return { id: filename, ...preset };
}

function deleteGradingPreset(presetId) {
  if (typeof presetId !== "string" || path.basename(presetId) !== presetId || !presetId.endsWith(".hdrf-grade.json")) {
    throw new Error("Invalid grading preset.");
  }
  fs.rmSync(path.join(gradingPresetDirectory(), presetId), { force: true });
  return true;
}

function semverParts(version) {
  const match = String(version || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const next = semverParts(candidate);
  const installed = semverParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

async function checkForUpdates({ force = false } = {}) {
  const now = Date.now();
  const currentVersion = app.getVersion();
  if (!updateCheckCache) {
    try {
      const cached = JSON.parse(fs.readFileSync(updateCheckCachePath(), "utf8"));
      if (Number.isFinite(cached.checkedAt) && cached.result && typeof cached.result === "object") updateCheckCache = cached;
    } catch {}
  }
  const cachedResult = cachedUpdateResult(updateCheckCache, currentVersion, now);
  if (!force && cachedResult) return cachedResult;
  const cacheResult = (result) => {
    updateCheckCache = { checkedAt: now, result };
    try { fs.writeFileSync(updateCheckCachePath(), JSON.stringify(updateCheckCache)); } catch {}
    return result;
  };
  try {
    const response = await fetch("https://api.github.com/repos/LucienMidnight/hdr-finisher/releases/latest", {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": `HDR-Finisher/${currentVersion}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const release = await response.json();
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    const releaseUrl = typeof release.html_url === "string" ? release.html_url : "";
    const parsedReleaseUrl = new URL(releaseUrl);
    if (!allowedProjectUrl(parsedReleaseUrl.toString())) {
      throw new Error("Unexpected release URL.");
    }
    const result = {
      status: isNewerVersion(latestVersion, currentVersion) ? "available" : "current",
      currentVersion,
      latestVersion,
      releaseName: typeof release.name === "string" ? release.name.slice(0, 160) : "",
      releaseUrl,
      checkedAt: new Date(now).toISOString(),
    };
    return cacheResult(result);
  } catch (error) {
    const result = { status: "unavailable", currentVersion, message: error?.message || "Update check failed.", checkedAt: new Date(now).toISOString() };
    return cacheResult(result);
  }
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
      const dirty = documentState.dirty;
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "HDR Finisher backend stopped",
        message: "The image-processing backend stopped unexpectedly.",
        detail: `${dirty ? "Unsaved edits are still visible; keep this window open while recording any values you need.\n\n" : ""}Exit code: ${code ?? "unknown"}\n\nLog: ${logPath}`,
        buttons: dirty ? ["Keep Window Open", "Open Logs", "Quit Without Saving"] : ["Open Logs", "Quit"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then(async ({ response }) => {
        if ((dirty && response === 1) || (!dirty && response === 0)) {
          shell.showItemInFolder(logPath);
          return;
        }
        if ((dirty && response === 2) || (!dirty && response === 1)) await beginShutdown();
      }).catch(() => {});
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

function existingFileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    if (!stat.isFile()) return null;
    return {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      size: stat.size.toString(),
      modifiedNs: stat.mtimeNs.toString(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
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
  handle("desktop:renderer-ready", async () => {
    rendererReady = true;
    await dispatchPendingOpenPaths();
    return true;
  });
  handle("desktop:get-preferences", () => applicationPreferences);
  handle("desktop:get-default-preset-directory", () => defaultPresetDirectory());
  handle("desktop:list-grading-presets", (groupId) => listGradingPresets(groupId));
  handle("desktop:save-grading-preset", (preset) => saveGradingPreset(preset));
  handle("desktop:delete-grading-preset", (presetId) => deleteGradingPreset(presetId));
  handle("desktop:set-preferences", (value) => {
    applicationPreferences = sanitizeApplicationPreferences(value);
    renderingMode = applicationPreferences.renderingMode;
    persistApplicationPreferences();
    buildMenu();
    return applicationPreferences;
  });
  handle("desktop:choose-preference-directory", async (key) => {
    if (!["projectSave", "projectImport", "fileSave", "fileImport", "presetSave"].includes(key)) throw new Error("Unknown folder preference.");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose default folder",
      defaultPath: applicationPreferences.folders[key] || (key === "presetSave" ? defaultPresetDirectory() : app.getPath(key.startsWith("project") ? "documents" : "pictures")),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    return key === "presetSave" ? ensurePresetLibrary(result.filePaths[0]) : result.filePaths[0];
  });
  handle("desktop:reveal-preference-directory", (key) => {
    if (key !== "presetSave") throw new Error("Only the preset library can be revealed from settings.");
    const directory = ensurePresetLibrary(applicationPreferences.folders.presetSave || defaultPresetDirectory());
    shell.showItemInFolder(directory);
    return directory;
  });
  handle("desktop:check-for-updates", (options) => checkForUpdates(options));
  handle("desktop:open-project-website", async (url) => {
    const target = new URL(String(url || "https://github.com/LucienMidnight/hdr-finisher"));
    if (!allowedProjectUrl(target.toString())) {
      throw new Error("Only the HDR Finisher GitHub project can be opened.");
    }
    await shell.openExternal(target.toString());
    return true;
  });
  handle("desktop:open-documentation", async (url) => {
    if (!allowedDocumentationUrl(url)) throw new Error("Only trusted HDR Finisher documentation links can be opened.");
    await shell.openExternal(url);
    return true;
  });
  handle("desktop:set-rendering-mode", (mode) => setRenderingMode(mode));
  handle("desktop:write-clipboard-text", (value) => {
    if (typeof value !== "string" || value.length > 32768) throw new Error("Invalid clipboard text.");
    clipboard.writeText(value);
    return true;
  });
  handle("desktop:open-source", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Import source image", defaultPath: directoryPreference("fileImport", "pictures"), properties: ["openFile"], filters: SOURCE_FILTERS });
    return result.canceled ? null : grantPath(result.filePaths[0], "source-open");
  });
  handle("desktop:grant-source-path", async (filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    if (!isSourcePath(resolved)) throw new Error("Select a supported source image.");
    return grantPath(resolved, "source-open");
  });
  handle("desktop:grant-project-path", async (filePath, intent) => {
    if (!["project-open", "project-save"].includes(intent)) throw new Error("Unknown project path intent.");
    let resolved = path.resolve(String(filePath || ""));
    if (intent === "project-save" && !isProjectPath(resolved)) resolved = `${resolved}.hdrfinisher`;
    if (!isProjectPath(resolved)) throw new Error("Select an HDR Finisher project file.");
    const exists = fs.existsSync(resolved);
    if (intent === "project-open" && !exists) throw new Error("Select an existing HDR Finisher project.");
    const selection = await grantPath(resolved, intent);
    knownProjectPaths.add(pathKey(selection.path || resolved));
    return { ...selection, exists };
  });
  handle("desktop:open-project", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Open project", defaultPath: directoryPreference("projectImport", "documents"), properties: ["openFile"], filters: PROJECT_FILTERS });
    if (result.canceled) return null;
    const selection = await grantPath(result.filePaths[0], "project-open");
    knownProjectPaths.add(pathKey(selection.path || result.filePaths[0]));
    return selection;
  });
  handle("desktop:relink-source", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: "Relink original source", properties: ["openFile"], filters: SOURCE_FILTERS });
    return result.canceled ? null : grantPath(result.filePaths[0], "source-relink");
  });
  handle("desktop:save-project", async (options = {}) => {
    const saveAs = Boolean(options.saveAs);
    if (!saveAs && documentState.path && knownProjectPaths.has(pathKey(documentState.path))) {
      return grantPath(documentState.path, "project-save");
    }
    const suggested = safeSuggestedName(options.suggestedName, "Untitled.hdrfinisher");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: saveAs ? "Save Project As" : "Save Project",
      defaultPath: documentState.path || path.join(directoryPreference("projectSave", "documents"), suggested),
      filters: PROJECT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    const projectPath = isProjectPath(result.filePath) ? result.filePath : `${result.filePath}.hdrfinisher`;
    const selection = await grantPath(projectPath, "project-save");
    knownProjectPaths.add(pathKey(selection.path || projectPath));
    return selection;
  });
  handle("desktop:confirm-unsaved-transition", async (options = {}) => {
    if (!documentState.dirty) return "discard";
    const actionLabel = typeof options.actionLabel === "string" && options.actionLabel.length <= 80
      ? options.actionLabel
      : "continue";
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Save changes?",
      message: `Save changes to ${documentState.displayName}?`,
      detail: `Unsaved editing changes will be lost if you ${actionLabel}.`,
      buttons: ["Save", "Discard", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return ["save", "discard", "cancel"][choice.response] || "cancel";
  });
  handle("desktop:choose-export-directory", async (initialPath) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose export folder",
      defaultPath: typeof initialPath === "string" && initialPath ? initialPath : directoryPreference("fileSave", "pictures"),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("desktop:choose-export-path", async (options = {}) => {
    const extension = typeof options.extension === "string" ? options.extension.replace(/^\./, "") : "jpg";
    const suggested = safeSuggestedName(options.suggestedName, `hdr_finisher_export.${extension}`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export finished image",
      defaultPath: path.join(typeof options.directory === "string" && options.directory ? options.directory : directoryPreference("fileSave", "pictures"), suggested),
      filters: [{ name: typeof options.formatName === "string" ? options.formatName : "Finished image", extensions: [extension] }],
    });
    if (result.canceled || !result.filePath || !isExportPath(result.filePath)) return null;
    const resolved = path.resolve(result.filePath);
    const selection = await grantPath(resolved, "export-file");
    grantedExportPaths.add(pathKey(selection.path || resolved));
    // A returned native Windows or macOS Save dialog has already obtained
    // overwrite approval when this target exists. Bind that approval to the
    // exact file identity so a later replacement still requires a fresh
    // confirmation.
    const nativeOverwriteApproved = process.platform === "win32" || process.platform === "darwin";
    return { ...selection, overwriteTarget: nativeOverwriteApproved ? existingFileIdentity(resolved) : null };
  });
  handle("desktop:resolve-dropped-files", async (paths) => {
    if (!Array.isArray(paths) || paths.length > 16) throw new Error("Invalid dropped-file request.");
    const results = [];
    for (const filePath of paths) {
      if (isProjectPath(filePath)) {
        const selection = await grantPath(filePath, "project-open");
        knownProjectPaths.add(pathKey(selection.path || filePath));
        results.push({ kind: "project", ...selection });
      } else if (isSourcePath(filePath)) {
        results.push({ kind: "source", ...(await grantPath(filePath, "source-open")) });
      }
    }
    return results;
  });
  handle("desktop:reveal-path", async (filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    if (!grantedExportPaths.has(pathKey(resolved))) throw new Error("Only exports created in this run can be revealed.");
    shell.showItemInFolder(resolved);
    return true;
  });
  handle("desktop:open-path", async (filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    if (!grantedExportPaths.has(pathKey(resolved))) throw new Error("Only exports created in this run can be opened.");
    return shell.openPath(resolved);
  });
  handle("desktop:open-proof", async (url) => {
    if (!allowedProofUrl(url, backend.url)) throw new Error("Only local read-only proof URLs can be opened.");
    await shell.openExternal(url);
    return true;
  });
  handle("desktop:set-document-state", (next = {}) => {
    const nextPath = typeof next.path === "string" ? next.path : "";
    if (nextPath && !knownProjectPaths.has(pathKey(nextPath))) throw new Error("Unknown project path.");
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
        { label: "Import Source…", click: () => sendCommand("open-source") },
        { label: "Open Project…", click: () => sendCommand("open-project") },
        { type: "separator" },
        { label: "Save", enabled: hasDocument, click: () => sendCommand("save") },
        { label: "Save As…", enabled: hasDocument, click: () => sendCommand("save-as") },
        { type: "separator" },
        { label: "Export…", enabled: hasDocument, click: () => sendCommand("export") },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", enabled: hasDocument, click: () => sendCommand("undo") },
        { label: "Redo", enabled: hasDocument, click: () => sendCommand("redo") },
        { type: "separator" },
        { label: "Settings…", click: () => sendCommand("settings") },
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
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] },
    {
      label: "Help",
      submenu: [
        { label: "HDR Finisher Help", click: () => sendCommand("help") },
        { label: "Check for Updates…", click: () => sendCommand("check-updates") },
        { type: "separator" },
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
  rendererReady = false;
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
  mainWindow.on("query-session-end", (event) => {
    saveWindowBounds();
    if (!documentState.dirty) return;
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Save changes before signing out",
      message: `HDR Finisher prevented Windows from closing ${documentState.displayName}.`,
      detail: "Save or discard the document, then retry shutdown, restart, or sign out.",
      buttons: ["OK"],
      noLink: true,
    }).catch(() => {});
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (!shuttingDown) forceClose = false;
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  await mainWindow.loadURL(backend.url);
  updateWindowDocumentState();
}

async function dispatchPendingOpenPaths() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const paths = pendingOpenPaths;
  pendingOpenPaths = [];
  for (const filePath of paths) {
    if (!isProjectPath(filePath)) continue;
    try {
      const selection = await grantPath(filePath, "project-open");
      knownProjectPaths.add(pathKey(selection.path || filePath));
      app.addRecentDocument(selection.path || path.resolve(filePath));
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
      if (rendererReady) dispatchPendingOpenPaths();
    }
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    if (!isProjectPath(filePath)) return;
    pendingOpenPaths.push(filePath);
    if (mainWindow && rendererReady) dispatchPendingOpenPaths();
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
    loadApplicationPreferences();
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
