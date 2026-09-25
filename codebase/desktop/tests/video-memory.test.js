const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  activeAdapter, windowsDedicatedBytes, linuxDedicatedBytes, detectVideoMemory,
} = require("../lib/video-memory");

const KEY = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const MEMORY = `
${KEY}\\0000
    HardwareInformation.qwMemorySize    REG_QWORD    0x20000000

${KEY}\\0001
    HardwareInformation.qwMemorySize    REG_QWORD    0x2ffa00000

End of search: 2 match(es) found.
`;
const DEVICES = `
${KEY}\\0000
    MatchingDeviceId    REG_SZ    PCI\\VEN_1002&DEV_164E&SUBSYS_88771043&REV_C6

${KEY}\\0001
    MatchingDeviceId    REG_SZ    pci\\ven_10de&dev_2782

End of search: 2 match(es) found.
`;
const GPU_INFO = {
  gpuDevice: [
    { active: true, vendorId: 4318, deviceId: 10114, deviceString: "NVIDIA GeForce RTX 4070 Ti" },
    { active: false, vendorId: 4098, deviceId: 5710, deviceString: "AMD Radeon(TM) Graphics" },
  ],
};

test("the active adapter is identified by PCI vendor and device id", () => {
  assert.deepEqual(activeAdapter(GPU_INFO), { vendorId: "10de", deviceId: "2782", name: "NVIDIA GeForce RTX 4070 Ti" });
  assert.equal(activeAdapter({ gpuDevice: [] }), null);
});

test("Windows reads the active card's 64-bit dedicated memory, not another adapter's", () => {
  assert.equal(windowsDedicatedBytes(MEMORY, DEVICES, activeAdapter(GPU_INFO)), 12878610432);
  const integrated = { vendorId: "1002", deviceId: "164e", name: "AMD" };
  assert.equal(windowsDedicatedBytes(MEMORY, DEVICES, integrated), 536870912);
  assert.equal(windowsDedicatedBytes(MEMORY, DEVICES, { vendorId: "8086", deviceId: "0001" }), null);
  assert.equal(windowsDedicatedBytes("", "", activeAdapter(GPU_INFO)), null);
});

test("detection reports the card, and anything unreadable is not detected", async () => {
  const app = { getGPUInfo: async () => GPU_INFO };
  const run = (command, args, options, callback) => callback(null, args.includes("MatchingDeviceId") ? DEVICES : MEMORY);
  assert.deepEqual(await detectVideoMemory({ app, platform: "win32", run }), {
    detected: true, bytes: 12878610432, device: "NVIDIA GeForce RTX 4070 Ti", source: "windows-display-driver",
  });
  const failing = (command, args, options, callback) => callback(new Error("denied"), "");
  assert.equal((await detectVideoMemory({ app, platform: "win32", run: failing })).detected, false);
  assert.equal((await detectVideoMemory({ app, platform: "darwin", run })).detected, false);
  assert.equal((await detectVideoMemory({ app: { getGPUInfo: async () => { throw new Error("no gpu"); } }, platform: "win32", run })).detected, false);
});

test("Linux reads amdgpu's VRAM total for the matching card", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drm-"));
  const card = path.join(root, "card1", "device");
  fs.mkdirSync(card, { recursive: true });
  fs.writeFileSync(path.join(card, "vendor"), "0x1002\n");
  fs.writeFileSync(path.join(card, "device"), "0x744c\n");
  fs.writeFileSync(path.join(card, "mem_info_vram_total"), "25753026560\n");
  assert.equal(linuxDedicatedBytes({ vendorId: "1002", deviceId: "744c" }, root), 25753026560);
  assert.equal(linuxDedicatedBytes({ vendorId: "10de", deviceId: "2782" }, root), null);
});
