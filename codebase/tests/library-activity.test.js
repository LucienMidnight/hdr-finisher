const assert = require("node:assert/strict"), { test } = require("node:test");
const { summary, writerText, indexText } = require("../frontend/library-activity.js");
const rest = () => ({ writer: { waiting: 0, done: 0, total: 0, attention: [] }, index: { state: "idle" }, helper: {} });

test("remembered errors stay in Activity after workers finish; ignored errors stay quiet", () => {
  const {sceneWork}=require("../frontend/library-activity.js"), health=rest();
  health.picture_errors=[{path:"photo.png",revision:"1",reason:"Saved edits cannot be read",ignored:false}];
  const work=sceneWork(health,{sources:{failures:[{path:"photo.png",reason:"older message"}]}});
  assert.equal(work.failures.length,1); assert.equal(work.failures[0].revision,"1");
  assert.match(summary(health),/Needs attention: 1/);
  health.picture_errors[0].ignored=true;
  assert.equal(summary(health),"Activity"); assert.equal(sceneWork(health).failures.length,1);
});
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

test("requested folder checks show Grade wait while timed empty checks stay quiet", () => {
  const health = rest(); health.index.checks = { running: { requested: false, path: "Intake" }, requested: [] };
  assert.equal(summary(health), "Activity");
  health.index.checks.running.requested = true;
  assert.equal(summary(health), "Checking for new photos · Intake");
  health.index.checkWaiting = true;
  assert.equal(summary(health), "Checking folders waits while Grade is busy");
  health.index.checks.folders = [{ failure: "drive unplugged" }];
  assert.ok(summary(health).endsWith("Needs attention: 1"));
});

test("Library work names every active file and distinguishes waiting and stopping", () => {
  const {sceneWork}=require("../frontend/library-activity.js"), health=rest();
  health.helper.jobs=[{path:"C:/photos/one.dng",stage:"Correcting DNG distortion",state:"running"}];
  const work=sceneWork(health,{sources:{jobs:[{path:"C:/photos/two.jpg",stage:"Reading source",state:"waiting"},{path:"C:/photos/three.png",stage:"Drawing picture on GPU",state:"stopping"}]}});
  assert.equal(work.jobs.length,3); assert.match(work.text,/2 active.*1 waiting/);
  assert.match(work.lines.find(l=>l.includes("one.dng")),/one.dng.*Correcting DNG distortion/);
  assert.match(work.lines.find(l=>l.includes("two.jpg")),/two.jpg.*Waiting/);assert.match(work.lines.find(l=>l.includes("three.png")),/three.png.*Stopping after current step/);
  assert.deepEqual(sceneWork(rest()).lines,[]);
});
