/* Shared bounded work with merged demand and priority promotion. */
(function(root){
  "use strict";
  function create(limit=2,now=()=>Date.now(),{heavyLimit=limit,onChange=()=>{}}={}){
    const jobs=new Map(),waiting=[],failures=[],runningJobs=new Set();let active=0,heavyActive=0,sequence=0;
    const cancelled=()=>new DOMException("Cancelled","AbortError");
    const score=job=>job.priority+job.cost-(now()-job.created)/1000;
    let borrowPending=false;
    function pump(borrow=false){
      while(active<limit&&waiting.length){
        waiting.sort((a,b)=>score(a)-score(b)||a.sequence-b.sequence);
        let index=waiting.findIndex(job=>!job.heavy||heavyActive<heavyLimit);
        if(index<0){
          // Prefer light work already waiting, but never reserve an empty slot
          // indefinitely. One microtask lets a burst of requests join the queue.
          if(!borrow){
            if(!borrowPending){borrowPending=true;queueMicrotask(()=>{borrowPending=false;pump(true);});}
            break;
          }
          index=0;
        }
        const [job]=waiting.splice(index,1);
        if(job.controller.signal.aborted){if(jobs.get(job.key)===job)jobs.delete(job.key);continue;}
        active++;if(job.heavy)heavyActive++;job.running=true;job.started=now();runningJobs.add(job);onChange(job,"running");
        Promise.resolve().then(()=>job.task(job.controller.signal,()=>job.priority))
          .then(value=>settle(job,null,value),error=>settle(job,error))
          .finally(()=>{runningJobs.delete(job);active--;if(job.heavy)heavyActive--;if(jobs.get(job.key)===job)jobs.delete(job.key);pump();});
      }
    }
    function settle(job,error,value){
      if(error&&!job.controller.signal.aborted){failures.push({path:job.path,reason:error.message});if(failures.length>8)failures.shift();}
      onChange(job,job.controller.signal.aborted ? "cancelled" : error ? "failed" : "completed",error);
      if(jobs.get(job.key)===job)jobs.delete(job.key);
      for(const user of job.users){user.signal?.removeEventListener("abort",user.stop);error?user.reject(error):user.resolve(value);}
      job.users.clear();
    }
    function submit(key,task,signal,priority=10,{heavy=false,cost=0,path=key,stage="Preparing photo"}={}){
      if(signal?.aborted)return Promise.reject(cancelled());
      let job=jobs.get(key);
      if(!job){for(let i=failures.length-1;i>=0;i--)if(failures[i].path===path)failures.splice(i,1);job={key,path,stage,task,priority,heavy,cost:Math.max(0,Math.min(5,cost)),created:now(),sequence:sequence++,controller:new AbortController(),users:new Set()};jobs.set(key,job);waiting.push(job);onChange(job,"waiting");}
      job.priority=Math.min(job.priority,priority);
      const result=new Promise((resolve,reject)=>{
        const user={signal,resolve,reject};
        user.stop=()=>{job.users.delete(user);reject(cancelled());if(!job.users.size){job.controller.abort();onChange(job,job.running?"stopping":"cancelled");if(jobs.get(key)===job)jobs.delete(key);}};
        job.users.add(user);signal?.addEventListener("abort",user.stop,{once:true});
      });
      pump();return result;
    }
    return Object.freeze({submit,stage:(path,stage,waiting=false)=>{for(const job of jobs.values())if(job.path===path&&job.running&&(job.stage!==stage||job.resourceWaiting!==waiting)){job.stage=stage;job.resourceWaiting=waiting;onChange(job,"running");}},snapshot:()=>({failures:[...failures],active,waiting:waiting.filter(j=>!j.controller.signal.aborted).length,jobs:[...new Set([...jobs.values(),...runningJobs])].map(j=>({path:j.path,stage:j.stage,state:j.controller.signal.aborted?"stopping":j.running&&!j.resourceWaiting?"running":"waiting"}))})});
  }
  const api=Object.freeze({create});
  if(typeof module!=="undefined")module.exports=api;else root.HDRLibrarySceneScheduler=api;
})(typeof window==="undefined"?globalThis:window);
