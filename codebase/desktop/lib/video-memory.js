/**
 * Dedicated video memory of the active graphics adapter.
 *
 * WebGPU does not report VRAM, and Electron's GPU info names the adapter but
 * not its memory. The preview's Auto memory budget (Preview Responsiveness
 * Tuning Sprint P2, owner decision Q2) uses half of the card's dedicated
 * memory, so the desktop shell reads it where the platform records it:
 *
 *   Windows  the display-class registry key the driver writes
 *            (HardwareInformation.qwMemorySize, a 64-bit byte count), matched
 *            to the active adapter by PCI vendor and device id.
 *   Linux    amdgpu's sysfs `mem_info_vram_total`, matched by vendor/device.
 *
 * Anything else, or any failure, is "not detected": the renderer then keeps
 * its stated 2 GiB fallback. Nothing here guesses.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DISPLAY_CLASS_KEY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

function hex4(value) {
  return (Number(value) >>> 0).toString(16).padStart(4, "0").slice(-4);
}

/** The active adapter from `app.getGPUInfo("basic")`, or null. */
function activeAdapter(gpuInfo) {
  const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
  const device = devices.find((entry) => entry.active) || devices[0];
  if (!device || !Number.isFinite(Number(device.vendorId)) || !Number.isFinite(Number(device.deviceId))) return null;
  return {
    vendorId: hex4(device.vendorId),
    deviceId: hex4(device.deviceId),
    name: device.deviceString || null,
  };
}

/** Group `reg query /s /v <value>` output by subkey: { subkey: rawValue }. */
function parseRegQuery(output) {
  const values = {};
  let key = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      key = line.trim();
      continue;
    }
    const match = /^\s+(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line);
    if (key && match) values[key] = { type: match[2], value: match[3].trim() };
  }
  return values;
}

/**
 * Dedicated bytes of the adapter whose MatchingDeviceId names this vendor and
 * device, from the two reg query outputs. Largest wins if several match.
 */
function windowsDedicatedBytes(memoryOutput, deviceOutput, adapter) {
  if (!adapter) return null;
  const memories = parseRegQuery(memoryOutput);
  const devices = parseRegQuery(deviceOutput);
  const needle = `ven_${adapter.vendorId}&dev_${adapter.deviceId}`;
  let best = null;
  for (const [key, device] of Object.entries(devices)) {
    if (!String(device.value).toLowerCase().includes(needle)) continue;
    const memory = memories[key];
    if (!memory) continue;
    const bytes = memory.type === "REG_QWORD" || /^0x/i.test(memory.value)
      ? Number(BigInt(memory.value))
      : Number(memory.value);
    if (Number.isFinite(bytes) && bytes > 0 && (best === null || bytes > best)) best = bytes;
  }
  return best;
}

function regQuery(valueName, run = execFile) {
  return new Promise((resolve) => {
    run("reg", ["query", DISPLAY_CLASS_KEY, "/s", "/v", valueName], { windowsHide: true, timeout: 5000 },
      (error, stdout) => resolve(error ? "" : String(stdout || "")));
  });
}

function linuxDedicatedBytes(adapter, root = "/sys/class/drm") {
  if (!adapter) return null;
  let best = null;
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return null; }
  for (const entry of entries) {
    if (!/^card\d+$/.test(entry)) continue;
    const device = path.join(root, entry, "device");
    try {
      const vendor = fs.readFileSync(path.join(device, "vendor"), "utf8").trim().toLowerCase();
      const id = fs.readFileSync(path.join(device, "device"), "utf8").trim().toLowerCase();
      if (vendor !== `0x${adapter.vendorId}` || id !== `0x${adapter.deviceId}`) continue;
      const bytes = Number(fs.readFileSync(path.join(device, "mem_info_vram_total"), "utf8").trim());
      if (Number.isFinite(bytes) && bytes > 0 && (best === null || bytes > best)) best = bytes;
    } catch { /* not an amdgpu device, or not readable */ }
  }
  return best;
}

/**
 * { detected, bytes, device, source } for the active adapter. Never throws;
 * a platform or adapter it cannot read reports `detected: false`.
 */
async function detectVideoMemory({ app, platform = process.platform, run = execFile } = {}) {
  try {
    const adapter = activeAdapter(await app.getGPUInfo("basic"));
    let bytes = null;
    let source = null;
    if (platform === "win32") {
      const [memory, devices] = await Promise.all([
        regQuery("HardwareInformation.qwMemorySize", run),
        regQuery("MatchingDeviceId", run),
      ]);
      bytes = windowsDedicatedBytes(memory, devices, adapter);
      source = "windows-display-driver";
    } else if (platform === "linux") {
      bytes = linuxDedicatedBytes(adapter);
      source = "linux-drm-sysfs";
    }
    return bytes
      ? { detected: true, bytes, device: adapter?.name || null, source }
      : { detected: false, bytes: null, device: adapter?.name || null, source: null };
  } catch {
    return { detected: false, bytes: null, device: null, source: null };
  }
}

module.exports = { activeAdapter, parseRegQuery, windowsDedicatedBytes, linuxDedicatedBytes, detectVideoMemory };
