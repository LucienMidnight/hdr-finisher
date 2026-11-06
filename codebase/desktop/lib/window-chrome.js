function windowChromeOptions(platform = process.platform) {
  return {
    frame: platform === "darwin",
    autoHideMenuBar: true,
    // Native traffic lights share the content toolbar on macOS.
    ...(platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    roundedCorners: platform === "darwin",
  };
}

module.exports = { windowChromeOptions };
