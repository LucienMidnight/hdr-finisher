const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  safeSuggestedName,
} = require("../lib/validation");

test("desktop path types are restricted to supported extensions", () => {
  assert.equal(isSourcePath("C:\\Images\\scene.EXR"), true);
  assert.equal(isSourcePath("C:\\Images\\script.exe"), false);
  assert.equal(isProjectPath("C:\\Projects\\grade.hdrfinisher"), true);
  assert.equal(isExportPath("C:\\Exports\\grade.avif"), true);
  assert.equal(isExportPath("C:\\Exports\\grade.exe"), false);
});

test("suggested names cannot smuggle directories or reserved characters", () => {
  assert.equal(safeSuggestedName("..\\bad:name.hdrfinisher", "Untitled.hdrfinisher"), "bad_name.hdrfinisher");
  assert.equal(safeSuggestedName("", "Untitled.hdrfinisher"), "Untitled.hdrfinisher");
});

test("external proof URLs stay on the exact backend origin and proof route", () => {
  const origin = "http://127.0.0.1:49152";
  assert.equal(allowedProofUrl(`${origin}/proof/example`, origin), true);
  assert.equal(allowedProofUrl(`${origin}/api/session`, origin), false);
  assert.equal(allowedProofUrl("https://example.com/proof/example", origin), false);
});
