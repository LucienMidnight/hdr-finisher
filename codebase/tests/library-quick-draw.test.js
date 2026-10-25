const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {create}=require('../frontend/library-scene-scheduler');
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('quick work runs independently and selected sharp follows only the in-flight neighbour',async()=>{
 const window={dispatchEvent(){}};
 const context=vm.createContext({window,HDRLibrarySceneScheduler:{create},performance,Event,crypto:require('node:crypto'),setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-scenes'),'utf8'),context);
 const scenes=window.HDRLibraryScenes,hold=gate(),started=[];
 const sharp={submit:(_key,task,signal,priority)=>scenes.draw(task,signal,priority)};
 const quick={submit:(_key,task,signal,priority)=>scenes.quickDraw(task,signal,priority)};
 const signal=new AbortController().signal;
 const first=sharp.submit('first',async()=>{started.push('first');await hold.promise;},signal,5);
 await Promise.resolve();
 const neighbours=[1,2,3].map(i=>sharp.submit('n'+i,async()=>started.push('n'+i),signal,5));
 const selected=sharp.submit('selected',async()=>started.push('selected'),signal,0);
 await quick.submit('stand-in',async()=>started.push('stand-in'),signal,0);
 assert.deepEqual(started,['first','stand-in']);
 hold.resolve();await selected;assert.deepEqual(started.slice(0,3),['first','stand-in','selected']);
 await Promise.all([first,...neighbours]);
});
test('repeat Library model preparations reuse exact photo, grade, lane, size and geometry within 16 entries',async()=>{
 let requests=0;
 const window={};
  const context=vm.createContext({window,document:{createElement:()=>({})},performance,fetch:async url=>({ok:true,json:async()=>({url,measurement:++requests})}),HDRWebGPUPreview:class {},HDRLibrarySceneScheduler:{create}});
 vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-gpu'),'utf8'),context);
 const prepare=window.HDRLibraryPictures.prepareDenoise;
 const meta=(key='live-photo-grade1',edge=2560,geometry={})=>({key,edge,denoise:{hdr:{enabled:true},sdr:{enabled:true}},adjustments:{shared:{geometry}}});
 const a=meta();await prepare(a,true);await prepare(meta('live-neighbour'),true);await prepare(a,true);
 assert.equal(requests,2,'Back-and-forth must not remeasure');
 await window.HDRLibraryQuickPictures.prepareDenoise(a,true);assert.equal(requests,2,'Renderers share model results');
 await prepare(a,false);await prepare(meta(a.key,640),true);await prepare(meta('live-photo-grade2'),true);await prepare(meta(a.key,2560,{rotate:90}),true);
 assert.equal(requests,6,'Changed measured pixels never reuse a model');
 for(let i=0;i<16;i++)await prepare(meta('live-other-'+i),true);
 await prepare(a,true);assert.equal(requests,23,'Old models evict at the bounded capacity');
});
