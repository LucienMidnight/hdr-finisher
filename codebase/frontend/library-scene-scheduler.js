/* Shared bounded work with merged demand and priority promotion. */
(function(root){
  "use strict";
  function create(limit=2,now=()=>Date.now()){
    const jobs=new Map(),waiting=[];let active=0,sequence=0;
    const cancelled=()=>new DOMException("Cancelled","AbortError");
    const score=job=>job.priority-(now()-job.created)/1000;
    function pump(){
      while(active<limit&&waiting.length){
        waiting.sort((a,b)=>score(a)-score(b)||a.sequence-b.sequence);
        const job=waiting.shift();
        if(job.controller.signal.aborted){if(jobs.get(job.key)===job)jobs.delete(job.key);continue;}
        active++;job.running=true;
        Promise.resolve().then(()=>job.task(job.controller.signal,()=>job.priority))
          .then(value=>settle(job,null,value),error=>settle(job,error))
          .finally(()=>{active--;if(jobs.get(job.key)===job)jobs.delete(job.key);pump();});
      }
    }
    function settle(job,error,value){
      if(jobs.get(job.key)===job)jobs.delete(job.key);
      for(const user of job.users){user.signal?.removeEventListener("abort",user.stop);error?user.reject(error):user.resolve(value);}
      job.users.clear();
    }
    function submit(key,task,signal,priority=10){
      if(signal?.aborted)return Promise.reject(cancelled());
      let job=jobs.get(key);
      if(!job){job={key,task,priority,created:now(),sequence:sequence++,controller:new AbortController(),users:new Set()};jobs.set(key,job);waiting.push(job);}
      job.priority=Math.min(job.priority,priority);
      const result=new Promise((resolve,reject)=>{
        const user={signal,resolve,reject};
        user.stop=()=>{job.users.delete(user);reject(cancelled());if(!job.users.size){job.controller.abort();if(jobs.get(key)===job)jobs.delete(key);}};
        job.users.add(user);signal?.addEventListener("abort",user.stop,{once:true});
      });
      pump();return result;
    }
    return Object.freeze({submit,snapshot:()=>({active,waiting:waiting.filter(j=>!j.controller.signal.aborted).length})});
  }
  const api=Object.freeze({create});
  if(typeof module!=="undefined")module.exports=api;else root.HDRLibrarySceneScheduler=api;
})(typeof window==="undefined"?globalThis:window);
