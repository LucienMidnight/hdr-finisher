const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8');
const start = source.indexOf('function responseCoarseLongEdge(');
const end = source.indexOf('function globalDetailActive(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ state: { previewLatencyPreference: 'responsive' } });
vm.runInContext(source.slice(start, end) + '\nglobalThis.coarse = responseCoarseLongEdge;', context);

test('Responsive reuses the same 1K source across large zoom steps', () => {
  for (const exact of [2789, 3984, 7968]) assert.equal(context.coarse(exact), 1024);
  assert.equal(context.coarse(798), 512);
});

test('Balanced uses a stable 2K coarse source before exact refinement', () => {
  context.state.previewLatencyPreference = 'balanced';
  assert.equal(context.coarse(3984), 2048);
  assert.equal(context.coarse(7968), 2048);
  assert.equal(context.coarse(1470), 1024);
});
