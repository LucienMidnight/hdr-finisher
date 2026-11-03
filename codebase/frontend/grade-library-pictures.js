/* Publication follows saving, independently of Grade's render/edit queue. */
(function(root) {
  "use strict";
  function create({snapshot, capture, store, sources, send, defer, now=Date.now}) {
    let latest=0, flight=null, releasedAt=0, changedAt=0, changeKey=null;
    function changed(key){if(key!==undefined&&key===changeKey)return;changeKey=key;changedAt=now();releasedAt=0;}
    function released(){releasedAt=now();}
    function available(ticket) {
      const id=++latest, session=snapshot(), controller=new AbortController();
      flight?.abort();flight=controller;
      const packet={...ticket,id:session.sessionId+":"+id,sessionId:session.sessionId,
        audience:session.detached?"standalone":"docked",settled_at:releasedAt||changedAt||ticket.available_at};
      const current=()=>id===latest&&!controller.signal.aborted;
      send({...packet,stage:"pending"});
      // Run after the frame has had a presentation opportunity. Nothing here
      // is awaited by a slider release, save, or Grade render.
      defer(async()=>{
        let lane=null,reason="No clean full-frame Grade picture";
        try {
          if(!current())return;
          const frame=snapshot();
          if(frame.sessionId!==packet.sessionId)throw Error("Grade photo changed before hand-off");
          reason=frame.reason||reason;
          if(frame.revision===ticket.revision&&frame.clean) {
            try {
              const pixels=await capture(frame);
              if(!current())return;
              if(pixels) {
                const saved=await store(packet,frame.lane,pixels,controller.signal);
                if(!current())return;
                if(saved){lane=frame.lane;send({...packet,stage:"picture",lane,source:"Grade picture"});}
                else reason="Capture could not be stored for the saved grade";
              }
            } catch(error) { if(!current())return;reason="Grade picture capture failed: "+error.message; }
          }
          if(!current())return;
          // The other lane (or both lanes on a capture miss) only finishes
          // Grade's already developed photo. No RAW decode is requested.
          const prepared=await sources(packet,controller.signal);
          if(current())send({...packet,...prepared,stage:"sources",captured_lane:lane,
            source:"finishing redraw",reason:lane?"Grade only supplied "+lane:reason});
        } catch(error) {
          if(current())send({...packet,stage:"failed",reason:error.message});
        }
      });
    }
    return Object.freeze({available,changed,released,getSnapshot:snapshot,dispose(){latest++;flight?.abort();}});
  }
  const api={create};
  if(typeof module!=="undefined"&&module.exports){module.exports=api;return;}
  const channel=new BroadcastChannel("hdr-library-grade-picture");
  let presented=null;
  window.addEventListener("hdrfinisher:preview-presented",event=>{presented=event.detail;});
  const snapshot=()=>{
    const gpu=state.gpuPreview, source=gpu?.scopeSources?.get(els.previewCanvas), frame=gpu?.lastPresentedFrame;
    let reason="No retained whole-frame Grade picture";
    const clean=!!source&&presented?.sessionId===state.session?.session_id
      &&presented.generation===source.applicationGeneration
      &&!presented.coarse&&presented.wholeFrame!==false&&frame?.execution==="direct"&&source.serial===gpu.renderSerials.get(els.previewCanvas)
      &&source.sessionId===state.session?.session_id&&source.lane===state.currentView
      &&source.applicationGeneration===state.previewGeneration[source.lane]
      &&Math.max(source.width,source.height)<=2560
      &&!state.previewScheduler?.interacting&&!state.comparePeekActive
      &&!state.denoiseRuntime?.[source.lane]?.showOriginal&&!denoiseNoiseViewActive(source.lane)
      &&!localsBypassed()&&!geometryDraftActive()
      &&(source.lane!=="hdr"||state.adjustments.hdr.highlight_section_enabled===false||state.adjustments.hdr.highlight_compression_target_nits===1000);
    if(source&&Math.max(source.width,source.height)>2560)reason="Whole-frame Grade picture exceeds the screen-preview tier";
    else if(frame?.execution!=="direct")reason="Grade has a tiled or zoom-region picture";
    else if(source?.lane==="hdr"&&state.adjustments.hdr.highlight_compression_target_nits!==1000)reason="Library uses its fixed 1000-nit finishing target";
    return {sessionId:state.session?.session_id,revision:state.editRevision,lane:source?.lane,
      detached:!!root.HDRLibraryHost?.isDetached(),clean,reason,width:source?.width,height:source?.height,
      sourceSerial:source?.serial,generation:source?.applicationGeneration};
  };
  root.HDRGradeLibraryPictures=create({snapshot,
    defer:work=>requestAnimationFrame(()=>setTimeout(()=>void work(),0)),
    capture:async frame=>{
      const gpu=state.gpuPreview,source=gpu?.scopeSources.get(els.previewCanvas);
      if(source?.serial!==frame.sourceSerial||state.editRevision!==frame.revision)return null;
      return gpu.analyzeScope(els.previewCanvas,{width:frame.width,height:frame.height,tier:"picture",raw:"rgba",snapshot:true,transient:true});
    },
    store:async(packet,lane,pixels,signal)=>{
      const query=new URLSearchParams({grade:packet.grade_identity,revision:packet.revision,lane,
        width:pixels.width,height:pixels.height,stride:pixels.stride});
      const response=await HDRLibraryUpload.send("/api/library/grade-picture/"+packet.sessionId+"?"+query,{body:pixels.body,signal});
      return response.ok;
    },
    sources:async(packet,signal)=>{
      const response=await fetch("/api/library/grade-picture-source/"+packet.sessionId+"?"+new URLSearchParams({grade:packet.grade_identity}),{method:"POST",signal});
      if(!response.ok)throw Error("Grade source hand-off was refused: "+response.status);
      return response.json();
    },send:packet=>channel.postMessage(packet)});
  for(const event of ["pointerup","pointercancel","change"])
    window.addEventListener(event,event=>{
      if(state.activeWorkflow==="grade"&&event.target.closest?.("input,canvas,.instrument,.geometry-controls"))
        root.HDRGradeLibraryPictures.released();
    },true);
  window.addEventListener("pagehide",()=>{root.HDRGradeLibraryPictures.dispose();channel.close();});
})(typeof window==="undefined"?globalThis:window);
