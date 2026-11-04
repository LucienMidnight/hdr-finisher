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
          let frame=snapshot();
          const until=Date.now()+2000;
          while(current()&&frame.waiting&&frame.revision===ticket.revision&&Date.now()<until){await new Promise(r=>setTimeout(r,16));frame=snapshot();}
          if(!current())return;
          if(frame.sessionId!==packet.sessionId)throw Error("Grade photo changed before hand-off");
          reason=frame.reason||reason;
          if(frame.revision===ticket.revision&&frame.clean) {
            try {
              packet.capture_started_at=now();
              const pixels=await capture(frame,controller.signal);
              packet.captured_at=now();
              if(!current())return;
              if(pixels) {
                const saved=await store(packet,frame.lane,pixels,controller.signal);
                if(!current())return;
                if(saved){packet.stored_at=now();lane=frame.lane;send({...packet,stage:"picture",lane,source:"Grade picture"});}
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
    const gpu=state.gpuPreview, frame=gpu?.lastPresentedFrame;
    const lane=state.currentView;
    const source=gpu?.scopeSources?.get(els.previewCanvas);
    const clean=!!frame&&presented?.sessionId===state.session?.session_id
      &&presented.generation===state.previewGeneration[lane]
      &&!presented.coarse&&presented.wholeFrame!==false
      &&frame.sessionId===state.session?.session_id&&frame.lane===lane
      &&frame.applicationGeneration===state.previewGeneration[lane];
    const eligible=presented?.wholeFrame!==false
      &&!state.previewScheduler?.interacting&&!state.comparePeekActive
      &&!state.denoiseRuntime?.[lane]?.showOriginal&&!denoiseNoiseViewActive(lane)
      &&!localsBypassed()&&!geometryDraftActive()
      &&(!state.adjustments.shared.overlay_mode||state.adjustments.shared.overlay_mode==="off")
      &&(lane!=="hdr"||state.adjustments.hdr.highlight_section_enabled===false||state.adjustments.hdr.highlight_compression_target_nits===1000);
    return {sessionId:state.session?.session_id,revision:state.editRevision,lane,
      detached:!!root.HDRLibraryHost?.isDetached(),clean:clean&&eligible,waiting:eligible&&!clean,
      reason:presented?.wholeFrame===false?"Grade is showing a zoom region":"No clean current Grade picture",
      width:source?.width,height:source?.height,execution:frame?.execution,
      sourceSerial:source?.serial,generation:frame?.applicationGeneration};
  };
  root.HDRGradeLibraryPictures=create({snapshot,
    defer:work=>setTimeout(()=>void work(),0),
    capture:async (frame,signal)=>{
      const gpu=state.gpuPreview;
      const current=()=>!signal.aborted&&state.session?.session_id===frame.sessionId&&state.editRevision===frame.revision
        &&state.previewGeneration[frame.lane]===frame.generation;
      // Reuse the settled whole-frame Grade scope picture for tiled Fit.
      // If it is not ready, Grade produces that same bounded clean picture
      // after its visible frame. Never change or resize the viewer canvas.
      const scopeReady=()=>{
        const source=gpu.scopeAnalysisCanvas&&gpu.scopeSources.get(gpu.scopeAnalysisCanvas);
        return source?.sessionId===frame.sessionId&&source.lane===frame.lane&&source.applicationGeneration===frame.generation;
      };
      while(current()&&(state.gpuDraftInFlight||gpu.activeRenderCount>0||gpu.scopeProxyFlight||(state.gpuScopeRequestInFlight&&!scopeReady())))await new Promise(r=>setTimeout(r,16));
      if(!current())return null;
      let canvas=els.previewCanvas,source=gpu.scopeSources.get(canvas);
      if(frame.execution!=="direct"||!source||Math.max(source.width,source.height)>2560){
        canvas=gpu.scopeAnalysisCanvas;source=canvas&&gpu.scopeSources.get(canvas);
        if(!source||source.sessionId!==frame.sessionId||source.lane!==frame.lane||source.applicationGeneration!==frame.generation){
          const rendered=await gpu.renderScopeProxy(frame.sessionId,frame.lane,state.adjustments,sampleCurvePoints,
            1600,localAdjustments(),frame.revision,projectReferenceWhiteNits(),
            {width:state.session.source.width,height:state.session.source.height},
            {applicationGeneration:frame.generation,isCurrent:current,gradeLibraryPicture:true});
          if(!rendered||!current())return null;
          canvas=rendered.canvas;source=gpu.scopeSources.get(canvas);
        }
      }
      if(!current()||!source||source.sessionId!==frame.sessionId||source.lane!==frame.lane||source.applicationGeneration!==frame.generation)return null;
      return gpu.analyzeScope(canvas,{width:source.width,height:source.height,tier:"picture",raw:"rgba",snapshot:true,transient:true});
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
