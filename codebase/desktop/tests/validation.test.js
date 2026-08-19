const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  safeSuggestedName,
} = require("../lib/validation");
const { backendCommand, backendExecutableName, sourcePythonPath } = require("../lib/runtime");

test("desktop path types are restricted to supported extensions", () => {
  assert.equal(isSourcePath("C:\\Images\\scene.EXR"), true);
  assert.equal(isSourcePath("C:\\Images\\script.exe"), false);
  assert.equal(isProjectPath("C:\\Projects\\grade.hdrfinisher"), true);
  assert.equal(isExportPath("C:\\Exports\\grade.avif"), true);
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

test("desktop backend paths follow Windows and macOS bundle conventions", () => {
  assert.equal(backendExecutableName("win32"), "HDR Finisher Backend.exe");
  assert.equal(backendExecutableName("darwin"), "HDR Finisher Backend");
  assert.equal(sourcePythonPath("C:\\app\\codebase", "win32"), "C:\\app\\codebase\\.venv\\Scripts\\python.exe");
  assert.equal(sourcePythonPath("/app/codebase", "darwin"), "/app/codebase/.venv/bin/python");

  const command = backendCommand({
    isPackaged: true,
    resourcesPath: "/HDR Finisher.app/Contents/Resources",
    desktopDirectory: "/unused/desktop",
    platform: "darwin",
    pid: 42,
  });
  assert.equal(command.executable, "/HDR Finisher.app/Contents/Resources/backend/HDR Finisher Backend");
  assert.deepEqual(command.args, ["--desktop-sidecar", "--parent-pid", "42"]);

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
