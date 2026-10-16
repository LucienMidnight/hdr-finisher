const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRecentProjects } = require('../desktop/lib/recent-projects');
test('recent projects survive restart, put the latest first and reject non-project entries', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-recent-projects-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'recent-projects.json');
  const first = path.join(directory, 'first.hdrfinisher'), second = path.join(directory, 'second.hdrfinisher');
  const store = createRecentProjects(file);
  assert.deepEqual(store.list(), []);
  store.remember(first); store.remember(second); store.remember(first);
  assert.deepEqual(createRecentProjects(file).list(), [first, second]);
  assert.throws(() => store.remember(path.join(directory, 'photo.CR2')));
  fs.writeFileSync(file, JSON.stringify([second, second, 'relative.hdrfinisher', false, path.join(directory, 'photo.CR2')]));
  assert.deepEqual(store.list(), [second]);
  fs.writeFileSync(file, '{');
  assert.deepEqual(store.list(), []);
});
