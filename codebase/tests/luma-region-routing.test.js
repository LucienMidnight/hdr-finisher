// A leaf luma mask qualifies the scene's ACEScg source. A magnified pass may
// make it on the GPU from its own source region in either lane, but only when
// that region is the scene picture: Match and an authored SDR base replace the
// SDR lane's source. Those regions need an independent HDR scene region;
// otherwise they keep the established fallback.

const assert = require("node:assert/strict");
const vm = require("node:vm");
const { test } = require("node:test");
const { frontendSource } = require("./frontend-source.js");

const read = (name) => frontendSource(name);

function loadPreview() {
  const context = vm.createContext({
    window: {}, performance: { now: () => Date.now() }, console,
    fetch: async () => { throw new Error("unexpected request"); },
    AbortController, setInterval, clearInterval, setTimeout, clearTimeout,
    GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
    GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 },
    GPUMapMode: { READ: 1, WRITE: 2 },
  });
  for (const name of ["graph-scale.js", "gpu-allocator.js", "source-transport.js", "webgpu-shaders.js", "webgpu-preview.js"]) {
    vm.runInContext(read(name), context);
  }
  return context.window.HDRWebGPUPreview;
}

const luma = { operator: "leaf", enabled: true, inverted: false, leaf: { type: "luminance_range", mask_feather: 0.004,
  fade_in_start_ev: -6, full_start_ev: -3, full_end_ev: 2, fade_out_end_ev: 5 } };
const batch = { localIndex: 0, local: { id: "local-1", mask: luma }, tiles: [{ key: "0:0" }, { key: "0:1" }] };
const region = { x: 512, y: 1024, width: 2048, height: 1536 };

test('locals with shared range stops retain independent immutable feather results', async()=>{
  const preview=new (loadPreview())(null);
  const resource=()=>({destroy(){},createView(){return {};}});
  let submissions=0;
  preview.device={queue:{writeBuffer(){},submit(){submissions++;}},createCommandEncoder(){return{finish(){return {};}};}};
  preview.createMaskTexture=resource;preview.createStorageBuffer=resource;
  preview.createMaskBindGroup=()=>({});preview.encodeMaskPass=()=>{};
  preview.maskPipelines={qualify:{},refine:{}};preview.retainLocalMask=()=>{};
  preview.loadSceneLuminance=async()=>({texture:resource(),width:100,height:100,frameWidth:500,frameHeight:500,
    frameRect:[.2,.2,.2,.2],regionIdentity:':region:test'});
  const first={id:'first',mask:{...luma,leaf:{...luma.leaf,mask_feather:0}}};
  const second={id:'second',mask:{...luma,leaf:{...luma.leaf,mask_feather:.005}}};
  const a=await preview.loadGpuLumaMask('session',first,500,1,'{}');
  const b=await preview.loadGpuLumaMask('session',second,500,1,'{}');
  assert.notEqual(a,b);assert.equal(a.texture,a.baseTexture);assert.notEqual(b.texture,b.baseTexture);
  const before=submissions;
  assert.equal(await preview.loadGpuLumaMask('session',first,500,2,'{}'),a);
  assert.equal(await preview.loadGpuLumaMask('session',second,500,2,'{}'),b);
  assert.equal(submissions,before,'An unrelated edit must not reblur either unchanged feather');
});

async function route(proxy) {
  const Preview = loadPreview();
  const preview = new Preview(null);
  const calls = { luma: [], soft: 0 };
  preview.loadGpuLumaMask = async (...args) => { calls.luma.push(args[8]); return { kind: "gpu-luma-region" }; };
  preview.softLeafMask = async () => { calls.soft += 1; return { kind: "soft" }; };
  const result = await preview.loadLocalMaskTiles("session", batch, 7968, 3, "{}", () => true, undefined, proxy);
  return { calls, kinds: [...result.entries.values()].map((entry) => entry.kind) };
}

test("a supported luma/path graph uses the scene region; an authored SDR base retains fallback", async () => {
  for (const scene of [true, false]) {
    const Preview = loadPreview(), preview = new Preview(null);
    const shape = { operator: 'leaf', leaf: { type: 'linear_gradient', start: {x:0,y:0}, end: {x:1,y:1},
      gradient_midpoint_1:.3, gradient_midpoint_2:.7 } };
    const graphBatch = { ...batch, local: { ...batch.local, mask: { operator:'intersect', children:[luma,shape] } } };
    let calls = 0;
    preview.loadGpuMaskGraph = async (...args) => { calls++; assert.equal(args[8].region, region);
      return {kind:'gpu-mask-graph',wholeFrame:true}; };
    preview.softLeafMask = async () => ({kind:'soft'});
    const result = await preview.loadLocalMaskTiles('session', graphBatch, 7968, 3, '{}', () => true, undefined,
      {region,lane:'sdr',sourceIdentity:'source',workingSpace:scene?'acescg':'linear-srgb'});
    assert.equal(calls, scene?1:0);
    assert.ok([...result.entries.values()].every(entry=>entry.kind===(scene?'gpu-mask-graph':'soft')));
  }
});

test("an HDR source region makes its own luma mask", async () => {
  const proxy = { region, lane: "hdr", sourceIdentity: "source", workingSpace: "acescg" };
  const { calls, kinds } = await route(proxy);
  assert.deepEqual(calls.luma, [proxy]);
  assert.deepEqual(kinds, ["gpu-luma-region", "gpu-luma-region"]);
});

