function windowChromeOptions(platform = process.platform) {
  return {
    frame: platform === "darwin",
    autoHideMenuBar: true,
    // macOS uses its native title bar, traffic lights, and full-screen behavior.
    roundedCorners: platform === "darwin",
  };
}

module.exports = { windowChromeOptions };
