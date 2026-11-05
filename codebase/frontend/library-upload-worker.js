/* Uploads a large Library request body off the frame's main thread. */
const uploads=new Map(),streams=new Map();
const CHUNK=4*1024*1024,COLLECT_BYTES=64*1024*1024;
// Each 4 MB request leaves a copy of its body here until the next garbage
// collection. Without one, a full-size scene was held here a second time
// until its upload ended (about +1 GB for 48 MP, November 5). The desktop app
// starts with --expose-gc; elsewhere this does nothing.
const collect=async()=>{if(typeof gc==='function')try{await gc({type:'major',execution:'async'});}catch{}};
// Full-size detail arrives in bounded bands (open, write..., end or cancel)
// and goes to the backend's admitted receiving buffer in 4 MB requests.
async function streamMessage({id,stream:{kind,key,url,total,headers},buffer}){
  const reply=value=>self.postMessage({id,...value});
  if(kind==='open'){
    streams.set(key,{token:crypto.randomUUID().replaceAll('-',''),url,total,headers,offset:0,collectAt:COLLECT_BYTES,controller:new AbortController()});
    reply({ok:true,status:200});return;
  }
  const s=streams.get(key);
  if(!s){if(kind!=='cancel')reply({ok:false,status:410,text:JSON.stringify({detail:'Full-size detail upload expired; try again.'})});return;}
  const upload='/api/library/native-upload/'+s.token;
  if(kind==='cancel'){streams.delete(key);s.controller.abort();await fetch(upload,{method:'DELETE'}).catch(()=>{});return;}
  try{
    if(kind==='write'){
      const view=new Uint8Array(buffer);buffer=null;
      for(let at=0;at<view.length;at+=CHUNK){
        const chunk=view.subarray(at,Math.min(view.length,at+CHUNK));
        const response=await fetch(upload+'?offset='+s.offset+'&total='+s.total,{method:'POST',headers:s.headers,body:chunk,signal:s.controller.signal});
        // A refused receiving buffer: the producer unwinds and releases its
        // GPU planes and scheduler grant before asking for memory again.
        if(response.status===202){reply({ok:false,status:503,text:JSON.stringify({detail:'Waiting for memory to save detail; request it again.'})});return;}
        if(!response.ok){reply({ok:false,status:response.status,text:await response.text()});return;}
        s.offset+=chunk.byteLength;
        if(s.offset>=s.collectAt){s.collectAt=s.offset+COLLECT_BYTES;await collect();}
      }
      reply({ok:true,status:200});return;
    }
    if(kind==='end'){
      streams.delete(key);
      try{
        const response=await fetch(s.url,{method:'POST',headers:{...s.headers,'X-Library-Native-Upload':s.token},signal:s.controller.signal});
        reply({ok:response.ok,status:response.status,text:await response.text()});
      }finally{await fetch(upload,{method:'DELETE'}).catch(()=>{});await collect();}
    }
  }catch(error){reply({ok:false,status:0,error:String(error?.message||error)});}
}
self.onmessage=async({data})=>{
  if(data.cancel){uploads.get(data.cancel)?.abort();return;}
  if(data?.stream){await streamMessage(data);return;}
  let {id,url,body,headers,responseType,priority}=data||{};const controller=new AbortController();uploads.set(id,controller);
  try{
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
