/* Authored composition is independent of preview pixels and app preferences. */
window.HDRPhotoFramingUI = (() => {
  const $=id=>document.getElementById(id),panel=$("photo-frame-popover"),button=$("photo-frame-toggle");
  let draft=null,sequence=0,group=null;
  function settings(){return draft && draft.session===state.session?.session_id?draft.value:state.editDocument?.framing||HDRPhotoFraming.defaults();}
  function dimensions(){return sourcePixelFrameDimensions(state.adjustments?.shared?.geometry)||state.session?.source||{width:1,height:1};}
  function change(mutator){
    if(!state.session)return;
    const value=structuredClone(settings());mutator(value);draft={session:state.session.session_id,value};sequence++;
    state.documentDirty=true;syncProjectBadge();updateExportAvailability();render();applyZoomGeometry();
  }
  async function commit(){
    if(!draft)return;
    const current=draft,token=sequence;
    const ok=await queueEditCommand("set_photo_framing",{framing:structuredClone(current.value)},null,{refreshPreview:false,historyGroup:group});
    if(draft===current&&sequence===token){draft=null;if(!ok&&state.session?.session_id===current.session)await refreshEditState();render();applyZoomGeometry();}
    window.HDRProofing?.invalidate();
  }
  function render(){
    const s=settings();button.disabled=!state.session;$("photo-framing-enabled").checked=s.enabled;
    const size=dimensions(),box=HDRPhotoFraming.layout(size.width,size.height,s);
    $("photo-frame-dimensions").textContent=`Photo ${Math.round(size.width)} × ${Math.round(size.height)} · Framed ${box.width} × ${box.height} source px`;
    for(const name of ["frame","border"]){
      const layer=s[name];$("photo-"+name+"-enabled").checked=layer.enabled;$("photo-"+name+"-color").value=layer.color;
      $("photo-"+name+"-unit").value=layer.unit;
      const field=$("photo-"+name+"-value"),slider=$("photo-"+name+"-slider");
      if(document.activeElement!==field)field.value=String(Number(layer.value.toFixed(6)));
      slider.max=String(Math.max(layer.unit==="percent"?50:Math.min(size.width,size.height)/2,layer.value));slider.value=String(layer.value);
      slider.step=layer.unit==="percent"?"0.01":"1";field.step="any";
      field.setAttribute("aria-label",`${name==="frame"?"Frame":"Border"} thickness in ${layer.unit==="percent"?"percent of cropped photo shorter side":"cropped source pixels"}`);
    }
  }
  function close(focus=true){panel.classList.add("hidden");button.setAttribute("aria-expanded","false");if(focus)button.focus();}
  button.addEventListener("click",()=>{const open=panel.classList.toggle("hidden")===false;button.setAttribute("aria-expanded",String(open));if(open){render();$("photo-framing-enabled").focus();}});
  $("photo-frame-close").addEventListener("click",()=>close());
  document.addEventListener("pointerdown",event=>{if(!panel.classList.contains("hidden")&&!event.target.closest("#photo-frame-popover,#photo-frame-toggle"))close(false);});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!panel.classList.contains("hidden")){event.preventDefault();close();}});
  $("photo-framing-enabled").addEventListener("change",event=>{group="framing-"+crypto.randomUUID();change(s=>s.enabled=event.target.checked);void commit();});
  for(const name of ["frame","border"]){
    $("photo-"+name+"-enabled").addEventListener("change",event=>{group="framing-"+crypto.randomUUID();change(s=>s[name].enabled=event.target.checked);void commit();});
    for(const suffix of ["color","value","slider"]){
      const field=$("photo-"+name+"-"+suffix);
      field.addEventListener("pointerdown",()=>group="framing-"+crypto.randomUUID());
      field.addEventListener("focus",()=>{group="framing-"+crypto.randomUUID();});
      field.addEventListener("input",()=>{
        const value=suffix==="color"?field.value:Number(field.value);
        if(suffix!=="color"&&(!Number.isFinite(value)||value<0||field.value===""))return;
        change(s=>{s[name][suffix==="color"?"color":"value"]=value;});
      });
      field.addEventListener("change",()=>{if(!field.checkValidity()){field.value=String(settings()[name][suffix==="color"?"color":"value"]);render();}void commit();});
    }
    $("photo-"+name+"-unit").addEventListener("change",event=>{
      group="framing-"+crypto.randomUUID();const size=dimensions(),to=event.target.value;
      change(s=>{s[name].value=HDRPhotoFraming.convert(s[name].value,s[name].unit,to,size.width,size.height);s[name].unit=to;});void commit();
    });
  }
  $("export-with-frame").addEventListener("change",()=>{applyZoomGeometry();window.HDRProofing?.invalidate();});
  window.addEventListener("hdrfinisher:workflowchange",()=>{render();applyZoomGeometry();});
  return {settings,render};
})();