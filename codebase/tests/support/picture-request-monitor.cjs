// Test-only observer: installation runs inside the Library frame.
function installPictureRequestMonitor({ folder, target = window }) {
  const original = target.fetch;
  const prefix = folder.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const counts = { active: 0, peak: 0, started: 0 };
  target.fetch = async function(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, target.location.href);
    const body = url.pathname === "/api/library/picture" ? JSON.parse(options.body || "{}") : {};
    if (!String(body.path || "").replace(/\\/g, "/").startsWith(prefix) || options.signal?.aborted) {
      return original.call(this, input, options);
    }
    counts.started++;
    counts.peak = Math.max(counts.peak, ++counts.active);
    let pending = true;
    const finish = () => {
      if (!pending) return;
      pending = false; counts.active--;
      options.signal?.removeEventListener("abort", finish);
    };
    // Abort retires this work immediately; transport notifications may lag it.
    options.signal?.addEventListener("abort", finish, { once: true });
    try {
      const response = await original.call(this, input, options);
      const json = response.json.bind(response);
      // Fetch resolving only means headers arrived. Keep counting the body.
      response.json = async () => { try { return await json(); } finally { finish(); } };
      return response;
    } catch (error) { finish(); throw error; }
  };
  target.__pictureRequestMonitor = {
    snapshot: () => ({ ...counts }),
    stop: () => { target.fetch = original; },
  };
}
module.exports = { installPictureRequestMonitor };
