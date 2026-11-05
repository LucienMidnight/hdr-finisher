/* Large Library request bodies leave the window thread through a worker. */
window.HDRLibraryUpload = (() => {
  'use strict';
  const workerURL=new URL('library-upload-worker.js',document.currentScript.src);
  let worker=null,serial=0;
  const pending=new Map();
  const cancelled=()=>new DOMException('Cancelled','AbortError');
  function failWorker(current,error){
    if(worker!==current)return;
    worker=null;current.terminate();
    for(const task of pending.values())task.reject(error);
  }
  function ensureWorker(){
    if(!worker){
      const current=new Worker(workerURL);worker=current;
      current.onmessage=({data})=>{
        const task=pending.get(data.id);if(!task)return;
        data.error?task.reject(Error(data.error)):task.resolve({ok:data.ok,status:data.status,text:data.text,body:data.body,headerEntries:data.headerEntries});
      };
      current.onerror=()=>failWorker(current,Error('Library upload could not start.'));
      current.onmessageerror=()=>failWorker(current,Error('Library upload response could not be read.'));
    }
    return worker;
  }
  async function send(url,{body,headers={},signal,responseType,priority,timeoutMs=45000}={}){
    if(signal?.aborted)throw cancelled();
    ensureWorker();
    return new Promise((resolve,reject)=>{
      const id=++serial,current=worker;
      const finish=(fn,value)=>{if(!pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',stop);fn(value);};
      const stop=()=>{try{current.postMessage({cancel:id});}catch{}finish(reject,cancelled());};
      const timer=setTimeout(()=>{try{current.postMessage({cancel:id});}catch{}finish(reject,Error('Library upload timed out.'));},timeoutMs);
      pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
      signal?.addEventListener('abort',stop,{once:true});
      try{current.postMessage({id,url,body,headers,responseType,priority},body instanceof ArrayBuffer?[body]:[]);}
      catch(error){finish(reject,error);}
    });
  }
  // Source downloads assemble in the worker too. Returning a transferred buffer
  // avoids a hundreds-of-MB arrayBuffer completion on the window thread.
  async function fetchSource(url,options={}){
    const response=await send(url,{...options,responseType:'buffer',timeoutMs:310000});
    const bytes=response.body,entries=new Map(response.headerEntries||[]);delete response.body;
    return {...response,headers:{get:name=>entries.get(name.toLowerCase())??null},
      arrayBuffer:async()=>bytes,json:async()=>JSON.parse(new TextDecoder().decode(bytes))};
  }
  // Full-size detail is written in bounded bands: open, write(buffer)..., end.
  // Each write is transferred and awaited, so one band is in flight at a time.
  // The answers have send's shape ({ok,status,text}); a refused receiving
  // buffer answers ok:false with status 503.
  function stream(url,{total,headers={},signal,timeoutMs=45000}={}){
    const key=crypto.randomUUID();let closed=false;
    const cancel=()=>{if(closed)return;closed=true;try{ensureWorker().postMessage({stream:{kind:'cancel',key}});}catch{}};
    signal?.addEventListener('abort',cancel,{once:true});
    const call=(kind,buffer)=>{
      if(signal?.aborted)return Promise.reject(cancelled());
      const current=ensureWorker(),id=++serial;
      return new Promise((resolve,reject)=>{
        const finish=(fn,value)=>{if(!pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',stop);fn(value);};
        const stop=()=>finish(reject,cancelled());
        const timer=setTimeout(()=>finish(reject,Error('Library upload timed out.')),timeoutMs);
        pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
        signal?.addEventListener('abort',stop,{once:true});
        try{current.postMessage({id,stream:{kind,key,url,total,headers},buffer},buffer?[buffer]:[]);}
        catch(error){finish(reject,error);}
      });
    };
    return Object.freeze({open:()=>call('open'),write:buffer=>call('write',buffer),
      end:async()=>{const value=await call('end');closed=true;signal?.removeEventListener('abort',cancel);return value;},cancel});
  }
  return Object.freeze({send,fetchSource,stream});
})();
