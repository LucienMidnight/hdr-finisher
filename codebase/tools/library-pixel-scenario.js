async function({photo,edge}){
   const w=window,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
   const record={name:photo.replaceAll('\\','/').split('/').pop(),photo};
   let canvas,gpu,original,captured,refusal;
   const watch=setInterval(()=>{const job=HDRLibraryGrants.snapshot().jobs.find(j=>j.path===photo&&j.reason==='needs more memory'&&j.estimate>4e9);if(job){refusal='Needs more memory: '+job.estimate;controller.abort();}},250);
   try{
    HDRLibraryScenes.viewport([photo],[]);
    const meta=await HDRLibraryScenes.load(photo,edge,controller.signal,0,false,null,{viewportDemand:true});
    record.width=meta.width;record.height=meta.height;record.route=meta.route;record.actual_edge=meta.edge;record.lanes={};
    gpu=await HDRLibraryPictures.initialize();original=gpu.renderTo;
    gpu.renderTo=async function(target,...args){const result=await original.call(this,target,...args);captured=await this.analyzeScope(target,{width:args[9].width,height:args[9].height,tier:'picture',raw:true});return result;};
    canvas=document.createElement('canvas');canvas.id=edge===640?'fixture-grid-picture':'fixture-single-picture';document.body.append(canvas);
    w.__fixtureCaptured={};
    for(const lane of ['sdr','hdr']){
     captured=null;await HDRLibraryPictures.show(meta,canvas,controller.signal,()=>true,lane==='hdr');
     if(!captured?.halves)throw Error('No finished pixels');
     const bytes=new Uint8Array(captured.halves.buffer).slice();
     w.__fixtureCaptured[lane]=bytes;record.lanes[lane]=bytes.length;
    }
   }catch(error){record.error=refusal||String(error.message||error);}
   finally{clearTimeout(timer);clearInterval(watch);HDRLibraryScenes.viewport([],[]);if(gpu&&original)gpu.renderTo=original;canvas?.remove();}

return record;
}