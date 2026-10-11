/* Source maps stay separate from picture rendering and saved grades. */
(() => {
  function create(o) {
    let prefs={}, enabled={exposure:false}, records=new Map(), switching=Promise.resolve();
    const $=id=>document.getElementById(id), legend=document.createElement('div');
    legend.id='library-overlay-legend';legend.hidden=true;document.body.append(legend);
    const button=document.createElement('button');button.id='exposure-button';button.className='tool-button';button.textContent='Exposure';button.title='Exposure options · E';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');$('zoom-button').before(button);
    const panel=document.createElement('div');panel.id='exposure-options';panel.className='library-popover library-options';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Exposure options');
    panel.innerHTML=`<label><input id="exposure-enabled" type="checkbox"> Exposure warnings</label><label>Strength <input id="exposure-strength" type="range" min="0" max="1" step=".01" value=".65"></label><label><input id="exposure-highlights" type="checkbox" checked> Blown highlights <input id="exposure-highlight-color" type="color" value="#ff4050" aria-label="Highlight colour"></label><label><input id="exposure-shadows" type="checkbox" checked> Blocked shadows <input id="exposure-shadow-color" type="color" value="#4080ff" aria-label="Shadow colour"></label>`;document.body.append(panel);
    button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));const r=button.getBoundingClientRect();panel.style.left=`${Math.min(r.left,innerWidth-280)}px`;panel.style.top=`${r.bottom+4}px`;});
    document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!button.contains(e.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();e.stopPropagation();}});
    $('exposure-enabled').addEventListener('change',e=>toggle('exposure',e.target.checked));
    let saveQueue=Promise.resolve();
    function change(key,value){prefs[key]=value;redraw();saveQueue=saveQueue.then(()=>o.api('/api/library/review-preferences',{[key]:value})).catch(e=>o.status(e.message));}
    const fields={'exposure-strength':['exposure_strength',e=>+e.value],'exposure-highlights':['exposure_highlights',e=>e.checked],'exposure-shadows':['exposure_shadows',e=>e.checked],'exposure-highlight-color':['exposure_highlight_color',e=>e.value],'exposure-shadow-color':['exposure_shadow_color',e=>e.value]};
    for(const [id,[key,value]] of Object.entries(fields))$(id).addEventListener('input',e=>change(key,value(e.target)));
    function updateLegend(){legend.replaceChildren();legend.hidden=!enabled.exposure;if(!enabled.exposure)return;
      for(const [name,key] of [['Blown','exposure_highlight_color'],['Blocked','exposure_shadow_color']]){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='color';input.value=prefs[key];input.setAttribute('aria-label',`${name} colour`);input.addEventListener('input',()=>{change(key,input.value);$(key.replaceAll('_','-')).value=input.value;});label.prepend(input);legend.append(label);}
    }
    function sync(r){if(!r.canvas.isConnected)return;const c=r.canvas,absolute=c.style.position==='absolute';r.layer.style.cssText=absolute?c.style.cssText:`position:absolute;left:${c.offsetLeft}px;top:${c.offsetTop}px;width:${c.clientWidth}px;height:${c.clientHeight}px;object-fit:contain`;
      r.layer.style.pointerEvents='none';r.layer.style.zIndex='3';r.layer.style.padding=getComputedStyle(c).padding;r.layer.style.boxSizing='border-box';}
    function remove(r){r.request?.abort();r.observer.disconnect();r.resize.disconnect();r.layer.remove();r.badge.remove();if(records.get(r.canvas)===r)records.delete(r.canvas);r.controller.signal.removeEventListener('abort',r.cleanup);}
    function attach(photo,canvas,meta,controller,current){
      const old=records.get(canvas);if(old)remove(old);if(!enabled.exposure||!current()||controller.signal.aborted)return;
      const layer=document.createElement('canvas');layer.className='library-source-overlay';layer.dataset.kind='exposure';layer.hidden=true;canvas.parentElement.append(layer);
      const badge=document.createElement('span');badge.className='library-map-status';badge.textContent='E · preparing';canvas.parentElement.append(badge);
      const r={photo,canvas,meta,controller,current,layer,badge,values:null};records.set(canvas,r);r.cleanup=()=>remove(r);controller.signal.addEventListener('abort',r.cleanup,{once:true});
      r.observer=new MutationObserver(()=>sync(r));r.observer.observe(canvas,{attributes:true,attributeFilter:['style']});r.resize=new ResizeObserver(()=>sync(r));r.resize.observe(canvas);sync(r);
      void request(r);
    }
    async function request(r){const controller=new AbortController();r.request=controller;const current=()=>enabled.exposure&&records.get(r.canvas)===r&&r.current()&&!controller.signal.aborted;
      try{
        const m=await o.api('/api/library/overlay-map',{path:r.photo.path,kind:'exposure',quality:'half',priority:85},controller.signal);if(!current())return;
        if(m.unavailable){r.badge.textContent='E · unavailable';r.badge.title=m.unavailable;return;}
        const response=await fetch(`/api/library/overlay-pixels/${m.key}`,{signal:controller.signal});if(!response.ok)throw new Error('Overlay map unavailable; switch the overlay off and on to remake it.');
        const bitmap=await createImageBitmap(await response.blob());if(!current()){bitmap.close();return;}
        const temp=document.createElement('canvas');temp.width=bitmap.width;temp.height=bitmap.height;const ctx=temp.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();r.values=ctx.getImageData(0,0,temp.width,temp.height);r.map=m;r.badge.hidden=true;draw(r);
      }catch(e){if(e.name!=='AbortError'&&current()){r.badge.textContent='E · unavailable';r.badge.title=e.message;}}
    }
    const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    function draw(r){if(!r.values)return;const input=r.values,output=new ImageData(input.width,input.height),highlight=rgb(prefs.exposure_highlight_color),shadow=rgb(prefs.exposure_shadow_color);
      for(let i=0;i<input.data.length;i+=4){const color=prefs.exposure_highlights&&input.data[i]?highlight:prefs.exposure_shadows&&input.data[i+1]?shadow:null;if(color){output.data.set(color,i);output.data[i+3]=Math.round(prefs.exposure_strength*255);}}
      r.layer.width=output.width;r.layer.height=output.height;r.layer.getContext('2d').putImageData(output,0,0);r.layer.hidden=false;r.layer.dataset.key=r.map.key;r.layer.dataset.strength=String(prefs.exposure_strength);sync(r);
    }
    function redraw(){for(const r of records.values())draw(r);updateLegend();}
    function refresh(){for(const r of [...records.values()])remove(r);for(const s of o.surfaces())attach(s.photo,s.canvas,s.meta,s.controller,s.current);updateLegend();}
    function toggle(kind,value){const task=switching.then(async()=>{const result=await o.api('/api/library/overlay-switch',{kind,enabled:value??!enabled[kind]});enabled[kind]=result.enabled;$('exposure-enabled').checked=result.enabled;button.classList.toggle('active',result.enabled);refresh();});switching=task.catch(e=>o.status(e.message));return task;}
    async function init(){try{prefs=await o.api('/api/library/review-preferences');for(const [id,[key]] of Object.entries(fields)){const input=$(id);if(input.type==='checkbox')input.checked=prefs[key];else input.value=prefs[key];}redraw();}catch(e){o.status(e.message);}}
    return {attach,toggle,init,snapshot:()=>({enabled:{...enabled},settings:{...prefs},maps:[...records.values()].map(r=>({path:r.photo.path,key:r.map?.key,ready:!!r.values,unavailable:r.badge.title}))})};
  }
  window.HDRLibraryOverlays={create};
})();
