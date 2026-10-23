/* HSL authoring uses the existing grade history, presets and slider controls. */
const hslUI = { panels: [], picker: null, stroke: null, overlayRevision: 0 };

function initializeHslPanels() {
  for (const scope of ['global', 'local']) {
    const host = document.getElementById(`hsl-${scope}-panel`);
    const ui = { host, scope, channel: 'red', range: 0, mode: 'pick', gesture: false, signature: '' };
    hslUI.panels.push(ui);
    host.innerHTML = `<div class="hsl-channels" aria-label="${scope === 'global' ? 'Channels' : 'Quick starts'}"></div>
      <div class="hsl-customs"></div><div class="hsl-title"><strong></strong><span></span>
      <button type="button" class="text-button" data-hsl-action="reset">Reset channel</button>
      <button type="button" class="text-button" data-hsl-action="delete">Delete</button></div>
      <svg class="hsl-wheel" viewBox="0 0 320 320" aria-label="HSL colour selection wheel"></svg>
      <div class="hsl-picker">${['pick','add','subtract'].map(m=>`<button type="button" class="text-button" data-hsl-mode="${m}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}
      <button type="button" class="text-button" data-hsl-action="stop">Stop picking</button></div>
      <label><input type="checkbox" data-hsl-selection> Show selection</label>
      <div class="hsl-sliders"></div><p class="hsl-notice" role="status" aria-live="polite"></p>`;
    const specs = [['width','Range',1,180,1,16],['feather','Softness',1,90,1,12],['hue','Hue',-180,180,1,0],['saturation','Saturation',-100,100,1,0],['luminance','Luminance',-2,2,.01,0],['uniformity','Uniformity',0,100,1,0],['opacity','Amount',0,1,.01,1]];
    for (const [key,label,min,max,step,value] of specs) {
      const row = document.createElement('div'); row.className = 'control-row instrument-slider-control';
      row.innerHTML = `<div class="control-heading"><label>${label}</label><output></output></div><input type="range" aria-label="HSL ${label}" data-hsl-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">`;
      host.querySelector('.hsl-sliders').append(row);
      const input = row.querySelector('input');
      input.addEventListener('pointerdown',()=>hslBegin(ui));
      input.addEventListener('input',()=>{
        const channel = hslChannel(ui); if (!channel) return;
        hslBegin(ui);
        const target = ['width','feather'].includes(key) ? channel.recipe.ranges[ui.range] : channel.recipe;
        if (!target) return;
        target[key] = Number(input.value); hslPreview(ui); hslSync(ui);
      });
      input.addEventListener('change',()=>hslEnd(ui));
      input.addEventListener('pointerup',()=>hslEnd(ui));
      input.addEventListener('pointercancel',()=>hslEnd(ui));
      enhanceRangeControl(input);
    }
    bindSliderReadouts(host);
    host.querySelectorAll('[data-hsl-mode]').forEach(button=>button.addEventListener('click',()=>{
      ui.mode=button.dataset.hslMode;hslUI.picker=ui;hslNotice(ui,'Click or drag on the main preview. Escape stops picking.');hslSync(ui);
    }));
    host.querySelector('[data-hsl-action="stop"]').onclick=()=>{hslUI.picker=null;hslSync(ui);};
    host.querySelector('[data-hsl-action="reset"]').onclick=()=>hslEdit(ui,()=>{
      const c=hslChannel(ui),defaults=HDRHSL.defaultSettings().channels.find(v=>v.id===c.id);
      c.recipe=defaults?defaults.recipe:HDRHSL.newRecipe();
      if(ui.scope==='local')hslOwner(ui).hsl=c.recipe;
      ui.range=0;
    });
    host.querySelector('[data-hsl-action="delete"]').onclick=()=>hslEdit(ui,()=>{
      const owner=hslOwner(ui);owner.hsl.channels=owner.hsl.channels.filter(c=>c.id!==ui.channel);ui.channel='red';ui.range=0;
    });
    host.querySelector('[data-hsl-selection]').onchange=()=>void hslSelection(ui);
    hslBindWheel(ui);
  }
  document.addEventListener('pointerdown',hslPickStart,true);
  document.addEventListener('pointermove',hslPickMove,true);
  document.addEventListener('pointerup',hslPickEnd,true);
  document.addEventListener('pointercancel',()=>{hslUI.stroke=null;},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){hslUI.picker=null;hslUI.stroke=null;hslClearSelection();renderHslPanels();}});
  window.addEventListener('resize',hslPlaceOverlay);
  window.addEventListener('scroll',hslPlaceOverlay,true);
  document.getElementById('hsl-reset').onclick=()=>{const ui=hslUI.panels[0];hslEdit(ui,()=>{hslOwner(ui).hsl=HDRHSL.defaultSettings();hslOwner(ui).hsl_section_enabled=true;ui.channel='red';ui.range=0;});};
  document.getElementById('local-hsl-reset').onclick=()=>{const ui=hslUI.panels[1];if(hslOwner(ui))hslEdit(ui,()=>{hslOwner(ui).hsl=HDRHSL.newRecipe();ui.range=0;});};
  document.getElementById('local-hsl-bypass').onclick=()=>{const ui=hslUI.panels[1];if(hslOwner(ui))hslEdit(ui,()=>{hslOwner(ui).hsl_section_enabled=!hslOwner(ui).hsl_section_enabled;});};
  renderHslPanels();
}

