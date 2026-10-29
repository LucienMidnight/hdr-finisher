/* RAM shares come from the one backend owner; VRAM stays with gpu/activity. */
(function(root) {
  const caches=new Map();
  let limits={thumbnails:512*1024**2,sharp:512000000}, pressure='none';
  function used(share) {let bytes=0;for(const c of caches.values())if(c.share===share)bytes+=c.bytes();return bytes;}
  function trim(share,target) {
    for(const c of caches.values())if(c.share===share && used(share)>target)c.trim(Math.max(0,c.bytes()-(used(share)-target)));
  }
  function enforce() {for(const share of Object.keys(limits))trim(share,limits[share]);}
  function register(key,share,bytes,release) {caches.set(key,{share,bytes,trim:release});}
  function admit(share,bytes,exclude=null) {
    const other=used(share)-(exclude ? caches.get(exclude)?.bytes() || 0 : 0);
    return other+bytes<=limits[share];
  }
  async function report() {
    enforce();
    const response=await fetch('/api/library/memory-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({thumbnails:used('thumbnails'),sharp:used('sharp')})});
    if(!response.ok)throw Error('RAM owner unavailable');
    const value=await response.json();
    for(const share of Object.keys(limits))limits[share]=value.caches[share].limitBytes;
    enforce(); return value;
  }
  function apply(value) {
    for(const share of Object.keys(limits))if(value.caches?.[share])limits[share]=value.caches[share].limitBytes;
    enforce();
    const level=value.pressure==='critical' ? 'critical' : value.pressure==='moderate' || value.reclaim ? 'moderate' : 'none';
    if(level!=='none' && (pressure!==level || value.reclaim))for(const share of Object.keys(limits))trim(share,level==='critical'?0:used(share)/2);
    pressure=level;
  }
  root.HDRLibraryRAM={register,admit,enforce,apply,report,limit:share=>limits[share],used,
    snapshot:()=>Object.fromEntries(Object.keys(limits).map(k=>[k,{bytes:used(k),limitBytes:limits[k]}]))};
  if(typeof window!=='undefined') {let running=false;setInterval(async()=>{if(running)return;running=true;try{await report();}catch(e){console.debug(e.message);}finally{running=false;}},500);}
})(typeof window==='undefined'?globalThis:window);
