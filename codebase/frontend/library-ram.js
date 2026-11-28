/* RAM shares come from the one backend owner; VRAM stays with gpu/activity. */
(function(root) {
  const caches=new Map();
  let limits={thumbnails:512*1024**2,sharp:512000000};
  function used(share) {let bytes=0;for(const c of caches.values())if(c.share===share)bytes+=c.bytes();return bytes;}
  function trim(share,target,reason="cache_share_limit") {
    const before=used(share);
    if(before<=target)return;
    for(const c of caches.values())if(c.share===share && used(share)>target)c.trim(Math.max(0,c.bytes()-(used(share)-target)));
    const freed=before-used(share);
    if(freed>0)root.HDRDiagnostics?.event("memory","cache_trimmed",{
      route:"cpu",reason,share,resident_bytes:before,budget_bytes:target,freed_bytes:freed,
    });
  }
  function enforce() {for(const share of Object.keys(limits))trim(share,limits[share]);}
  function register(key,share,bytes,release) {caches.set(key,{share,bytes,trim:release});}
  function admit(share,bytes,exclude=null) {
    const other=used(share)-(exclude ? caches.get(exclude)?.bytes() || 0 : 0);
    return other+bytes<=limits[share];
  }
  let reports=Promise.resolve();
  function report() {
    // The timer and explicit reclaim both use the same backend report keys.
    // Send their snapshots in order, measuring bytes when each request starts.
    const pending=reports.catch(()=>{}).then(sendReport);
    reports=pending;
    return pending;
  }
  async function sendReport() {
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
    // The main process decides when to trim (once per level rise, then per
    // cool-down); this only carries it out.
    if(value.reclaim)for(const share of Object.keys(limits))trim(share,value.reclaimLevel==='critical'?0:used(share)/2,'system_memory_pressure');
  }
  root.HDRLibraryRAM={register,admit,enforce,apply,report,limit:share=>limits[share],used,
    snapshot:()=>Object.fromEntries(Object.keys(limits).map(k=>[k,{bytes:used(k),limitBytes:limits[k]}]))};
  if(typeof window!=='undefined') {let running=false;setInterval(async()=>{if(running)return;running=true;try{await report();}catch(e){console.debug(e.message);}finally{running=false;}},500);}
})(typeof window==='undefined'?globalThis:window);