function hslOwner(ui) { return ui.scope==='global'?state.adjustments?.[state.currentView]:selectedLocal()?.[`${state.currentView}_grade`]; }
function hslChannel(ui) {
  const owner=hslOwner(ui);if(!owner)return null;
  if(ui.scope==='local')return {id:'selection',name:'Selection',kind:'custom',recipe:owner.hsl};
  return owner.hsl?.channels.find(c=>c.id===ui.channel)||owner.hsl?.channels[0];
}
function hslNotice(ui,text=''){ui.host.querySelector('.hsl-notice').textContent=text;}
function hslBegin(ui){
  if(ui.gesture)return;ui.gesture=true;
  ui.gestureLocal=ui.scope==='local'?selectedLocal()?.id:null;
  ui.gestureLane=state.currentView;
  ui.before=JSON.stringify([hslOwner(ui)?.hsl,hslOwner(ui)?.hsl_section_enabled]);
  if(ui.scope==='global')beginGlobalEditGesture(ui.host);
  state.previewScheduler?.beginInteraction();
}
function hslPreview(ui){
  if(ui.scope==='local'){hideLocalMaskOverlayForGradePreview();scheduleLocalPreview();}
  else {invalidatePreview(state.currentView);debouncePreview(state.currentView);}
}
function hslEnd(ui){
  if(!ui.gesture)return;ui.gesture=false;state.previewScheduler?.endInteraction();
  if(ui.scope==='global')endGlobalEditGesture(ui.host);
  else if(ui.gestureLocal===selectedLocal()?.id && ui.gestureLane===state.currentView && ui.before!==JSON.stringify([hslOwner(ui)?.hsl,hslOwner(ui)?.hsl_section_enabled]))void commitSelectedLocal({refreshPreview:false});
  if(ui.host.querySelector('[data-hsl-selection]').checked)void hslSelection(ui);
}
function hslEdit(ui,fn){hslBegin(ui);try{fn();hslPreview(ui);}catch(error){hslNotice(ui,error.message);}finally{hslSync(ui);hslEnd(ui);}}
function hslAddCustom(ui){
  const channels=hslOwner(ui).hsl.channels;
  if(channels.length>=13)throw Error('All four Custom channels are in use. Delete one to add another.');
  let n=1;while(channels.some(c=>c.name===`Custom ${n}`))n++;
  const c={id:crypto.randomUUID(),name:`Custom ${n}`,kind:'custom',recipe:HDRHSL.newRecipe()};channels.push(c);ui.channel=c.id;ui.range=0;return c;
}
function renderHslPanels(){
  if(!hslUI.panels.length)return;
  const identity=`${state.session?.session_id}:${state.currentView}:${state.gradeMode}:${selectedLocal()?.id}`;
  if(hslUI.identity!==identity){hslUI.identity=identity;hslUI.picker=null;hslUI.stroke=null;hslClearSelection();}
  for(const ui of hslUI.panels){
    const signature=JSON.stringify([hslOwner(ui)?.hsl,hslOwner(ui)?.hsl_section_enabled,ui.channel,ui.range,Boolean(state.session)]);
    if(signature!==ui.signature){ui.signature=signature;hslSync(ui);}
  }
  const overlayOwner=hslUI.panels.find(ui=>ui.host.querySelector('[data-hsl-selection]').checked);
  const selectionKey=`${state.editRevision}:${state.globalEditGeneration}`;
  if(overlayOwner&&!overlayOwner.gesture&&selectionKey!==hslUI.selectionKey){
    hslUI.selectionKey=selectionKey;clearTimeout(hslUI.selectionTimer);
    hslUI.selectionTimer=setTimeout(()=>{if(overlayOwner.host.querySelector('[data-hsl-selection]').checked)void hslSelection(overlayOwner);},250);
  }
}
function hslSync(ui){
  const owner=hslOwner(ui),c=hslChannel(ui);ui.host.hidden=!owner;if(!c)return;
  const e=HDRHSL,global=ui.scope==='global';
  if(global)ui.host.closest('.control-group').classList.toggle('modified',JSON.stringify(owner.hsl)!==JSON.stringify(e.defaultSettings())||owner.hsl_section_enabled===false);
  if(!global){const toggle=document.getElementById('local-hsl-bypass');toggle.textContent=owner.hsl_section_enabled===false?'Off':'On';toggle.setAttribute('aria-pressed',String(owner.hsl_section_enabled!==false));}
  ui.range=Math.min(Math.max(0,ui.range),Math.max(0,c.recipe.ranges.length-1));
  const strip=ui.host.querySelector('.hsl-channels');strip.replaceChildren();
  const defaults=e.defaultSettings().channels;
  const channels=global?owner.hsl.channels.filter(v=>v.kind!=='custom'):e.BANDS;
  for(const ch of channels){
    const button=document.createElement('button');button.type='button';button.className='hsl-channel text-button';
    button.setAttribute('aria-label',global?`${ch.name} channel`:`${ch.name} quick start`);
    const band=e.BANDS.find(b=>b.id===ch.id);button.style.background=band?.hex||'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)';
    button.setAttribute('aria-pressed',String(global&&c.id===ch.id));
    if(global&&JSON.stringify(ch.recipe)!==JSON.stringify(defaults.find(d=>d.id===ch.id)?.recipe))button.classList.add('modified');
    button.title=ch.name;
    button.onclick=()=>{
      if(global){ui.channel=ch.id;ui.range=0;hslSync(ui);if(ui.host.querySelector('[data-hsl-selection]').checked)void hslSelection(ui);}
      else hslEdit(ui,()=>{const r=hslChannel(ui).recipe;if(ui.mode==='pick')r.ranges=[e.bandRange(ch)];else{if(r.ranges.length>=32)throw Error('Selection is limited to 32 ranges; remove or widen a range.');r.ranges.push({...e.bandRange(ch),subtract:ui.mode==='subtract'});}ui.range=r.ranges.length-1;});
    };strip.append(button);
  }
  const customs=ui.host.querySelector('.hsl-customs');customs.replaceChildren();customs.hidden=!global;
  if(global){
    for(const ch of owner.hsl.channels.filter(v=>v.kind==='custom')){
      const b=document.createElement('button');b.className='text-button';b.type='button';b.textContent=ch.name+(JSON.stringify(ch.recipe)!==JSON.stringify(e.newRecipe())?' •':'');b.setAttribute('aria-pressed',String(c.id===ch.id));b.onclick=()=>{ui.channel=ch.id;ui.range=0;hslSync(ui);if(ui.host.querySelector('[data-hsl-selection]').checked)void hslSelection(ui);};customs.append(b);
    }
    const add=document.createElement('button');add.type='button';add.className='text-button';add.textContent='+ Custom';add.disabled=owner.hsl.channels.length>=13;add.title=add.disabled?'All four Custom channels are in use':'';add.onclick=()=>hslEdit(ui,()=>hslAddCustom(ui));customs.append(add);
  }
  ui.host.querySelector('.hsl-title strong').textContent=c.name;
  ui.host.querySelector('.hsl-title span').textContent=`${c.recipe.ranges.filter(r=>!r.subtract).length} in · ${c.recipe.ranges.filter(r=>r.subtract).length} out`;
  ui.host.querySelector('[data-hsl-action="delete"]').hidden=!(global&&c.kind==='custom');
  ui.host.querySelectorAll('[data-hsl-mode]').forEach(b=>b.setAttribute('aria-pressed',String(ui.mode===b.dataset.hslMode)));
  ui.host.querySelector('[data-hsl-action="stop"]').hidden=hslUI.picker!==ui;
  for(const input of ui.host.querySelectorAll('[data-hsl-key]')){
    const k=input.dataset.hslKey,range=['width','feather'].includes(k),r=c.recipe.ranges[ui.range];
    const stock=defaults.find(v=>v.id===c.id)?.recipe||e.newRecipe();
    input.dataset.defaultValue=String(range?(stock.ranges[0]?.[k]??(k==='width'?16:12)):stock[k]);
    const value=range?r?.[k]??Number(input.defaultValue):c.recipe[k];input.value=String(value);
    input.disabled=!state.session || (range&&(!r||c.kind==='all')) || (k==='uniformity'&&c.kind==='all');
    input.closest('.control-row').querySelector('output').textContent=k==='opacity'?`${Math.round(value*100)}%`:k==='luminance'?`${Number(value).toFixed(2)} EV`:['width','feather','hue'].includes(k)?`${Math.round(value)}°`:`${Math.round(value)}%`;
    updateRangeVisual(input);
  }
  hslWheel(ui);
}

