const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "frontend", "whole-image-preview-pipe.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const Pipe = context.window.HDRWholeImagePreviewPipe;

test("whole-image purposes cannot inherit a native Full edge", () => {
  for (const [purpose, cap] of Object.entries({ scopes: 1600, navigation: 512, maskOverview: 1600, coarseAnalysis: 960, fitPlaceholder: 1600 })) {
    assert.equal(Pipe.edgeFor(purpose, 9000), cap);
    assert.equal(Pipe.edgeFor(purpose, 384), Math.min(cap, 384));
  }
  assert.throws(() => Pipe.edgeFor("authoringROI", 9000), /Unknown whole-image purpose/);
});

test("whole-image requests declare their purpose and stay immutable", () => {
  const request = Pipe.request("navigation", 1200, { generation: 7, sourceIdentity: "photo-a" });
  assert.equal(request.longEdge, 512);
  assert.equal(request.pipe, "whole-image");
  assert.equal(request.generation, 7);
  assert.ok(Object.isFrozen(request));
  assert.equal(Pipe.request("navigation", 1200, { longEdge: 9000 }).longEdge, 512);
});
