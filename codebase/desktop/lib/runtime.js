const path = require("node:path");

function backendExecutableName(platform = process.platform) {
  return platform === "win32" ? "HDR Finisher Backend.exe" : "HDR Finisher Backend";
}

function sourcePythonPath(codebase, platform = process.platform) {
  return platform === "win32"
    ? path.win32.join(codebase, ".venv", "Scripts", "python.exe")
    : path.posix.join(codebase, ".venv", "bin", "python");
}

function backendCommand({
  isPackaged,
  resourcesPath,
  desktopDirectory,
  platform = process.platform,
  pid = process.pid,
  pythonOverride = process.env.HDR_FINISHER_PYTHON,
}) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (isPackaged) {
    const backendDirectory = platformPath.join(resourcesPath, "backend");
    return {
      executable: platformPath.join(backendDirectory, backendExecutableName(platform)),
      args: ["--desktop-sidecar", "--parent-pid", String(pid)],
      cwd: backendDirectory,
    };
  }

  const codebase = platformPath.resolve(desktopDirectory, "..");
  return {
    executable: pythonOverride || sourcePythonPath(codebase, platform),
    args: [platformPath.join(codebase, "run_app.py"), "--desktop-sidecar", "--parent-pid", String(pid)],
    cwd: codebase,
  };
}

module.exports = { backendCommand, backendExecutableName, sourcePythonPath };
