const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_APPLICATION_PREFERENCES, defaultAppMemoryBytes, sanitizeApplicationPreferences } = require("../lib/application-preferences");

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

test("Developed badge preference accepts Always and defaults to On hover", () => {
  assert.equal(DEFAULT_APPLICATION_PREFERENCES.developedBadge, "hover");
  for (const value of [undefined, null, "hover", "invalid", true]) {
    assert.equal(sanitizeApplicationPreferences({developedBadge:value}).developedBadge, "hover");
  }
  assert.equal(sanitizeApplicationPreferences({developedBadge:"always"}).developedBadge, "always");
});

test('app memory clamps to the platform default and retains the system reserve', t => {
  const ram = 16 * 1024**3;
  t.mock.method(require('node:os'), 'totalmem', () => ram);
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  const profile = process.env.HDR_FINISHER_MEMORY_PROFILE;
  t.after(() => {
    Object.defineProperty(process, 'platform', original);
    if (profile === undefined) delete process.env.HDR_FINISHER_MEMORY_PROFILE;
    else process.env.HDR_FINISHER_MEMORY_PROFILE = profile;
  });
  for (const [platform, emulated, minimum] of [
    ['win32', false, 6_000_000_000],
    ['win32', true, 4_000_000_000],
    ['darwin', false, 4_000_000_000],
    ['linux', false, 4_000_000_000],
  ]) {
    Object.defineProperty(process, 'platform', { value: platform });
    if (emulated) process.env.HDR_FINISHER_MEMORY_PROFILE = 'unified-8gb';
    else delete process.env.HDR_FINISHER_MEMORY_PROFILE;
    assert.equal(defaultAppMemoryBytes(), minimum);
    assert.equal(sanitizeApplicationPreferences({appMemoryBytes: 2_500_000_000}).appMemoryBytes, minimum);
    assert.equal(sanitizeApplicationPreferences({appMemoryBytes: 8_000_000_000}).appMemoryBytes, 8_000_000_000);
    assert.equal(sanitizeApplicationPreferences({appMemoryBytes: ram}).appMemoryBytes, ram - 2_000_000_000);
    assert.equal(sanitizeApplicationPreferences({appMemoryBytes: null}).appMemoryBytes, null);
  }
});
