// Forward the app's measured pressure to Chromium's native memory owners.
async function notifyChromiumPressure(contents, level) {
  const transport = contents.debugger;
  const owned = !transport.isAttached();
  try {
    if (owned) transport.attach('1.3');
    await transport.sendCommand('Memory.simulatePressureNotification', {level});
  } finally {
    if (owned && transport.isAttached()) transport.detach();
  }
}
module.exports = {notifyChromiumPressure};
