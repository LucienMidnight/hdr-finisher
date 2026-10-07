const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');

const { declarations } = require('./frontend-source.js');
const context = vm.createContext({ state: { fasterDragging: true } });
vm.runInContext(declarations('responseCoarseLongEdge') + '\nglobalThis.coarse = responseCoarseLongEdge;', context);

// P5: Faster dragging (the old Balanced) is the only coarse mode left.
test('Faster dragging uses a stable 2K coarse source before exact refinement', () => {
  assert.equal(context.coarse(3984), 2048);
  assert.equal(context.coarse(7968), 2048);
  assert.equal(context.coarse(2789), 2048);
  assert.equal(context.coarse(1470), 1024);
  assert.equal(context.coarse(798), 512);
});
