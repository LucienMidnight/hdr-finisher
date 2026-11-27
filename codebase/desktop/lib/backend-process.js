const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const PROOF_PREFIX = "hdr-proof-";
const OWNER_GRACE_MS = 5 * 60 * 1000;
const BACKEND_PID_FILE = "backend-pid";

function createProofScratch(tempRoot) {
  // Publish the desktop PID atomically with the directory, before another
  // instance can start scanning. Keep the backend PID too in case it outlives us.
  return fs.mkdtempSync(path.join(tempRoot, `${PROOF_PREFIX}${process.pid}-`));
}

function markProofBackend(root, pid) {
  if (pid) fs.writeFileSync(path.join(root, BACKEND_PID_FILE), String(pid));
}

function pidIsAlive(value) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Permission failures still mean another app may own this directory.
    return error.code !== "ESRCH";
  }
}

function clearProofScratch(root, maxRetries = 10) {
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries, retryDelay: 100 });
  } catch (error) {
    console.warn(`Proof scratch cleanup failed: ${error.message}`);
  }
}

function sweepProofScratch(tempRoot) {
  for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PROOF_PREFIX)) continue;
    const root = path.join(tempRoot, entry.name);
    const desktopPid = /^hdr-proof-(\d+)-/.exec(entry.name)?.[1];
    if (pidIsAlive(desktopPid)) continue;
    try {
      // Give legacy roots and newly abandoned roots time for native helpers
      // to exit. An old timestamp alone never overrides a live owner.
      if (Date.now() - fs.statSync(root).mtimeMs <= OWNER_GRACE_MS) continue;
      const marker = path.join(root, BACKEND_PID_FILE);
      if (fs.existsSync(marker) && pidIsAlive(fs.readFileSync(marker, "utf8"))) continue;
      // A native helper may still hold a file. Retry on a future launch.
      clearProofScratch(root, 0);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Proof scratch sweep failed: ${error.message}`);
    }
  }
}

function hasExited(child) {
  return !child.pid || child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), 3000);
    child.once("exit", onExit);
  });
}

async function stopBackendProcess(child) {
  if (hasExited(child)) return;
  if (process.platform === "win32") {
    // Killing Python first can orphan the encoders and leave scratch locked.
    try {
      await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
    } catch (error) {
      if (!hasExited(child)) {
        console.warn(`Backend process tree termination failed: ${error.message}`);
        child.kill();
      }
    }
  } else {
    // Desktop sidecars own a process group, including native encoders.
    try { process.kill(-child.pid, "SIGKILL"); }
    catch { child.kill(); }
  }
  if (await waitForExit(child)) return;
  child.kill("SIGKILL");
  if (!await waitForExit(child)) console.warn("Timed out waiting for the backend to exit.");
}

module.exports = { createProofScratch, markProofBackend, clearProofScratch, sweepProofScratch, stopBackendProcess };
