const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allowedDocumentationUrl,
  allowedProjectUrl,
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  pathKey,
  safeSuggestedName,
} = require("../lib/validation");

test("Windows path keys are case-insensitive without changing POSIX identity", () => {
  assert.equal(pathKey("C:\\Mixed\\Project.hdrfinisher", "win32"), pathKey("c:\\mixed\\project.HDRFINISHER", "win32"));
  assert.notEqual(pathKey("/Mixed/Project.hdrfinisher", "linux"), pathKey("/mixed/project.hdrfinisher", "linux"));
});

test("project website allowlist rejects sibling repository prefixes", () => {
  assert.equal(allowedProjectUrl("https://github.com/LucienMidnight/hdr-finisher"), true);
  assert.equal(allowedProjectUrl("https://github.com/LucienMidnight/hdr-finisher/releases/tag/v0.7.3"), true);
  assert.equal(allowedProjectUrl("https://github.com/LucienMidnight/hdr-finisher-malicious"), false);
});

test("documentation allowlist permits bundled help sources but rejects arbitrary sites", () => {
  assert.equal(allowedDocumentationUrl("https://www.itu.int/rec/R-REC-BT.2100"), true);
  assert.equal(allowedDocumentationUrl("https://support.microsoft.com/en-us/windows/example"), true);
  assert.equal(allowedDocumentationUrl("https://example.com/fake-help"), false);
  assert.equal(allowedDocumentationUrl("http://www.itu.int/rec/R-REC-BT.2100"), false);
});
const { backendCommand, backendExecutableName, sourcePythonPath } = require("../lib/runtime");
const { UPDATE_CACHE_MAX_AGE_MS, cachedUpdateResult } = require("../lib/updates");
const { windowChromeOptions } = require("../lib/window-chrome");

test("update cache is discarded after an application upgrade", () => {
  const now = Date.now();
  const cache = {
    checkedAt: now - 1000,
    result: { status: "available", currentVersion: "0.7.3", latestVersion: "0.7.4" },
  };

  assert.equal(cachedUpdateResult(cache, "0.7.3", now), cache.result);
  assert.equal(cachedUpdateResult(cache, "0.7.4", now), null);
  assert.equal(cachedUpdateResult({ ...cache, checkedAt: now - UPDATE_CACHE_MAX_AGE_MS }, "0.7.3", now), null);
});

test("desktop chrome preserves macOS zoom support", () => {
  assert.deepEqual(windowChromeOptions("darwin"), {
    frame: false,
    autoHideMenuBar: true,
    roundedCorners: true,
  });
  assert.equal(windowChromeOptions("win32").roundedCorners, false);
  assert.equal(windowChromeOptions("linux").roundedCorners, false);
});

test("desktop path types are restricted to supported extensions", () => {
  assert.equal(isSourcePath("C:\\Images\\scene.EXR"), true);
  assert.equal(isSourcePath("C:\\Images\\script.exe"), false);
  assert.equal(isProjectPath("C:\\Projects\\grade.hdrfinisher"), true);
  assert.equal(isExportPath("C:\\Exports\\grade.avif"), true);
  assert.equal(isSourcePath("C:\\Photos\\camera.dng"), true);
  assert.equal(isSourcePath("C:\\Photos\\direct-hdr.jxl"), true);
  assert.equal(isExportPath("C:\\Exports\\grade.exe"), false);
});

test("suggested names cannot smuggle directories or reserved characters", () => {
  assert.equal(safeSuggestedName("..\\bad:name.hdrfinisher", "Untitled.hdrfinisher"), "bad_name.hdrfinisher");
  assert.equal(safeSuggestedName("", "Untitled.hdrfinisher"), "Untitled.hdrfinisher");
});

test("external proof URLs stay on the exact backend origin and proof route", () => {
  const origin = "http://127.0.0.1:49152";
  assert.equal(allowedProofUrl(`${origin}/proof/example`, origin), true);
  assert.equal(allowedProofUrl(`${origin}/api/session`, origin), false);
  assert.equal(allowedProofUrl("https://example.com/proof/example", origin), false);
});

test("desktop backend paths follow Windows, macOS, and Linux bundle conventions", () => {
  assert.equal(backendExecutableName("win32"), "HDR Finisher Backend.exe");
  assert.equal(backendExecutableName("darwin"), "HDR Finisher Backend");
  assert.equal(sourcePythonPath("C:\\app\\codebase", "win32"), "C:\\app\\codebase\\.venv\\Scripts\\python.exe");
  assert.equal(sourcePythonPath("/app/codebase", "darwin"), "/app/codebase/.venv/bin/python");
  assert.equal(sourcePythonPath("/app/codebase", "linux"), "/app/codebase/.venv/bin/python");

  const command = backendCommand({
    isPackaged: true,
    resourcesPath: "/HDR Finisher.app/Contents/Resources",
    desktopDirectory: "/unused/desktop",
    platform: "darwin",
    pid: 42,
  });
  assert.equal(command.executable, "/HDR Finisher.app/Contents/Resources/backend/HDR Finisher Backend");
  assert.deepEqual(command.args, ["--desktop-sidecar", "--parent-pid", "42"]);

  const linuxCommand = backendCommand({
    isPackaged: true,
    resourcesPath: "/opt/HDR Finisher/resources",
    desktopDirectory: "/unused/desktop",
    platform: "linux",
    pid: 44,
  });
  assert.equal(linuxCommand.executable, "/opt/HDR Finisher/resources/backend/HDR Finisher Backend");
  assert.deepEqual(linuxCommand.args, ["--desktop-sidecar", "--parent-pid", "44"]);

  const windowsCommand = backendCommand({
    isPackaged: true,
    resourcesPath: "C:\\Program Files\\HDR Finisher\\resources",
    desktopDirectory: "C:\\unused\\desktop",
    platform: "win32",
    pid: 43,
  });
  assert.equal(
    windowsCommand.executable,
    "C:\\Program Files\\HDR Finisher\\resources\\backend\\HDR Finisher Backend.exe",
  );
  assert.deepEqual(windowsCommand.args, ["--desktop-sidecar", "--parent-pid", "43"]);
});
