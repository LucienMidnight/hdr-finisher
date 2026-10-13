/* The editor sends rules, never the library. Use the exact Library matcher. */
importScripts("library-query.js");
let photos=[], version="", metadata={}, loading=null;
const choices=new Map(), counts=new Map();
async function load() {
 if(loading)return loading;
 loading=(async()=>{
  const response=await fetch(`/api/library/smart-candidates?version=${encodeURIComponent(version)}`);
  if(!response.ok)throw new Error(await response.text());
  const result=await response.json();
  if(result.photos!==null){photos=result.photos;version=result.version;choices.clear();counts.clear();}
  const {photos:ignored,...rest}=result;metadata=rest;
 })();
 try{await loading;}finally{loading=null;}
}
self.onmessage=async ({data:{id,action,filters,field,knownVersion}})=>{
 try {
  if(action==="refresh"||action==="candidates"||!version)await load();
  let result;
  if(action==="candidates")result={...metadata,photos:knownVersion===version?null:photos};
  else if(action==="values") {
   if(!choices.has(field))choices.set(field,HDRLibraryQuery.values(photos,field));
   result=choices.get(field);
  } else {
   const key=JSON.stringify(filters);
   if(!counts.has(key)){
    if(counts.size>=100)counts.clear();
    counts.set(key,HDRLibraryQuery.count(photos,filters));
   }
   result={count:counts.get(key),indexing:metadata.indexing};
  }
  self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:error.message});}
};
