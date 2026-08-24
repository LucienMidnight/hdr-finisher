const UPDATE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cachedUpdateResult(cache, currentVersion, now = Date.now()) {
  if (!cache || !Number.isFinite(cache.checkedAt) || !cache.result || typeof cache.result !== "object") return null;
  if (now - cache.checkedAt >= UPDATE_CACHE_MAX_AGE_MS) return null;
  if (cache.result.currentVersion !== currentVersion) return null;
  return cache.result;
}

module.exports = { UPDATE_CACHE_MAX_AGE_MS, cachedUpdateResult };
