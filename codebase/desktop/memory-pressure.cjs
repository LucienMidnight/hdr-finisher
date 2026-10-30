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
// Decide when a measured pressure level trims caches. A rise trims at once;
// a level that lasts trims again only after the cool-down, as Chromium's own
// memory monitor does. "none" never trims. Returns the level to trim at, or null.
const RANK = {none: 0, moderate: 1, critical: 2};
const COOLDOWN_MS = 10000;
function pressureGate(cooldownMs = COOLDOWN_MS) {
  let lastLevel = 'none', lastAt = -Infinity;
  return function step(level, now = Date.now()) {
    const rank = RANK[level] ?? 0;
    if (!rank) return null;
    if (rank <= RANK[lastLevel] && now - lastAt < cooldownMs) return null;
    lastLevel = level; lastAt = now;
    return level;
  };
}
module.exports = {notifyChromiumPressure, pressureGate, COOLDOWN_MS};
