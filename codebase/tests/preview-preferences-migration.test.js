const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../frontend/application-shell.js"), "utf8");
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
const context = vm.createContext({});
vm.runInContext([
  section("const PREVIEW_RESOLUTIONS =", "// Diagnostic only."),
  section("const DEFAULT_PREFERENCES =", "const COMMON_DEFAULT_SHORTCUTS"),
  "const clone = (value) => JSON.parse(JSON.stringify(value));",
  "const normalizeGpuMemoryGiB = (value) => value === 'auto' ? 'auto' : Number(value) || 'auto';",
  "const THEME_IDS = ['default-dark']; const FRAME_PRESET_IDS = ['theme'];",
  "const EXECUTION_OVERRIDES = new Set(['auto', 'direct', 'tiled']);",
  "const ROI_PREVIEW_MODES = new Set(['fit', 'refinement']);",
  "const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;",
  section("const mergePreferences =", "async function loadPreferences"),
  "globalThis.mergePreferences = mergePreferences;",
].join("\n"), context);

test("all four legacy tiers migrate to response preferences without enabling a tier override", () => {
  for (const [tier, preference] of Object.entries({
    "1024": "responsive", "2048": "balanced", "4096": "balanced", full: "precise",
  })) {
    const migrated = context.mergePreferences({ schemaVersion: 2, previewResolution: tier });
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.previewPreference, preference);
    assert.equal(migrated.previewResolution, "auto");
    assert.equal(migrated.previewMigration.previousTier, tier);
  }
});

test("new response preference and diagnostic override round-trip without touching project data", () => {
  const saved = context.mergePreferences({ schemaVersion: 3, previewPreference: "responsive",
    previewResolution: "4096", previewMigration: { previousTier: "full", noticeShown: true } });
  const restored = context.mergePreferences(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.previewPreference, "responsive");
  assert.equal(restored.previewResolution, "4096");
  assert.equal(restored.previewMigration.previousTier, "full");
  assert.equal(restored.previewMigration.noticeShown, true);
  assert.equal("project" in restored, false);
});
