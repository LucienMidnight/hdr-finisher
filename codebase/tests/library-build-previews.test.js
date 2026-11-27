const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const fail of [false,true])test(`preview completion retains ${fail?'failure':'success'} when refreshing disk usage fails`,async()=>{
 const events=[];
 const context={AbortController,DOMException,Event,console:{debug(){}},HDRLibraryStopwatch:(stage,fields)=>events.push({stage,...fields}),
  HDRLibraryPictures:{initialize:async()=>{throw Object.assign(Error('No GPU'),{gpuUnavailable:true});}},HDRLibraryScreenPreviews:{display:()=>({})},
  fetch:async url=>{
   if(url==='/api/library/health')return {json:async()=>({helper:{paused:false,source_busy:false}})};
   if(url.endsWith('/cpu'))return {ok:!fail,json:async()=>fail?{detail:'Source unreadable'}:{saved:true}};
   throw Error('Disk usage unavailable');
  },dispatchEvent(){}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-build-previews.js'),'utf8'),context);
 const result=await context.HDRLibraryBuildPreviews.run(['photo']);
 assert.equal(result.job.state,fail?'failed':'finished');assert.equal(result.job.done,fail?0:1);
 assert.equal(result.job.error,fail?'Source unreadable':'');assert.equal(events.at(-1).stage,'built_previews_finished');
 assert.match(events.at(-1).reason,fail?/failed.*Source unreadable/:/^finished$/);
});
