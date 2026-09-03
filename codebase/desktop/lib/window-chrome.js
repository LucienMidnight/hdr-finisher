function windowChromeOptions(platform = process.platform) {
  return {
    frame: false,
    autoHideMenuBar: true,
    // Frameless square-corner windows cannot complete macOS zoom/full-screen transitions.
    roundedCorners: platform === "darwin",
  };
}

module.exports = { windowChromeOptions };
