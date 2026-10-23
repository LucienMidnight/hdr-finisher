const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_APPLICATION_PREFERENCES, sanitizeApplicationPreferences } = require("../lib/application-preferences");

test("desktop preferences preserve the Test Patterns opt-in as a boolean", () => {
  assert.equal(sanitizeApplicationPreferences({ libraryTestPatterns: true }).libraryTestPatterns, true);
  assert.equal(sanitizeApplicationPreferences({ libraryTestPatterns: false }).libraryTestPatterns, false);
  assert.equal(sanitizeApplicationPreferences({}).libraryTestPatterns, false);
  assert.equal(sanitizeApplicationPreferences({ libraryTestPatterns: "true" }).libraryTestPatterns, false);
});

test("desktop preferences retain rendering defaults and user selections", () => {
  for (const preferences of [DEFAULT_APPLICATION_PREFERENCES, sanitizeApplicationPreferences({})]) {
    assert.equal(preferences.schemaVersion, 3);
    assert.equal(preferences.previewResolution, "auto");
    assert.equal(preferences.fasterDragging, false);
    assert.equal(preferences.maximumGpuMemoryGiB, "auto");
  }
  const preferences = sanitizeApplicationPreferences({
    previewResolution: "2048", fasterDragging: true, maximumGpuMemoryGiB: 6,
  });
  assert.equal(preferences.previewResolution, "2048");
  assert.equal(preferences.fasterDragging, true);
  assert.equal(preferences.maximumGpuMemoryGiB, 6);
});
