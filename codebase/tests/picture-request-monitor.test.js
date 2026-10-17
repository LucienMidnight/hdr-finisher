const test = require("node:test");
const assert = require("node:assert/strict");
const { installPictureRequestMonitor } = require("./support/picture-request-monitor.cjs");
function setup() {
  const responses = [];
  const target = { location: { href: "http://localhost/library" }, fetch: async () => ({
    json: () => new Promise((resolve, reject) => responses.push({ resolve, reject })),
  }) };
  const original = target.fetch;
  installPictureRequestMonitor({ folder: "D:/Photos/HDR Test Images", target });
  const request = (signal, path = "D:/Photos/HDR Test Images/sample.ARW") => target.fetch("/api/library/picture", {
    body: JSON.stringify({ path }), signal,
  });
  return { target, original, responses, request, monitor: target.__pictureRequestMonitor };
}
test("picture monitor counts bodies after headers and detects five live requests", async () => {
  const { request, responses, monitor, target, original } = setup();
  const bodies = [];
  for (let i = 0; i < 5; i++) bodies.push((await request()).json());
  assert.deepEqual(monitor.snapshot(), { active: 5, peak: 5, started: 5 });
  responses.forEach(response => response.resolve({}));
  await Promise.all(bodies);
  assert.equal(monitor.snapshot().active, 0);
  monitor.stop(); assert.equal(target.fetch, original);
});
test("four cancellations followed by replacements remain four despite delayed failures", async () => {
  const { request, responses, monitor } = setup();
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const oldBodies = [];
  for (const controller of controllers) oldBodies.push((await request(controller.signal)).json().catch(error => error.name));
  controllers.forEach(controller => controller.abort());
  assert.equal(monitor.snapshot().active, 0);
  const newBodies = [];
  for (let i = 0; i < 4; i++) newBodies.push((await request()).json());
  // Old transport failures arrive only after all four replacements start.
  responses.slice(0, 4).forEach(response => response.reject(new DOMException("Aborted", "AbortError")));
  await Promise.all(oldBodies);
  assert.deepEqual(monitor.snapshot(), { active: 4, peak: 4, started: 8 });
  responses.slice(4).forEach(response => response.resolve({}));
  await Promise.all(newBodies);
  assert.equal(monitor.snapshot().active, 0);
});
test("picture monitor excludes other folders and already-aborted work", async () => {
  const { request, monitor } = setup();
  await request(undefined, "D:/Photos/HDR Test Images-other/sample.ARW");
  const controller = new AbortController(); controller.abort();
  await request(controller.signal);
  assert.deepEqual(monitor.snapshot(), { active: 0, peak: 0, started: 0 });
});
