const assert = require('node:assert/strict');
const vm = require('node:vm');
const { test } = require('node:test');
const { frontendSource } = require('./frontend-source.js');

function fixture() {
  const context = vm.createContext({ window: {}, performance: { now: () => 0 }, console,
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval });
  for (const name of ['mask-loader.js', 'mask-raster.js', 'webgpu-shaders.js', 'webgpu-preview.js']) {
    vm.runInContext(frontendSource(name), context);
  }
  const renderer = new context.window.HDRWebGPUPreview(null);
  const textures = [], passes = [], writes = [];
  renderer.device = { limits: { maxTextureDimension2D: 8192 },
    createCommandEncoder: () => ({ finish: () => ({}) }),
    queue: { writeBuffer: (_buffer, _offset, values) => writes.push(Array.from(values)), submit: () => {} } };
  renderer.maskPipelines = { shapeRaster: 'shape', linearGradient: 'gradient' };
  renderer.createMaskTexture = (width, height) => {
    const texture = { width, height, destroyed: 0, destroy() { this.destroyed++; } };
    textures.push(texture); return texture;
  };
  renderer.createStorageBuffer = () => ({ destroy() {} });
  renderer.createMaskBindGroup = () => ({});
  renderer.encodeMaskPass = (_encoder, pipeline) => passes.push(pipeline);
  renderer.destroyAfterActiveRenders = fn => fn();
  const region = { x: 100, y: 200, width: 600, height: 400 };
  const proxy = { region, width: 7968, height: 5320, texture: {} };
  const batch = { localIndex: 0, local: { id: 'one', mask: { operator: 'leaf', leaf: { type: 'brush', strokes: [] } } },
    tiles: [100, 400].map(x => ({ key: String(x), rect: { x, y: 200, width: 300, height: 400 },
      halo: 0, haloRect: { x, y: 200, width: 300, height: 400 } })) };
  const run = (current = () => true) => renderer.loadLocalMaskTiles('session', batch, 7968, 1, '{}', current, undefined, proxy);
  return { renderer, textures, passes, writes, proxy, batch, run };
}

test('live gradient eligibility retains content and resampling fallbacks', () => {
  const {renderer}=fixture();renderer.available=true;renderer.gpuAnalyticMasksEnabled=true;
  const expression={operator:'leaf',leaf:{type:'linear_gradient',start:{x:.2,y:.3},end:{x:.8,y:.7},gradient_midpoint_1:.3,gradient_midpoint_2:.7,gradient_fan:1}};
  assert.equal(renderer.supportsLiveGradientMask(expression,JSON.stringify({crop:{x:.1,y:.1,width:.8,height:.8}})),true);
  assert.equal(renderer.supportsLiveGradientMask(expression,JSON.stringify({straighten_angle:1})),false);
  assert.equal(renderer.supportsLiveGradientMask({...expression,leaf:{...expression.leaf,gradient_luma_enabled:true}},'{}'),false);
  renderer.gpuAnalyticMasksEnabled=false;
  assert.equal(renderer.supportsLiveGradientMask(expression,'{}'),false);
});

test('auxiliary analytic masks use source dimensions when only another picture edge is resident', () => {
  const f=fixture(),renderer=f.renderer;
  renderer.maskSourceSize={sessionId:'session',width:4000,height:2000};
  renderer.proxies.set('resident',{sessionId:'session',longEdge:960,geometrySignature:'{}',width:960,height:480,texture:{}});
  const mask={operator:'leaf',leaf:{type:'path',nodes:[{x:.2,y:.2},{x:.8,y:.2},{x:.5,y:.8}],feather:.05,feather_mode:'outer_boundary'}};
  const entry=renderer.loadGpuAnalyticLeaf('session',mask,1600,'{}',()=>true);
  assert.equal(entry.width,1600);assert.equal(entry.height,800);assert.deepEqual(f.passes,['shape']);
  assert.equal(renderer.loadGpuAnalyticLeaf('session',mask,1600,'{}',()=>true),entry);
  assert.equal(f.passes.length,1);
});

