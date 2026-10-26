/* GPU pixel statistics; compact order statistics and a three-term fit on the host.
 * Measurement is independent of finishing controls and rendition names.
 */
(() => {
  const VERSION = "adaptive-measure-gpu-v1";
  const shader = `
struct Params { w:u32, h:u32, count:u32, op:u32, step:u32, axis:u32, stride:u32, pad:u32, a:f32, b:f32, c:f32, extra:f32 }
@group(0) @binding(0) var<storage,read> src:array<vec4f>;
@group(0) @binding(1) var<storage,read> other:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> dst:array<vec4f>;
@group(0) @binding(3) var<uniform> p:Params;
@group(0) @binding(4) var<storage,read> edges:array<vec4u>;
fn coord(v:i32,n:u32,low:bool,high:bool,reach:u32)->u32 {
 var q=v;
 if(q<0){if(low && n>reach){q=-q;}else{q=0;}}
 if(q>=i32(n)){if(high && n>reach){q=2*i32(n)-2-q;}else{q=i32(n)-1;}}
 return u32(clamp(q,0,i32(n)-1));
}
fn at(x:i32,y:i32,t:u32,reach:u32)->vec4f {
 let e=edges[t]; return src[t*p.w*p.h+coord(y,p.h,e.x!=0u,e.y!=0u,reach)*p.w+coord(x,p.w,e.z!=0u,e.w!=0u,reach)];
}
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x; let area=p.w*p.h;
 if(p.op==7u){
  let bw=p.w/16u;let bh=p.h/16u;let blocks=bw*bh;if(i>=blocks*p.count){return;}
  let t=i/blocks;let b=i%blocks;let x=(b%bw)*16u;let y=(b/bw)*16u;
  var sum=vec3f(0);for(var dy=0u;dy<16u;dy++){for(var dx=0u;dx<16u;dx++){sum+=src[t*area+(y+dy)*p.w+x+dx].xyz;}}
  let mean=sum/256.;var variance=vec3f(0);
  for(var dy=0u;dy<16u;dy++){for(var dx=0u;dx<16u;dx++){let d=src[t*area+(y+dy)*p.w+x+dx].xyz-mean;variance+=d*d;}}
  dst[i]=vec4f(sqrt(variance/256.),0);return;
 }
 if(p.op==5u){if(i>=(area*p.count+p.stride-1u)/p.stride){return;}dst[i]=src[min(i*p.stride,area*p.count-1u)];return;}
 if(i>=area*p.count){return;}let t=i/area;let q=i%area;let x=i32(q%p.w);let y=i32(q/p.w);let v=src[i];
 if(p.op==0u){dst[i]=vec4f(dot(v.xyz,vec3f(.5773502692)),dot(v.xyz,vec3f(.7071067812,0,-.7071067812)),dot(v.xyz,vec3f(.4082482905,-.8164965809,.4082482905)),dot(v.xyz,vec3f(.2722287,.6740818,.0536895)));}
 if(p.op==1u){var total=vec4f(0);let weights=array<f32,5>(.0625,.25,.375,.25,.0625);for(var k=0u;k<5u;k++){let d=(i32(k)-2)*i32(p.step);total+=weights[k]*at(x+select(0,d,p.axis==0u),y+select(0,d,p.axis==1u),t,2u*p.step);}dst[i]=total;}
 if(p.op==2u){let lum=max(v.w,0.);dst[i]=vec4f(sqrt(max(p.c*lum*lum+p.a*lum+p.b,1e-20)));}
 if(p.op==3u){var mean=0.;var residual=0.;let k=array<f32,3>(1.,-2.,1.);for(var dy=0u;dy<3u;dy++){for(var dx=0u;dx<3u;dx++){let z=at(x+i32(dx)-1,y+i32(dy)-1,t,1u).w;mean+=z/9.;residual+=k[dy]*k[dx]*z;}}dst[i]=vec4f(mean,residual,0,0);}
 if(p.op==4u){var gx=0.;var gy=0.;let k=array<f32,3>(1.,2.,1.);for(var dy=0u;dy<3u;dy++){for(var dx=0u;dx<3u;dx++){let z=at(x+i32(dx)-1,y+i32(dy)-1,t,1u).x;gx+=f32(i32(dx)-1)*k[dy]*z;gy+=f32(i32(dy)-1)*k[dx]*z;}}dst[i]=vec4f(v.xy,length(vec2f(gx,gy)),0);}
 if(p.op==6u){dst[i]=vec4f((v.xyz-other[i].xyz)/max(other[i].w,1e-10),0);}
 if(p.op==8u){dst[i]=v*v;}
 if(p.op==9u){var total=vec4f(0);for(var k=-3;k<=3;k++){// Wiener box always replicates at window boundaries.
 let xx=u32(clamp(x+select(0,k,p.axis==0u),0,i32(p.w)-1));let yy=u32(clamp(y+select(0,k,p.axis==1u),0,i32(p.h)-1));total+=src[t*area+yy*p.w+xx];}dst[i]=total/7.;}
 // Difference divided by the retained sigma (passed in other); current/smooth
 // subtraction is a separate operation to keep the same normalization at all bands.
 if(p.op==10u){dst[i]=vec4f(v.xyz-other[i].xyz,other[i].w);}
 if(p.op==11u){dst[i]=vec4f(v.xyz/max(other[i].x,1e-10),0);}
 if(p.op==12u){dst[i]=vec4f(v.xyz,other[i].x);}
}`;
  const pipelines = new WeakMap();
  async function pipeline(device) {
    if (!pipelines.has(device)) pipelines.set(device, device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code:shader}),entryPoint:"main"}}).catch(error=>{pipelines.delete(device);throw error;}));
    return pipelines.get(device);
  }
  function quantile(values, q) {
    if (!values.length) return NaN;
    const sorted=Float64Array.from(values).sort(), at=(sorted.length-1)*q, low=Math.floor(at);
    return sorted[low]+(sorted[Math.min(low+1,sorted.length-1)]-sorted[low])*(at-low);
  }
  function fit(xs, vs, ws) {
    let best=Infinity, result=[0,0,0]; // c,a,b
    for(let mask=1;mask<8;mask++){
      const terms=[0,1,2].filter(k=>mask&(1<<k)), n=terms.length;
      const matrix=Array.from({length:n},()=>Array(n+1).fill(0));
      for(let i=0;i<xs.length;i++){
        const columns=[xs[i]**2,xs[i],1], weight=ws[i]/Math.max(vs[i],1e-20)**2;
        for(let j=0;j<n;j++){for(let k=0;k<n;k++)matrix[j][k]+=columns[terms[j]]*columns[terms[k]]*weight;matrix[j][n]+=columns[terms[j]]*vs[i]*weight;}
      }
      let valid=true;
      for(let j=0;j<n;j++){
        let pivot=j;for(let k=j+1;k<n;k++)if(Math.abs(matrix[k][j])>Math.abs(matrix[pivot][j]))pivot=k;
        [matrix[j],matrix[pivot]]=[matrix[pivot],matrix[j]];
        const d=matrix[j][j];if(Math.abs(d)<1e-30){valid=false;break;}
        for(let k=j;k<=n;k++)matrix[j][k]/=d;
        for(let row=0;row<n;row++)if(row!==j){const f=matrix[row][j];for(let k=j;k<=n;k++)matrix[row][k]-=f*matrix[j][k];}
      }
      const co=[0,0,0];for(let j=0;j<n;j++)co[terms[j]]=matrix[j][n];
      if(!valid||co.some(v=>v<0||!Number.isFinite(v)))continue;
      let error=0;for(let i=0;i<xs.length;i++)error+=ws[i]*((co[0]*xs[i]**2+co[1]*xs[i]+co[2]-vs[i])/Math.max(vs[i],1e-20))**2;
      if(error<best-1e-9){best=error;result=co;}
    }
    return {a:result[1],b:Math.max(result[2],Math.min(...vs)*.02,1e-20),c:result[0]};
  }
  function variance(samples) {
    const values=[];for(let i=0;i<samples.length;i+=4)if(samples[i]>0)values.push([samples[i],samples[i+1],samples[i+2]]);
    if(values.length<1000)return {a:0,b:1e-8,c:0};
    const edges=Array.from({length:13},(_,i)=>quantile(values.map(v=>v[0]),.02+i*.08));
    const xs=[],vs=[],ws=[];
    for(let i=0;i<12;i++){
      const bin=values.filter(v=>v[0]>=edges[i]&&v[0]<edges[i+1]);if(bin.length<8)continue;
      const limit=quantile(bin.map(v=>v[2]),.3), flat=bin.filter(v=>v[2]<=limit);
      const std=quantile(flat.map(v=>Math.abs(v[1])),.25)/.31863936396437514/6;
      xs.push(quantile(flat.map(v=>v[0]),.5));vs.push(std*std);ws.push(flat.length);
    }
    return xs.length>=2?fit(xs,vs,ws):{a:0,b:vs[0]||1e-8,c:0};
  }
  async function measure(device, description, pixels, budget=512*1024**2) {
    const start=performance.now(), {width:w,height:h,windows}=description, count=windows.length;
    const size=w*h*count*16, required=size*8+4*1024**2;
    if(required>budget||size>device.limits.maxStorageBufferBindingSize)throw Error("Denoise measurement exceeds available GPU memory.");
    const pipe=await pipeline(device), owned=[];
    const make=(bytes,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC)=>{const b=device.createBuffer({size:Math.max(16,bytes),usage});owned.push(b);return b;};
    device.pushErrorScope("out-of-memory");device.pushErrorScope("validation");
    try {
      const input=make(size), original=make(size), current=make(size), smooth=make(size), temp=make(size), band=make(size), energy=make(size), sigma=make(size);
      const flags=make(count*16);device.queue.writeBuffer(flags,0,new Uint32Array(windows.flatMap(v=>v.edges.map(Number))));
      device.queue.writeBuffer(input,0,pixels);
      const dispatch=(op,src,dst,other=src,extra={}, length=w*h*count)=>{
        const data=new ArrayBuffer(48), u=new Uint32Array(data),f=new Float32Array(data);
        u.set([w,h,count,op,extra.step||1,extra.axis||0,extra.stride||1,0]);f.set([extra.a||0,extra.b||0,extra.c||0,0],8);
        const params=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(params,0,data);
        const group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[src,other,dst,params,flags].map((buffer,binding)=>({binding,resource:{buffer}}))});
        const encoder=device.createCommandEncoder(), pass=encoder.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(length/128));pass.end();device.queue.submit([encoder.finish()]);
      };
      const read=async(buffer,bytes)=>{const staging=make(bytes,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);const enc=device.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,staging,0,bytes);device.queue.submit([enc.finish()]);await staging.mapAsync(GPUMapMode.READ);const result=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();return result;};
      const sample=async(buffer)=>{const stride=Math.max(1,Math.ceil(w*h*count/16384)), length=Math.ceil(w*h*count/stride);dispatch(5,buffer,temp,buffer,{stride},length);return read(temp,length*16);};
      const blur=(src,dst,step)=>{dispatch(1,src,temp,src,{step,axis:0});dispatch(1,temp,dst,temp,{step,axis:1});};
      dispatch(0,input,original);
      dispatch(3,original,band);dispatch(4,band,energy);
      const model=variance(await sample(energy));
      blur(original,current,1);blur(current,smooth,2);dispatch(2,smooth,sigma,smooth,model);
      // The opponent current keeps its luminance channel through the blur.
      let src=original, dst=current;
      const blockCount=Math.floor(w/16)*Math.floor(h/16)*count, stds=[], energies=[];
      for(let level=0;level<4;level++){
        blur(src,dst,2**level);
        dispatch(10,src,band,dst);dispatch(11,band,energy,sigma);
        if(level<2){dispatch(7,energy,band,energy,{},blockCount);stds.push(await read(band,blockCount*16));}
        dispatch(8,energy,band);dispatch(9,band,temp,band,{axis:0});dispatch(9,temp,energy,temp,{axis:1});
        energies.push(await sample(energy));
        src=dst;dst=dst===current?smooth:current;
      }
      const luma=Array.from({length:blockCount},(_,i)=>stds[0][i*4]);const limit=quantile(luma,.25), flat=luma.map((v,i)=>v<=limit?i:-1).filter(i=>i>=0);
      const rows=[];
      for(let k=0;k<3;k++){
        const s0=quantile(flat.map(i=>stds[0][i*4+k]),.1)*1.096484132980239;
        const s1=quantile(flat.map(i=>stds[1][i*4+k]),.1)*1.096484132980239;
        const ratio=Math.min(.6,Math.max(.15,s1/Math.max(s0,1e-12))),decay=Math.min(.65,Math.max(.45,ratio));
        rows.push([s0,...[1,2,3,4].map(level=>s0*ratio*decay**(level-1))]);
      }
      const limits=[1.9266645908355713,1.9007071256637573,1.8868334293365479,2.7170934677124023,2.666938304901123,2.5905818939208984];
      const references=[[1.583670735359192,2.354907751083374],[1.468549370765686,2.3227500915527344],[1.4817520380020142,2.290879726409912]];
      const kept=Array.from({length:3},()=>[[],[]]);let quietCount=0;
      for(let i=0;i<energies[0].length;i+=4){
        let quiet=true;for(let level=2;level<4;level++)for(let k=0;k<3;k++)if(!(energies[level][i+k]/Math.max(rows[k][level]**2,1e-12)<=limits[(level-2)*3+k]))quiet=false;
        if(!quiet)continue;quietCount++;
        for(let k=0;k<3;k++)for(let level=0;level<2;level++)kept[k][level].push(energies[level][i+k]/Math.max(rows[k][level]**2,1e-12));
      }
      const fraction=quietCount/(energies[0].length/4),confidence=Math.min(1,Math.max(0,(fraction-.005)/.015));
      for(let k=0;k<3;k++)for(let level=0;level<2;level++){
        const measured=kept[k][level].length>=Math.max(8,2000*energies[0].length/(4*w*h*count))?quantile(kept[k][level],.99)/references[k][level]:1;
        rows[k][level]*=Math.sqrt(1+confidence*(Math.min(4,Math.max(1,measured))-1));
      }
      const result={algorithm_version:"adaptive-atrous-v1",...model,band_sigmas:rows};
      if(![model.a,model.b,model.c,...rows.flat()].every(Number.isFinite))throw Error("Non-finite GPU noise measurement.");
      return {model:result,duration_ms:performance.now()-start,measured_pixels:w*h*count,version:VERSION};
    } finally {
      await device.queue.onSubmittedWorkDone().catch(()=>{});for(const buffer of owned)buffer.destroy();
      const validation=await device.popErrorScope(),oom=await device.popErrorScope();if(validation||oom)throw Error((validation||oom).message);
    }
  }
  window.HDRDenoiseMeasurement={measure,version:VERSION};
})();
