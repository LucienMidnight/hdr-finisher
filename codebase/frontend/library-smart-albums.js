/* Saved filters: the same query engine drives the editor, count and album. */
(() => {
 "use strict";
 const {make,ask,showMenu}=HDRLibraryDialogs, query=HDRLibraryQuery;
 const workerURL=new URL("library-smart-worker.js",document.currentScript.src);
 function create(options) {
  let albums=[], active="", version="", photos=[], flight=null, worker=null, serial=0;
  const pending=new Map();
  function work(action,extra={}) {
   if(!worker){
    worker=new Worker(workerURL);
    worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.result);};
    worker.onerror=()=>{for(const task of pending.values())task.reject(new Error("Smart album counting could not start."));pending.clear();worker.terminate();worker=null;};
   }
   return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,action,...extra});});
  }
  const root=options.root;
  const select=(label,values,value)=>{const s=make("select");s.setAttribute("aria-label",label);s.append(...values.map(v=>new Option(v.label??v,v.value??v)));s.value=value;return s;};
  const album=id=>albums.find(a=>a.id===id);
  async function candidates() {
   const result=await work("candidates",{knownVersion:version});
   if(result.photos!==null){photos=result.photos;version=result.version;}
   return { ...result,photos };
  }
  function render() {
   root.replaceChildren(...albums.map(item=>{
    const row=make("div","library-folder-row library-album-row");row.dataset.smart=item.id;row.classList.toggle("active",active===item.id);row.setAttribute("aria-selected",String(active===item.id));
    const name=make("button","folder-name",item.name);name.type="button";name.title="Smart album · saved filter";name.addEventListener("click",()=>options.open(item.id));
    const menu=event=>showMenu(event,[{label:"Edit rules and name…",run:()=>editor(item)},{label:"Save as manual album…",run:()=>copy(item,true)},{label:"Duplicate",run:()=>copy(item,false)},{label:"Delete smart album…",run:()=>remove(item)}],{label:"Smart album actions",onError:e=>options.status(e.message)});
    row.addEventListener("contextmenu",menu);row.addEventListener("keydown",e=>{if(e.key==="ContextMenu" || e.shiftKey && e.key==="F10")menu(e);});
    // No drop handler: membership is determined only by the saved rules.
    row.append(name,make("span","library-count","◇"));return row;
   }));
  }
  async function refresh() {albums=(await options.api("/api/library/smart-albums")).albums;render();return albums;}
  async function open(id) {
   await refresh();const item=album(id);if(!item)throw new Error("That smart album is no longer in the library.");
   active=id;render();const result=await candidates();return {...result,filters:item.filters,name:item.name};
  }
  async function poll() {
   if(flight)return flight;
   flight=(async()=>{await refresh();if(!active)return null;const item=album(active);if(!item){active="";options.closed();return null;}
    const before=version;const result=await candidates();return {changed:before!==version,...result,filters:item.filters,name:item.name};})();
   try{return await flight;}finally{flight=null;}
  }
  async function remove(item) {
   if(!await ask({title:"Delete smart album",message:`Delete ${item.name}? Photos, grades and settings stay untouched. Ctrl+Z restores the rules.`,confirm:"Delete smart album"}))return;
   await options.run("/api/library/smart-albums",{action:"delete",id:item.id});await refresh();if(active===item.id){active="";options.closed();}
  }
  async function copy(item,manual) {
   await refresh();
   const handpicked=(await options.api("/api/library/albums")).albums;
   const value=HDRLibraryAlbumNames.copyName(item.name,[...albums.map(a=>a.name),...handpicked.map(a=>a.name)]);
   const answer=await ask({title:manual?"Save as Manual Album":"Duplicate Smart Album",message:manual?"The new manual album keeps the photos matching now, including not-connected photos. The smart album keeps updating.":"The new smart album uses the same rules and Look in choices.",fields:[{name:"name",label:"Album name",value}],confirm:manual?"Create manual album":"Duplicate"});
   if(!answer)return;
   if(manual) {
    await refresh();const current=album(item.id);if(!current)throw new Error("That smart album is no longer in the library.");
    await work("refresh",{filters:current.filters});
    const paths=await work("paths",{filters:current.filters});
    await options.run("/api/library/albums/create",{name:answer.name,paths});
   } else await options.run("/api/library/smart-albums",{action:"duplicate",id:item.id,name:answer.name});
   await refresh();options.status(`Album ${answer.name} created.`);
  }
  async function editor(item=null,initial=null) {
   const filters=structuredClone(item?.filters || initial || {rules:[],any:false,folders:[]});filters.rules ||= [];filters.folders ||= [];
   const dialog=make("dialog","application-dialog library-ask library-smart-editor"),form=make("form"),header=make("div","application-dialog-header"),body=make("div","library-ask-body"),actions=make("div","app-dialog-actions");
   dialog.setAttribute("aria-label",item?"Edit smart album":"New smart album");header.append(make("h2","",item?"Edit smart album":"New smart album"));
   const name=make("input");name.name="name";name.value=item?.name||"";name.maxLength=120;name.setAttribute("aria-label","Smart album name");const nameLabel=make("label","library-ask-field");nameLabel.append(make("span","","Name"),name);body.append(nameLabel);
   const mode=select("Match rules",[{value:"all",label:"Match all of these rules"},{value:"any",label:"Match any of these rules"}],filters.any?"any":"all");body.append(mode);
   // Common filter controls are mandatory in the filter bar, even with Match any.
   // Preserve that expression and expose them as editable required controls.
   const common=make("div","library-smart-common");
   for(const [key,label] of [["rating","Minimum rating"],["pick","Pick status"],["label","Colour label"],["type","File type"],["search","File name or tag"]]) if(filters[key]) {
    const line=make("label","library-ask-field"),input=make("input");input.value=String(filters[key]);input.setAttribute("aria-label",label);line.append(make("span","",`Required: ${label}`),input);common.append(line);input.addEventListener("input",()=>{filters[key]=input.value;count();});
   }
   if(filters.grade){const label=make("label","library-ask-field"),input=select("Grade status",[{value:"",label:"Any grade status"},{value:"graded",label:"Graded"},{value:"ungraded",label:"Ungraded"}],filters.grade);label.append(make("span","","Required: Grade status"),input);common.append(label);input.addEventListener("change",()=>{filters.grade=input.value;count();});}
   if(filters.raw){const label=make("label"),box=make("input");box.type="checkbox";box.checked=true;label.append(box,make("span","","Required: RAW only"));box.addEventListener("change",()=>{filters.raw=box.checked;count();});common.append(label);}
   body.append(common);
   const rows=make("div","library-smart-rows"),add=make("button","text-button","+ Add rule");add.type="button";body.append(rows,add);
   const look=make("fieldset","library-smart-folders");look.append(make("legend","","Look in"));
   const pins=options.pins(),available=[...pins];for(const path of filters.folders)if(!available.some(p=>p.path===path))available.push({path,name:`${path} (not pinned)`});
   const boxes=[];for(const pin of available){const label=make("label"),box=make("input");box.type="checkbox";box.value=pin.path;box.checked=!filters.folders.length ? pins.some(p=>p.path===pin.path) : filters.folders.includes(pin.path);box.dataset.pinned=String(pins.some(p=>p.path===pin.path));label.append(box,make("span","",pin.name));look.append(label);boxes.push(box);box.addEventListener("change",()=>{filters.folders=boxes.filter(b=>b.dataset.pinned==="true").every(b=>b.checked)&&!boxes.some(b=>b.dataset.pinned==="false"&&b.checked)?[]:boxes.filter(b=>b.checked).map(b=>b.value);count();});}
   body.append(look,make("p","library-filter-note","All pinned folders ticked means the whole library, including photos kept by albums. A folder marked not pinned matches nothing until pinned again."));
   const live=make("p","library-smart-count");live.setAttribute("aria-live","polite");body.append(live);
   const error=make("p","library-filter-note");error.setAttribute("role","alert");body.append(error);
   const cancel=make("button","button-secondary","Cancel"),save=make("button","button-primary",item?"Save":"Create smart album");cancel.type="button";save.type="submit";actions.append(cancel,save);
   form.append(header,body,actions);dialog.append(form);document.body.append(dialog);cancel.addEventListener("click",()=>dialog.close());dialog.addEventListener("close",()=>{clearTimeout(countTimer);revision++;dialog.remove();});
   let countTimer, revision=0;
   // Controls and Save are independent of counting and of the library size.
   let ready;
   function count(){
    clearTimeout(countTimer);const request=++revision;
    filters.any=mode.value==="any";const none=boxes.length>0&&!boxes.some(b=>b.checked);
    save.disabled=!name.value.trim()||none;live.textContent=none?"0 matching photos":"Counting…";
    if(none)return;
    const expression=structuredClone(filters);
    countTimer=setTimeout(async()=>{try{
     await ready;const result=await work("count",{filters:expression});
     if(request===revision&&dialog.isConnected)live.textContent=`${result.count.toLocaleString()} matching photos${result.indexing?" · Indexing is still running, so more may turn up.":""}`;
    }catch(e){if(request===revision&&dialog.isConnected){live.textContent="Count unavailable";error.textContent=e.message;}}},100);
   }
   function renderRules(){rows.replaceChildren(...filters.rules.map((rule,i)=>{
    const row=make("div","library-smart-rule"),field=select("Rule field",Object.entries(query.FIELDS).map(([value,f])=>({value,label:f.label})),rule.field);field.dataset.ruleField=String(i);const f=query.FIELDS[rule.field];
    const ops=f.kind==="range"||f.kind==="date"?["range","is","greater","less","at-least","at-most"]:f.kind==="text"?["contains","is","starts","ends"]:["is","contains","starts","ends"];
    const op=select("Comparison",ops,rule.op||((f.kind==="range"||f.kind==="date")&&rule.value==null?"range":f.kind==="text"?"contains":"is"));rule.op=op.value;row.append(field,op);
    if(op.value==="range")for(const key of ["from","to"]){const input=make("input");input.type=f.kind==="date"?"date":"number";input.value=rule[key]??"";input.setAttribute("aria-label",key==="from"?"From":"To");input.addEventListener("input",()=>{rule[key]=input.value;count();});row.append(input);}
    else {
     const found=f.kind==="choice"&&op.value==="is"?[]:null;
     const suppliedValue=rule.value!=null;
     const input=make("input");input.type=f.kind==="range"?"number":f.kind==="date"?"date":"text";input.value=rule.value??"";input.setAttribute("aria-label","Rule value");rule.value=input.value;
     if(found){
      const initialValue=input.value,hadValue=suppliedValue;
      const suggestions=make("datalist");suggestions.id=`smart-rule-values-${serial}-${i}`;input.setAttribute("list",suggestions.id);row.append(suggestions);
      // Values can be typed immediately; indexed suggestions arrive independently.
      ready.then(()=>work("values",{field:rule.field})).then(values=>{
       if(!input.isConnected)return;
       const selected=input.value,untouched=selected===initialValue;
       if((hadValue||selected!==initialValue)&&!values.some(v=>v.value===String(rule.value)))values.push({value:String(rule.value),label:rule.label||String(rule.value)});
       found.push(...values);suggestions.replaceChildren(...values.map(v=>new Option(v.label,v.value)));
       if(untouched&&!hadValue)input.value=values[0]?.value||"";
       rule.value=input.value;count();
      }).catch(e=>{if(input.isConnected)error.textContent=e.message;});
     }
     input.dataset.ruleValue=String(i);input.addEventListener("input",()=>{rule.value=input.value;rule.label=found?.find(v=>v.value===input.value)?.label;count();});row.append(input);
    }
    const notLabel=make("label"),not=make("input");not.type="checkbox";not.checked=!!rule.not;not.setAttribute("aria-label","is not");notLabel.append(not,make("span","","is not"));not.addEventListener("change",()=>{rule.not=not.checked;count();});row.append(notLabel);
    const remove=make("button","text-button","×");remove.type="button";remove.setAttribute("aria-label","Remove rule");remove.addEventListener("click",()=>{filters.rules.splice(i,1);renderRules();count();});row.append(remove);
    field.addEventListener("change",()=>{filters.rules[i]={field:field.value};renderRules();count();});op.addEventListener("change",()=>{rule.op=op.value;delete rule.from;delete rule.to;delete rule.value;renderRules();count();});return row;
   }));}
   add.addEventListener("click",()=>{filters.rules.push({field:"rating",op:"at-least",value:3});renderRules();count();});mode.addEventListener("change",count);name.addEventListener("input",()=>{save.disabled=!name.value.trim()||(boxes.length>0&&!boxes.some(b=>b.checked));});
   form.addEventListener("submit",async e=>{e.preventDefault();save.disabled=true;try{await options.run("/api/library/smart-albums",{action:item?"edit":"create",id:item?.id||"",name:name.value.trim(),filters});dialog.close();await refresh();if(active===item?.id)options.open(active);}catch(e){error.textContent=e.message;save.disabled=false;}});
   ready=work("refresh",{filters:structuredClone(filters)});
   // Attach a rejection handler immediately, including editors closed before the debounce.
   ready.catch(e=>{if(dialog.isConnected){live.textContent="Count unavailable";error.textContent=e.message;}});
   renderRules();count();dialog.showModal();name.focus();
  }
  return Object.freeze({refresh,open,poll,editor,menuAction:()=>({label:"New smart album…",run:()=>editor()}),active:()=>active,setActive:id=>{active=id||"";render();},name:id=>album(id)?.name,filters:id=>album(id)?.filters});
 }
 window.HDRLibrarySmartAlbums=Object.freeze({create});
})();