function hslWheel(ui){
  const svg=ui.host.querySelector('svg'),e=HDRHSL,c=hslChannel(ui);svg.replaceChildren();if(!c)return;
  const node=(tag,attrs,parent=svg)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;};
  const pt=(h,r)=>[160+r*Math.cos(h*Math.PI/180),160-r*Math.sin(h*Math.PI/180)];
  const arc=(a,b,r)=>{const steps=Math.max(2,Math.ceil(Math.abs(b-a)/2));return Array.from({length:steps+1},(_,i)=>`${i?'L':'M'}${pt(a+(b-a)*i/steps,r).join(' ')}`).join(' ');};
  const rgb=h=>e.fromLab([.72,.12*Math.cos(h*Math.PI/180),.12*Math.sin(h*Math.PI/180)]);
  const css=v=>`rgb(${v.map(x=>Math.round(e.clamp(e.encode(x))*255)).join(' ')})`;
  for(let h=0;h<360;h+=3){const v=rgb(h+1.5),weight=c.kind==='all'?1:e.selection(v,c.recipe.ranges).weight;
    node('path',{d:arc(h,h+3.6,118),stroke:css(v),'stroke-width':26,fill:'none',opacity:.25+.75*weight});
    const result=ui.scope==='global'?e.applyChannels(v,hslOwner(ui).hsl.channels):e.applyPixel(v,c.recipe);
    node('path',{d:arc(h,h+3.6,88),stroke:css(result),'stroke-width':16,fill:'none'});
  }
  node('text',{x:160,y:155,'text-anchor':'middle',fill:'currentColor'}).textContent=c.name;
  node('text',{x:160,y:178,'text-anchor':'middle',fill:'currentColor','font-size':10}).textContent='outer: source · inner: result';
  if(c.kind==='all')return;
  const handle=(kind,h,r,i,label)=>{const group=node('g',{'data-hsl-handle':kind,'data-range':i,tabindex:0,role:'slider','aria-label':label,'aria-valuemin':0,'aria-valuemax':360,'aria-valuenow':e.wrap(h)}),p=pt(h,r);
    if(kind.startsWith('edge')){const a=pt(h,r-9),b=pt(h,r+9);node('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'transparent','stroke-width':16},group);node('line',{x1:a[0],y1:a[1],x2:b[0],y2:b[1],stroke:'currentColor','stroke-width':4},group);}
    else{node('circle',{cx:p[0],cy:p[1],r:11,fill:'transparent'},group);node('circle',{cx:p[0],cy:p[1],r:kind.startsWith('feather')?4:6,fill:kind==='move'?css(rgb(h)):'currentColor',stroke:'currentColor','stroke-width':2},group);}
  };
  c.recipe.ranges.forEach((r,i)=>{const radius=r.subtract?96:142;
    node('path',{d:arc(r.center-r.width-r.feather,r.center+r.width+r.feather,radius),stroke:'currentColor','stroke-width':6,fill:'none',opacity:.25,'data-hsl-handle':'move','data-range':i});
    node('path',{d:arc(r.center-r.width,r.center+r.width,radius),stroke:'currentColor','stroke-width':5,fill:'none','stroke-dasharray':r.subtract?'4 3':'none','data-hsl-handle':'move','data-range':i});
    handle('move',r.center,radius,i,`${r.subtract?'Excluded':'Included'} range centre`);
    if(i===ui.range){for(const side of [-1,1]){handle(`edge${side}`,r.center+side*r.width,radius,i,side<0?'Range start':'Range end');handle(`feather${side}`,r.center+side*(r.width+r.feather),radius,i,side<0?'Softness start':'Softness end');}if(!r.subtract)handle('target',r.center+c.recipe.hue,88,i,'Hue shift target');}
  });
}
function hslRemoveRange(ui,i){
  const c=hslChannel(ui),r=c.recipe.ranges[i];if(!r)return;
  if(c.kind==='band'&&!r.subtract&&c.recipe.ranges.filter(v=>!v.subtract).length<=1){hslNotice(ui,'A band must keep one included range.');return;}
  hslEdit(ui,()=>c.recipe.ranges.splice(i,1));
}
function hslMoveHandle(ui,kind,i,h){
  const e=HDRHSL,c=hslChannel(ui),r=c.recipe.ranges[i];if(!r)return;
  if(kind==='move')r.center=e.wrap(h);
  else if(kind==='target')c.recipe.hue=e.clamp(e.delta(h,r.center),-180,180);
  else {const side=kind.endsWith('-1')?-1:1;
    if(kind.startsWith('edge')){const fixed=r.center-side*r.width;const span=((side*(h-fixed))%360+360)%360;r.width=e.clamp(span/2,1,180);r.center=e.wrap(fixed+side*r.width);}
    else r.feather=e.clamp(side*e.delta(h,r.center+side*r.width),1,90);
  }
}
function hslBindWheel(ui){
  const svg=ui.host.querySelector('svg');let drag=null;
  const hue=event=>{const box=svg.getBoundingClientRect();return HDRHSL.wrap(Math.atan2(-(event.clientY-box.top-box.height/2),event.clientX-box.left-box.width/2)*180/Math.PI);};
  svg.addEventListener('pointerdown',event=>{const target=event.target.closest('[data-hsl-handle]');if(!target||event.button!==0)return;event.preventDefault();const i=Number(target.dataset.range);ui.range=i;hslBegin(ui);drag={kind:target.dataset.hslHandle,i,offset:target.dataset.hslHandle==='move'?HDRHSL.delta(hslChannel(ui).recipe.ranges[i].center,hue(event)):0};svg.setPointerCapture(event.pointerId);hslSync(ui);});
  svg.addEventListener('pointermove',event=>{if(!drag)return;hslMoveHandle(ui,drag.kind,drag.i,hue(event)+drag.offset);hslPreview(ui);hslSync(ui);});
  const end=()=>{if(!drag)return;drag=null;hslEnd(ui);};svg.addEventListener('pointerup',end);svg.addEventListener('lostpointercapture',end);svg.addEventListener('pointercancel',end);
  svg.addEventListener('contextmenu',event=>{const target=event.target.closest('[data-hsl-handle]');if(!target)return;event.preventDefault();if(target.dataset.hslHandle!=='target')hslRemoveRange(ui,Number(target.dataset.range));});
  svg.addEventListener('keydown',event=>{const target=event.target.closest('[data-hsl-handle]');if(!target)return;const i=Number(target.dataset.range),kind=target.dataset.hslHandle;
    if(['Delete','Backspace'].includes(event.key)){event.preventDefault();hslRemoveRange(ui,i);return;}
    const direction={ArrowRight:1,ArrowUp:1,ArrowLeft:-1,ArrowDown:-1}[event.key];if(!direction)return;event.preventDefault();
    const r=hslChannel(ui).recipe.ranges[i],side=kind.endsWith('-1')?-1:1;
    const h=kind==='target'?r.center+hslChannel(ui).recipe.hue:kind==='move'?r.center:r.center+side*(r.width+(kind.startsWith('feather')?r.feather:0));
    hslEdit(ui,()=>{ui.range=i;hslMoveHandle(ui,kind,i,h+direction*(event.shiftKey?5:1));});svg.querySelector(`[data-hsl-handle="${kind}"][data-range="${i}"][tabindex]`)?.focus();
  });
}

function hslPoint(event){const preview=activePreviewElement();if(!preview)return null;const r=preview.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return null;return{x:HDRHSL.clamp((event.clientX-r.left)/r.width),y:HDRHSL.clamp((event.clientY-r.top)/r.height)};}
function hslPickStart(event){if(!hslUI.picker||event.button!==0||!state.session)return;const point=hslPoint(event);if(!point)return;event.preventDefault();event.stopImmediatePropagation();hslUI.stroke={ui:hslUI.picker,points:[point],lane:state.currentView,session:state.session.session_id,localId:hslUI.picker.scope==='local'?selectedLocal()?.id:null};}
function hslPickMove(event){const s=hslUI.stroke;if(!s)return;event.preventDefault();event.stopImmediatePropagation();const p=hslPoint(event),last=s.points.at(-1);if(p&&s.points.length<512&&Math.hypot(p.x-last.x,p.y-last.y)>.003)s.points.push(p);}
function hslPickEnd(event){if(!hslUI.stroke)return;event.preventDefault();event.stopImmediatePropagation();const s=hslUI.stroke;hslUI.stroke=null;void hslPickSamples(s);}
async function hslFetchStage(ui,points,extra={}){
  if(await syncGlobalEditState()===false)throw Error("The current edit could not be saved.");
  await state.editCommandQueue;
  const response=await fetch(`/api/session/${state.session.session_id}/hsl-sample`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lane:state.currentView,local_id:ui.scope==='local'?selectedLocal()?.id:null,points,adjustments:state.adjustments,local_adjustments:localAdjustments(),edit_revision:state.editRevision,long_edge:1000,...extra})});
  const result=await safeJson(response);if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'HSL stage sampling failed.');return result;
}
async function hslPickSamples(stroke){
  const {ui}=stroke,identity=hslUI.identity,channel=ui.channel,mode=ui.mode;
  if(ui.sampling){hslNotice(ui,"Wait for the current colour sample to finish.");return;}ui.sampling=true;
  try{
    hslNotice(ui,'Sampling colours…');
    if(await syncGlobalEditState()===false)throw Error('Save the current edit before picking colours.');
    const result=await hslFetchStage(ui,stroke.points);
    if(channel!==ui.channel||mode!==ui.mode||identity!==hslUI.identity||stroke.lane!==state.currentView||stroke.session!==state.session?.session_id)return;
    const samples=result.samples.filter(v=>HDRHSL.describe(v).relativeChroma>=.02&&Math.abs(HDRHSL.describe(v).L)>=1e-5);
    if(!samples.length){hslNotice(ui,'That sample is too grey to have a hue. Pick a more colourful area.');return;}
    hslEdit(ui,()=>{
      let c=hslChannel(ui);if(c.kind==='all')c=hslAddCustom(ui);
      const band=HDRHSL.BANDS.find(b=>b.id===c.id);let changed=false;
      for(const rgb of samples){const mode=ui.mode==='pick'?(changed?'add':'pick'):ui.mode;
        try{if(HDRHSL.addSample(c.recipe,rgb,mode,band?.width||16,band?.feather||12))changed=true;}
        catch(error){hslNotice(ui,error.message);break;}
      }
      ui.range=Math.max(0,c.recipe.ranges.length-1);
      if(c.recipe.ranges.length<32)hslNotice(ui,'Colours selected. Click or drag to pick again; Escape stops picking.');
    });
  }catch(error){hslNotice(ui,error.message);}finally{ui.sampling=false;}
}
function hslClearSelection(){clearTimeout(hslUI.selectionTimer);hslUI.overlayRevision++;document.getElementById('hsl-selection-overlay')?.remove();for(const ui of hslUI.panels)ui.host.querySelector('[data-hsl-selection]').checked=false;}
function hslPlaceOverlay(){const image=document.getElementById('hsl-selection-overlay'),preview=activePreviewElement();if(!image||!preview)return;const r=preview.getBoundingClientRect();Object.assign(image.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});}
async function hslSelection(ui){
  const checked=ui.host.querySelector('[data-hsl-selection]').checked;hslClearSelection();if(!checked||!state.session)return;ui.host.querySelector('[data-hsl-selection]').checked=true;
  const revision=hslUI.overlayRevision;
  try{const data=await hslFetchStage(ui,[{x:.5,y:.5}],{selection_recipe:hslChannel(ui).recipe});if(revision!==hslUI.overlayRevision)return;const image=document.createElement('img');image.id='hsl-selection-overlay';image.alt='';image.src=data.selection_overlay;image.style.cssText='position:fixed;pointer-events:none;z-index:20;';document.body.append(image);hslPlaceOverlay();}catch(error){hslNotice(ui,error.message);}
}
