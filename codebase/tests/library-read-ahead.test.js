const test = require('node:test'), assert = require('node:assert/strict');
const {create} = require('../frontend/library-read-ahead.js');
const turn = () => new Promise(resolve => setImmediate(resolve));
test('selecting a neighbour preserves its unfinished decode and promise', async () => {
 const calls=[]; let resolve;
 const ahead=create({key:(p,e)=>`${p.id}:${p.grade}:${e}`,load:(p,e,signal)=>{calls.push({p,signal});return new Promise(r=>{resolve=r;});}});
 const a={id:'a',grade:1},b={id:'b',grade:1};
 ahead.update(a,[b],2560); await turn(); const promised=ahead.take(b,2560);
 ahead.update(b,[a],2560); await turn();
 assert.equal(ahead.take(b,2560),promised); assert.equal(calls[0].signal.aborted,false);
 assert.equal(calls.filter(c=>c.p.id==='b').length,1); ahead.clear();
 assert.ok(calls.every(c=>c.signal.aborted));
});
test('leaving the neighbourhood, resizing or changing a grade discards obsolete work', async () => {
 const calls=[]; const ahead=create({key:(p,e)=>`${p.id}:${p.grade}:${e}`,load:(p,e,signal)=>{calls.push(signal);return new Promise(()=>{});}});
 const a={id:'a',grade:1},b={id:'b',grade:1},c={id:'c',grade:1};
 ahead.update(a,[b],1920); await turn();
 ahead.update(c,[{...b,grade:2}],2560); await turn();
 assert.ok(calls[0].aborted); assert.equal(ahead.take(b,1920),undefined); ahead.clear();
});
test('a failed read-ahead can be retried', async () => {
 let calls=0; const ahead=create({key:p=>p.id,load:async()=>{calls++;throw Error('offline');}});
 const a={id:'a'},b={id:'b'}; ahead.update(a,[b],2560); await turn();
 assert.equal(ahead.take(b,2560),undefined); ahead.update(a,[b],2560); await turn();
 assert.equal(calls,2); ahead.clear();
});
