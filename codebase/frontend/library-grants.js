/* One persistent RAM grant channel per Library window. Waiting is not failure. */
(function(root){
  "use strict";
  const cancelled=()=>new DOMException("Cancelled","AbortError");
  function create({socket=url=>new WebSocket(url),url,changed=()=>{},timer=setTimeout,interval=setInterval,reclaim=async()=>{}}={}){
    const jobs=new Map(); let screenOrder=new Map(); let visible=true; let channel=null,reconnect=null,heartbeat=null,lastMessage=0,closed=false,grade={name:"",bytes:0};
    const send=value=>{if(channel?.readyState===1)channel.send(JSON.stringify(value));};
    function connect(){
      if(closed||channel)return;
      const current=channel=socket(url);
      current.onopen=()=>{lastMessage=Date.now();if(!visible)send({type:"visibility",visible});for(const j of jobs.values())send({type:"ask",id:j.id,path:j.path,kind:j.kind,edge:j.edge,gpu_bytes:j.gpu_bytes,gpu_unified:j.gpu_unified,priority:j.priority,order:j.front?-1:screenOrder.get(j.path)});heartbeat=interval(()=>{if(Date.now()-lastMessage>15000)current.close();else send({type:"heartbeat"});},5000);};
      current.onmessage=event=>{
        lastMessage=Date.now();const value=JSON.parse(event.data);
        if(value.type==="grade"){grade=value;for(const job of jobs.values())job.status.grade=value.name;}
        if(value.type==="reclaim"){
          Promise.resolve().then(()=>reclaim(value.bytes)).then(()=>send({type:"reclaimed",epoch:value.epoch})).catch(error=>console.debug(error));return;
        }
        const j=jobs.get(value.id);
        if(j&&value.type==="needs-memory"){
          finish(j,"needs more memory");
          j.reject(Object.assign(Error(waitingText({...value,reason:"needs more memory"})),{needsMemory:true,estimate:value.estimate}));return;
        }
        if(j){if(value.type==="gpu-preempt"){j.connection.abort();return;}if(value.type==="saving"){j.saveResolve?.();return;}j.status=value;if(value.type==="waiting")j.granted=false;if(value.type==="granted"&&!j.granted){j.granted=true;j.started=true;j.resolve(j);}}
        changed();
      };
      current.onclose=()=>{
        if(channel!==current)return;channel=null;clearInterval(heartbeat);
        for(const j of [...jobs.values()])if(j.started){jobs.delete(j.id);j.saveReject?.(cancelled());j.detach();j.connection.abort();}
        changed();if(!closed)reconnect=timer(()=>{reconnect=null;connect();},500);
      };
      current.onerror=()=>current.close();
    }
    function acquire(path,kind,signal,priority=10,edge=2560,gpu_bytes=0,gpu_unified=false,front=false){
      if(closed||signal?.aborted)return Promise.reject(cancelled());
      return new Promise((resolve,reject)=>{
        const id=root.crypto.randomUUID(),j={id,path,kind,edge,gpu_bytes,gpu_unified,front,priority,resolve,reject,connection:new AbortController(),granted:false,status:{type:"waiting",path,reason:"connecting"}};
        const stop=()=>{finish(j,"cancelled");reject(cancelled());};
        j.detach=()=>signal?.removeEventListener("abort",stop);
        jobs.set(id,j);signal?.addEventListener("abort",stop,{once:true});
        if(channel?.readyState===1)send({type:"ask",id,path,kind,edge,gpu_bytes,gpu_unified,priority,order:front?-1:screenOrder.get(path)});else connect();changed();
      });
    }
    function finish(j,outcome="finished"){
      if(!jobs.delete(j.id))return;
      j.saveReject?.(cancelled());j.detach();send({type:outcome==="cancelled"?"cancel":"finish",id:j.id,outcome});changed();
    }
    async function run(path,kind,signal,task,priority=10,initial=null){
      let grant=initial,front=false;
      for(;;){
        grant ||= await acquire(path,kind,signal,typeof priority==="function"?priority():priority,initial?.edge??2560,initial?.gpu_bytes??0,initial?.gpu_unified??false,front);
        const combined=new AbortController(),stop=()=>combined.abort();
        signal?.addEventListener("abort",stop,{once:true});grant.connection.signal.addEventListener("abort",stop,{once:true});
        if(signal?.aborted||grant.connection.signal.aborted)stop();
        const ownedGrant=grant;
        let outcome="finished";
        try{return await task(grant.id,combined.signal);}
        catch(error){
          if((grant.connection.signal.aborted||error.libraryRequeue)&&!signal?.aborted){front=!!error.gpuRetry;finish(grant,"cancelled");grant=null;continue;}
          outcome=signal?.aborted?"cancelled":/chang|invalidat/i.test(error.message)?"changed":"finished";throw error;
        }finally{
          signal?.removeEventListener("abort",stop);
          ownedGrant.connection.signal.removeEventListener("abort",stop);finish(ownedGrant,outcome);
        }
      }
    }
    function snapshot(){return {grade,jobs:[...jobs.values()].map(j=>({...j.status,path:j.path,state:j.granted?"running":"waiting",stage:j.granted?"Developing photo":waitingText(j.status)}))};}
    return {acquire,finish,run,snapshot,gpuLost(){for(const j of [...jobs.values()])if(j.gpu_bytes&&j.started){j.connection.abort();finish(j,"cancelled");}},gpuDone(id){const j=jobs.get(id);if(!j)return Promise.reject(cancelled());return new Promise((resolve,reject)=>{j.saveResolve=resolve;j.saveReject=reject;send({type:"gpu-done",id});});},visibility(value){visible=!!value;send({type:"visibility",visible});},viewport(paths){screenOrder=new Map(paths.map((p,i)=>[p,i]));for(const j of jobs.values())send({type:"priority",id:j.id,priority:j.priority,order:j.front?-1:screenOrder.get(j.path)});},release(id){const job=jobs.get(id);if(job)finish(job);},wait(id,signal){return new Promise((resolve,reject)=>{const stop=()=>{signal?.removeEventListener("abort",stop);reject(cancelled());};signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)stop();});},promote(path,priority,edge=null){for(const j of jobs.values())if(j.path===path&&(edge===null||j.edge===edge)&&j.priority!==priority){j.priority=priority;send({type:"priority",id:j.id,priority});}},close(){closed=true;clearTimeout(reconnect);clearInterval(heartbeat);for(const j of [...jobs.values()]){finish(j,"cancelled");j.connection.abort();j.reject(cancelled());}channel?.close();}};
  }
  function waitingText(value){
    if(value.reason==="needs more memory")return `Needs about ${(value.estimate/1e9).toFixed(1)} GB. Raise “Memory the app may use” in Settings.`;
    if(value.reason==="paused for Grade")return "memory in use by the photo open in Grade";
    if(value.reason==="system reserve")return `not enough free memory on this computer (needs ${(value.estimate/1e9).toFixed(2)} GB, ${(value.free/1e9).toFixed(2)} GB free)`;
    return value.reason==="connecting"?"Connecting to Library scheduler":"Waiting for working memory";
  }
  const api={create,waitingText};
  if(typeof module!=="undefined")module.exports=api;
  else {
    root.HDRLibraryGrants=create({url:location.origin.replace(/^http/,"ws")+"/api/library/grants",changed:()=>root.dispatchEvent(new Event("library-work-changed")),reclaim:bytes=>root.HDRLibraryReclaimWaiting?.(bytes)});
    root.HDRLibraryGrants.preview=(body,signal,headers={},priority=10)=>root.HDRLibraryGrants.run(body.path,"quick",signal,async(grant,shared)=>{
      const response=await fetch("/api/library/preview",{method:"POST",priority:"high",signal:shared,headers:{"Content-Type":"application/json",...headers},body:JSON.stringify({...body,grant})});
      return new Response(response.status===204?null:await response.arrayBuffer(),{status:response.status,headers:response.headers});
    },priority);
    let nativeVisible=true;
    const visibility=()=>root.HDRLibraryGrants.visibility(nativeVisible&&root.document.visibilityState!=="hidden");
    const desktop=root.hdrFinisherDesktop||root.parent?.hdrFinisherDesktop;
    const nativeState=value=>{nativeVisible=value.visible!==false;visibility();};
    desktop?.onWindowStateChanged?.(nativeState);
    desktop?.getWindowState?.().then(nativeState).catch(()=>{});
    if(root.document.visibilityState==="hidden")visibility();
    root.document.addEventListener("visibilitychange",visibility);
    root.addEventListener("pagehide",()=>root.HDRLibraryGrants.close());
  }
})(typeof window==="undefined"?globalThis:window);
