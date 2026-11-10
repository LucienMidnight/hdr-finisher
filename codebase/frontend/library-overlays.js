/* Source maps stay separate from picture rendering and saved grades. */
(() => {
  function create(o) {
    let prefs={}, enabled={exposure:false,focus:false}, records=new Map(), switching=Promise.resolve(), saveQueue=Promise.resolve();
    // Maps just taken off a picture, so the same photo's next picture (for
    // example after Develop) shows the overlay at once. References only; bounded.
    const recent=new Map(), recentKey=(photo,kind)=>[photo.path,photo.bytes,photo.mtime_ns,photo.grade_identity,kind].join('|');
    // An undeveloped RAW shows the camera's embedded preview; the map is placed by its measured camera_frame.
    const cameraPicture=meta=>!!meta?.bitmap&&meta.picture_source==='camera picture';
    const label=kind=>kind==='focus'?'Focus':'Exposure';
    const $=id=>document.getElementById(id);
    const controls={},fields={};
    let drawFrame=null,saveScheduled=false,pendingPrefs={};
    function change(key,value){
      prefs[key]=value;pendingPrefs[key]=value;syncSwitches();
      if(drawFrame===null)drawFrame=requestAnimationFrame(()=>{drawFrame=null;redraw();});
      if(!saveScheduled){saveScheduled=true;saveQueue=saveQueue.then(()=>{
        saveScheduled=false;const values=pendingPrefs;pendingPrefs={};
        return o.api('/api/library/review-preferences',values);
      }).catch(e=>o.status(e.message));}
    }
    function switchControl(id, label, checked=false) {
      return `<label class="checkbox-row"><input id="${id}" type="checkbox" aria-label="${label}" ${checked?'checked':''}><span data-switch-for="${id}">${checked?'Enabled':'Disabled'}</span></label>`;
    }
    function syncSwitches() {
      for(const label of document.querySelectorAll('[data-switch-for]')) label.textContent=$(label.dataset.switchFor).checked?'Enabled':'Disabled';
    }
    function options(kind,title,key,content){
      const button=document.createElement('button');button.id=`${kind}-button`;button.className='tool-button';button.textContent=title;button.title=kind === "exposure" ? "Show clipped highlights and near-black shadows from the source photo · E" : `${title} options · ${key}`;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');$('zoom-button').before(button);
      const panel=document.createElement('div');panel.id=`${kind}-options`;panel.className='library-popover library-options';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`${title} options`);
      panel.innerHTML=`${switchControl(`${kind}-enabled`,title)}${content}`;document.body.append(panel);controls[kind]={button,panel};
      button.addEventListener('click',()=>{for(const c of Object.values(controls))if(c!==controls[kind]){c.panel.hidden=true;c.button.setAttribute('aria-expanded','false');}panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));const r=button.getBoundingClientRect();panel.style.left=`${Math.min(r.left,innerWidth-280)}px`;panel.style.top=`${r.bottom+4}px`;});
      document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!button.contains(e.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
      panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();e.stopPropagation();}});
      $(`${kind}-enabled`).addEventListener('change',e=>toggle(kind,e.target.checked));
    }
    options('focus','Focus','S',`<label>Strength <input id="focus-strength" type="range" min="0" max="1" step=".01" value=".65"></label><label>Sensitivity <input id="focus-sensitivity" type="range" min="0" max="1" step=".01" value=".5"></label><label>Colour <input id="focus-color" type="color" value="#47ff80" aria-label="Focus colour"></label>`);
    options('exposure','Exposure','E',`<label>Strength <input id="exposure-strength" type="range" min="0" max="1" step=".01" value=".65"></label><div class="library-option-toggle"><span title="Marks areas where at least one colour channel reached its limit: the camera's recorded white level for RAW, or the file's maximum value for JPEG, PNG and TIFF. Detail in that channel is lost.">Clipped highlights</span>${switchControl("exposure-highlights","Clipped highlights",true)}<input id="exposure-highlight-color" type="color" value="#ff4050" aria-label="Highlight colour"></div><div class="library-option-toggle"><span title="Marks areas that are close to black in every colour channel. Detail there may still be recoverable.">Near-black shadows</span>${switchControl("exposure-shadows","Near-black shadows",true)}<input id="exposure-shadow-color" type="color" value="#4080ff" aria-label="Shadow colour"></div>`);
    for(const id of ['focus-strength','focus-sensitivity','focus-color','exposure-strength','exposure-highlights','exposure-shadows','exposure-highlight-color','exposure-shadow-color']){const key=id.replaceAll('-','_');fields[id]=key;$(id).addEventListener('input',e=>change(key,e.target.type==='checkbox'?e.target.checked:e.target.type==='range'?+e.target.value:e.target.value));}
    prefs=Object.fromEntries(Object.entries(fields).map(([id,key])=>{const input=$(id);return [key,input.type==='checkbox'?input.checked:input.type==='range'?+input.value:input.value];}));
    function sync(r){if(!r.canvas.isConnected)return;const c=r.canvas,absolute=c.style.position==='absolute';for(const item of Object.values(r.items)){const layer=item.layer;layer.style.cssText=absolute?c.style.cssText:`position:absolute;left:${c.offsetLeft}px;top:${c.offsetTop}px;width:${c.clientWidth}px;height:${c.clientHeight}px;object-fit:contain`;
      layer.style.pointerEvents='none';layer.style.zIndex=item.kind==='focus'?'4':'3';layer.style.padding=getComputedStyle(c).padding;layer.style.boxSizing='border-box';}}
    function keep(r,item){if(!item.values||r.photo.edited)return;const k=recentKey(r.photo,item.kind);recent.delete(k);recent.set(k,{values:item.values,map:item.map});while(recent.size>24)recent.delete(recent.keys().next().value);}
    function remove(r){for(const item of Object.values(r.items)){keep(r,item);item.request?.abort();item.layer.remove();item.badge.remove();}r.observer.disconnect();r.resize.disconnect();if(records.get(r.canvas)===r)records.delete(r.canvas);r.controller.signal.removeEventListener('abort',r.cleanup);}
    function attach(photo,canvas,meta,controller,current){
      const old=records.get(canvas);if(old)remove(old);if(!Object.values(enabled).some(Boolean)||!current()||controller.signal.aborted)return;
      const r={photo,canvas,meta,controller,current,items:{}};records.set(canvas,r);r.cleanup=()=>remove(r);
      r.observer=new MutationObserver(()=>sync(r));r.observer.observe(canvas,{attributes:true,attributeFilter:['style']});r.resize=new ResizeObserver(()=>sync(r));r.resize.observe(canvas);sync(r);controller.signal.addEventListener('abort',r.cleanup,{once:true});
      addItems(r,['exposure','focus']);
    }
    function addItems(r,kinds){
      const {photo,canvas}=r;
      for(const kind of kinds){if(!enabled[kind])continue;const layer=document.createElement('canvas');layer.className='library-source-overlay';layer.dataset.kind=kind;layer.hidden=true;canvas.parentElement.append(layer);
        const badge=document.createElement('span');badge.className='library-map-status';badge.dataset.kind=kind;badge.textContent=`${kind==='focus'?'S':'E'} · preparing`;canvas.parentElement.append(badge);r.items[kind]={kind,layer,badge,values:null};
        const seed=!photo.edited&&recent.get(recentKey(photo,kind));if(seed){const item=r.items[kind];item.values=seed.values;item.map=seed.map;}}
      sync(r);for(const kind of kinds){const item=r.items[kind];if(!item)continue;if(item.values&&draw(r,item))item.badge.hidden=true;void request(r,item);}
    }
    // Only pending metadata is shared. Finished maps still use the existing
    // pixel handling and recent-map allowance; this table retains no results.
    const mapJobs=new Map();
    function mapRequest(photo,kind,quality,signal,priority){
      const key=JSON.stringify([kind,quality,photo.path,photo.bytes??null,photo.mtime_ns??null,photo.grade_identity??null]);
      let job=mapJobs.get(key);
      // A queued background job cannot be promoted: preserve a later Single
      // request's priority rather than making it wait behind background maps.
      if(job?.submitted && priority<job.priority)job=null;
      if(!job){
        const controller=new AbortController();job={controller,subscribers:new Set(),priority};mapJobs.set(key,job);
        const clean=()=>{if(mapJobs.get(key)===job)mapJobs.delete(key);};
        // Same-turn subscribers can raise importance before queue submission;
        // unrelated grid/filmstrip jobs keep their existing background priority.
        job.promise=Promise.resolve().then(()=>{
          if(controller.signal.aborted)throw Object.assign(new Error('Cancelled'),{name:'AbortError'});
          job.submitted=true;return o.api('/api/library/overlay-map',{path:photo.path,kind,quality,priority:job.priority},controller.signal);
        }).finally(clean);
      }
      job.priority=Math.min(job.priority,priority);
      return new Promise((resolve,reject)=>{
        const token={};job.subscribers.add(token);
        const leave=()=>{
          signal.removeEventListener('abort',abort);job.subscribers.delete(token);
          if(!job.subscribers.size){if(mapJobs.get(key)===job)mapJobs.delete(key);job.controller.abort();}
        };
        const abort=()=>{leave();reject(Object.assign(new Error('Cancelled'),{name:'AbortError'}));};
        signal.addEventListener('abort',abort,{once:true});
        job.promise.then(value=>{leave();if(!signal.aborted)resolve(value);},error=>{leave();reject(error);});
        if(signal.aborted)abort();
      });
    }
    async function request(r,item){const controller=new AbortController();item.request=controller;const current=()=>enabled[item.kind]&&records.get(r.canvas)===r&&r.items[item.kind]===item&&r.current()&&!controller.signal.aborted;
      const large=r.canvas.id==='single-picture'||r.canvas.classList.contains('compare-fit');
      try{for(const quality of item.kind==='focus'&&large?['half','full']:['half']){
        const m=await mapRequest(r.photo,item.kind,quality,controller.signal,large?82:85);if(!current())return;
        if(m.unavailable){item.values=null;item.layer.hidden=true;delete item.layer.dataset.key;const type=(r.photo.source_path||r.photo.path.split('|copy|',1)[0]).split(/[/\\]/).pop().split('.').pop().toUpperCase();item.badge.textContent=`${item.kind==='focus'?'Focus':'Exposure'} unavailable · ${m.reason==='graded'?'graded':type}`;item.badge.title=m.unavailable;item.badge.hidden=false;return;}
        if(!placeable(r,item,m))return;
        if(item.values&&(item.map?.key===m.key||quality==='half'&&item.map?.quality==='full')){item.badge.textContent='S · refining';item.badge.hidden=!(item.kind==='focus'&&large&&quality==='half');continue;}
        const response=await fetch(`/api/library/overlay-pixels/${m.key}`,{signal:controller.signal});if(!response.ok)throw new Error('Overlay map unavailable; switch the overlay off and on to remake it.');
        const bitmap=await createImageBitmap(await response.blob());if(!current()){bitmap.close();return;}
        const temp=document.createElement('canvas');temp.width=bitmap.width;temp.height=bitmap.height;const ctx=temp.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();item.values=ctx.getImageData(0,0,temp.width,temp.height);item.map=m;if(!draw(r,item))return;
        item.badge.textContent='S · refining';item.badge.hidden=!(item.kind==='focus'&&large&&quality==='half');
      }}catch(e){if(e.name!=='AbortError'&&current()){item.badge.hidden=false;item.badge.textContent=`${item.kind==='focus'?'S':'E'} · unavailable`;item.badge.title=e.message;}}
    }
    function placeable(r,item,m){
      if(!cameraPicture(r.meta)||m.camera_frame)return true;
      item.values=null;item.layer.hidden=true;delete item.layer.dataset.key;item.badge.textContent=`${label(item.kind)} unavailable · camera preview`;
      item.badge.title=m.camera_frame_error||'The camera preview could not be lined up with the sensor data. Develop the photo to see this overlay.';item.badge.hidden=false;return false;
    }
    // The part of the map under the shown picture, in map pixels.
    const area=(r,item)=>cameraPicture(r.meta)?item.map.camera_frame:item.map.frame||[0,0,item.values.width,item.values.height];
    const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    function draw(r,item){if(!item.values)return false;if(!placeable(r,item,item.map))return false;const input=item.values,output=new ImageData(input.width,input.height),highlight=rgb(prefs.exposure_highlight_color),shadow=rgb(prefs.exposure_shadow_color),focus=rgb(prefs.focus_color);
      const cutoff=Math.max(.02,.75-prefs.focus_strength*.6-(prefs.focus_sensitivity-.5)*.25);
      for(let i=0;i<input.data.length;i+=4){let color=null,alpha=0;
        if(item.kind==='focus'){const confidence=input.data[i]/255;if(confidence>=cutoff){color=focus;alpha=prefs.focus_strength*(.5+.5*(confidence-cutoff)/(1-cutoff));}}
        else{color=prefs.exposure_highlights&&input.data[i]?highlight:prefs.exposure_shadows&&input.data[i+1]?shadow:null;alpha=prefs.exposure_strength;}
        if(color){output.data.set(color,i);output.data[i+3]=Math.round(alpha*255);}}
      // Crop to the shown picture and give the layer the picture's shape, at
      // least as many pixels as it covers on screen, so the layer's rounding
      // stays under half a screen pixel and both fit the same box identically.
      const full=document.createElement('canvas');full.width=output.width;full.height=output.height;full.getContext('2d').putImageData(output,0,0);
      const [x,y,w,h]=area(r,item),shown=r.canvas,known=shown.width>0&&shown.height>0;
      const step=known?Math.max(1,Math.floor(shown.width/Math.max(shown.clientWidth*devicePixelRatio,Math.ceil(w)))):1;
      const width=known?Math.max(1,Math.round(shown.width/step)):Math.max(1,Math.ceil(w)),height=known?Math.max(1,Math.round(shown.height/step)):Math.max(1,Math.ceil(h));
      item.layer.width=width;item.layer.height=height;const layer=item.layer.getContext('2d');layer.clearRect(0,0,width,height);layer.drawImage(full,x,y,w,h,0,0,width,height);full.width=full.height=0;item.layer.hidden=false;item.layer.dataset.camera=String(cameraPicture(r.meta));item.layer.dataset.key=item.map.key;item.layer.dataset.quality=item.map.quality;item.layer.dataset.strength=String(prefs[item.kind+'_strength']);sync(r);return true;
    }
    function redraw(){syncSwitches();for(const r of records.values())for(const item of Object.values(r.items))draw(r,item);}
    function refresh(kind){
      for(const r of [...records.values()]){
        const item=r.items[kind];
        if(!enabled[kind]&&item){keep(r,item);item.request?.abort();item.layer.remove();item.badge.remove();delete r.items[kind];}
        if(!Object.keys(r.items).length&&!enabled[kind])remove(r);
        else if(enabled[kind]&&!item)addItems(r,[kind]);
      }
      if(enabled[kind])for(const s of o.surfaces())if(!records.has(s.canvas))attach(s.photo,s.canvas,s.meta,s.controller,s.current);
    }
    function toggle(kind,value){const task=switching.then(async()=>{const result=await o.api('/api/library/overlay-switch',{kind,enabled:value??!enabled[kind]});enabled[kind]=result.enabled;$(`${kind}-enabled`).checked=result.enabled;syncSwitches();controls[kind].button.classList.toggle('active',result.enabled);refresh(kind);});switching=task.catch(e=>o.status(e.message));return task;}
    async function init(){try{prefs=await o.api('/api/library/review-preferences');for(const [id,key] of Object.entries(fields)){const input=$(id);if(input.type==='checkbox')input.checked=prefs[key];else input.value=prefs[key];}redraw();}catch(e){o.status(e.message);}}
    return {attach,detach:canvas=>{const record=records.get(canvas);if(record)remove(record);},toggle,init,snapshot:()=>({enabled:{...enabled},settings:{...prefs},maps:[...records.values()].flatMap(r=>Object.values(r.items).map(item=>({path:r.photo.path,kind:item.kind,camera:cameraPicture(r.meta),key:item.map?.key,quality:item.map?.quality,ready:!!item.values,unavailable:item.badge.title})))})};
  }
  window.HDRLibraryOverlays={create};
})();
