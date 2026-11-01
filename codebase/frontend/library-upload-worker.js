/* Uploads a large Library request body off the frame's main thread. */
const uploads=new Map();
self.onmessage=async({data})=>{
  if(data.cancel){uploads.get(data.cancel)?.abort();return;}
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
