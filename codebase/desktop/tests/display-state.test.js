const assert = require("node:assert/strict");
const test = require("node:test");
const { distributionChannel, linuxSessionState, serializeDisplay, updatesManagedByStore } = require("../lib/display-state");

test("native Wayland requires a Wayland session and socket", () => {
  assert.deepEqual(linuxSessionState({ env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" } }), {
    sessionType: "wayland",
    nativeWayland: true,
  });
  assert.equal(linuxSessionState({ env: { XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" } }).nativeWayland, false);
  assert.equal(linuxSessionState({ env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }, ozonePlatform: "x11" }).nativeWayland, false);
  assert.equal(linuxSessionState({ env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0", ELECTRON_OZONE_PLATFORM_HINT: "x11" } }).nativeWayland, false);
});

test("distribution channel distinguishes Flatpak, deb, and development", () => {
  assert.equal(distributionChannel({ env: { FLATPAK_ID: "io.github.LucienMidnight.hdr-finisher" }, platform: "linux", packaged: true }), "flatpak");
  assert.equal(distributionChannel({ env: {}, platform: "linux", packaged: true }), "deb");
  assert.equal(distributionChannel({ env: {}, platform: "linux", packaged: false }), "development");
  assert.equal(updatesManagedByStore({ env: { FLATPAK_ID: "io.github.LucienMidnight.hdr-finisher" } }), true);
  assert.equal(updatesManagedByStore({ env: {} }), false);
});

test("display state exposes color metadata without inventing luminance", () => {
  const value = serializeDisplay({
    id: 7,
    label: "HDR panel",
    colorSpace: "hdr10",
    colorDepth: 30,
    depthPerComponent: 10,
    scaleFactor: 1.5,
    internal: false,
    monochrome: false,
    bounds: { x: 0, y: 0, width: 3840, height: 2160 },
    workArea: { x: 0, y: 0, width: 3840, height: 2100 },
  });
  assert.equal(value.id, "7");
  assert.equal(value.depthPerComponent, 10);
  assert.equal("peakNits" in value, false);
});
