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
test("idle preparation waits for quiet and foreground demand bypasses that wait",async()=>{
  let now=0;
  const context=vm.createContext({window:{addEventListener(){}},navigator:{gpu:{requestAdapter:async()=>({})}},
    performance:{now:()=>now},setTimeout:(callback,ms)=>{now+=ms;queueMicrotask(callback);},
    requestIdleCallback:callback=>queueMicrotask(callback),fetch:async()=>({ok:true,json:async()=>({idle:true,ready:true})})});
  vm.runInContext(frontendSource("idle-warmup.js"),context);
  const idle=context.window.HDRIdleWarmup;
  await idle.run("test",async beforeNext=>{
    assert.ok(now>=2000);idle.touch();const started=now;
    await beforeNext(()=>true);assert.equal(now,started);
  });
  assert.equal(idle.results.test,"ready");
});
