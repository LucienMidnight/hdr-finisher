const {test}=require("node:test"), assert=require("node:assert/strict"), vm=require("node:vm");
const {frontendSource}=require("./frontend-source.js");
function setup() {
  const context=vm.createContext({window:{},document:{createElement:()=>({})},performance:{now:()=>1},HDRLibraryStopwatch:()=>{},HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler')});
  for(const file of ["graph-scale.js","webgpu-shaders.js","webgpu-preview.js"]) vm.runInContext(frontendSource(file),context);
  context.HDRWebGPUPreview=context.window.HDRWebGPUPreview;
  vm.runInContext(frontendSource("library-gpu.js")+"\nwindow.TestGPU=HDRLibraryGPU;",context);
  const gpu=Object.create(context.window.TestGPU.prototype);
  Object.assign(gpu,{pipelines:new Map(),module:{},pipelineLayout:{}});
  return gpu;
}
test("idle Library compilation uses the same complete descriptors as foreground, asynchronously",async()=>{
  const gpu=setup(), foreground=setup(); let gates=0;
  gpu.device={createRenderPipeline(){throw Error("Idle compilation must be asynchronous");},
    createRenderPipelineAsync:async descriptor=>({descriptor})};
  foreground.device={createRenderPipeline:descriptor=>({descriptor})};
  await gpu.warmPipelines("rgba16float",async()=>{gates++;});
  const warmed=gpu.pipelines.get("rgba16float"), expected=foreground.pipelineFor("rgba16float");
  assert.equal(JSON.stringify(warmed),JSON.stringify(expected));
  assert.equal(gates,Object.keys(expected).length);
});
test("foreground can take over between idle pipeline compilations",async()=>{
  const gpu=setup(), foreground={complete:true};let compiled=0;
  gpu.device={createRenderPipelineAsync:async()=>{compiled++;}};
  await gpu.warmPipelines("rgba16float",async()=>{gpu.pipelines.set("rgba16float",foreground);});
  assert.equal(compiled,0);assert.equal(gpu.pipelines.get("rgba16float"),foreground);
});
test("foreground preparation shares a pending program without synchronous duplication",async()=>{
  const gpu=setup();let release,compiled=0;
  gpu.device={createRenderPipeline(){throw Error('Duplicate synchronous compilation');},
    createRenderPipelineAsync:descriptor=>{compiled++;return new Promise(resolve=>{release=()=>resolve({descriptor});});}};
  const background=gpu.prepareLibraryPipelines('rgba16float',['base']);
  await Promise.resolve();
  const foreground=gpu.prepareLibraryPipelines('rgba16float',['base']);
  await Promise.resolve();
  assert.equal(compiled,1);
  release();await Promise.all([background,foreground]);
  assert.ok(gpu.pipelineFor('rgba16float').base);
  assert.equal(compiled,1);
});
test("a failed pending program can be prepared again",async()=>{
  const gpu=setup();let compiled=0;
  gpu.device={createRenderPipelineAsync:async descriptor=>{if(!compiled++)throw Error('compile failed');return {descriptor};}};
  await assert.rejects(gpu.prepareLibraryPipelines('rgba16float',['base']),/compile failed/);
  await gpu.prepareLibraryPipelines('rgba16float',['base']);
  assert.ok(gpu.pipelineFor('rgba16float').base);assert.equal(compiled,2);
});
test("idle preparation waits for quiet and foreground demand bypasses that wait",async()=>{
  let now=0;
  const context=vm.createContext({window:{addEventListener(){}},navigator:{gpu:{requestAdapter:async()=>({})}},
    performance:{now:()=>now},setTimeout:(callback,ms)=>{now+=ms;queueMicrotask(callback);},
    requestIdleCallback:callback=>queueMicrotask(callback),fetch:async()=>({ok:true,json:async()=>({idle:true,ready:true})})});
  vm.runInContext(frontendSource("idle-warmup.js"),context);
  const idle=context.window.HDRIdleWarmup;
  idle.gridShown();
  await idle.run("test",async beforeNext=>{
    assert.ok(now>=2000);idle.touch();const started=now;
    await beforeNext(()=>true);assert.equal(now,started);
  });
  assert.equal(idle.results.test,"ready");
});

test("fullscreen/window bounds notifications preserve pictures on the same output display",()=>{
  const {displayIdentity}=require('../frontend/library-ready-window');
  const environment={renderingMode:'auto',currentDisplay:{id:'one',colorSpace:'srgb',scaleFactor:1,bounds:{width:2560,height:1440},workArea:{height:1400}}};
  const key=displayIdentity(environment,false);
  assert.equal(key,displayIdentity({...environment,currentDisplay:{...environment.currentDisplay,workArea:{height:1440}}},false));
  assert.notEqual(key,displayIdentity(environment,true));
  for(const [field,value] of [['id','two'],['colorSpace','p3'],['scaleFactor',2],['colorDepth',30]])
    assert.notEqual(key,displayIdentity({...environment,currentDisplay:{...environment.currentDisplay,[field]:value}},false));
});

test("a foreground development bypasses a paused RAW warmer and shares completed compilation",async()=>{
  require('../frontend/library-gpu-raw');
  const prepare=globalThis.HDRLibraryGpuRaw.shared.preparePipelines;
  let release,compiled=0;const held=new Promise(resolve=>{release=resolve;});
  const context={pipelines:{},compilation:new Map(),device:{createShaderModule:descriptor=>descriptor,createComputePipelineAsync:async descriptor=>{compiled++;return {descriptor};}}};
  const background=prepare(context,()=>held,['REDUCE']);
  const foreground=await prepare(context,undefined,['REDUCE']);
  assert.ok(foreground.REDUCE);assert.equal(compiled,1);
  release();await background;assert.equal(compiled,1);
});
