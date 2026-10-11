/* Source maps stay separate from picture rendering and saved grades. */
(() => {
  function create(o) {
    let prefs={}, enabled={exposure:false,focus:false}, records=new Map(), switching=Promise.resolve(), saveQueue=Promise.resolve();
    const $=id=>document.getElementById(id), legend=document.createElement('div');
    legend.id='library-overlay-legend';legend.hidden=true;document.body.append(legend);
    const controls={},fields={};
    function change(key,value){prefs[key]=value;redraw();saveQueue=saveQueue.then(()=>o.api('/api/library/review-preferences',{[key]:value})).catch(e=>o.status(e.message));}
    function options(kind,title,key,content){
      const button=document.createElement('button');button.id=`${kind}-button`;button.className='tool-button';button.textContent=title;button.title=`${title} options · ${key}`;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');$('zoom-button').before(button);
      const panel=document.createElement('div');panel.id=`${kind}-options`;panel.className='library-popover library-options';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label',`${title} options`);
      panel.innerHTML=`<label><input id="${kind}-enabled" type="checkbox"> ${title}</label>${content}`;document.body.append(panel);controls[kind]={button,panel};
      button.addEventListener('click',()=>{for(const c of Object.values(controls))if(c!==controls[kind]){c.panel.hidden=true;c.button.setAttribute('aria-expanded','false');}panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));const r=button.getBoundingClientRect();panel.style.left=`${Math.min(r.left,innerWidth-280)}px`;panel.style.top=`${r.bottom+4}px`;});
      document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!button.contains(e.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
      panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();e.stopPropagation();}});
      $(`${kind}-enabled`).addEventListener('change',e=>toggle(kind,e.target.checked));
    }
    options('focus','Focus','S',`<label>Strength <input id="focus-strength" type="range" min="0" max="1" step=".01" value=".65"></label><label>Sensitivity <input id="focus-sensitivity" type="range" min="0" max="1" step=".01" value=".5"></label><label>Colour <input id="focus-color" type="color" value="#47ff80" aria-label="Focus colour"></label>`);
    options('exposure','Exposure','E',`<label>Strength <input id="exposure-strength" type="range" min="0" max="1" step=".01" value=".65"></label><label><input id="exposure-highlights" type="checkbox" checked> Blown highlights <input id="exposure-highlight-color" type="color" value="#ff4050" aria-label="Highlight colour"></label><label><input id="exposure-shadows" type="checkbox" checked> Blocked shadows <input id="exposure-shadow-color" type="color" value="#4080ff" aria-label="Shadow colour"></label>`);
    for(const id of ['focus-strength','focus-sensitivity','focus-color','exposure-strength','exposure-highlights','exposure-shadows','exposure-highlight-color','exposure-shadow-color']){const key=id.replaceAll('-','_');fields[id]=key;$(id).addEventListener('input',e=>change(key,e.target.type==='checkbox'?e.target.checked:e.target.type==='range'?+e.target.value:e.target.value));}
    prefs=Object.fromEntries(Object.entries(fields).map(([id,key])=>{const input=$(id);return [key,input.type==='checkbox'?input.checked:input.type==='range'?+input.value:input.value];}));
    function updateLegend(){legend.replaceChildren();legend.hidden=!enabled.exposure&&!enabled.focus;
      const entries=[...(enabled.focus?[['Focus','focus_color']]:[]),...(enabled.exposure?[['Blown','exposure_highlight_color'],['Blocked','exposure_shadow_color']]:[])];
      for(const [name,key] of entries){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='color';input.value=prefs[key];input.setAttribute('aria-label',`${name} colour`);input.addEventListener('input',()=>{change(key,input.value);$(key.replaceAll('_','-')).value=input.value;});label.prepend(input);legend.append(label);}
    }
    function sync(r){if(!r.canvas.isConnected)return;const c=r.canvas,absolute=c.style.position==='absolute';for(const item of Object.values(r.items)){const layer=item.layer;layer.style.cssText=absolute?c.style.cssText:`position:absolute;left:${c.offsetLeft}px;top:${c.offsetTop}px;width:${c.clientWidth}px;height:${c.clientHeight}px;object-fit:contain`;
      layer.style.pointerEvents='none';layer.style.zIndex=item.kind==='focus'?'4':'3';layer.style.padding=getComputedStyle(c).padding;layer.style.boxSizing='border-box';}}
    function remove(r){for(const item of Object.values(r.items)){item.request?.abort();item.layer.remove();item.badge.remove();}r.observer.disconnect();r.resize.disconnect();if(records.get(r.canvas)===r)records.delete(r.canvas);r.controller.signal.removeEventListener('abort',r.cleanup);}
    function attach(photo,canvas,meta,controller,current){
      const old=records.get(canvas);if(old)remove(old);if(!Object.values(enabled).some(Boolean)||!current()||controller.signal.aborted)return;
      const r={photo,canvas,meta,controller,current,items:{}};records.set(canvas,r);r.cleanup=()=>remove(r);
      for(const kind of ['exposure','focus']){if(!enabled[kind])continue;const layer=document.createElement('canvas');layer.className='library-source-overlay';layer.dataset.kind=kind;layer.hidden=true;canvas.parentElement.append(layer);
        const badge=document.createElement('span');badge.className='library-map-status';badge.dataset.kind=kind;badge.textContent=`${kind==='focus'?'S':'E'} · preparing`;canvas.parentElement.append(badge);r.items[kind]={kind,layer,badge,values:null};}
      r.observer=new MutationObserver(()=>sync(r));r.observer.observe(canvas,{attributes:true,attributeFilter:['style']});r.resize=new ResizeObserver(()=>sync(r));r.resize.observe(canvas);sync(r);controller.signal.addEventListener('abort',r.cleanup,{once:true});
      for(const item of Object.values(r.items))void request(r,item);
    }
    async function request(r,item){const controller=new AbortController();item.request=controller;const current=()=>enabled[item.kind]&&records.get(r.canvas)===r&&r.current()&&!controller.signal.aborted;
      const large=r.canvas.id==='single-picture'||r.canvas.classList.contains('compare-fit');
      try{for(const quality of item.kind==='focus'&&large?['half','full']:['half']){
        const m=await o.api('/api/library/overlay-map',{path:r.photo.path,kind:item.kind,quality,priority:large?82:85},controller.signal);if(!current())return;
        if(m.unavailable){item.badge.textContent=`${item.kind==='focus'?'S':'E'} · unavailable`;item.badge.title=m.unavailable;item.badge.hidden=false;return;}
        const response=await fetch(`/api/library/overlay-pixels/${m.key}`,{signal:controller.signal});if(!response.ok)throw new Error('Overlay map unavailable; switch the overlay off and on to remake it.');
        const bitmap=await createImageBitmap(await response.blob());if(!current()){bitmap.close();return;}
        const temp=document.createElement('canvas');temp.width=bitmap.width;temp.height=bitmap.height;const ctx=temp.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();item.values=ctx.getImageData(0,0,temp.width,temp.height);item.map=m;draw(r,item);
        item.badge.textContent='S · refining';item.badge.hidden=!(item.kind==='focus'&&large&&quality==='half');
      }}catch(e){if(e.name!=='AbortError'&&current()){item.badge.hidden=false;item.badge.textContent=`${item.kind==='focus'?'S':'E'} · unavailable`;item.badge.title=e.message;}}
    }
    const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    function draw(r,item){if(!item.values)return;const input=item.values,output=new ImageData(input.width,input.height),highlight=rgb(prefs.exposure_highlight_color),shadow=rgb(prefs.exposure_shadow_color),focus=rgb(prefs.focus_color);
      const cutoff=Math.max(.02,.75-prefs.focus_strength*.6-(prefs.focus_sensitivity-.5)*.25);
      for(let i=0;i<input.data.length;i+=4){let color=null,alpha=0;
        if(item.kind==='focus'){const confidence=input.data[i]/255;if(confidence>=cutoff){color=focus;alpha=prefs.focus_strength*(.5+.5*(confidence-cutoff)/(1-cutoff));}}
        else{color=prefs.exposure_highlights&&input.data[i]?highlight:prefs.exposure_shadows&&input.data[i+1]?shadow:null;alpha=prefs.exposure_strength;}
        if(color){output.data.set(color,i);output.data[i+3]=Math.round(alpha*255);}}
      item.layer.width=output.width;item.layer.height=output.height;item.layer.getContext('2d').putImageData(output,0,0);item.layer.hidden=false;item.layer.dataset.key=item.map.key;item.layer.dataset.quality=item.map.quality;item.layer.dataset.strength=String(prefs[item.kind+'_strength']);sync(r);
    }
    function redraw(){for(const r of records.values())for(const item of Object.values(r.items))draw(r,item);updateLegend();}
    function refresh(){for(const r of [...records.values()])remove(r);for(const s of o.surfaces())attach(s.photo,s.canvas,s.meta,s.controller,s.current);updateLegend();}
    function toggle(kind,value){const task=switching.then(async()=>{const result=await o.api('/api/library/overlay-switch',{kind,enabled:value??!enabled[kind]});enabled[kind]=result.enabled;$(`${kind}-enabled`).checked=result.enabled;controls[kind].button.classList.toggle('active',result.enabled);refresh();});switching=task.catch(e=>o.status(e.message));return task;}
    async function init(){try{prefs=await o.api('/api/library/review-preferences');for(const [id,key] of Object.entries(fields)){const input=$(id);if(input.type==='checkbox')input.checked=prefs[key];else input.value=prefs[key];}redraw();}catch(e){o.status(e.message);}}
    return {attach,toggle,init,snapshot:()=>({enabled:{...enabled},settings:{...prefs},maps:[...records.values()].flatMap(r=>Object.values(r.items).map(item=>({path:r.photo.path,kind:item.kind,key:item.map?.key,quality:item.map?.quality,ready:!!item.values,unavailable:item.badge.title})))})};
  }
  window.HDRLibraryOverlays={create};
})();
