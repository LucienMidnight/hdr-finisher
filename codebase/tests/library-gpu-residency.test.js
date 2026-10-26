const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('Library session change keeps owned scenes while releasing ordinary proxies', () => {
  let released=0, ordinary=0;
  class Base {
    constructor(){this.proxies=new Map();}
    resetSession(id){for(const entry of this.proxies.values())entry.texture.destroy();this.proxies.clear();this.sessionId=id;}
    evictGpuCacheEntry(_kind,key){this.proxies.get(key).texture.destroy();this.proxies.delete(key);}
  }
  const context=vm.createContext({window:{},document:{createElement:()=>({})},HDRWebGPUPreview:Base,HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler')});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-gpu.js'),'utf8')+'\nwindow.TestGPU=HDRLibraryGPU;',context);
  const gpu=new context.window.TestGPU(), held={destroy:()=>{released++;}}, other={destroy:()=>{ordinary++;}};
  gpu.rawPictures={owns:texture=>texture===held,release:texture=>{texture.destroy();gpu.proxies.delete('held');}};
  gpu.proxies.set('held',{texture:held});gpu.proxies.set('other',{texture:other});
  gpu.resetSession('next');assert.equal(released,0);assert.equal(ordinary,1);
  gpu.proxies.set('held',{texture:held});gpu.evictGpuCacheEntry('source-proxy','held');assert.equal(released,1);
});
test('Shared accounting includes retained Library scenes outside the current proxy', () => {
  class Base {
    constructor(){this.proxies=new Map();}
    resourceMemorySnapshot(){return {resident:{totalBytes:40,categories:{}},cached:{totalBytes:40,categories:{}},
      peakLogicalBytes:40,totals:{residentBytes:40,cachedBytes:40,peakLogicalBytes:40}};}
  }
  const context=vm.createContext({window:{},document:{createElement:()=>({})},HDRWebGPUPreview:Base,HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler')});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-gpu.js'),'utf8')+'\nwindow.TestGPU=HDRLibraryGPU;',context);
  const gpu=new context.window.TestGPU(), texture={};
  gpu.rawPictures={owns:t=>t===texture,snapshot:()=>({bytes:100})};
  gpu.proxies.set('current',{texture,byteSize:40});
  const result=gpu.resourceMemorySnapshot();
  assert.equal(result.resident.totalBytes,100);
  assert.equal(result.cached.totalBytes,100);
  assert.equal(result.resident.categories.libraryRetainedBytes,60);
  assert.equal(result.peakLogicalBytes,100);
});

test('ready surfaces report the configured budget without feeding back shared deductions',async()=>{
 const reports=[];let retained=16;
 class Base {
  constructor(){this.deliveryBudgetBytes=32;}
  async initialize(){return true;}
  memoryBudgetBytes(){return this.deliveryBudgetBytes ?? 1024;}
 }
  const context=vm.createContext({window:{},document:{createElement:()=>({})},performance,HDRLibrarySceneScheduler:require('../frontend/library-scene-scheduler'),
  HDRLibraryGpuRaw:{directBytes:()=>retained},HDRWebGPUPreview:Base,HDRLibraryStopwatch:()=>{},crypto:{randomUUID:()=> 'test'},
  fetch:async(url,options)=>{const value=JSON.parse(options.body);reports.push(value);return {ok:true,json:async()=>({budget:value.budget-value.bytes})};}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-gpu.js'),'utf8'),context);
 const pictures=context.window.HDRLibraryPictures;
 assert.equal(await pictures.readyMemory(100),908);retained=0;assert.equal(await pictures.readyMemory(0),1024);
 assert.deepEqual(reports.map(r=>r.budget),[1024,1024]);assert.ok(reports.every(r=>r.active===false));
 assert.equal((await pictures.initialize()).deliveryBudgetBytes,32);
});
