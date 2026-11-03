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
  async function send(url,{body,parts,headers={},signal,responseType,priority,timeoutMs=45000}={}){
    if(signal?.aborted)throw cancelled();
    if(!worker){
      const current=new Worker(workerURL);worker=current;
      current.onmessage=({data})=>{
        const task=pending.get(data.id);if(!task)return;
        data.error?task.reject(Error(data.error)):task.resolve({ok:data.ok,status:data.status,text:data.text,body:data.body,headerEntries:data.headerEntries});
      };
      current.onerror=()=>failWorker(current,Error('Library upload could not start.'));
      current.onmessageerror=()=>failWorker(current,Error('Library upload response could not be read.'));
    }
    return new Promise((resolve,reject)=>{
      const id=++serial,current=worker;
      const finish=(fn,value)=>{if(!pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',stop);fn(value);};
      const stop=()=>{try{current.postMessage({cancel:id});}catch{}finish(reject,cancelled());};
      const timer=setTimeout(()=>{try{current.postMessage({cancel:id});}catch{}finish(reject,Error('Library upload timed out.'));},timeoutMs);
      pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});
      signal?.addEventListener('abort',stop,{once:true});
      try{current.postMessage({id,url,body,parts,headers,responseType,priority},parts || (body instanceof ArrayBuffer?[body]:[]));}
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
  return Object.freeze({send,fetchSource});
})();
