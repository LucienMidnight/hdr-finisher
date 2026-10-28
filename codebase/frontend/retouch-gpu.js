/* Bounded Retouch kernels. The delivery queue owns admission and cancellation. */
window.HDRRetouchGPU=(()=>{
 const cache=new WeakMap();
 function source(m){
  const a=k=>`${m.input[k]}u`,s=k=>`${m.scratch[k]}u`,f=v=>`${Number(v).toExponential(9)}`;
  const remap=(m.reference_windows||[]).map(r=>`if(i>=${r.offset}u&&i<${r.offset+r.width*r.height*3}u){let pixel=(i-${r.offset}u)/3u;let full=${m.reference_offset}u+((${r.top}u+pixel/${r.width}u)*${m.reference_width}u+${r.left}u+pixel%${r.width}u)*3u;return vec3f(input[full],input[full+1u],input[full+2u]);}`).join('');
  const common=`
struct Params {v:vec4u};
@group(0) @binding(0) var<storage,read> input:array<f32>;
@group(0) @binding(1) var<storage,read_write> scratch:array<f32>;
@group(0) @binding(2) var<storage,read_write> output:array<f32>;
@group(0) @binding(3) var<uniform> param:Params;
const W:i32=${m.w}i; const H:i32=${m.h}i;
fn rgb(i:u32)->vec3f{${remap}return vec3f(input[i],input[i+1u],input[i+2u]);}
fn load3(i:u32)->vec3f{return vec3f(scratch[i],scratch[i+1u],scratch[i+2u]);}
fn put(i:u32,v:vec3f){scratch[i]=v.x;scratch[i+1u]=v.y;scratch[i+2u]=v.z;}
fn emit(i:u32,v:vec3f){output[i]=v.x;output[i+1u]=v.y;output[i+2u]=v.z;}
fn pos(i:u32,w:i32)->vec2i{return vec2i(i32(i)%w,i32(i)/w);}
fn ix(p:vec2i,w:i32,h:i32)->u32{let q=clamp(p,vec2i(0),vec2i(w-1,h-1));return u32(q.y*w+q.x);}
fn sample_input(off:u32,w:i32,h:i32,p:vec2f)->vec3f{
 let q=clamp(p,vec2f(0),vec2f(f32(w-1),f32(h-1)));let b=vec2i(q);let t=fract(q);
 return mix(mix(rgb(off+ix(b,w,h)*3u),rgb(off+ix(b+vec2i(1,0),w,h)*3u),t.x),
 mix(rgb(off+ix(b+vec2i(0,1),w,h)*3u),rgb(off+ix(b+vec2i(1,1),w,h)*3u),t.x),t.y);
}
fn sample_scratch(off:u32,w:i32,h:i32,p:vec2f)->vec3f{
 let q=clamp(p,vec2f(0),vec2f(f32(w-1),f32(h-1)));let b=vec2i(q);let t=fract(q);
 return mix(mix(load3(off+ix(b,w,h)*3u),load3(off+ix(b+vec2i(1,0),w,h)*3u),t.x),
 mix(load3(off+ix(b+vec2i(0,1),w,h)*3u),load3(off+ix(b+vec2i(1,1),w,h)*3u),t.x),t.y);
}
`;
  if(m.mode!=='inpaint')return common+transfer(m,a,s,f);
  const code=`
const N:u32=${m.count}u;const R:i32=${m.radius}i;const K:f32=${(2*m.radius+1)**2}.0;
fn image(p:vec2i)->vec3f{return rgb(${a('image')}+ix(p,W,H)*3u);}
fn work(p:vec2i)->vec3f{return load3(${s('work')}+ix(p,W,H)*3u);}
fn mean(p:vec2i)->vec3f{return rgb(${a('mean')}+ix(p,W,H)*3u);}
fn target_pos(t:u32)->vec2i{return vec2i(i32(input[${a('targets')}+t*2u+1u]),i32(input[${a('targets')}+t*2u]));}
fn link(t:u32,off:u32)->vec2i{return vec2i(i32(scratch[off+t*2u+1u]),i32(scratch[off+t*2u]));}
fn index(p:vec2i)->i32{if(any(p<vec2i(0))||any(p>=vec2i(W,H))){return -1;}return i32(input[${a('lookup')}+ix(p,W,H)]);}
fn score(t:u32,p:vec2i)->f32{
 let at=target_pos(t);var dc=vec3f(0);var result=0.0;
 if(${m.align}){for(var y=-R;y<=R;y++){for(var x=-R;x<=R;x++){dc+=work(at+vec2i(x,y));}}dc/=K;}
 for(var y=-R;y<=R;y++){for(var x=-R;x<=R;x++){
  let d=vec2i(x,y);let ti=ix(at+d,W,H);
  var confidence=select(1.0,0.0,input[${a('excluded')}+ti]>0.0);
  if(input[${a('defect')}+ti]>0.0){confidence=0.25;}
  var delta=rgb(${a('source')}+ix(p+d,W,H)*3u)-(work(at+d)-dc);
  if(${m.align}){delta-=mean(p);}
  result+=dot(delta*delta,vec3f(confidence));
 }}return result;
}
@compute @workgroup_size(64) fn init(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i<u32(W*H)){put(${s('work')}+i*3u,rgb(${a('guide')}+i*3u));}
 if(i<N){scratch[${s('field_a')}+i*2u]=input[${a('initial')}+i*2u];scratch[${s('field_a')}+i*2u+1u]=input[${a('initial')}+i*2u+1u];}
}
@compute @workgroup_size(64) fn search(@builtin(global_invocation_id) id:vec3u){
 let t=id.x;if(t>=N){return;}let current=link(t,param.v.y);var candidate=current;
 if(param.v.x<=4u){
  var shift=vec2i(0,1);if(param.v.x==2u){shift=vec2i(1,0);}if(param.v.x==3u){shift=vec2i(0,-1);}if(param.v.x==4u){shift=vec2i(-1,0);}
  let ni=index(target_pos(t)-shift);candidate=vec2i(-1);
  if(ni>=0){candidate=link(u32(ni),param.v.y)+shift;}
 }else{
  candidate=vec2i(i32(input[param.v.w+t*2u+1u]),i32(input[param.v.w+t*2u]));
  if(param.v.x==6u){candidate+=current;}
 }
 var winner=current;
 if(all(candidate>=vec2i(R))&&all(candidate<vec2i(W-R,H-R))){
  if(input[${a('valid')}+ix(candidate,W,H)]>0.0&&score(t,candidate)<score(t,current)){winner=candidate;}
 }
 scratch[param.v.z+t*2u]=f32(winner.y);scratch[param.v.z+t*2u+1u]=f32(winner.x);
}
@compute @workgroup_size(64) fn vote(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(W*H)||input[${a('defect')}+i]==0.0){return;}
 let p=pos(i,W);var value=vec3f(0);var count=0.0;
 for(var y=-R;y<=R;y++){for(var x=-R;x<=R;x++){
  let ti=index(p-vec2i(x,y));if(ti<0){continue;}let donor=link(u32(ti),param.v.y);
  var v=image(donor+vec2i(x,y));if(${m.align}){v+=rgb(${a('guide_mean')}+u32(ti)*3u)-mean(donor);}
  value+=v;count+=1.0;
 }}put(${s('work')}+i*3u,value/count);
}
fn solved(p:vec2i)->vec3f{let i=ix(p,W,H);if(input[${a('defect')}+i]>0.0){return work(p);}return image(p);}
fn filled(p:vec2i)->vec3f{
 ${m.factor===1?'return solved(p);':`
 let q=clamp((vec2f(p)+0.5)/${m.factor}.0-0.5,vec2f(0),vec2f(f32(W-1),f32(H-1)));let b=vec2i(q);let t=fract(q);
 return mix(mix(solved(b),solved(b+vec2i(1,0)),t.x),mix(solved(b+vec2i(0,1)),solved(b+vec2i(1,1)),t.x),t.y);`}
}
fn native(p:vec2i)->vec3f{return rgb(${a('native')}+ix(p,${m.nw}i,${m.nh}i)*3u);}
@compute @workgroup_size(64) fn base(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${m.pw*m.ph}u){return;}let p=pos(i,${m.pw}i)+vec2i(${m.x}i,${m.y}i);
 let alpha=input[${a('solve_alpha')}+ix(p,${m.nw}i,${m.nh}i)];put(${s('base')}+i*3u,mix(native(p),filled(p),alpha));
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i<N){let p=link(i,param.v.y)*${m.factor}i;output[${m.pw*m.ph*3}u+i*2u]=f32(p.y);output[${m.pw*m.ph*3+1}u+i*2u]=f32(p.x);}
 if(i>=${m.pw*m.ph}u){return;}let p=pos(i,${m.pw}i);let np=p+vec2i(${m.x}i,${m.y}i);
 var value=load3(${s('base')}+i*3u);
 ${m.method==='standard'?'':`
 let alpha=input[${a('alpha')}+ix(np,${m.nw}i,${m.nh}i)];
 ${['original-detail','donor-detail'].includes(m.method)&&m.amount?`
 var at=np;
 ${m.method==='donor-detail'?`
 let ti=index(np/${m.factor}i);var valid=ti>=0;
 if(valid){let d=link(u32(ti),param.v.y)*${m.factor}i;at=d+np%${m.factor}i;valid=all(at>=vec2i(0))&&all(at<vec2i(${m.nw}i,${m.nh}i));}
 if(!valid&&alpha>0.0){emit(i*3u,vec3f(bitcast<f32>(0x7fc00000u+param.v.x)));return;}if(!valid){at=vec2i(0);}
 `:''}
 var original_mean=vec3f(0);var filled_mean=vec3f(0);
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
 original_mean+=native(at+vec2i(x,y));filled_mean+=load3(${s('base')}+ix(p+vec2i(x,y),${m.pw}i,${m.ph}i)*3u);
 }}value+=${f(m.amount)}*((native(at)-original_mean/25.0)-(value-filled_mean/25.0));
 `:''}
 value=mix(native(np),value,alpha);`}
 emit(i*3u,value*${f(m.scale)});
}
`;
 return common+code+(m.texture?texture(m,a,s,f):'');
 }
 function texture(m,a,s,f){return `
const TW:i32=${m.tw}i;const TH:i32=${m.th}i;const KN:u32=${m.known_count}u;
fn basis(p:u32,j:u32)->f32{return input[${a('basis')}+p*6u+j];}
fn tknown(k:u32)->vec2i{return vec2i(i32(input[${a('tknown')}+k*2u+1u]),i32(input[${a('tknown')}+k*2u]));}
fn candidate(c:u32)->vec2i{return vec2i(i32(input[${a('tcandidates')}+c*2u+1u]),i32(input[${a('tcandidates')}+c*2u]));}
fn fit_value(c:u32,p:u32)->vec3f{var v=vec3f(0);for(var j=0u;j<6u;j++){v+=load3(${s('fits')}+c*18u+j*3u)*basis(p,j);}return v;}
fn donor_at(c:u32,p:u32)->vec3f{
 var value=image(candidate(c)+pos(p,TW));
 if(${m.align}){for(var j=0u;j<6u;j++){value+=basis(p,j)*(rgb(${a('tfit')}+j*3u)-load3(${s('fits')}+c*18u+j*3u));}}
 return value;
}
@compute @workgroup_size(64) fn powers(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(W*H)){return;}let p=pos(i,W);var avg=vec3f(0);
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){avg+=work(p+vec2i(x,y));}}
 let d=work(p)-avg/9.0;let power=dot(d,d)/3.0;
 scratch[${s('powers')}+i*2u]=select(0.0,power,input[${a('defect')}+i]>0.0);
 scratch[${s('powers')}+i*2u+1u]=select(0.0,power,input[${a('ring')}+i]>0.0);
}
@compute @workgroup_size(64) fn texture_scores(@builtin(global_invocation_id) id:vec3u){
 let c=id.x;if(c>=${m.candidates}u){return;}var dc=vec3f(0);
 for(var j=0u;j<6u;j++){var value=vec3f(0);for(var k=0u;k<KN;k++){value+=input[${a('projection')}+j*KN+k]*image(candidate(c)+tknown(k));}put(${s('fits')}+c*18u+j*3u,value);}
 if(!${m.align}){for(var k=0u;k<KN;k++){dc+=image(candidate(c)+tknown(k));}dc/=f32(KN);}
 var power=0.0;
 for(var k=0u;k<KN;k++){
  let at=tknown(k);let pi=u32(at.y*TW+at.x);var detail=image(candidate(c)+at)-dc;
  if(${m.align}){detail=image(candidate(c)+at)-fit_value(c,pi);}power+=dot(detail,detail)/3.0;
 }power/=f32(KN);var error=0.0;
 for(var k=0u;k<KN;k++){
  let at=tknown(k);let pi=u32(at.y*TW+at.x);let sample=image(candidate(c)+at);var delta=sample-image(at+vec2i(${m.tx}i,${m.ty}i));
  if(${m.align}){delta=(sample-fit_value(c,pi))/sqrt(power+1e-30)-rgb(${a('residual')}+k*3u)/sqrt(${f(m.variance)});}
  error+=dot(delta,delta)/3.0;
 }error/=f32(KN);if(!${m.align}){error/=${f(m.variance)};}
 let ratio=log((power+1e-30)/${f(m.variance)});scratch[${s('scores')}+c]=error+ratio*ratio;
}
@compute @workgroup_size(1) fn texture_choose(){
 var inside=0.0;var ring=0.0;
 for(var i=0u;i<u32(W*H);i++){inside+=scratch[${s('powers')}+i*2u];ring+=scratch[${s('powers')}+i*2u+1u];}
 inside/=${m.defect_count}.0;ring/=${m.ring_count}.0;
 if(ring<=1e-14||inside>=0.5*ring){scratch[${s('choice')}]=0.0;return;}
 var best=3.402823e38;var winner=0u;
 for(var c=0u;c<${m.candidates}u;c++){if(scratch[${s('scores')}+c]<best){best=scratch[${s('scores')}+c];winner=c;}}
 scratch[${s('choice')}]=1.0;scratch[${s('choice')}+1u]=f32(winner);
 var dc=vec3f(0);for(var k=0u;k<KN;k++){let p=tknown(k);dc+=image(p+vec2i(${m.tx}i,${m.ty}i))-donor_at(winner,u32(p.y*TW+p.x));}
 put(${s('choice')}+2u,dc/f32(KN));
}
@compute @workgroup_size(64) fn texture_init(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(TW*TH)||scratch[${s('choice')}]==0.0){return;}
 let p=pos(i,TW)+vec2i(${m.tx}i,${m.ty}i);let donor=donor_at(u32(scratch[${s('choice')}+1u]),i);let anchor=work(p)-donor;
 put(${s('donor')}+i*3u,donor);put(${s('anchor')}+i*3u,anchor);var correction=anchor;
 if(input[${a('known_mask')}+i]>0.0){correction=image(p)-donor;}
 if(input[${a('hole')}+i]>0.0){correction=load3(${s('choice')}+2u);}
 put(${s('correction_a')}+i*3u,correction);
}
@compute @workgroup_size(64) fn texture_relax(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(TW*TH)||scratch[${s('choice')}]==0.0){return;}let p=pos(i,TW);var v=load3(param.v.y+i*3u);
 if(input[${a('hole')}+i]>0.0){let strength=${m.align?'0.0':'0.5'};
 v=(load3(param.v.y+ix(p+vec2i(-1,0),TW,TH)*3u)+load3(param.v.y+ix(p+vec2i(1,0),TW,TH)*3u)+load3(param.v.y+ix(p+vec2i(0,-1),TW,TH)*3u)+load3(param.v.y+ix(p+vec2i(0,1),TW,TH)*3u)+strength*load3(${s('anchor')}+i*3u))/(4.0+strength);}
 put(param.v.z+i*3u,v);
}
@compute @workgroup_size(64) fn texture_apply(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(TW*TH)||scratch[${s('choice')}]==0.0||input[${a('hole')}+i]==0.0){return;}
 let p=pos(i,TW)+vec2i(${m.tx}i,${m.ty}i);put(${s('work')}+ix(p,W,H)*3u,load3(${s('donor')}+i*3u)+load3(param.v.y+i*3u));
}
`;}
 function transfer(m,a,s,f){return `
const GW:i32=${m.gw}i;const GH:i32=${m.gh}i;const GN:u32=${m.gw*m.gh}u;
const WX:f32=${f(m.wx)};const WY:f32=${f(m.wy)};const DIAG:f32=2.0*(WX+WY);
fn unknown(i:u32)->bool{return input[${a('unknown')}+i]>0.0;}
fn at(off:u32,p:vec2i)->vec3f{return load3(off+ix(p,GW,GH)*3u);}
fn neighbors(off:u32,p:vec2i)->vec3f{return WX*(at(off,p+vec2i(-1,0))+at(off,p+vec2i(1,0)))+WY*(at(off,p+vec2i(0,-1))+at(off,p+vec2i(0,1)));}
@compute @workgroup_size(64) fn transfer_sample(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(W*H)){return;}let p=pos(i,W);
 let donor=sample_input(${a('donor')},${m.sw}i,${m.sh}i,vec2f(p)+vec2f(${f(m.sx)},${f(m.sy)}));
 put(${s('sampled')}+i*3u,donor);put(${s('difference')}+i*3u,rgb(${a('original')}+i*3u)-donor);
}
@compute @workgroup_size(64) fn heal_grid(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=GN){return;}let p=vec2f(pos(i,GW))*vec2f(${f((m.w-1)/(m.gw-1))},${f((m.h-1)/(m.gh-1))});
 put(${s('field')}+i*3u,sample_scratch(${s('difference')},W,H,p));
}
@compute @workgroup_size(1) fn heal_seed(){
 var boundary=vec3f(0);var count=0.0;var peak=0.0;
 for(var i=0u;i<GN;i++){let v=load3(${s('field')}+i*3u);peak=max(peak,max(abs(v.x),max(abs(v.y),abs(v.z))));if(!unknown(i)){boundary+=v;count+=1.0;}}
 boundary/=count;
 for(var i=0u;i<GN;i++){if(unknown(i)){put(${s('solution')}+i*3u,boundary);put(${s('field')}+i*3u,vec3f(0));}}
 var squared=vec3f(0);var maximum=0.0;
 for(var i=0u;i<GN;i++){if(unknown(i)){
  let p=pos(i,GW);let residual=neighbors(${s('field')},p)-(DIAG*boundary-neighbors(${s('solution')},p));
  put(${s('residual')}+i*3u,residual);put(${s('direction')}+i*3u,residual);squared+=residual*residual;
  maximum=max(maximum,max(abs(residual.x),max(abs(residual.y),abs(residual.z))));
 }}put(${s('control')}+1u,squared);
 scratch[${s('control')}+12u]=max(peak,${f(1/m.scale)})*DIAG*1e-8;
 scratch[${s('control')}]=select(0.0,1.0,maximum<=scratch[${s('control')}+12u]);
}
@compute @workgroup_size(64) fn heal_product(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=GN||!unknown(i)||scratch[${s('control')}]>0.0){return;}
 put(${s('product')}+i*3u,DIAG*load3(${s('direction')}+i*3u)-neighbors(${s('direction')},pos(i,GW)));
}
@compute @workgroup_size(1) fn heal_step(){
 if(scratch[${s('control')}]>0.0){return;}var denominator=vec3f(0);
 for(var i=0u;i<GN;i++){if(unknown(i)){denominator+=load3(${s('direction')}+i*3u)*load3(${s('product')}+i*3u);}}
 let squared=load3(${s('control')}+1u);var step=vec3f(0);
 for(var c=0u;c<3u;c++){if(denominator[c]>0.0){step[c]=squared[c]/denominator[c];}}
 put(${s('control')}+4u,step);
}
@compute @workgroup_size(64) fn heal_update(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=GN||!unknown(i)||scratch[${s('control')}]>0.0){return;}
 let step=load3(${s('control')}+4u);
 put(${s('solution')}+i*3u,load3(${s('solution')}+i*3u)+load3(${s('direction')}+i*3u)*step);
 put(${s('residual')}+i*3u,load3(${s('residual')}+i*3u)-load3(${s('product')}+i*3u)*step);
}
@compute @workgroup_size(1) fn heal_beta(){
 if(scratch[${s('control')}]>0.0){return;}var squared=vec3f(0);var maximum=0.0;
 for(var i=0u;i<GN;i++){if(unknown(i)){let r=load3(${s('residual')}+i*3u);squared+=r*r;maximum=max(maximum,max(abs(r.x),max(abs(r.y),abs(r.z))));}}
 let previous=load3(${s('control')}+1u);var beta=vec3f(0);
 for(var c=0u;c<3u;c++){if(previous[c]>0.0){beta[c]=squared[c]/previous[c];}}
 put(${s('control')}+7u,beta);put(${s('control')}+1u,squared);
 scratch[${s('control')}]=select(0.0,1.0,maximum<=scratch[${s('control')}+12u]);
}
@compute @workgroup_size(64) fn heal_direction(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=GN||!unknown(i)||scratch[${s('control')}]>0.0){return;}
 put(${s('direction')}+i*3u,load3(${s('residual')}+i*3u)+load3(${s('direction')}+i*3u)*load3(${s('control')}+7u));
}
@compute @workgroup_size(64) fn heal_finish(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=GN||!unknown(i)){return;}put(${s('field')}+i*3u,load3(${s('solution')}+i*3u));
}
@compute @workgroup_size(64) fn transfer_finish(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=u32(W*H)){return;}let p=pos(i,W);var value=load3(${s('sampled')}+i*3u);
 ${m.mode==='heal'?`value+=sample_scratch(${s('field')},GW,GH,vec2f(p)*vec2f(${f((m.gw-1)/Math.max(m.w-1,1))},${f((m.gh-1)/Math.max(m.h-1,1))}));`:''}
 let blend=input[${a('alpha')}+i]*${f(m.strength)};emit(i*3u,mix(rgb(${a('original')}+i*3u),value,blend)*${f(m.scale)});
}
`;}
 // Put numerical recipe values in uniforms so nearby spots reuse pipelines.
 // The computation and phase order are unchanged; only parameter delivery moves.
 function parameterize(code){
  const names=[];
  code=code.replace(/const (\w+):(\w+)=([^;]+);/g,(_,name,type,value)=>{names.push(name);return `fn value_${name}()->${type}{return ${value};}`;});
  for(const name of names)code=code.replace(new RegExp(`\\b${name}\\b`,'g'),`value_${name}()`);
  const bytes=new ArrayBuffer(16384),words=new Uint32Array(bytes),floats=new Float32Array(bytes);let count=0;
  code=code.replace(/(?<![\w.])(?:\d+\.\d*(?:e[+-]?\d+)?|\d+e[+-]?\d+|\d+[ui])\b/gi,value=>{
   if(count>=words.length)throw Error('Repair parameters exceed command reservation.');
   const i=count++,at=`recipe.values[${Math.floor(i/4)}u][${i%4}u]`;
   if(value.endsWith('u')){words[i]=Number(value.slice(0,-1));return at;}
   if(value.endsWith('i')){words[i]=Number(value.slice(0,-1));return `i32(${at})`;}
   floats[i]=Number(value);return `bitcast<f32>(${at})`;
  });
  return {code:'struct Recipe {values:array<vec4u,1024>};@group(0) @binding(4) var<uniform> recipe:Recipe;\n'+code,bytes};
 }
 async function run(device,m,body,permit,budget){
  const sizes=[m.input_count,m.scratch_count,m.output_count].map(n=>Math.max(4,n*4));
  const required=sizes[0]+sizes[1]+sizes[2]*2+4*1024*1024;
  if(required>budget||sizes.some(n=>n>device.limits.maxStorageBufferBindingSize||n>device.limits.maxBufferSize))throw Error('GPU repair exceeds the existing memory budget.');
  if(body.byteLength!==sizes[0])throw Error('Incomplete GPU repair input.');
  const owned=[];let uniformBytes=16384;
  const make=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
  let modules=cache.get(device);if(!modules){modules=new Map();cache.set(device,modules);}
  // Numerical data (including seed) is in the packet, not the pipeline key.
  const parameters=parameterize(source(m)),code=parameters.code;let entry=modules.get(code);
  if(!entry){
   const module=device.createShaderModule({code});const info=await module.getCompilationInfo();
   const errors=info.messages.filter(v=>v.type==='error');if(errors.length)throw Error(errors.map(v=>`${v.lineNum}:${v.linePos} ${v.message}`).join('\n'));
   const bind=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
    {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
   entry={module,pipelines:new Map(),layout:device.createPipelineLayout({bindGroupLayouts:[bind]})};modules.set(code,entry);
   if(modules.size>16)modules.delete(modules.keys().next().value);
  }
  device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
  let scopes=true;
  try{
  const buffers=sizes.map(size=>make(size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC));
  device.queue.writeBuffer(buffers[0],0,body);
  const recipeBuffer=make(parameters.bytes.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(recipeBuffer,0,parameters.bytes);
  let encoder=device.createCommandEncoder();let passes=0;
  const dispatch=async(name,count,params=[0,0,0,0])=>{
   let pipeline=entry.pipelines.get(name);
   if(!pipeline){pipeline=await device.createComputePipelineAsync({layout:entry.layout,compute:{module:entry.module,entryPoint:name}});entry.pipelines.set(name,pipeline);}
   // A separate immutable uniform per dispatch prevents later writes changing
   // earlier phases in an unsubmitted command buffer.
   uniformBytes+=16;if(uniformBytes>4*1024*1024)throw Error('GPU repair command reservation exceeded.');
   const p=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(p,0,new Uint32Array(params));
   const bindings=buffers.map((buffer,binding)=>({binding,resource:{buffer}}));bindings.push({binding:3,resource:{buffer:p}},{binding:4,resource:{buffer:recipeBuffer}});
   const layout=pipeline.getBindGroupLayout(0);
   const group=device.createBindGroup({layout,entries:bindings});
   const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/(name==='texture_choose'||['heal_seed','heal_step','heal_beta'].includes(name)?1:64)));pass.end();passes++;
  };
  const submit=async()=>{await permit();device.queue.submit([encoder.finish()]);encoder=device.createCommandEncoder();passes=0;};
  const read=async(buffer,offset,size)=>{
   const b=make(size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,offset,b,0,size);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const result=b.getMappedRange().slice(0);b.unmap();return result;
  };
   if(m.mode==='inpaint'){
    await dispatch('init',Math.max(m.w*m.h,m.count));
    let current=m.scratch.field_a,next=m.scratch.field_b;
    for(const turn of m.phases){
     for(const [kind,proposal] of turn){await dispatch('search',m.count,[kind,current,next,proposal]);[current,next]=[next,current];}
     await dispatch('vote',m.w*m.h,[0,current,0,0]);await submit();
    }
    if(m.texture){
     await dispatch('powers',m.w*m.h);await dispatch('texture_scores',m.candidates);await dispatch('texture_choose',1);await dispatch('texture_init',m.tw*m.th);
     let a=m.scratch.correction_a,b=m.scratch.correction_b;
     for(let iteration=0;iteration<256;iteration++){
      await dispatch('texture_relax',m.tw*m.th,[0,a,b,0]);[a,b]=[b,a];if(iteration%32===31)await submit();
     }
     await dispatch('texture_apply',m.tw*m.th,[0,a,0,0]);
    }
    await dispatch('base',m.pw*m.ph);await dispatch('finish',Math.max(m.count,m.pw*m.ph),[0,current,0,0]);
   }else{
    await dispatch('transfer_sample',m.w*m.h);
    if(m.mode==='heal'){
     await dispatch('heal_grid',m.gw*m.gh);await dispatch('heal_seed',1);await submit();
     let converged=new Float32Array(await read(buffers[1],m.scratch.control*4,4))[0]>0;
     for(let iteration=0;iteration<1200&&!converged;iteration+=16){
      for(let j=0;j<16;j++)for(const name of ['heal_product','heal_step','heal_update','heal_beta','heal_direction'])await dispatch(name,['heal_step','heal_beta'].includes(name)?1:m.gw*m.gh);
      await submit();converged=new Float32Array(await read(buffers[1],m.scratch.control*4,4))[0]>0;
     }
     if(!converged)throw Error('Healing did not converge; use a smaller stroke');
     await dispatch('heal_finish',m.gw*m.gh);
    }
    await dispatch('transfer_finish',m.w*m.h);
   }
   if(passes)await submit();const output=await read(buffers[2],0,sizes[2]);
   const validation=await device.popErrorScope(),oom=await device.popErrorScope();scopes=false;if(validation||oom)throw Error((validation||oom).message);
   return {pixels:output,reservedBytes:required};
  }finally{try{if(scopes){await device.popErrorScope();await device.popErrorScope();}}finally{for(const b of owned)b.destroy();}}
 }
 return {run,source};
})();
