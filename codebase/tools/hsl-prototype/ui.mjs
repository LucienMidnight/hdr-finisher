import { newRecipe, validateRecipe, addSample, sampleNeighborhood, processCPU, describe, selection, decode, encode, fromLab, wrap, clamp } from './engine.mjs';
import { createGPU } from './gpu.mjs';
const $ = id => document.getElementById(id), canvas = $('photo'), ctx = canvas.getContext('2d');
let recipe = newRecipe(), original, gpu, gpuFailure = '', mode = 'pick', active = -1, history = [], future = [], gesture = null;
let revision = 0, drawing = false, dirty = false, center = [.5,.5];
const controls = ['hue','saturation','luminance','uniformity','opacity','width','feather'];
const snapshot = () => JSON.stringify({recipe,active,center,local:$('local').checked});
function restore(s) { const v = JSON.parse(s); recipe = v.recipe; active = v.active; center = v.center; $('local').checked = v.local; sync(); render(); }
function record(before) { if (before !== snapshot()) { history.push(before); if (history.length > 100) history.shift(); future = []; } buttons(); }
function buttons() { $('undo').disabled = !history.length; $('redo').disabled = !future.length; }
function notice(s = '') { $('notice').textContent = s; }
function mask() {
  const result = new Float32Array(canvas.width * canvas.height).fill(1);
  if ($('local').checked) for (let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const d = Math.hypot((x/canvas.width-center[0])/.35,(y/canvas.height-center[1])/.4);
    const t = clamp((1-d)/.25); result[y*canvas.width+x] = t*t*(3-2*t);
  }
  return result;
}
function sync() {
  controls.forEach(id => {
    const v = id === 'width' || id === 'feather' ? recipe.ranges[active]?.[id] ?? Number($(id).value) : recipe[id];
    $(id).value = v;
    $(id+'-out').textContent = id==='luminance' ? `${Number(v).toFixed(2)} EV` : id==='opacity' ? `${Math.round(v*100)}%` : `${Math.round(v)}${['hue','width','feather'].includes(id)?'°':'%'}`;
    if (id==='width'||id==='feather') $(id).disabled = active < 0;
  });
  $('ranges').replaceChildren();
  recipe.ranges.forEach((r,i) => {
    const row = document.createElement('div'); row.className = 'range-row';
    const choose = document.createElement('button'); choose.className = 'choose'; choose.textContent = `${r.subtract?'− Exclude':'+ Include'} ${Math.round(r.center)}°`;
    choose.setAttribute('aria-pressed',String(i===active)); choose.onclick = () => { active=i;sync(); };
    const remove = document.createElement('button'); remove.textContent='×'; remove.setAttribute('aria-label',`Remove range ${i+1}`);
    remove.onclick = () => { const before=snapshot(); recipe.ranges.splice(i,1); active=Math.min(active,recipe.ranges.length-1); record(before);sync();render(); };
    row.append(choose,remove); $('ranges').append(row);
  });
  $('range-name').textContent = active>=0 ? `Editing range ${active+1} · ${recipe.ranges[active].subtract?'Excluded':'Included'}` : 'Pick a color to begin';
  wheel();buttons();
}
const NS='http://www.w3.org/2000/svg';
function pathArc(start,end,r) {
  const point = h => [125+r*Math.cos(h*Math.PI/180),125+r*Math.sin(h*Math.PI/180)];
  const p=point(start); let d=`M ${p[0]} ${p[1]}`;
  for(let h=start+2;h<end;h+=2) { const q=point(h); d+=` L ${q[0]} ${q[1]}`; }
  const q=point(end); return d+` L ${q[0]} ${q[1]}`;
}
function wheel() {
  $('wheel-ranges').replaceChildren();
  recipe.ranges.forEach((r,i) => {
    for (const soft of [true,false]) {
      const path=document.createElementNS(NS,'path');
      path.setAttribute('d',pathArc(r.center-r.width-(soft?r.feather:0),r.center+r.width+(soft?r.feather:0),r.subtract?76:113));
      path.setAttribute('fill','none');path.setAttribute('stroke',r.subtract?'#ff9494':i===active?'#fff':'#9ee7f8');path.setAttribute('stroke-width',soft?'15':'5');path.setAttribute('opacity',soft?'.23':'1');
      path.dataset.range=i;path.style.cursor='grab';$('wheel-ranges').append(path);
    }
  });
}
for(let h=0;h<360;h+=2) {
  const p=document.createElementNS(NS,'path'), rgb=fromLab([.73,.13*Math.cos(h*Math.PI/180),.13*Math.sin(h*Math.PI/180)]).map(v=>Math.round(clamp(encode(v))*255));
  p.setAttribute('d',pathArc(h,h+2.5,94));p.setAttribute('stroke',`rgb(${rgb.join(',')})`);p.setAttribute('stroke-width','35');p.setAttribute('fill','none');$('wheel-colors').append(p);
}
const bandColors=['#ed4656','#ef8c39','#e9d54e','#61c25a','#40c9cf','#4b80ec','#985ee9','#dd54ba'];
bandColors.forEach((hex,i)=>{
  const button=document.createElement('button');button.style.background=hex;button.title=['Red','Orange','Yellow','Green','Cyan','Blue','Purple','Magenta'][i];button.setAttribute('aria-label',`Select ${button.title} band`);
  button.onclick=()=>{try{const before=snapshot();const rgb=[1,3,5].map(k=>decode(parseInt(hex.slice(k,k+2),16)/255));addSample(recipe,rgb,mode,Number($('width').value),Number($('feather').value));active=recipe.ranges.length-1;record(before);notice();sync();render();}catch(e){notice(e.message);}};$('bands').append(button);
});
$('modes').onclick=e=>{if(e.target.dataset.mode){mode=e.target.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));}};
async function render() {
  revision++;dirty=true;if(drawing||!original)return;
  drawing=true;
  try {
    while(dirty){
      dirty=false;const rev=revision, src=original, current=structuredClone(recipe), m=mask(), width=canvas.width,height=canvas.height;
      let output=src, engine='Original';
      if(!$('before').checked){
        if(gpu&&!$('cpu').checked){
          try{output=await gpu.process(src,current,m);engine='WebGPU';}
          catch(e){gpu.destroy();gpu=null;gpuFailure=e.message;output=processCPU(src,current,m);engine='CPU fallback';}
        }else{output=processCPU(src,current,m);engine='CPU fallback';}
      }
      if(rev!==revision)continue;
      const image=new ImageData(width,height), overlay=$('overlay').checked&&!$('before').checked;
      for(let i=0;i<output.length;i+=4){
        const w=overlay?selection(src.subarray(i,i+3),current.ranges).weight*m[i/4]*current.opacity:0;
        for(let c=0;c<3;c++){const v=clamp(encode(output[i+c]));image.data[i+c]=Math.round(255*(overlay?v*.3*(1-w)+[.1,.85,1][c]*w:v));}
        image.data[i+3]=Math.round(clamp(output[i+3])*255);
      }
      ctx.putImageData(image,0,0);
      $('status').textContent=`${engine} · ${width} × ${height} · ${current.ranges.filter(r=>!r.subtract).length} included / ${current.ranges.filter(r=>r.subtract).length} excluded ranges${gpuFailure?' · '+gpuFailure:''}`;
      window.hslPrototype.lastOutput=output;
    }
  }catch(e){notice(e.message);}finally{drawing=false;}
}
function pick(e, continuing=false){
  const box=canvas.getBoundingClientRect(),x=Math.min(canvas.width-1,Math.max(0,Math.floor((e.clientX-box.left)/box.width*canvas.width))),y=Math.min(canvas.height-1,Math.max(0,Math.floor((e.clientY-box.top)/box.height*canvas.height)));
  if(e.altKey&&$('local').checked){center=[x/canvas.width,y/canvas.height];render();return;}
  try{
    const rgb=sampleNeighborhood(original,canvas.width,canvas.height,x,y);
    if(addSample(recipe,rgb,continuing&&mode==='pick'?'add':mode,Number($('width').value),Number($('feather').value))){active=recipe.ranges.length-1;notice();sync();render();}
    else if(describe(rgb).relativeChroma<.02)notice('That sample is too neutral. Pick a more colorful area.');
  }catch(e){notice(e.message);}
}
canvas.onpointerdown=e=>{if(e.button!==0)return;gesture=snapshot();canvas.setPointerCapture(e.pointerId);pick(e);};
canvas.onpointermove=e=>{if(gesture)pick(e,true);};
function finish(){if(gesture){record(gesture);gesture=null;}}
canvas.onpointerup=finish;canvas.onpointercancel=()=>{if(gesture){const prior=gesture;gesture=null;restore(prior);}};
canvas.onlostpointercapture=finish;
let wheelGesture=null;
$('wheel').onpointerdown=e=>{if(e.target.dataset.range===undefined)return;active=Number(e.target.dataset.range);wheelGesture=snapshot();$('wheel').setPointerCapture(e.pointerId);sync();};
$('wheel').onpointermove=e=>{if(!wheelGesture)return;const b=$('wheel').getBoundingClientRect();recipe.ranges[active].center=wrap(Math.atan2(e.clientY-b.top-b.height/2,e.clientX-b.left-b.width/2)*180/Math.PI);sync();render();};
function finishWheel(){if(wheelGesture){record(wheelGesture);wheelGesture=null;}}
$('wheel').onpointerup=finishWheel;$('wheel').onlostpointercapture=finishWheel;
$('wheel').onpointercancel=()=>{if(wheelGesture){const s=wheelGesture;wheelGesture=null;restore(s);}};
controls.forEach(id=>{
  let before=null;const start=()=>{before??=snapshot();};const end=()=>{if(before){record(before);before=null;}};
  $(id).onpointerdown=start;$(id).onkeydown=start;$(id).onchange=end;$(id).onblur=end;
  $(id).oninput=()=>{start();if(id==='width'||id==='feather'){if(active>=0)recipe.ranges[active][id]=Number($(id).value);}else recipe[id]=Number($(id).value);sync();render();};
});
$('undo').onclick=()=>{if(history.length){future.push(snapshot());restore(history.pop());}};
$('redo').onclick=()=>{if(future.length){history.push(snapshot());restore(future.pop());}};
$('reset').onclick=()=>{const b=snapshot();recipe=newRecipe();active=-1;record(b);sync();render();notice();};
for(const id of ['overlay','before','cpu'])$(id).onchange=render;
$('local').onchange=()=>{const after=snapshot(),old=JSON.parse(after);old.local=!old.local;record(JSON.stringify(old));render();};
$('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='hsl-recipe.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('load').onchange=async()=>{try{const r=validateRecipe(JSON.parse(await $('load').files[0].text()));const b=snapshot();recipe=r;active=r.ranges.length-1;record(b);notice();sync();render();}catch(e){notice(e.message);}finally{$('load').value='';}};
function setSource(image){
  canvas.width=image.width;canvas.height=image.height;original=new Float32Array(image.data.length);
  for(let i=0;i<image.data.length;i+=4){for(let c=0;c<3;c++)original[i+c]=decode(image.data[i+c]/255);original[i+3]=image.data[i+3]/255;}
  recipe=newRecipe();active=-1;history=[];future=[];notice();sync();render();
}
$('file').onchange=async()=>{
  let bitmap;
  try{
    const file=$('file').files[0];if(!file)return;
    bitmap=await createImageBitmap(file);const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));
    const temp=document.createElement('canvas');temp.width=Math.max(1,Math.round(bitmap.width*scale));temp.height=Math.max(1,Math.round(bitmap.height*scale));
    const c=temp.getContext('2d',{colorSpace:'srgb'});c.drawImage(bitmap,0,0,temp.width,temp.height);setSource(c.getImageData(0,0,temp.width,temp.height));
  }catch(e){notice(`Photo could not be loaded: ${e.message}`);}finally{bitmap?.close();$('file').value='';}
};
function demo(){
  const temp=document.createElement('canvas');temp.width=900;temp.height=560;const c=temp.getContext('2d');
  const sky=c.createLinearGradient(0,0,0,560);sky.addColorStop(0,'#225eb8');sky.addColorStop(.55,'#97c7db');sky.addColorStop(.56,'#a0ad50');sky.addColorStop(1,'#354c29');c.fillStyle=sky;c.fillRect(0,0,900,560);
  c.fillStyle='#e5dfd2';c.beginPath();c.ellipse(665,115,125,28,-.1,0,Math.PI*2);c.fill();
  for(let i=0;i<65;i++){const x=(i*137)%900,y=300+(i*71)%240;c.fillStyle=`hsl(${65+(i*17)%80} 50% ${22+i%22}%)`;c.beginPath();c.ellipse(x,y,35+i%15,14,Math.sin(i),0,Math.PI*2);c.fill();}
  c.fillStyle='#d58a48';c.fillRect(345,290,205,165);c.fillStyle='#ac483b';c.beginPath();c.moveTo(325,300);c.lineTo(445,205);c.lineTo(570,300);c.fill();c.fillStyle='#386ba0';c.fillRect(405,345,65,110);
  // Continuous hue strip exposes selection gaps and feathering immediately.
  for(let x=0;x<900;x++){c.fillStyle=`hsl(${x/900*360} 70% 55%)`;c.fillRect(x,510,1,50);}
  setSource(c.getImageData(0,0,900,560));
}
$('demo').onclick=demo;
window.hslPrototype={ get recipe(){return structuredClone(recipe);},get original(){return original;},get gpu(){return gpu;},render,ready:false };
demo();
try{gpu=await createGPU();}catch(e){gpuFailure=e.message;}
window.hslPrototype.ready=true;await render();
