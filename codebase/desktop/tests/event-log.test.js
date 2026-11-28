const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../lib/event-log');

test('invalid diagnostic names are dropped and invalid action IDs are cleared', () => {
  const lines = [];
  const log = create(line => lines.push(JSON.parse(line)));
  const malformed = { toString: null, valueOf: null };
  const base = { area: 'app', level: 'info' };
  assert.equal(log.ingest({ ...base, event: malformed }, 'renderer_main', 42), false);
  assert.equal(log.ingest({ ...base, event: ['started'] }, 'renderer_main', 42), false);
  assert.equal(log.ingest({ ...base, event: 'started', action: malformed }, 'renderer_main', 42), true);
  assert.equal(log.ingest({ ...base, event: 'finished', action: 'record_1' }, 'renderer_main', 42), true);
  log.flush();
  assert.deepEqual(lines.map(({ event, action }) => [event, action]),
    [['started', null], ['finished', 'record_1']]);
});
