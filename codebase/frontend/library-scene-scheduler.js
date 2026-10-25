/* Shared bounded work with merged demand and priority promotion. */
(function(root){
  "use strict";
  function create(limit=2,now=()=>Date.now(),{heavyLimit=limit,onChange=()=>{},keepRunning=false,preemptLower=false}={}){
    const jobs=new Map(),waiting=[],failures=[],runningJobs=new Set();let active=0,heavyActive=0,sequence=0;
    const cancelled=()=>new DOMException("Cancelled","AbortError");
    const score=job=>job.cost-Math.min(5,(now()-job.created)/1000);
    const order=(a,b)=>a.priority-b.priority||score(a)-score(b)||a.sequence-b.sequence;
    let ranking=null;
    const demand=job=>{job.priority=Math.min(80,...[...job.users].map(user=>user.priority===0?0:ranking?ranking(job.path):user.priority));};
    let borrowPending=false;
    function pump(borrow=false){
      while(active<limit&&waiting.length){
        waiting.sort(order);
        let index=waiting.findIndex(job=>job.priority===waiting[0].priority&&(job.priority===0||!job.heavy||heavyActive<heavyLimit));
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
      if(job.settled)return;job.settled=true;
      if(error&&!job.controller.signal.aborted){failures.push({path:job.path,reason:error.message});if(failures.length>8)failures.shift();}
      onChange(job,job.controller.signal.aborted ? "cancelled" : error ? "failed" : "completed",error);
      if(jobs.get(job.key)===job)jobs.delete(job.key);
      for(const user of job.users){user.signal?.removeEventListener("abort",user.stop);error?user.reject(error):user.resolve(value);}
      job.users.clear();
    }
    function submit(key,task,signal,priority=10,{heavy=false,cost=0,path=key,stage="Preparing photo"}={}){
      if(signal?.aborted)return Promise.reject(cancelled());
      let job=jobs.get(key);
      if (job?.controller.signal.aborted) { jobs.delete(key); job = null; }
      if(!job){for(let i=failures.length-1;i>=0;i--)if(failures[i].path===path)failures.splice(i,1);job={key,path,stage,task,priority,heavy,cost:Math.max(0,Math.min(5,cost)),created:now(),sequence:sequence++,controller:new AbortController(),users:new Set()};jobs.set(key,job);waiting.push(job);onChange(job,"waiting");}
      const result=new Promise((resolve,reject)=>{
        const user={signal,resolve,reject,priority};
        user.stop=()=>{const retained=typeof keepRunning==="function"?keepRunning(job):keepRunning;job.users.delete(user);reject(cancelled());demand(job);if(!job.users.size&&!(retained&&job.running)){job.controller.abort();if(!job.running){const index=waiting.indexOf(job);if(index>=0)waiting.splice(index,1);}onChange(job,job.running?"stopping":"cancelled");if(jobs.get(key)===job)jobs.delete(key);}};
        job.users.add(user);demand(job);signal?.addEventListener("abort",user.stop,{once:true});
      });
      if (preemptLower) for (const running of runningJobs) if (running.priority > priority) running.controller.abort();
      pump();return result;
    }
    return Object.freeze({submit,
      reprioritize:rank=>{ranking=rank;for(const job of jobs.values())demand(job);},
      invalidate:predicate=>{for(const job of [...jobs.values()])if(predicate(job.path)){job.controller.abort();const index=waiting.indexOf(job);if(index>=0)waiting.splice(index,1);settle(job,cancelled());}},
      stage:(path,stage,waiting=false)=>{for(const job of jobs.values())if(job.path===path&&job.running&&(job.stage!==stage||job.resourceWaiting!==waiting)){job.stage=stage;job.resourceWaiting=waiting;onChange(job,"running");}},snapshot:()=>({failures:[...failures],active,waiting:waiting.filter(j=>!j.controller.signal.aborted).length,jobs:[...new Set([...jobs.values(),...runningJobs])].map(j=>({path:j.path,stage:j.stage,state:j.controller.signal.aborted?"stopping":j.running&&!j.resourceWaiting?"running":"waiting"}))})});
  }
  // One idle candidate at a time, once per identity in the current folder.
  // Foreground activity detaches pending demand; active source work may finish.
  function createWarmer({load,idle,now=()=>Date.now(),delay=1000}){
    let scope=null,items=[],attempted=new Set(),controller=null,touched=now(),stopped=false;
    function touch(){touched=now();controller?.abort();}
    return Object.freeze({touch,
      update:(key,rows)=>{if(key!==scope){touch();scope=key;attempted=new Set();stopped=false;}items=rows;},
      async tick(){
        if(controller||stopped||now()-touched<delay||!idle())return;
        const item=items.find(row=>!attempted.has(row.identity));if(!item)return;
        const owner=new AbortController();controller=owner;const pass=attempted;
        pass.add(item.identity);
        try{if(await load(item.path,owner.signal)===null&&pass===attempted)stopped=true;}
        catch(error){if(error.name==='AbortError')pass.delete(item.identity);}
        finally{if(controller===owner)controller=null;}
      }
    });
  }
  const api=Object.freeze({create,createWarmer});
  if(typeof module!=="undefined")module.exports=api;else root.HDRLibrarySceneScheduler=api;
})(typeof window==="undefined"?globalThis:window);
