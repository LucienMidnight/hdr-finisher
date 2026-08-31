function linuxSessionState({ env = process.env, ozonePlatform = "" } = {}) {
  const declared = String(env.XDG_SESSION_TYPE || "").trim().toLowerCase();
  const hasWaylandSocket = Boolean(String(env.WAYLAND_DISPLAY || "").trim());
  const requestedOzonePlatform = String(
    ozonePlatform || env.ELECTRON_OZONE_PLATFORM_HINT || env.OZONE_PLATFORM || "",
  ).trim().toLowerCase();
  const forcedX11 = requestedOzonePlatform === "x11";
  const sessionType = declared || (hasWaylandSocket ? "wayland" : "x11");
  return {
    sessionType,
    nativeWayland: sessionType === "wayland" && hasWaylandSocket && !forcedX11,
  };
}

function distributionChannel({ env = process.env, platform = process.platform, packaged = false } = {}) {
  if (env.FLATPAK_ID) return "flatpak";
  if (!packaged) return "development";
  return platform === "linux" ? "deb" : "standalone";
}

function updatesManagedByStore({ env = process.env } = {}) {
  return Boolean(env.FLATPAK_ID);
}

function serializeDisplay(display) {
  if (!display) return null;
  return {
    id: String(display.id),
    label: display.label || `Display ${display.id}`,
    colorSpace: display.colorSpace || "unknown",
    colorDepth: Number.isFinite(display.colorDepth) ? display.colorDepth : null,
    depthPerComponent: Number.isFinite(display.depthPerComponent) ? display.depthPerComponent : null,
    scaleFactor: Number.isFinite(display.scaleFactor) ? display.scaleFactor : 1,
    internal: Boolean(display.internal),
    monochrome: Boolean(display.monochrome),
    bounds: display.bounds ? { ...display.bounds } : null,
    workArea: display.workArea ? { ...display.workArea } : null,
  };
}

module.exports = { distributionChannel, linuxSessionState, serializeDisplay, updatesManagedByStore };
