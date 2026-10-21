const {test} = require('node:test'), assert = require('node:assert/strict');
const {create} = require('../frontend/library-tile-pool');
test('completed surfaces are reused without disposal and the recent pool stays bounded', () => {
 const disposed=[],pool=create(10, v=>disposed.push(v)),a={photo:'a'},b={photo:'b'},c={photo:'c'};
 pool.put('a',a,4);pool.put('b',b,4);
 assert.equal(pool.take('a'),a);assert.deepEqual(disposed,[]);
 pool.put('a',a,4);pool.put('c',c,4);
 assert.deepEqual(disposed,[b]);assert.equal(pool.take('b'),undefined);
 assert.equal(pool.snapshot().bytes,8);assert.equal(pool.take('a'),a);
 pool.clear();assert.deepEqual(disposed,[b,c]);assert.equal(pool.snapshot().bytes,0);
});
test('grade invalidation, replacement, oversize surfaces and clear release resources', () => {
 const disposed=[],pool=create(10,v=>disposed.push(v));
 pool.put('a','old',4);pool.put('a','new',4);pool.put('b','other',4);
 pool.discard(v=>v==='new');assert.equal(pool.take('a'),undefined);
 pool.put('large','large',11);pool.clear();
 assert.deepEqual(disposed,['old','new','large','other']);assert.equal(pool.snapshot().bytes,0);
});

test('the default recent surface allowance remains fixed at 512 MiB', () => {
 assert.equal(create().snapshot().limit,512 * 1024 ** 2);
});
