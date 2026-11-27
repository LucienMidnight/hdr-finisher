const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

async function exercise(args,{badLocal=false}={}){
 const configurations=[],exports=[],proofs=[],compares=[];
 let forced=false,lastTag;
 const bytes=Buffer.from('same Proof and export');
 const page={
  on(){},goto:async()=>{},waitForFunction:async()=>{},
  locator:()=>({click:async()=>{}}),
  evaluate:async(fn,arg)=>{
   if(typeof arg==='string')return {session_id:'session'};
   if(arg){configurations.push(arg);return;}
   return {grant:'grant'};
  },
  request:{
   post:async(url,{data})=>{
    let payload={};
    if(url.endsWith('/preferences'))forced=data.force_cpu;
    else if(url.endsWith('/export')){
     lastTag=path.basename(path.dirname(data.output_path));
     exports.push({tag:lastTag,forced,settings:data});
     payload={accepted:true,renderer:forced?'cpu':'gpu'};
    }else if(url.endsWith('/proof/artifact')){
     proofs.push({tag:lastTag,forced,settings:data});
     payload={artifact_id:'proof',renderer:forced?'cpu':'gpu'};
    }
    return {ok:()=>true,text:async()=>'',json:async()=>payload};
   },
   get:async()=>({ok:()=>true,body:async()=>bytes})
  }
 };
 const fakeProcess={argv:['node','driver',...args],env:{},exitCode:0};
 const context={Buffer,URL,console:{log(){},error(){}},process:fakeProcess,__dirname:__dirname,
  global:{HDRFinisherElectronTestHarness:{selectExportPath:async()=>{}}},
  require:name=>{
   if(name==='playwright')return {chromium:{launch:async()=>({newPage:async()=>page,close:async()=>{}})}};
   if(name==='node:fs')return {...fs,existsSync:()=>true,readFileSync:file=>String(file).endsWith('.jpg')?bytes:fs.readFileSync(file)};
   if(name==='node:child_process')return {execFileSync:(_file,argv)=>{
    if(argv[1]==='compare'){
     const tag=path.basename(argv[2]);compares.push(tag);
     const difference=badLocal&&tag==='local'?2:0;
     return JSON.stringify({hdr:{passed:true,mean:difference,p99:0},sdr:{passed:true,mean:difference,p99:0}});
    }
    return '1000';
   }};
   return require(name);
  }
 };
 await vm.runInNewContext(fs.readFileSync(path.join(__dirname,'hsl-selection-delivery.js'),'utf8'),context);
 return {configurations:JSON.parse(JSON.stringify(configurations)),exports,proofs,compares,exitCode:fakeProcess.exitCode};
}

test('combined HSL mode delivers neutral once and checks both isolated edits in full',async()=>{
 const r=await exercise(['--all']);
 assert.equal(r.exitCode,0);
 assert.deepEqual(r.compares,['neutral','global','local']);
 assert.deepEqual(r.configurations,[{local:false,active:false},{local:false,active:true},{local:false,active:false},{local:true,active:true}]);
 assert.deepEqual(r.exports.map(e=>[e.tag,e.forced]),[['neutral',false],['neutral',true],['global',false],['global',true],['local',false],['local',true]]);
 assert.equal(r.proofs.length,6);
 for(const p of r.proofs)assert.equal(p.settings.full_size,true);
 for(const e of r.exports){assert.equal(e.settings.output_finishing.resize_mode,'original');assert.equal(e.settings.guarantee_hdr_peak,true);}
});
test('combined mode still fails the local added-difference gate',async()=>{
 assert.equal((await exercise(['--all'],{badLocal:true})).exitCode,1);
});
for(const args of [[],['--local']])test(`standalone ${args.length?'local':'global'} mode keeps its own neutral case`,async()=>{
 const r=await exercise(args);
 assert.equal(r.exitCode,0);assert.deepEqual(r.compares,['neutral',args.length?'local':'global']);assert.equal(r.exports.length,4);
});
