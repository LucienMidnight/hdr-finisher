const assert = require('node:assert/strict');
const vm = require('node:vm');
const {test} = require('node:test');
const { frontendSource } = require('./frontend-source.js');
const context = vm.createContext({window:{}, document:{}, navigator:{}, console});
for (const file of ['graph-scale.js', 'webgpu-shaders.js', 'webgpu-preview.js']) {
  vm.runInContext(frontendSource(file), context);
}
const proto = context.window.HDRWebGPUPreview.prototype;

test('measurement and magnified masks cannot evict unchanged Fit bitmaps', () => {
  const mib = 1024*1024, destroyed = [];
  const fit = {byteSize:48*mib, lastUseSerial:1};
  const native = {byteSize:150*mib, magnifiedMask:true, lastUseSerial:1};
  const analysis = {byteSize:80*mib, editingMeasurement:true, lastUseSerial:1};
  const target = Object.create(proto);
  Object.assign(target, {localMasks:new Map([['fit',fit], ['native',native], ['analysis',analysis]]), maskUseSerial:2,
    destroyAfterActiveRenders:callback=>callback(), destroyLocalMaskEntry:entry=>destroyed.push(entry)});
  const newNative = {byteSize:20*mib};
  target.localMasks.set('new-native', newNative);
  target.retainLocalMask(newNative, 8000);
  assert.equal(target.localMasks.get('fit'), fit);
  assert.equal(target.localMasks.get('analysis'), analysis);
  assert.equal(target.localMasks.has('native'), false);
  const newAnalysis = {byteSize:20*mib};
  target.localMasks.set('new-analysis', newAnalysis);
  target.retainEditingMask(newAnalysis);
  assert.equal(target.localMasks.get('fit'), fit);
  assert.equal(target.localMasks.get('new-native'), newNative);
  assert.equal(target.localMasks.has('analysis'), false);
  assert.equal(destroyed.length, 2);
});

test('all resident masks needed by a frame survive the first cache trim', () => {
  const mib = 1024*1024;
  const locals = [1, 2, 3].map(index => ({id:String(index), mask:{operator:'leaf', leaf:{type:'brush', strokes:[index]}}}));
  const entries = locals.map(local => {
    const signature = JSON.stringify({operator:'leaf', leaf:{...local.mask.leaf, mask_opacity:1}, children:[]});
    return [`session:1600:{}:cpu-spatial-leaf:${signature}`, {byteSize:40*mib, editingMeasurement:true, lastUseSerial:1}];
  });
  const target = Object.create(proto);
  Object.assign(target, {localMasks:new Map(entries), maskUseSerial:2,
    destroyAfterActiveRenders:callback=>callback(), destroyLocalMaskEntry:()=>assert.fail('active mask was evicted')});
  target.markResidentMaskFrame('session', locals, 1600, '{}');
  target.retainEditingMask(entries[0][1]);
  assert.equal(target.localMasks.size, 3);
  for (const [, entry] of entries) assert.equal(entry.lastUseSerial, 2);
});

test('regional graph outputs are protected before loading another local', () => {
  const region = {x:100,y:200,width:600,height:400};
  const local = {id:'graph',mask:{operator:'intersect',children:[
    {operator:'leaf',leaf:{type:'luminance_range'}}, {operator:'leaf',leaf:{type:'path'}}]}};
  const key = 'session:graph:7968:{}:gpu-mask-graph:node(leaf:luminance_range,leaf:path):region:' + JSON.stringify(region);
  const entry = {byteSize:200*1024*1024,magnifiedMask:true,lastUseSerial:1};
  const target = Object.create(proto);
  Object.assign(target,{localMasks:new Map([[key,entry]]),maskUseSerial:2,
    destroyAfterActiveRenders:fn=>fn(),destroyLocalMaskEntry:()=>assert.fail('current graph was evicted')});
  target.markResidentMaskFrame('session',[local],7968,'{}',region);
  target.retainLocalMask({byteSize:1},7968);
  assert.equal(target.localMasks.get(key),entry); assert.equal(entry.lastUseSerial,2);
});
