const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  const scope={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/delivery-activity.js'),'utf8'),scope);
  let time=0,tick,stalls=0,cleared=0;
  const activity=new scope.HDRDeliveryActivity(()=>stalls++,{now:()=>time,every:fn=>(tick=fn,1),clear:()=>cleared++});
  return {activity,advance(ms){time+=ms;tick();},get stalls(){return stalls;},get cleared(){return cleared;}};
}
test('active exports can exceed 60 seconds indefinitely',()=>{
  const f=fixture();for(let i=0;i<50;i++){f.advance(59000);f.activity.progress();}
  assert.equal(f.stalls,0);f.activity.stop();f.advance(60000);assert.equal(f.stalls,0);
});
test('60 seconds without activity stalls once and stops monitoring',()=>{
  const f=fixture();f.advance(59999);assert.equal(f.stalls,0);f.advance(1);
  assert.equal(f.stalls,1);assert.equal(f.cleared,1);f.advance(120000);assert.equal(f.stalls,1);
});

test('a stuck worker destroys its GPU, reports CPU fallback and reloads',async()=>{
  let tick,time=0,destroyed=0,reloads=0,completion;
  const job={id:'delivery-stalled'};
  const empty={ok:true,status:204,body:{getReader(){throw Error('null-body status must not be wrapped');}}};
  const scope={document:{createElement:()=>({})},window:{},performance:{now:()=>time},
    setInterval:fn=>(tick=fn,1),clearInterval(){},setTimeout(){},location:{reload(){reloads++;}},
    console:{error(){},info(){}},HDRIdleWarmup:{run(){}},
    HDRWebGPUPreview:class{constructor(){this.device={destroy(){destroyed++;}};}initialize(){return new Promise(()=>{});}},
    fetch:async(url,options)=>{if(url==='/no-content')return empty;if(url.endsWith('/complete'))completion=JSON.parse(options.body);
      return {ok:true,json:async()=>url.endsWith('/next')?job:{ready:true}};}};
  const ctx=vm.createContext(scope),root=require('node:path').join(__dirname,'../frontend');
  vm.runInContext(fs.readFileSync(require('node:path').join(root,'delivery-activity.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(require('node:path').join(root,'gpu-delivery.js'),'utf8'),ctx);
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(await scope.fetch('/no-content'),empty);
  time=59999;tick();assert.equal(destroyed,0);
  time=60000;tick();for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(destroyed,1);assert.match(completion.error,/60 seconds without progress/);
  assert.match(completion.error,/CPU/);assert.equal(reloads,1);
});