test('native tiles share one owned texture, reuse it, and pin it until the picture changes', async () => {
  const f = fixture(), result = await f.run(), entries = [...result.entries.values()];
  assert.equal(f.textures.length, 1); assert.equal(f.passes.length, 1);
  assert.equal(entries[0], entries[1]); assert.equal(entries[0].wholeFrame, true);
  assert.deepEqual(Array.from(entries[0].frameRect), [100 / 7968, 200 / 5320, 600 / 7968, 400 / 5320]);
  assert.equal(f.renderer.maskTiles.size, 1);
  await f.run(); assert.equal(f.textures.length, 1);
  f.renderer.cacheBudgetBytes = () => 0;
  f.renderer.presentedMaskKeys = new Set([entries[0].key]);
  f.renderer.trimMaskTiles(); assert.equal(f.textures[0].destroyed, 0);
  f.renderer.presentedMaskKeys.clear(); f.renderer.trimMaskTiles();
  assert.equal(f.textures[0].destroyed, 1); assert.equal(f.renderer.maskTiles.size, 0);
});

test('extra source feather padding reuses masks; a pan and stale request respect their bounds', async () => {
  const f = fixture();
  await f.run(() => false); assert.equal(f.textures.length, 0);
  await f.run();
  f.proxy.region = { ...f.proxy.region, x: 90, width: 610 };
  await f.run(); assert.equal(f.textures.length, 1);
  f.batch.tiles[0].haloRect = { ...f.batch.tiles[0].haloRect, x: 90, width: 310 };
  await f.run(); assert.equal(f.textures.length, 2); assert.equal(f.renderer.maskTiles.size, 2);
});

test('a region that does not cover all halos keeps per-tile placement', async () => {
  const f = fixture(); f.proxy.region.width = 500;
  const entries = [...(await f.run()).entries.values()];
  assert.equal(f.textures.length, 2); assert.notEqual(entries[0], entries[1]);
  assert.equal(entries[0].wholeFrame, undefined);
});

test('linear gradients also share a region; their parameters use full-frame coordinates', async () => {
  const f = fixture();
  f.batch.local.mask.leaf = { type: 'linear_gradient', start: { x: .1, y: .2 }, end: { x: .8, y: .9 },
    gradient_midpoint_1: .3, gradient_midpoint_2: .7 };
  const entries = [...(await f.run()).entries.values()];
  assert.equal(f.textures.length, 1); assert.equal(entries[0], entries[1]);
  assert.deepEqual(f.passes, ['gradient']);
  assert.deepEqual(f.writes[0].slice(6, 10), [100, 200, 7968, 5320]);
});

test('Fan extremes stay on the shared GPU gradient route without a CPU mask request', async () => {
  for (const fan of [-1, 1]) {
    const f = fixture();
    f.batch.local.mask.leaf = {type:'linear_gradient',start:{x:.1,y:.2},end:{x:.8,y:.9},
      gradient_midpoint_1:.3,gradient_midpoint_2:.7,gradient_fan:fan};
    const entries = [...(await f.run()).entries.values()];
    assert.equal(f.textures.length,1);assert.equal(entries[0],entries[1]);
    assert.deepEqual(f.passes,['gradient']);assert.equal(f.writes[0][13],fan);
  }
});

test('Fit gradients reuse GPU coverage and decline a stale request before allocation', async () => {
  const f=fixture(),signature=JSON.stringify({rotation:90,flip_horizontal:true});
  const expression={operator:'leaf',leaf:{type:'linear_gradient',start:{x:.1,y:.2},end:{x:.8,y:.9},
    gradient_midpoint_1:.3,gradient_midpoint_2:.7,gradient_fan:-1}};
  f.renderer.proxies.set('fit',{sessionId:'session',longEdge:512,geometrySignature:signature,
    width:342,height:512,texture:{}});
  const load=current=>f.renderer.loadMaskLeaf('session',f.batch.local,expression,'',512,1,signature,current);
  const a=await load(()=>true),b=await load(()=>true);
  assert.equal(a,b);assert.equal(a.kind,'gpu-linear-gradient');assert.equal(f.textures.length,1);
  assert.deepEqual(f.passes,['gradient']);assert.deepEqual(f.writes[0].slice(8,10),[512,342]);
  assert.equal(await load(()=>false),null);assert.equal(f.textures.length,1);
});
