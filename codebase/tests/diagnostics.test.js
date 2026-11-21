const assert = require("node:assert/strict");
const test = require("node:test");
const { create, ACTION_HEADER } = require("../frontend/diagnostics");
const eventLog = require("../desktop/lib/event-log");

test("concurrent actions carry separate ids and preserve request headers", () => {
  const events = [];
  let id = 0, now = 100;
  const diagnostics = create({ send: event => events.push(event), newId: () => `id-${++id}`, now: () => now });
  const photo = { id: "frame", name: "photo.ARW" };
  const first = diagnostics.start("denoise", "change_method", photo);
  const second = diagnostics.start("grade", "zoom");
  const headers = diagnostics.headers(first, { "Content-Type": "application/json" });
  assert.equal(headers.get(ACTION_HEADER), first.id);
  assert.equal(headers.get("Content-Type"), "application/json");
  now += 45;
  diagnostics.event("gpu", "grain_route", { route: "gpu" }, second);
  first.finish("done");
  first.finish("duplicate");
  assert.deepEqual(events.map(event => event.action), [first.id, second.id, second.id, first.id]);
  assert.deepEqual(events.map(event => event.seq), [1, 2, 3, 4]);
  assert.deepEqual(events[3].photo, photo);
  assert.equal(events[3].duration_ms, 45);
});

test("main accepts structured IPC records, bounds and collapses repeats, preserves Library lines", () => {
  const lines = [];
  const sink = eventLog.create(line => lines.push(line));
  const input = { area: "gpu", event: "grain_refused", level: "warn", action: "id-1", seq: 1, time: 1,
    photo: { name: "a.ARW" }, request_body: "private", details: { password: "private" } };
  assert.ok(sink.ingest(input, "renderer_main", 42));
  assert.equal(lines.length, 1, "first decision reaches main immediately");
  sink.ingest({ ...input, time: 2, seq: 2 }, "renderer_main", 42);
  sink.ingest({ ...input, time: 3, seq: 3 }, "renderer_main", 42);
  assert.equal(lines.length, 1);
  const legacy = '[library] denoise_grain_prepared {"time":3}';
  sink.backend(legacy, 90);
  sink.backend(JSON.stringify({ ...input, proc: "backend" }), 90);
  assert.equal(lines.length, 4);
  assert.deepEqual(JSON.parse(lines[0]).details, {});
  assert.equal(JSON.parse(lines[0]).pid, 42);
  assert.equal(JSON.parse(lines[1]).repeat_count, 2);
  assert.equal(JSON.parse(lines[1]).seq, 3);
  assert.equal(lines[2], legacy);
  assert.equal(JSON.parse(lines[3]).proc, "backend");
  assert.ok(!lines.join("").includes("private"));
  assert.equal(sink.ingest({ ...input, oversized: Array(16).fill("a".repeat(999)) }, "renderer_main", 42), false);
  sink.flush();
});
