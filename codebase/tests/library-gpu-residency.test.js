const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
test('Library session change keeps owned scenes while releasing ordinary proxies', () => {
  let released=0, ordinary=0;
  class Base {
    constructor(){this.proxies=new Map();}
    resetSession(id){for(const entry of this.proxies.values())entry.texture.destroy();this.proxies.clear();this.sessionId=id;}
    evictGpuCacheEntry(_kind,key){this.proxies.get(key).texture.destroy();this.proxies.delete(key);}
  }
  const context=vm.createContext({window:{},document:{createElement:()=>({})},HDRWebGPUPreview:Base});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-gpu.js'),'utf8')+'\nwindow.TestGPU=HDRLibraryGPU;',context);
  const gpu=new context.window.TestGPU(), held={destroy:()=>{released++;}}, other={destroy:()=>{ordinary++;}};
  gpu.rawPictures={owns:texture=>texture===held,release:texture=>{texture.destroy();gpu.proxies.delete('held');}};
  gpu.proxies.set('held',{texture:held});gpu.proxies.set('other',{texture:other});
  gpu.resetSession('next');assert.equal(released,0);assert.equal(ordinary,1);
  gpu.proxies.set('held',{texture:held});gpu.evictGpuCacheEntry('source-proxy','held');assert.equal(released,1);
});
