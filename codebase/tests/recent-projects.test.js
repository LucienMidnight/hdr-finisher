const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRecentProjects } = require('../desktop/lib/recent-projects');
test('recent projects survive restart, put the latest first and reject non-project entries', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-recent-projects-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'recent-projects.json');
  const first = path.join(directory, 'first.hdrfinisher'), second = path.join(directory, 'second.hdrfinisher');
  const store = createRecentProjects(file);
  assert.deepEqual(await store.list(), []);
  const remembered = [
    store.remember(first),
    store.remember(second),
    store.remember(first),
  ];
  const invalid = assert.rejects(store.remember(path.join(directory, 'photo.CR2')));
  const listing = store.list();
  await store.flush();
  assert.deepEqual(await createRecentProjects(file).list(), [first, second], 'flushing before quit persists earlier saves');
  assert.deepEqual(await listing, [first, second], 'listing sees earlier saves in order');
  assert.deepEqual(await Promise.all(remembered), [[first], [second, first], [first, second]]);
  await invalid;
  fs.writeFileSync(file, JSON.stringify([second, second, 'relative.hdrfinisher', false, path.join(directory, 'photo.CR2')]));
  assert.deepEqual(await store.list(), [second]);
  fs.writeFileSync(file, '{');
  assert.deepEqual(await store.list(), []);
});
