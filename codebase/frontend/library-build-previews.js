/* Explicit preparation uses the existing scene queues, draw graph and Activity. */
window.HDRLibraryBuildPreviews=(()=>{
  let job=null,usage=null;
  const changed=()=>window.dispatchEvent(new Event('library-work-changed'));
  async function api(route,body,signal){const response=await fetch('/api/library/built-previews'+route,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'Preview preparation failed');return value;}
  const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  async function refresh(){usage=await api('');changed();return usage;}
  async function run(paths){
    if(job?.state==='running'||job?.state==='paused')throw Error('Preview building is already running. Cancel it in Activity first.');
    const controller=new AbortController();job={state:'running',done:0,total:paths.length,controller,error:''};changed();
    HDRLibraryStopwatch('built_previews_started',{count:paths.length,picture_size:'screen preview'});
    try{
      for(const path of paths){
        for(;;){
          if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
          const health=await fetch('/api/library/health',{signal:controller.signal}).then(r=>r.json());
          if(!health.helper.paused&&!health.helper.source_busy)break;
          job.state='paused';changed();await wait(250);
        }
        job.state='running';job.path=path;changed();
        for(;;){
          try{
            let usable=true;
            try{await HDRLibraryPictures.initialize();}catch{usable=false;}
            if(!usable){const result=await api('/cpu',{path,...HDRLibraryScreenPreviews.display()},controller.signal);if(!result.saved)throw Error('Preview was not saved.');}
            else {
              const meta=await HDRLibraryScenes.load(path,2560,controller.signal,99);
              meta.buildPreview=true;meta.draw_priority=99;meta.log_view='build previews';
              const canvas=document.createElement('canvas');
              for(const hdr of [true,false])await HDRLibraryPictures.show(meta,canvas,controller.signal,()=>!controller.signal.aborted,hdr);
            }
            break;
          }catch(error){if(error.libraryYield&&!controller.signal.aborted){await wait(100);continue;}throw error;}
        }
        job.done++;HDRLibraryStopwatch('built_previews_progress',{path,count:job.done,total:job.total,picture_size:'screen preview'});changed();
      }
      job.state='finished';
    }catch(error){job.state=controller.signal.aborted?'cancelled':'failed';job.error=controller.signal.aborted?'':error.message;}
    finally{await refresh();HDRLibraryStopwatch('built_previews_finished',{count:job.done,total:job.total,reason:job.state+(job.error?' · '+job.error:''),picture_size:'screen preview'});changed();}
    return snapshot();
  }
  async function start(selection){
    const plan=await api('/plan',selection);usage=plan;
    if(!plan.count)throw Error('No indexed photos in this selection.');
    if(!plan.fits){await HDRLibraryDialogs.ask({title:'No room for built previews',message:'Protected previews fill the limit or the disk has too little free space. Discard some built previews or select fewer photos.',confirm:'OK',cancel:'Close'});return;}
    const fits=plan.fits<plan.count;
    const answer=await HDRLibraryDialogs.ask({title:'Build previews',message:`${plan.count.toLocaleString()} photos · estimated ${(plan.estimated_bytes/1024**3).toFixed(2)} GiB. Protected previews: ${(plan.protected_bytes/1024**3).toFixed(2)} of ${(plan.limit_bytes/1024**3).toFixed(0)} GiB.${fits?' The whole selection will not fit. Build the first '+plan.fits.toLocaleString()+' photos, or cancel and select fewer.':''} HDR and SDR screen previews stay until discarded.`,confirm:fits?'Build fewer':'Build previews'});
    if(answer)void run(plan.paths.slice(0,plan.fits));
  }
  async function discard(selection){const answer=await HDRLibraryDialogs.ask({title:'Discard built previews',message:'Remove protected screen previews for these photos. Originals and grades stay.',confirm:'Discard previews'});if(answer){await api('/discard',selection);await refresh();}}
  function cancel(){job?.controller.abort();changed();}
  function snapshot(){return {job:job?{state:job.state,done:job.done,total:job.total,path:job.path,error:job.error}:null,usage};}
  void refresh().catch(()=>{});
  return Object.freeze({start,run,discard,cancel,snapshot,refresh});
})();
