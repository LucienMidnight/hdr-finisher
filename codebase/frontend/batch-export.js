/* The batch owns Library identities, never the live Grade document. */
(() => {
  const model = {paths:[],photos:[],presets:[],draft:null,saved:null,version:0,job:null,selected:new Set(),directory:"",grant:null,initialized:false,thumbnailEpoch:0,thumbnailURLs:new Map(),anchor:0,grid:true,closedJob:null};
  const $ = id => document.getElementById(id);
  const node = (tag, text = "", cls = "") => { const e = document.createElement(tag); e.textContent=text; e.className=cls; return e; };
  const button = (text, fn) => { const b=node("button",text,"button-secondary"); b.type="button"; b.onclick=()=>Promise.resolve(fn()).catch(report); return b; };
  const report = error => status.post({id:"batch-export",severity:"error",message:error.message||String(error)});
  async function api(url, data, method="POST") { const r=await fetch(url,data === undefined?{}:{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}); const p=await r.json(); if(!r.ok) throw Error(typeof p.detail==="string"?p.detail:"Export request failed."); return p; }
  async function presetURL() { const directory=state.appPreferences?.folders?.presetSave || await desktop?.getDefaultPresetDirectory?.(); return `/api/export-presets${directory?`?directory=${encodeURIComponent(directory)}`:""}`; }
  function settings() { const s=currentExportSettings(); delete s.output_path; delete s.path_grant; delete s.overwrite; delete s.overwrite_target; delete s.edit_revision; delete s.editing_measurements; return s; }
  function capture() { if(!model.draft)return; const v=model.draft.versions[model.version]; v.settings=settings(); v.quality_preset=els.exportPreset.value; v.pattern=$("batch-pattern").value; v.subfolder=$("batch-subfolder").value; v.name=$("batch-version-name").value.trim()||`Version ${model.version+1}`; v.reference_white=Number($("batch-white").value)||null; model.draft.name=$("batch-preset-name").value.trim()||"Untitled preset"; $("batch-modified").textContent=JSON.stringify(model.draft)!==JSON.stringify(model.saved)?"Modified":""; example(); }
  function applyVersion() {
    const v=model.draft.versions[model.version], s=v.settings;
    const controls={format:"exportFormat",quality:"exportQuality",jpeg_gain_map_quality:"jpegGainMapQuality",jpeg_gain_map_scale:"jpegGainMapScale",avif_bit_depth:"avifBitDepth",avif_chroma_subsampling:"avifChromaSubsampling",avif_gain_map_quality:"avifGainMapQuality",avif_gain_map_scale:"avifGainMapScale",sdr_png_bit_depth:"sdrPngBitDepth",jpegxl_precision:"jpegxlPrecision",dithering:"exportDithering",metadata_policy:"exportMetadataPolicy"};
    for(const [key,id] of Object.entries(controls)) if(s[key]!=null&&els[id]) els[id].value=String(s[key]);
    els.jpegChromaSubsampling.value=s.jpeg_chroma_subsampling||"420"; els.jpegUltrahdrChromaSubsampling.value=s.jpeg_chroma_subsampling||"420";
    const f=s.output_finishing||{}; for(const [key,id] of Object.entries({resize_mode:"exportResizeMode",long_edge:"exportLongEdge",width:"exportWidth",height:"exportHeight",sharpening:"exportSharpening"}))if(f[key]!=null)els[id].value=String(f[key]);
    els.exportPreventEnlargement.checked=f.prevent_enlargement!==false; if(els.exportGuaranteePeak)els.exportGuaranteePeak.checked=s.guarantee_hdr_peak===true; els.exportPreset.value=v.quality_preset||"custom";
    $("batch-pattern").value=v.pattern; $("batch-subfolder").value=v.subfolder; $("batch-version-name").value=v.name; $("batch-white").value=String(v.reference_white||"");
    updateExportAvailability(); els.exportQualityValue.textContent=els.exportQuality.value; example();
  }
  function choose(preset) { model.draft=structuredClone(preset); model.saved=structuredClone(preset); model.version=0; $("batch-preset-name").value=preset.name; $("batch-modified").textContent=""; renderTabs(); applyVersion(); renderPresets(); renderGrid(); }
  function renderTabs() { $("batch-versions").replaceChildren(...model.draft.versions.map((v,i)=>{ const b=button(v.name,()=>{capture();model.version=i;renderTabs();applyVersion();});b.setAttribute("aria-pressed",String(i===model.version));return b;}),button("+ Add version",()=>{capture();const v=structuredClone(model.draft.versions[model.version]);v.name=`Version ${model.draft.versions.length+1}`;model.draft.versions.push(v);model.version=model.draft.versions.length-1;renderTabs();applyVersion();capture();}),button("Remove version",()=>{if(model.draft.versions.length<2)return;model.draft.versions.splice(model.version,1);model.version=0;renderTabs();applyVersion();capture();})); }
  function formatName(version) { return [...els.exportFormat.options].find(o=>o.value===version.settings.format)?.textContent || version.settings.format; }
  const HDR_FORMATS=["avif_gain_map","jpeg_ultrahdr","jpegxl_hdr"];
  // An SDR-only photo only loses something when the preset has an HDR version.
  function hdrSkipped(photo,versions=model.draft?.versions||[]){return !!photo.sdr_only&&versions.some(v=>HDR_FORMATS.includes(v.settings.format));}
  const OUTCOMES={exported:"Exported",renamed:"Renamed",skipped:"Skipped",failed:"Failed"};
  // The written file relative to the export folder, keeping its sub-folder.
  function writtenName(output,directory){if(!output)return "—";const unify=value=>String(value).replace(/\\/g,"/").replace(/\/+$/,"");const file=unify(output),folder=directory?unify(directory)+"/":"";const relative=folder&&file.toLowerCase().startsWith(folder.toLowerCase())?file.slice(folder.length):file.split("/").pop();return String(output).includes("\\")?relative.replace(/\//g,"\\"):relative;}
  function fileCount(photo) { return (model.draft?.versions||[]).filter(v=>!photo.sdr_only||!HDR_FORMATS.includes(v.settings.format)).length; }
  function renderPresets() { $("batch-preset-list").replaceChildren(...model.presets.map(p=>{const b=button("",()=>choose(p)); b.className="batch-preset";b.setAttribute("aria-pressed",String(p.id===model.draft?.id));b.append(node("strong",p.name),node("span",p.versions.map(formatName).join(" + "))); b.oncontextmenu=event=>{event.preventDefault();const menu=node("div","","window-menu-popover");for(const [label,fn]of [["Rename",()=>rename(p)],["Duplicate",()=>duplicate(p)],["Delete",()=>removePreset(p)]])menu.append(button(label,()=>{menu.remove();return fn();}));menu.style.position="fixed";menu.style.left=`${event.clientX}px`;menu.style.top=`${event.clientY}px`;document.body.append(menu);const dismiss=ev=>{if(!menu.contains(ev.target)){menu.remove();document.removeEventListener("pointerdown",dismiss);}};document.addEventListener("pointerdown",dismiss);};return b;})); }
  async function loadPresets(){const p=await api(await presetURL());model.presets=p.presets;if(!model.draft)choose(model.presets.find(p=>p.id===localStorage.getItem("last-export-preset"))||{id:crypto.randomUUID().replaceAll("-",""),name:"My export",versions:[{name:"Version 1",pattern:"{filename}_{version}",subfolder:"",settings:settings(),quality_preset:els.exportPreset.value,reference_white:null}]});else renderPresets();}
  async function save(asNew=false){capture();if(asNew)model.draft.id=crypto.randomUUID().replaceAll("-","");const p=await api(await presetURL(),model.draft);choose(p);await loadPresets();}
  async function rename(p){choose(p);$("batch-preset-name").focus();$("batch-preset-name").select();}
  async function duplicate(p){choose(p);model.draft.name=p.name+" copy";$("batch-preset-name").value=model.draft.name;await save(true);}
  async function removePreset(p){if(!await window.HDRDialogs.confirm(p.name,{title:"Delete export preset?",confirmLabel:"Delete",destructive:true}))return;const url=await presetURL();await api(url.replace("?",`/${p.id}?`)+(url.includes("?")?"":`/${p.id}`),{},"DELETE");model.draft=null;await loadPresets();}
  function example(){
    if(!model.draft)return;
    const photo=model.photos[0]||{source_path:"example.raw",copy_name:"Copy 1",rating:3};
    const version=model.draft.versions[model.version];
    try {
      const name=HDRExportPatterns.render(version.pattern,photo,1,version.name,model.draft.name);
      $("batch-example").textContent=`Example: ${version.subfolder?`${version.subfolder}/`:""}${name}${exportExtensionForFormat(version.settings.format)} · Invalid filename characters become _.`;
    }catch(error){$("batch-example").textContent=error.message;}
    $("batch-summary").textContent=`${model.photos.length} photos · up to ${model.photos.length*model.draft.versions.length} files. Each uses its last saved grade.${model.photos.some(p=>p.unsaved)?" Unsaved changes in Grade are not exported.":""}${model.photos.some(p=>hdrSkipped(p))?" HDR versions are skipped for SDR-only photos.":""}${model.photos.some(p=>p.hdr_compatibility==="unknown")?" HDR compatibility will be checked during export.":""}`;
    const files=model.photos.reduce((n,p)=>n+fileCount(p),0);
    $("batch-count").textContent=`${model.photos.length} photos · ${model.draft.versions.length} versions · ${files} files`;
    const flagged=model.photos.filter(p=>p.unsaved||hdrSkipped(p)).length;
    $("batch-notice").hidden=!flagged;
    $("batch-notice").textContent=`${flagged} ${flagged===1?"photo needs":"photos need"} a look before exporting. Details are on each photo below.`;
    $("batch-empty").hidden=!!model.photos.length;
    $("batch-run").textContent=`Export ${files} files`;
    $("batch-run").disabled=!files||!!model.job&&!terminal(model.job);
  }

  function terminal(job){return ["finished","failed","cancelled"].includes(job.state);}
  function selectPhoto(index,event={}) {
    const photo=model.photos[index]; if(!photo)return;
    if(event.shiftKey){if(!event.ctrlKey&&!event.metaKey)model.selected.clear();for(let i=Math.min(model.anchor,index);i<=Math.max(model.anchor,index);i++)model.selected.add(model.photos[i].path);}
    else {if(!event.ctrlKey&&!event.metaKey)model.selected.clear();if(model.selected.has(photo.path))model.selected.delete(photo.path);else model.selected.add(photo.path);model.anchor=index;}
    for(const tile of $("batch-grid").children)tile.setAttribute("aria-selected",String(model.selected.has(tile.dataset.path)));
  }
  function renderGrid(){
    const grid=$("batch-grid");if(!grid)return;
    // Keep decoded images and keyboard focus in place while progress is polled.
    const old=new Map([...grid.children].map(e=>[e.dataset.path,e]));
    const tiles=model.photos.map((p,index)=>{
      let row=old.get(p.path);
      if(!row){
        row=node("div","","batch-photo");row.dataset.path=p.path;row.tabIndex=0;row.setAttribute("role","option");
        const picture=node("div","","batch-picture"),img=node("img");img.alt="";img.hidden=true;img.decoding="async";
        img.onload=()=>{img.hidden=false;picture.classList.remove("failed");};img.onerror=()=>{img.hidden=true;picture.classList.add("failed");picture.setAttribute("aria-label","Picture unavailable");};
        picture.append(img);row.append(picture,node("div","","batch-caption"));
      }
      row.onclick=event=>selectPhoto(index,event);row.onkeydown=event=>{if([" ","Enter"].includes(event.key)){event.preventDefault();selectPhoto(index,event);}};
      row.setAttribute("aria-selected",String(model.selected.has(p.path)));
      const picture=row.firstChild,img=picture.querySelector("img"),url=model.thumbnailURLs.get(p.path);
      if(url&&img.getAttribute("src")!==url){img.hidden=true;img.src=url;}
      const caption=row.lastChild;caption.replaceChildren(node("strong",p.name+(p.copy_name?` · ${p.copy_name}`:"")),node("small",`${fileCount(p)} files`));
      for(const flag of [p.unsaved?"Unsaved changes in Grade · last saved grade used":"",hdrSkipped(p)?"SDR only · HDR version skipped":""])if(flag)caption.append(node("span",flag,"batch-flag"));
      picture.querySelectorAll(".batch-badge,progress").forEach(e=>e.remove());
      const results=model.job?.results.filter(r=>r.photo===p.path)||[],active=model.job?.active_photo===p.path&&!terminal(model.job);
      const skipped=results.filter(r=>r.outcome==="skipped").length,failed=results.some(r=>r.outcome==="failed");
      const label=failed?"Failed":active?"Exporting…":skipped?`${skipped} skipped`:results.length?"Done":"";
      if(label)picture.append(node("span",label,"batch-badge"));
      if(active){const meter=node("progress","","status-entry-progress batch-photo-progress");meter.max=model.job.photo_total||model.draft.versions.length;meter.value=model.job.photo_completed||0;meter.setAttribute("aria-label",`Versions completed for ${p.name}`);picture.append(meter);}
      return row;
    });
    if(tiles.length!==grid.children.length||tiles.some((e,i)=>e!==grid.children[i]))grid.replaceChildren(...tiles);
    example();
  }
  function renderJob(){
    const j=model.job,strip=$("batch-run-strip");strip.hidden=!j||model.closedJob===j.id;if(!j)return;
    const done=terminal(j),counts=Object.fromEntries(["exported","renamed","skipped","failed"].map(k=>[k,j.results.filter(r=>r.outcome===k).length]));
    $("batch-progress").textContent=done?`${j.state==="cancelled"?"Cancelled · ":""}${counts.exported+counts.renamed} files exported · ${counts.renamed} renamed · ${counts.skipped} skipped${counts.failed?` · ${counts.failed} failed`:""}`:`${j.state==="paused"?"Paused · ":""}Exporting ${Math.min(j.completed+1,j.total)} of ${j.total} files`;
    $("batch-eta").textContent=!done&&j.estimated_seconds?`about ${j.estimated_seconds}s left`:"";
    $("batch-meter").hidden=done;$("batch-meter").max=Math.max(1,j.total);$("batch-meter").value=j.completed;
    $("batch-pause").hidden=$("batch-cancel").hidden=done;$("batch-pause").textContent=j.state==="paused"?"Resume":"Pause";
    $("batch-reveal").hidden=$("batch-close").hidden=!done;
    $("batch-results").hidden=!done;
    $("batch-results").replaceChildren(...j.results.map(r=>{const item=node("li","","batch-result");item.append(node("span",writtenName(r.output_path,j.directory)),node("span",`${model.photos.find(p=>p.path===r.photo)?.name||r.photo} · ${r.version}`),node("span",(OUTCOMES[r.outcome]||r.outcome)+(r.reason?` · ${r.reason}`:""),`batch-outcome batch-outcome-${r.outcome}`));return item;}));
  }
  async function thumbnails(epoch, paths){if(epoch!==model.thumbnailEpoch||!paths.length)return;const response=await api("/api/library/thumbnails",{paths:paths.slice(0,256),wanted:paths.slice(0,256),client:"batch-export",edge:360,priority:5});if(epoch!==model.thumbnailEpoch)return;for(const item of response.ready)model.thumbnailURLs.set(item.path,item.url);for(const failure of response.errors||[]){const tile=[...$("batch-grid").children].find(e=>e.dataset.path===failure.path);tile?.firstChild.classList.add("failed");}renderGrid();const remaining=[...response.pending,...paths.slice(256)];if(remaining.length)setTimeout(()=>thumbnails(epoch,remaining).catch(report),800);}
  async function setPhotos(paths){model.paths=[...new Set(paths)];model.photos=(await api("/api/batch-export/photos",{paths:model.paths})).photos;model.selected.clear();model.anchor=0;renderGrid();thumbnails(++model.thumbnailEpoch,model.paths).catch(report);}
  async function folder(){const selected=await desktop?.chooseBatchExportDirectory?.(model.directory);if(selected){model.directory=selected.path;model.grant=selected.grant;}else if(!desktop)model.directory=$("batch-directory").value;$("batch-directory").value=model.directory;return selected;}
  async function run(preset=model.draft,paths=model.paths){capture();if(!paths.length)throw Error("Add photos from the Library before exporting.");if(!model.directory)await folder();if(!model.directory)return;if(desktop&&!model.grant){if(!await folder())return;}if(model.photos.some(p=>p.unsaved)&&!await HDRDialogs.confirm("The photo open in Grade has unsaved changes. This batch exports its last saved grade.",{title:"Export saved grades",confirmLabel:"Export"}))return;const job=await api("/api/batch-export",{paths,preset,directory:model.directory,path_grant:model.grant});model.grant=null;model.job=job;localStorage.setItem("last-export-directory",model.directory);localStorage.setItem("last-export-preset",preset.id);poll();}
  async function poll(){if(!model.job)return;model.job=await api(`/api/batch-export/${model.job.id}`);window.dispatchEvent(new CustomEvent("batch-export-activity",{detail:model.job}));renderJob();renderGrid();if(!terminal(model.job))setTimeout(()=>poll().catch(report),750);}
  async function control(action){if(model.job){model.job=await api(`/api/batch-export/${model.job.id}`,{action});renderJob();}}
  function view(grid){model.grid=grid;document.body.classList.toggle("batch-export-grid",grid);$("batch-grid").hidden=!grid;$("batch-empty").hidden=!!model.photos.length;$("batch-grid-panel").classList.toggle("batch-preview",!grid);for(const kind of ["grid","preview"]){const b=$("batch-view-"+kind);b.classList.toggle("active",grid===(kind==="grid"));b.setAttribute("aria-pressed",String(grid===(kind==="grid")));}}
  async function open(paths=[],options={}){await init();await setPhotos(paths);activateWorkflowTab("export",{focus:true,batch:true});view(options.fromLibrary!==false);}
  async function quick(paths){await init();await setPhotos(paths);const dialog=node("dialog","","application-dialog app-dialog");dialog.classList.add("batch-quick-dialog");const heading=node("h2","Quick export…"), select=node("select"), examples=node("p"), destination=node("input");for(const p of model.presets)select.append(new Option(p.name,p.id));select.value=model.presets.find(p=>p.id===localStorage.getItem("last-export-preset"))?.id||model.presets[0]?.id||"";destination.value=model.directory;destination.readOnly=!!desktop;const describe=()=>{const p=model.presets.find(p=>p.id===select.value);examples.textContent=p?p.versions.map(v=>`${v.name}: ${v.subfolder?`${v.subfolder}/`:""}${HDRExportPatterns.render(v.pattern,model.photos[0]||{source_path:"example.raw"},1,v.name,p.name)}${exportExtensionForFormat(v.settings.format)}`).join("\n"):"Create an export preset on the Export page first.";};select.onchange=describe;describe();const note=node("p",`${model.photos.length} photos. Each uses its last saved grade.${model.photos.some(p=>p.unsaved)?" Unsaved changes in Grade will not be exported.":""}${model.photos.some(p=>hdrSkipped(p,model.presets.find(x=>x.id===select.value)?.versions||[]))?" HDR versions are skipped for SDR-only photos.":""}${model.photos.some(p=>p.hdr_compatibility==="unknown")?" HDR compatibility will be checked during export.":""}`);dialog.append(heading,select,examples,destination,button("Choose folder…",async()=>{await folder();destination.value=model.directory;}),note,button("Open Export page",async()=>{await open(paths);dialog.close();dialog.remove();}),button("Cancel",()=>{dialog.close();dialog.remove();}),button("Export",async()=>{const preset=model.presets.find(p=>p.id===select.value);if(!preset)return;model.directory=destination.value;await run(preset,paths);dialog.close();dialog.remove();}));const content=node("div","","app-dialog-content"),header=node("div","","application-dialog-header"),actions=node("div","","app-dialog-actions");for(const child of [...dialog.children]){if(child===heading)header.append(child);else if(child.tagName==="BUTTON"&&!child.textContent.startsWith("Choose folder"))actions.append(child);else content.append(child);}const folderButton=[...content.children].find(e=>e.tagName==="BUTTON");const folderRow=node("div","","directory-picker-row");if(folderButton){destination.before(folderRow);folderRow.append(destination,folderButton);}dialog.replaceChildren(header,content,actions);heading.id="batch-quick-title";dialog.setAttribute("aria-labelledby",heading.id);document.body.append(dialog);dialog.showModal();}
  let initializing;
  function init(){return initializing ||= buildUI();}
  async function buildUI(){model.initialized=true;document.body.classList.add("batch-export-ready");model.directory=localStorage.getItem("last-export-directory")||els.exportDirectory.value;const rail=node("aside","","batch-preset-rail panel");rail.id="batch-preset-rail";
    const railHead=node("div","","workflow-rail-header");const add=button("+",()=>choose({id:crypto.randomUUID().replaceAll("-",""),name:"New export preset",versions:[{name:"Version 1",pattern:"{filename}_{version}",subfolder:"",settings:settings(),quality_preset:els.exportPreset.value}]}));add.className="top-icon-button";add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.setAttribute("aria-label","New preset");add.title="New preset";
    railHead.append(node("h2","Export presets","panel-title"),add);const list=node("div");list.id="batch-preset-list";rail.append(railHead,list,node("p","Right-click a preset to rename, duplicate or delete it. Presets are used by Quick export… in the Library.","helper batch-preset-help"));document.body.append(rail);
    const editor=node("section","","export-choice-section");editor.id="batch-preset-editor";const name=node("input");name.id="batch-preset-name";name.setAttribute("aria-label","Export preset name");const modified=node("span");modified.id="batch-modified";const tabs=node("div");tabs.id="batch-versions";const presetActions=node("div","","batch-preset-actions");presetActions.append(button("Save",()=>save()),button("Save as new",()=>save(true)),button("Revert",()=>choose(model.saved)));editor.append(name,modified,presetActions,tabs);els.exportFormat.closest("section").before(editor);
    const naming=node("section","","export-choice-section");for(const [id,label,value] of [["batch-version-name","Version name","Version 1"],["batch-pattern","File name pattern","{filename}_{version}"],["batch-subfolder","Sub-folder",""]]){const l=node("label",label),input=node("input");input.id=id;input.value=value;l.append(input);naming.append(l);}const tokenRow=node("div");for(const token of ["filename","copy","sequence:3","date:YYYYMMDD","rating","version","preset"])tokenRow.append(button(`{${token}}`,()=>{const input=$("batch-pattern");input.setRangeText(`{${token}}`,input.selectionStart,input.selectionEnd,"end");capture();}));naming.append(tokenRow);const whiteLabel=node("label","Reference white"),white=node("select");white.id="batch-white";white.append(new Option("Photo's saved reference white",""),new Option("100 nits","100"),new Option("203 nits","203"));whiteLabel.append(white);naming.append(whiteLabel);for(const id of ["batch-example","batch-summary"]){const p=node("p");p.id=id;naming.append(p);}const destLabel=node("label","Destination folder"),dest=node("input");dest.id="batch-directory";dest.value=model.directory;dest.readOnly=!!desktop;dest.onchange=()=>model.directory=dest.value;destLabel.append(dest);naming.append(destLabel,button("Choose folder…",folder));const runButton=button("Export files",()=>run());runButton.id="batch-run";runButton.className="button-primary";naming.append(runButton);els.exportConfirmButton.before(naming);
    const panel=node("section","","batch-grid-panel panel");panel.id="batch-grid-panel";
    const header=node("div","","batch-header"),title=node("div","","batch-heading"),count=node("span","","helper");count.id="batch-count";title.append(node("h2","Export batch","panel-title"),count);
    const tools=node("div","","batch-tools");
    for(const [kind,icon] of [["grid","M4 4h6v6h-6z M14 4h6v6h-6z M4 14h6v6h-6z M14 14h6v6h-6z"],["preview","M4 4h16v11h-16z M4 19h3 M10.5 19h3 M17 19h3"]]){const b=button("",()=>view(kind==="grid"));b.id="batch-view-"+kind;b.className="tool-button";b.setAttribute("aria-label",kind==="grid"?"Grid":"Preview");b.title=kind==="grid"?"Grid":"Preview";const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");path.setAttribute("d",icon);svg.append(path);b.append(svg);tools.append(b);}
    for(const [label,fn] of [["Add Library selection",()=>window.dispatchEvent(new CustomEvent("batch-export-add-selection"))],["Select all",()=>{model.selected=new Set(model.photos.map(p=>p.path));renderGrid();}],["Remove",()=>setPhotos(model.paths.filter(p=>!model.selected.has(p)))],["Clear",()=>setPhotos([])]]){const b=button(label,fn);b.className="tool-button";tools.append(b);}
    header.append(title,tools);const notice=node("p","","batch-notice");notice.id="batch-notice";notice.hidden=true;
    const grid=node("div");grid.id="batch-grid";grid.setAttribute("role","listbox");grid.setAttribute("aria-label","Photos in this batch");grid.setAttribute("aria-multiselectable","true");
    grid.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){e.preventDefault();model.selected=new Set(model.paths);renderGrid();}};
    const empty=node("p","Add a Library selection, or open a photo in Grade to add it here.","helper batch-empty");empty.id="batch-empty";
    const strip=node("section","","batch-run-strip");strip.id="batch-run-strip";strip.hidden=true;
    const line=node("div","","batch-run-line"),progress=node("strong"),eta=node("span","","helper"),actions=node("div","","batch-tools");progress.id="batch-progress";progress.setAttribute("aria-live","polite");eta.id="batch-eta";
    for(const [id,label,fn] of [["pause","Pause",()=>control(model.job?.state==="paused"?"resume":"pause")],["cancel","Cancel",()=>control("cancel")],["reveal","Show in Explorer",()=>desktop?.revealPath?.(model.job?.results.find(r=>r.output_path)?.output_path)],["close","Close",()=>{model.closedJob=model.job?.id;renderJob();}]]){const b=button(label,fn);b.id="batch-"+id;actions.append(b);}
    line.append(progress,eta,actions);const meter=node("progress","","status-entry-progress");meter.id="batch-meter";meter.setAttribute("aria-label","Overall export progress");const results=node("ul");results.id="batch-results";strip.append(line,meter,results);panel.append(header,notice,grid,empty,strip);document.body.append(panel);view(true);
    $("export-sheet").addEventListener("change",()=>capture());$("export-sheet").addEventListener("input",()=>capture());await loadPresets();}
  new MutationObserver(()=>{if(document.body.dataset.workflow==="export")init().then(async()=>{if(!model.paths.length&&window.HDRGradeSaving?.item()){await setPhotos([window.HDRGradeSaving.item()]);view(false);}}).catch(report);}).observe(document.body,{attributes:true,attributeFilter:["data-workflow"]});
  window.batchExport={open,quick,reveal:path=>desktop?.revealPath?.(path),activity:()=>model.job,add:paths=>setPhotos([...model.paths,...paths]),control};
})();
