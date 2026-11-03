/* Uploads a large Library request body off the frame's main thread. */
const uploads=new Map();
self.onmessage=async({data})=>{
  if(data.cancel){uploads.get(data.cancel)?.abort();return;}
  let {id,url,body,parts,headers,responseType,priority}=data||{};const controller=new AbortController();uploads.set(id,controller);
  try{
    if(parts){
      const token=crypto.randomUUID().replaceAll('-',''),total=parts.reduce((n,p)=>n+p.byteLength,0);
      const upload='/api/library/native-upload/'+token;
      try{
        let offset=0;
        for(let i=0;i<parts.length;i++){
          const view=new Uint8Array(parts[i]);
          for(let at=0;at<view.length;at+=4*1024*1024){
            const chunk=view.subarray(at,Math.min(view.length,at+4*1024*1024));
            const response=await fetch(upload+'?offset='+offset+'&total='+total,{method:'POST',headers,body:chunk,signal:controller.signal});
            if(response.status===202){
              // Do not wait while owning the producer's full-size planes. A
              // refused receiving buffer may need those bytes freed to fit.
              // Unwind the whole preparation so its scheduler grant and GPU
              // output are released before fresh admission, not after 45 s.
              self.postMessage({id,ok:false,status:503,text:JSON.stringify({detail:'Waiting for memory to save detail; request it again.'})});
              return;
            }
            if(!response.ok){self.postMessage({id,ok:false,status:response.status,text:await response.text()});return;}
            offset+=chunk.byteLength;
          }
          parts[i]=null;
        }
        parts=null;data.parts=null;
        const response=await fetch(url,{method:'POST',headers:{...headers,'X-Library-Native-Upload':token},signal:controller.signal});
        self.postMessage({id,ok:response.ok,status:response.status,text:await response.text()});
      }finally{await fetch(upload,{method:'DELETE'}).catch(()=>{});}
      return;
    }
    const request=fetch(url,{method:'POST',headers,body,priority,signal:controller.signal});
    // Fetch owns its request now; the message must not retain another body root.
    body=null;data.body=null;
    const response=await request;
    if(responseType==='buffer'){
      const buffer=await response.arrayBuffer(),headerEntries=[...response.headers.entries()];
      self.postMessage({id,ok:response.ok,status:response.status,body:buffer,headerEntries},[buffer]);
    }else{
      const text=await response.text();self.postMessage({id,ok:response.ok,status:response.status,text});
    }
  }catch(error){self.postMessage({id,ok:false,status:0,error:String(error?.message||error)});}
  finally{uploads.delete(id);
    // Transferred bodies belong to this isolate, not the page's collection.
    if(typeof gc==='function')try{void Promise.resolve(gc({type:'major',execution:'async',flavor:'last-resort'})).catch(()=>{});}catch{}
  }
};