test("an SDR region of the scene source makes the same mask without a CPU request", async () => {
  const proxy = { region, lane: "sdr", sourceIdentity: "source", workingSpace: "acescg" };
  const { calls, kinds } = await route(proxy);
  assert.deepEqual(calls.luma, [proxy]);
  assert.equal(calls.soft, 0);
  assert.deepEqual(kinds, ["gpu-luma-region", "gpu-luma-region"]);
});

test("a matched or authored SDR region is not scene luminance and keeps the fallback", async () => {
  for (const proxy of [
    { region, lane: "sdr", sourceIdentity: "source", workingSpace: "linear-srgb" },
    { region, lane: "sdr", sourceIdentity: "hdr-to-sdr-match-v1:signature", workingSpace: "linear-srgb" },
    { region, lane: "sdr", sourceIdentity: "hdr-to-sdr-match-v1:signature", workingSpace: "acescg" },
  ]) {
    const { calls, kinds } = await route(proxy);
    assert.deepEqual(calls.luma, [], JSON.stringify(proxy));
    assert.equal(calls.soft, 1);
    assert.deepEqual(kinds, ["soft", "soft"]);
  }
});

test("an independent scene region qualifies authored SDR leaf and graph masks", async () => {
  const preview = new (loadPreview())(null);
  const scene = { region, lane:'hdr', sourceIdentity:'source', workingSpace:'acescg' };
  const authored = { region, lane:'sdr', sourceIdentity:'source', workingSpace:'linear-srgb' };
  const calls = [];
  preview.loadGpuLumaMask = async (...args) => { calls.push(args[8]); return {kind:'gpu-luma-region'}; };
  preview.loadGpuMaskGraph = async (...args) => { calls.push(args[8]); return {kind:'gpu-mask-graph'}; };
  preview.softLeafMask = async () => { throw new Error('unexpected CPU fallback'); };
  await preview.loadLocalMaskTiles('session',batch,7968,3,'{}',()=>true,undefined,authored,scene);
  const gradient = {operator:'leaf',leaf:{type:'linear_gradient',start:{x:0,y:0},end:{x:1,y:1},
    gradient_midpoint_1:.3,gradient_midpoint_2:.7}};
  const graph = {...batch,local:{...batch.local,mask:{operator:'union',children:[luma,gradient]}}};
  await preview.loadLocalMaskTiles('session',graph,7968,3,'{}',()=>true,undefined,authored,scene);
  assert.deepEqual(calls,[scene,scene]);
});

test("one scene-region request covers foreground halos and all feather grids", async () => {
  const preview = new (loadPreview())(null);
  const proxy = {region,lane:'sdr',sourceIdentity:'matched',workingSpace:'linear-srgb',width:5320,height:7968};
  const tiles = [{haloRect:{x:1024,y:2048,width:600,height:600}},
    {haloRect:{x:1536,y:2560,width:600,height:600}}];
  const locals = [.004,.008].map(mask_feather=>({mask:{...luma,leaf:{...luma.leaf,mask_feather}}}));
  let request;
  preview.loadProxy = async (...args) => {
    request=args;
    return {...proxy,lane:'hdr',sourceIdentity:'source',workingSpace:'acescg',region:args[6].region};
  };
  const result = await preview.loadSceneMaskRegion('session',proxy,tiles,locals,7968,3,'{}',()=>true);
  assert.equal(request[1],'hdr');assert.equal(request[5],'source');assert.equal(request[6].regionOnly,true);
  const rect=request[6].region;
  assert.equal(rect.alignment,28);assert.equal(rect.x%28,0);assert.equal(rect.y%28,0);
  assert.equal((rect.x+rect.width)%28,0);assert.equal((rect.y+rect.height)%28,0);
  // Six discrete boxes need their full finite support, including the
  // reduced-grid footprint; a three-sigma halo omitted the outer taps.
  assert.ok(rect.x<=1024-536&&rect.y<=2048-536);
  assert.ok(rect.x+rect.width>=2136+536&&rect.y+rect.height>=3160+536);
  assert.ok(rect.width*rect.height<proxy.width*proxy.height*.9);
  assert.equal(result.lane,'hdr');
});

test("scene-region refusal, stale state and mismatched frame keep the fallback", async () => {
  for (const mode of ['refused','stale','dimensions','space']) {
    const preview = new (loadPreview())(null);
    const proxy={region,lane:'sdr',workingSpace:'linear-srgb',width:5320,height:7968};
    let current=true;
    preview.loadProxy=async(...args)=>{
      if(mode==='stale')current=false;
      if(mode==='refused')return null;
      return {...proxy,lane:'hdr',sourceIdentity:'source',region:args[6].region,
        width:mode==='dimensions'?5319:5320,workingSpace:mode==='space'?'linear-srgb':'acescg'};
    };
    assert.equal(await preview.loadSceneMaskRegion('session',proxy,[{haloRect:region}],
      [batch.local],7968,3,'{}',()=>current),null,mode);
  }
});

test("a region approaching the whole frame never starts scene preparation", async () => {
  const preview = new (loadPreview())(null);
  preview.loadProxy=async()=>{throw new Error('unbounded request');};
  const proxy={region,lane:'sdr',workingSpace:'linear-srgb',width:128,height:192};
  assert.equal(await preview.loadSceneMaskRegion('session',proxy,
    [{haloRect:{x:0,y:0,width:128,height:192}}],[batch.local],192,3,'{}',()=>true),null);
});
