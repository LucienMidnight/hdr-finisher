/* Edge colour v1. Shared by Library RAW and the Grade/import delivery worker.
 * Scalar planes keep each storage binding below the adapter's size limit.
 * Every allocation uses the caller's reservation and every dispatch yields.
 */
(function(root) {
  "use strict";
  const caches = new WeakMap();
  async function reconstruct({device, planes, ratio, width:w, height:h, expand,
    toBT, fromBT, make, release, read, beforeSubmit = async()=>{}}) {
    let cache=caches.get(device); if(!cache)caches.set(device,cache=new Map());
    const owned=new Set(), alloc=bytes=>{const b=make(bytes);owned.add(b);return b;};
    const drop=b=>{if(owned.delete(b))release(b);};
    const stash=async b=>{const bytes=await read(b,w*h*4);drop(b);return bytes;};
    const restore=bytes=>{const b=alloc(bytes.byteLength);device.queue.writeBuffer(b,0,bytes);return b;};
    const u=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    async function op(inputs, body, ow=w, oh=h, functions="") {
      const code=`@group(0) @binding(0) var<uniform> p:vec4<u32>;
        ${inputs.map((_,j)=>`@group(0) @binding(${j+1}) var<storage,read> ${String.fromCharCode(97+j)}:array<f32>;`).join("\n")}
        @group(0) @binding(${inputs.length+1}) var<storage,read_write> out:array<f32>;
        fn ss(lo:f32,hi:f32,v:f32)->f32 {let t=clamp((v-lo)/max(hi-lo,1e-9),0.,1.);return t*t*(3.-2.*t);}
        ${functions}
        @compute @workgroup_size(16,16) fn main(@builtin(global_invocation_id) g:vec3<u32>){
          let x=g.x;let y=g.y+p.x;if(x>=${ow}u||y>=${oh}u){return;}
          let i=y*${ow}u+x;${body}
        }`;
      let pipe=cache.get(code);
      if(!pipe){pipe=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code}),entryPoint:"main"}});cache.set(code,pipe);
        if(cache.size>256)cache.delete(cache.keys().next().value);}
      const out=alloc(ow*oh*4);
      const buffers=[u,...inputs,out];
      const group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
      // These scalar passes are much lighter than AHD. A 1024-row band
      // keeps preemption bounded without thousands of round trips to Dawn.
      for(let row=0;row<oh;row+=1024){
        await beforeSubmit();device.queue.writeBuffer(u,0,new Uint32Array([row,0,0,0]));
        const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);
        pass.dispatchWorkgroups(Math.ceil(ow/16),Math.ceil(Math.min(1024,oh-row)/16));pass.end();device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
      return out;
    }
    const f=v=>{const s=String(Math.fround(v));return /[.e]/i.test(s)?s:s+".0";};
    const dot=(matrix,k)=>`(${matrix[k].map((v,j)=>`${f(v)}*${String.fromCharCode(97+j)}[i]`).join("+")})`;
    const round=v=>{const a=Math.floor(v),d=v-a;return d===.5?a+(a%2):Math.round(v);};
    async function blur(input,sigma){
      if(sigma<.5)return op([input],"out[i]=a[i];");
      const factor=Math.max(1,Math.floor(sigma/4)),bw=Math.ceil(w/factor),bh=Math.ceil(h/factor);
      let small;
      if(factor===1)small=await op([input],"out[i]=a[i];");
      else {
        const mid=await op([input],`var s=0.;for(var k=0u;k<${factor}u;k++){s+=a[y*${w}u+min(x*${factor}u+k,${w-1}u)];}out[i]=s/${f(factor)};`,bw,h);
        small=await op([mid],`var s=0.;for(var k=0u;k<${factor}u;k++){s+=a[min(y*${factor}u+k,${h-1}u)*${bw}u+x];}out[i]=s/${f(factor)};`,bw,bh);drop(mid);
      }
      const r=Math.max(1,round((Math.sqrt(4*(sigma/factor)**2+1)-1)/2));
      for(let pass=0;pass<3;pass++)for(const axis of [0,1]){
        const next=await op([small],`var s=0.;for(var k=-${r};k<=${r};k++){
          let xx=${axis===1?`u32(clamp(i32(x)+k,0,${bw-1}))`:"x"};let yy=${axis===0?`u32(clamp(i32(y)+k,0,${bh-1}))`:"y"};s+=a[yy*${bw}u+xx];}out[i]=s/${f(2*r+1)};`,bw,bh);
        drop(small);small=next;
      }
      if(factor===1)return small;
      const out=await op([small],`let pos=(vec2<f32>(f32(x),f32(y))+.5)/${f(factor)}-.5;
        let lo=vec2<u32>(clamp(floor(pos),vec2<f32>(0.),vec2<f32>(${f(bw-1)},${f(bh-1)})));
        let hi=min(lo+vec2<u32>(1u),vec2<u32>(${bw-1}u,${bh-1}u));let t=clamp(pos-floor(pos),vec2<f32>(0.),vec2<f32>(1.));
        out[i]=mix(mix(a[lo.y*${bw}u+lo.x],a[lo.y*${bw}u+hi.x],t.x),mix(a[hi.y*${bw}u+lo.x],a[hi.y*${bw}u+hi.x],t.x),t.y);`);
      drop(small);return out;
    }
    try {
      const transport=[];for(let k=0;k<3;k++)transport.push(await op(planes,`out[i]=${dot(toBT,k)};`));
      const luma=await op(transport,"out[i]=max(.2627*a[i]+.678*b[i]+.0593*c[i],0.);");
      const total=await op(transport,"out[i]=max(a[i]+b[i]+c[i],1e-12);");
      const clip=await op([ratio],"out[i]=ss(.92,1.,a[i]);");
      release(ratio);
      const selected=await op([luma,clip],"out[i]=select(-1.,a[i],b[i]>=.5);");
      const samples=new Float32Array(await read(selected,w*h*4));drop(selected);
      let count=0;for(const v of samples)if(v>=0)samples[count++]=v;
      if(!count)return {planes,applied:false,clipped_pixel_fraction:0};
      // Once clipping is established the caller's inputs can be consumed.
      // Original transport and carried colours live in host RAM between GPU
      // passes, keeping peak GPU residency within the existing RAW budget.
      for(const b of [...planes,ratio])release(b);
      const originals=[];for(const b of transport)originals.push(await stash(b));
      // Only the scalar median is selected on the host; all spatial work and
      // colour reconstruction run on the GPU, including the clipping mask.
      const values=samples.subarray(0,count);values.sort();
      const median=(values[(count-1)>>1]+values[count>>1])*.5, den=f(Math.max(median,1e-12));
      const near=await blur(clip,2);
      const source=await op([clip,near,luma],`out[i]=(1.-a[i])*(1.-ss(.02,.2,b[i]))*ss(.25,.5,c[i]/${den});`);
      const expandPx=Math.max(0,expand)/100*Math.max(w,h);
      let zone=near;
      if(expandPx>=.5){const wide=await blur(clip,expandPx);zone=await op([near,wide],"out[i]=clamp(max(a[i],ss(0.,.5,b[i])),0.,1.);");drop(wide);drop(near);}
      const edgeSigma=Math.max(3,expandPx/2),side=await blur(clip,edgeSigma);drop(clip);
      const bright=await op([luma],`out[i]=ss(.35,.7,a[i]/${den});`);
      const weighted=await op([luma,bright],"out[i]=a[i]*b[i];");
      const numerator=await blur(weighted,edgeSigma);drop(weighted);
      const denominator=await blur(bright,edgeSigma);
      const smoothLuma=await op([luma,side,bright,numerator,denominator],"let band=clamp(4.*b[i]*(1.-b[i]),0.,1.)*c[i];out[i]=a[i]+band*(d[i]/max(e[i],1e-6)-a[i]);");
      for(const b of [luma,side,bright,numerator,denominator])drop(b);
      const luminance=await stash(smoothLuma);
      // Keep scale weights on the reduced grids only while needed. Process
      // one colour channel at a time to bound full-resolution scratch.
      const rebuilt=[];
      for(let channel=0;channel<3;channel++){
        const original=restore(originals[channel]);
        const chroma=await op([original,total],"out[i]=max(a[i],0.)/b[i];");drop(original);
        const seed=await op([chroma,source],"out[i]=a[i]*b[i];");
        drop(chroma);
        let carried=null,found=null;
        for(let sigma=Math.max(2,.003*Math.max(w,h));sigma<.2*Math.max(w,h);sigma*=3){
          const weight=await blur(source,sigma),colour=await blur(seed,sigma);
          const next=await op(carried?[colour,weight,carried,found]:[colour,weight],carried?
            "let take=1.-d[i];out[i]=c[i]*(1.-take)+a[i]/max(b[i],1e-9)*take;":"out[i]=a[i]/max(b[i],1e-9);");
          const coverage=await op(found?[weight,found]:[weight],found?"out[i]=max(b[i],ss(0.,.08,a[i]));":"out[i]=ss(0.,.08,a[i]);");
          for(const b of [weight,colour,carried,found])if(b)drop(b);carried=next;found=coverage;
        }
        drop(seed);drop(found);rebuilt.push(await stash(carried));
      }
      drop(source);
      const carriedPlanes=rebuilt.map(restore);
      const sum=await op(carriedPlanes,"out[i]=max(a[i]+b[i]+c[i],1e-12);");
      for(const b of carriedPlanes)drop(b);
      for(let k=0;k<3;k++){
        const original=restore(originals[k]),carried=restore(rebuilt[k]);
        const next=await op([original,total,zone,carried,sum],"let original=max(a[i],0.)/b[i];out[i]=original+c[i]*(d[i]/e[i]-original);");
        drop(original);drop(carried);rebuilt[k]=next;
      }
      drop(sum);drop(total);drop(zone);
      const finalLuma=restore(luminance);
      const intensity=await op([...rebuilt,finalLuma],"out[i]=d[i]/max(.2627*a[i]+.678*b[i]+.0593*c[i],1e-12);");drop(finalLuma);
      for(let k=0;k<3;k++){
        const original=restore(originals[k]);
        const next=await op([rebuilt[k],intensity,original],"out[i]=select(a[i]*b[i],c[i],c[i]<0.);");
        drop(rebuilt[k]);drop(original);rebuilt[k]=next;
      }
      drop(intensity);
      const result=[];for(let k=0;k<3;k++)result.push(await op(rebuilt,`out[i]=${dot(fromBT,k)};`));
      for(const b of result)owned.delete(b);
      return {planes:result,applied:true,clip_luminance:median,clipped_pixel_fraction:count/(w*h)};
    } finally {await device.queue.onSubmittedWorkDone().catch(()=>{});for(const b of owned)release(b);u.destroy();}
  }
  root.HDREdgeColour=Object.freeze({reconstruct});
})(typeof window==="undefined"?globalThis:window);
