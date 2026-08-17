const path = require("node:path");

function backendExecutableName(platform = process.platform) {
  return platform === "win32" ? "HDR Finisher Backend.exe" : "HDR Finisher Backend";
}

function sourcePythonPath(codebase, platform = process.platform) {
  return platform === "win32"
    ? path.join(codebase, ".venv", "Scripts", "python.exe")
    : path.join(codebase, ".venv", "bin", "python");
}

function backendCommand({
  isPackaged,
  resourcesPath,
  desktopDirectory,
  platform = process.platform,
  pid = process.pid,
  pythonOverride = process.env.HDR_FINISHER_PYTHON,
}) {
  if (isPackaged) {
    const backendDirectory = path.join(resourcesPath, "backend");
    return {
      executable: path.join(backendDirectory, backendExecutableName(platform)),
      args: ["--desktop-sidecar", "--parent-pid", String(pid)],
      cwd: backendDirectory,
    };
  }

  const codebase = path.resolve(desktopDirectory, "..");
  return {
    executable: pythonOverride || sourcePythonPath(codebase, platform),
    args: [path.join(codebase, "run_app.py"), "--desktop-sidecar", "--parent-pid", String(pid)],
    cwd: codebase,
  };
}

module.exports = { backendCommand, backendExecutableName, sourcePythonPath };
