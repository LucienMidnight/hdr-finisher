const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

test("grading preset saves, backup, listing and delete are ordered and retain their results", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hdr-preset-storage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  const context = vm.createContext({
    fs: { promises: fs.promises }, path, crypto,
    gradingPresetDirectory: () => directory, GRADING_PRESET_GROUPS: new Set(["hdr-tone"]),
  });
  vm.runInContext(source.slice(source.indexOf("async function pathExists("),
    source.indexOf("function semverParts(")), context);
  await fs.promises.writeFile(path.join(directory, "broken.hdrf-grade.json"), "{");
  const first = context.saveGradingPreset({ groupId: "hdr-tone", name: "Zed", values: { strength: 1 } });
  const second = context.saveGradingPreset({ groupId: "hdr-tone", name: "Zed", values: { strength: 2 } });
  const third = context.saveGradingPreset({ groupId: "hdr-tone", name: "Alpha", values: {} });
  const listed = context.listGradingPresets("hdr-tone");
  const [original, overwrite] = await Promise.all([first, second, third]);
  assert.equal(original.id, overwrite.id);
  const names = await fs.promises.readdir(directory);
  const backup = names.filter(name => name.endsWith(".backup"));
  assert.equal(backup.length, 1);
  const read = async name => JSON.parse(await fs.promises.readFile(path.join(directory, name), "utf8"));
  assert.equal((await read(backup[0])).values.strength, 1);
  assert.deepEqual(await read(overwrite.id),
    { schemaVersion: 1, groupId: "hdr-tone", name: "Zed", recipeVersion: 1, values: { strength: 2 } });
  assert.deepEqual(Array.from(await listed, preset => preset.name), ["Alpha", "Zed"]);
  const deleting = context.deleteGradingPreset(overwrite.id);
  const remaining = context.listGradingPresets("hdr-tone");
  assert.equal(await deleting, true);
  assert.deepEqual(Array.from(await remaining, preset => preset.name), ["Alpha"]);
});
