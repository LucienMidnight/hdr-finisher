/* A pinned reference and one selected alternate share normalized zoom coordinates. */
(() => {
  function create(o) {
    const $ = id => document.getElementById(id);
    let enabled=false, left=null, settings={compare_layout:'side',compare_names:true}, divider=.5;
    let queue=Promise.resolve(), generation=0, ahead=[], drag=null;
    const root=document.createElement('div');root.id='library-compare';root.hidden=true;
    root.innerHTML=`<div class="compare-panes"><section class="compare-side" data-side="left"><div class="compare-stage"><canvas class="compare-fit"></canvas><canvas class="compare-native" hidden></canvas></div><div class="compare-caption"></div><p class="compare-note"></p></section><section class="compare-side" data-side="right"><div class="compare-stage"><canvas class="compare-fit"></canvas><canvas class="compare-native" hidden></canvas></div><div class="compare-caption"></div><p class="compare-note"></p></section><div id="compare-divider" role="slider" tabindex="0" aria-valuemin="5" aria-valuemax="95" aria-valuenow="50" aria-label="Split divider"></div></div>`;
    $('single-stage').before(root);
    const sides=[...root.querySelectorAll('.compare-side')].map(element=>({element,stage:element.querySelector('.compare-stage'),fit:element.querySelector('.compare-fit'),native:element.querySelector('.compare-native'),caption:element.querySelector('.compare-caption'),note:element.querySelector('.compare-note')}));
    const button=document.createElement('button');button.id='compare-button';button.className='tool-button';button.textContent='Compare';button.title='Compare options Â· C';button.setAttribute('aria-expanded','false');button.setAttribute('aria-haspopup','dialog');$('zoom-button').before(button);
    const panel=document.createElement('div');panel.id='compare-options';panel.className='library-popover library-options';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Compare options');
    panel.innerHTML=`<label class="checkbox-row"><input id="compare-enabled" type="checkbox" aria-label="Compare"><span data-compare-state="compare-enabled">Disabled</span></label><label>Layout <select id="compare-layout"><option value="side">Side by side</option><option value="top">Top and bottom</option><option value="split">Split</option></select></label><div class="library-option-toggle"><span>File names and marks</span><label class="checkbox-row"><input id="compare-names" type="checkbox" aria-label="File names and marks" checked><span data-compare-state="compare-names">Enabled</span></label></div>`;document.body.append(panel);
    button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));const r=button.getBoundingClientRect();panel.style.left=`${Math.min(r.left,innerWidth-260)}px`;panel.style.top=`${r.bottom+4}px`;});
    document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!button.contains(e.target)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();e.stopPropagation();}});
    function syncSwitches(){
      $('compare-enabled').checked=enabled;$('compare-names').checked=settings.compare_names;
      for(const label of panel.querySelectorAll('[data-compare-state]')) label.textContent=$(label.dataset.compareState).checked?'Enabled':'Disabled';
    }
    $('compare-enabled').addEventListener('change',e=>{void command(e.target.checked?'on':'off').then(syncSwitches,syncSwitches);});
    for(const id of ['compare-layout','compare-names']) $(id).addEventListener('change',async()=>{
      try {settings=await o.api('/api/library/review-preferences',{compare_layout:$('compare-layout').value,compare_names:$('compare-names').checked});layout();if(enabled)show();}catch(e){o.status(e.message);}
    });
    const handle=$('compare-divider');
    let splitting=false;
    const splitAt=e=>{const r=root.getBoundingClientRect();divider=Math.max(.05,Math.min(.95,(e.clientX-r.left)/r.width));handle.setAttribute('aria-valuenow',String(Math.round(divider*100)));layout();};
    handle.addEventListener('pointerdown',e=>{splitting=true;handle.setPointerCapture(e.pointerId);splitAt(e);e.preventDefault();e.stopPropagation();});
    handle.addEventListener('pointermove',e=>{if(splitting)splitAt(e);});
    for(const type of ['pointerup','pointercancel'])handle.addEventListener(type,e=>{splitting=false;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);});
    handle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){divider=Math.max(.05,Math.min(.95,divider+(e.key==='ArrowLeft'?-.02:.02)));handle.setAttribute('aria-valuenow',String(Math.round(divider*100)));layout();e.preventDefault();e.stopPropagation();}});
    function layout(){syncSwitches();root.dataset.layout=settings.compare_layout;root.style.setProperty('--compare-split',`${divider*100}%`);for(const side of sides)side.caption.hidden=!settings.compare_names;}
    function cancel(){generation++;for(const s of sides){s.controller?.abort();s.nativeController?.abort();}for(const c of ahead)c.abort();ahead=[];}
    function captions(){for(const s of sides){if(s.photo)s.caption.replaceChildren(document.createTextNode(s.photo.name),o.strip(s.photo));}}
    function command(action,step=1){
      const task=queue.then(async()=>{
        if(!o.selected())return;
        const result=await o.api('/api/library/compare',{action,step,paths:o.photos().map(p=>p.path),selected:o.selected().path,left:left?.path||null});
        left=o.allPhotos().find(p=>p.path===result.left)||left;enabled=result.enabled;
        syncSwitches();button.classList.toggle('active',enabled);
        o.choose(result.right);if(enabled)o.setView('single');else{o.setView('single');cancel();root.hidden=true;$('single-stage').hidden=false;$('single-caption').hidden=false;}
      });queue=task.catch(e=>o.status(e.message));return task;
    }
    function position(){
      const z=o.zoom();
      for(const s of sides){
        if(!s.meta)continue;
        const dpr=devicePixelRatio||1,w=s.meta.source_width||s.meta.width,h=s.meta.source_height||s.meta.height;
        s.stage.classList.toggle('zoomed',z.enabled);
        if(!z.enabled){s.fit.style.cssText='';s.native.hidden=true;continue;}
        const x=s.stage.clientWidth/2-z.x*w/dpr,y=s.stage.clientHeight/2-z.y*h/dpr;
        s.fit.style.cssText=`position:absolute;width:${w/dpr}px;height:${h/dpr}px;left:${x}px;top:${y}px;object-fit:fill`;
        if(s.nativeMeta){const m=s.nativeMeta;s.native.style.cssText=`position:absolute;width:${m.width/dpr}px;height:${m.height/dpr}px;left:${x+m.crop_x/dpr}px;top:${y+m.crop_y/dpr}px`;s.native.hidden=false;}
      }
    }
    async function native(s){
      s.nativeController?.abort();s.nativeMeta=null;s.native.hidden=true;
      if(!o.zoom().enabled||!s.meta)return;
      if(s.photo.edited){s.note.textContent='Saved Library picture enlarged. Check detail in Grade.';return;}
      const c=new AbortController();s.nativeController=c;const z=o.zoom(),dpr=devicePixelRatio||1;
      const current=()=>enabled&&o.active()&&!c.signal.aborted&&s.photo?.path===s.fit.dataset.picturePath;
      s.note.textContent='Loading 100%â€¦';
      try{
        const m=await o.api('/api/library/native',{path:s.photo.path,center_x:z.x,center_y:z.y,width:Math.max(64,Math.min(4096,Math.ceil(s.stage.clientWidth*dpr))),height:Math.max(64,Math.min(4096,Math.ceil(s.stage.clientHeight*dpr)))},c.signal);
        if(!current())return;m.adjustments=s.meta.adjustments;await o.draw(m,s.native,c,current);if(!current())return;
        s.nativeMeta=m;s.native.dataset.picturePath=s.photo.path;s.note.textContent='';position();o.drawOverlay?.(s.photo,s.fit,s.meta,s.controller,current);
      }catch(e){if(e.name!=='AbortError'&&current())s.note.textContent=`100% unavailable Â· ${e.message}`;}
    }
    async function show(){
      if(!enabled)return;cancel();root.hidden=false;$('single-stage').hidden=true;$('single-caption').hidden=true;layout();
      const gen=generation,photos=[o.allPhotos().find(p=>p.path===left?.path)||left,o.selected()];
      await Promise.all(sides.map(async(s,i)=>{
        s.photo=photos[i];s.meta=null;s.nativeMeta=null;s.native.hidden=true;s.note.textContent='';s.fit.style.cssText='';
        const c=new AbortController();s.controller=c;const current=()=>enabled&&o.active()&&generation===gen&&!c.signal.aborted;
        if(!s.photo)return;
        try{const edge=Math.max(s.stage.clientWidth,s.stage.clientHeight)*(devicePixelRatio||1);s.meta=await o.load(s.photo,edge<=1280?1280:edge<=1920?1920:2560,s.fit,c,current,0);if(!current())return;position();captions();await native(s);}catch(e){if(e.name!=='AbortError')o.status(e.message);}
      }));
      if(generation!==gen)return;
      const i=o.photos().findIndex(p=>p.path===o.selected()?.path);
      for(const p of [o.photos()[i+1],o.photos()[i-1]])if(p&&p.path!==left?.path){const c=new AbortController();ahead.push(c);o.api('/api/library/picture',{path:p.path,edge:1280,quality:'quick',priority:50},c.signal).catch(()=>{});}
    }
    function zoom(point,side=sides[1]){
      const z=o.zoom();let x=z.x,y=z.y;
      if(!z.enabled&&point&&side.meta){const m=side.meta,p=HDRLibraryZoom.click(point.x,point.y,side.stage.clientWidth,side.stage.clientHeight,m.source_width||m.width,m.source_height||m.height);x=p.x;y=p.y;}
      o.setZoom(!z.enabled,x,y);position();for(const s of sides)void native(s);
    }
    for(const s of sides){
      s.stage.addEventListener('pointerdown',e=>{if(e.button!==0||!s.meta)return;drag={s,id:e.pointerId,x:e.clientX,y:e.clientY,z:o.zoom(),moved:false};s.stage.setPointerCapture(e.pointerId);e.preventDefault();});
      s.stage.addEventListener('pointermove',e=>{if(!drag||drag.s!==s||!o.zoom().enabled)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)<4&&!drag.moved)return;drag.moved=true;for(const side of sides){side.nativeController?.abort();side.native.hidden=true;side.nativeMeta=null;}const m=s.meta,dpr=devicePixelRatio||1;o.setZoom(true,Math.max(0,Math.min(1,drag.z.x-dx*dpr/(m.source_width||m.width))),Math.max(0,Math.min(1,drag.z.y-dy*dpr/(m.source_height||m.height))));position();});
      const end=e=>{if(!drag||drag.s!==s||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;if(s.stage.hasPointerCapture(e.pointerId))s.stage.releasePointerCapture(e.pointerId);if(e.type==='pointercancel')return;if(moved)for(const side of sides)void native(side);else{const r=s.stage.getBoundingClientRect();zoom({x:e.clientX-r.left,y:e.clientY-r.top},s);}};
      s.stage.addEventListener('pointerup',end);s.stage.addEventListener('pointercancel',end);
    }
    function hide(){cancel();root.hidden=true;$('single-stage').hidden=false;$('single-caption').hidden=false;}
    async function init(){try{settings=await o.api('/api/library/review-preferences');$('compare-layout').value=settings.compare_layout;$('compare-names').checked=settings.compare_names;layout();}catch(e){o.status(e.message);}}
    return {enabled:()=>enabled,command,show,hide,cancel,zoom,captions,init,surfaces:()=>sides,snapshot:()=>({enabled,left:left?.path,right:o.selected()?.path,layout:settings.compare_layout,zoom:o.zoom(),sides:sides.map(s=>({path:s.photo?.path,native:!!s.nativeMeta,kept:!!s.meta?.kept}))})};
  }
  window.HDRLibraryCompare={create};
})();
