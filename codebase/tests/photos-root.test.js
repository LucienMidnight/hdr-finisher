const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const settings = require('../tools/lib/machine-settings.cjs');

function mapper(t, readSettings) {
  t.mock.method(settings, 'machineSettings', readSettings);
  const modulePath = require.resolve('./helpers/photos-root.cjs');
  delete require.cache[modulePath];
  t.after(() => { delete require.cache[modulePath]; });
  return require(modulePath).photosPath;
}

test('non-photo arguments and explicit roots need no machine discovery', t => {
  const map = mapper(t, () => { throw Error('Unexpected machine discovery'); });
  for (const value of ['--enforce', 'tests/example.js', '/tmp/output.json', 'D:/Photos-other/a.jpg', null, 42]) {
    assert.equal(map(value), value);
  }
  assert.equal(map('D:/Photos/a.jpg', '/test-photos'), path.join('/test-photos', 'a.jpg'));
  assert.equal(map('D:/Photos/a.jpg', ''), 'D:/Photos/a.jpg');
  assert.equal(map('D:/Photos/a.jpg', null), 'D:/Photos/a.jpg');
});

test('photo roots remain live and both Windows slash directions map', t => {
  let root = '/first-root', calls = 0;
  const map = mapper(t, () => { calls++; return {photosRoot: root}; });
  assert.equal(map('D:/Photos/folder/a.jpg'), path.join(root, 'folder', 'a.jpg'));
  root = '/second-root';
  assert.equal(map(String.raw`d:\Photos\folder\a.jpg`), path.join(root, 'folder', 'a.jpg'));
  assert.equal(calls, 2);
});
