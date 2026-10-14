const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
for(const route of ['camera-raw-gpu','cached-picture']) test(`Library ${route} keeps old shape during loading`,async()=>{
 const raw=gate(),rawStarted=gate(),pixels=gate(),renderStarted=gate();
 const canvas={width:600,height:400,dataset:{}},controller=new AbortController();
 class Base {
  constructor(){this.surfaceKeys=new Map();}
  async initialize(){return true;}
  async renderTo(target){renderStarted.resolve();await pixels.promise;target.width=400;target.height=600;return {rendered:true};}
  async waitForSubmittedWork(){}
 }
 const context=vm.createContext({window:{},document:{createElement:()=>({})},HDRWebGPUPreview:Base,
  performance,structuredClone,sampleCurvePoints:()=>{},HDRLibraryStopwatch:()=>{},
  HDRLibraryRawGPU:{create:()=>({get:()=>false,configure(){},convert:()=>{rawStarted.resolve();return raw.promise;}})}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/library-gpu.js'),'utf8'),context);
 const pictures=context.window.HDRLibraryPictures;
 const pending=pictures.show({key:'portrait',width:400,height:600,route,adjustments:{hdr:{}}},canvas,controller.signal,()=>true);
 if(route==='camera-raw-gpu'){
  await rawStarted.promise;assert.deepEqual([canvas.width,canvas.height],[600,400],'RAW conversion retains accepted shape');raw.resolve();
 }
 await renderStarted.promise;assert.deepEqual([canvas.width,canvas.height],[600,400],'Pixel fetch retains accepted shape');
 pixels.resolve();await pending;assert.deepEqual([canvas.width,canvas.height],[400,600],'Presentation changes shape');
 await pictures.show({key:'stale',width:900,height:300},canvas,controller.signal,()=>false);
 assert.deepEqual([canvas.width,canvas.height],[400,600],'Stale picture does not resize');
});
