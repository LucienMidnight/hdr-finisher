const assert = require("node:assert/strict"), { test } = require("node:test");
const { summary, writerText, indexText } = require("../frontend/library-activity.js");
const rest = () => ({ writer: { waiting: 0, done: 0, total: 0, attention: [] }, index: { state: "idle" }, helper: {} });
test("Activity is quiet at rest; writer takes priority and counts other jobs", () => {
  const health = rest(); assert.equal(summary(health), "Activity");
  Object.assign(health.writer, { waiting: 688, done: 312, total: 1000 });
  health.index = { state: "indexing", done: 10, total: 20, folder: "Photos" };
  assert.equal(summary(health), "Writing settings: 312 of 1,000 +1");
  health.writer.attention = [{ count: 4 }];
  assert.ok(summary(health).endsWith("Needs attention: 4"));
});
test("pause, Grade wait and failed indexing are distinct", () => {
  assert.equal(writerText({ waiting: 2, paused: true }), "Writing settings paused · 2 waiting");
  assert.equal(writerText({ waiting: 2, busy: true }), "Writing settings waits while Grade is busy · 2 waiting");
  assert.equal(indexText({ state: "failed" }), "Indexing stopped · Re-scan to try again");
  const health = rest(); health.helper.failure = "pipe closed";
  assert.equal(summary(health), "Activity · Needs attention");
});
test("retrying indexing and conflict copies remain visible in Activity", () => {
  const health = rest();
  health.index.state = "retrying";
  assert.equal(summary(health), "Indexing is waiting to try again · Needs attention");
  health.conflicts = [{ files: ["photo.png.hdrf", "conflicted.hdrf"] }];
  assert.equal(summary(health), "Indexing is waiting to try again · Needs attention: 1");
  health.index.state = "idle"; health.conflicts = [];
  health.helper.recovering = true;
  assert.equal(summary(health), "Activity · Needs attention");
});
