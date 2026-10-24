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
    async function op(inputs, body, ow=w, oh=h, functions="", components=1) {
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
      const out=alloc(ow*oh*4*components);
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
    // Range scan. Faulty graphics memory has produced NaNs and values near
    // 1e33 here. out[0] holds the largest magnitude seen (bit pattern of a
    // non-negative f32 orders like u32); out[1] counts rejected pixels.
    async function scan(inputs, body) {
      const code=`@group(0) @binding(0) var<uniform> p:vec4<u32>;
        ${inputs.map((_,j)=>`@group(0) @binding(${j+1}) var<storage,read> ${String.fromCharCode(97+j)}:array<f32>;`).join("\n")}
        @group(0) @binding(${inputs.length+1}) var<storage,read_write> out:array<atomic<u32>,4>;
        var<workgroup> m:atomic<u32>; var<workgroup> n:atomic<u32>;
        fn bad(v:vec3<f32>)->bool {return any((bitcast<vec3<u32>>(v)&vec3<u32>(0x7f800000u))==vec3<u32>(0x7f800000u));}
        @compute @workgroup_size(16,16) fn main(@builtin(global_invocation_id) g:vec3<u32>,@builtin(local_invocation_index) l:u32){
          let x=g.x;let y=g.y+p.x;
          if(x<${w}u&&y<${h}u){let i=y*${w}u+x;let v=vec3<f32>(a[i],b[i],c[i]);${body}}
          workgroupBarrier();
          if(l==0u){atomicMax(&out[0],atomicLoad(&m));atomicAdd(&out[1],atomicLoad(&n));}
        }`;
      let pipe=cache.get(code);
      if(!pipe){pipe=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code}),entryPoint:"main"}});cache.set(code,pipe);
        if(cache.size>256)cache.delete(cache.keys().next().value);}
      const out=alloc(16),buffers=[u,...inputs,out];
      const group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
      for(let row=0;row<h;row+=1024){
        await beforeSubmit();device.queue.writeBuffer(u,0,new Uint32Array([row,0,0,0]));
        const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);
        pass.dispatchWorkgroups(Math.ceil(w/16),Math.ceil(Math.min(1024,h-row)/16));pass.end();device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
      }
      const [largest,rejected]=new Uint32Array(await read(out,16));drop(out);
      return {largest:new Float32Array(new Uint32Array([largest]).buffer)[0],rejected};
    }
    const f=v=>{const s=String(Math.fround(v));return /[.e]/i.test(s)?s:s+".0";};
    const dot=(matrix,k)=>`(${matrix[k].map((v,j)=>`${f(v)}*${String.fromCharCode(97+j)}[i]`).join("+")})`;
    const round=v=>{const a=Math.floor(v),d=v-a;return d===.5?a+(a%2):Math.round(v);};
    async function blur(input,sigma,gridOnly=false){
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
      if(gridOnly)return {buffer:small,width:bw,height:bh,factor};
      if(factor===1)return small;
      const out=await op([small],`let pos=(vec2<f32>(f32(x),f32(y))+.5)/${f(factor)}-.5;
        let lo=vec2<u32>(clamp(floor(pos),vec2<f32>(0.),vec2<f32>(${f(bw-1)},${f(bh-1)})));
        let hi=min(lo+vec2<u32>(1u),vec2<u32>(${bw-1}u,${bh-1}u));let t=clamp(pos-floor(pos),vec2<f32>(0.),vec2<f32>(1.));
        out[i]=mix(mix(a[lo.y*${bw}u+lo.x],a[lo.y*${bw}u+hi.x],t.x),mix(a[hi.y*${bw}u+lo.x],a[hi.y*${bw}u+hi.x],t.x),t.y);`);
      drop(small);return out;
    }
    // Sample the same reduced blur grid at the consumer. Materializing each
    // colour/weight as a native plane used gigabytes of avoidable traffic.
    const gridSample=(name,grid)=>`fn sample_${name}(x:u32,y:u32)->f32 {
      let pos=(vec2<f32>(f32(x),f32(y))+.5)/${f(grid.factor)}-.5;
      let lo=vec2<u32>(clamp(floor(pos),vec2<f32>(0.),vec2<f32>(${f(grid.width-1)},${f(grid.height-1)})));
      let hi=min(lo+vec2<u32>(1u),vec2<u32>(${grid.width-1}u,${grid.height-1}u));let t=clamp(pos-floor(pos),vec2<f32>(0.),vec2<f32>(1.));
      return mix(mix(${name}[lo.y*${grid.width}u+lo.x],${name}[lo.y*${grid.width}u+hi.x],t.x),mix(${name}[hi.y*${grid.width}u+lo.x],${name}[hi.y*${grid.width}u+hi.x],t.x),t.y);
    }`;
    try {
      const transport=[];for(let k=0;k<3;k++)transport.push(await op(planes,`out[i]=${dot(toBT,k)};`));
      const input=await scan(transport,"if(bad(v)){atomicAdd(&n,1u);}else{atomicMax(&m,bitcast<u32>(max(max(abs(v.x),abs(v.y)),abs(v.z))));}");
      const luma=await op(transport,"out[i]=max(.2627*a[i]+.678*b[i]+.0593*c[i],0.);");
      const total=await op(transport,"out[i]=max(a[i]+b[i]+c[i],1e-12);");
      const clip=await op([ratio],"out[i]=ss(.92,1.,a[i]);");
      release(ratio);
      const selected=await op([luma,clip],"out[i]=select(-1.,a[i],b[i]>=.5);");
      const samples=new Float32Array(await read(selected,w*h*4));drop(selected);
      let count=0;for(const v of samples)if(v>=0)samples[count++]=v;
      if(!count)return {planes,applied:false,clipped_pixel_fraction:0};
      // Once clipping is established the caller's inputs can be consumed.
      // Reduced edge grids leave room for the original colour on the GPU.
      // Narrow, native-resolution edge grids spill it once to keep the budget.
      for(const b of [...planes,ratio])release(b);
      const expandPx=Math.max(0,expand)/100*Math.max(w,h);
      const edgeSigma=Math.max(3,expandPx/2),residentOriginals=edgeSigma>=8;
      const originals=[];for(const b of transport)originals.push(residentOriginals?b:await stash(b));
      const originalAt=k=>residentOriginals?originals[k]:restore(originals[k]);
      const dropOriginal=b=>{if(!residentOriginals)drop(b);};
      // Only the scalar median is selected on the host; all spatial work and
      // colour reconstruction run on the GPU, including the clipping mask.
      const values=samples.subarray(0,count);values.sort();
      const median=(values[(count-1)>>1]+values[count>>1])*.5, den=f(Math.max(median,1e-12));
      const near=await blur(clip,2);
      const source=await op([clip,near,luma],`out[i]=(1.-a[i])*(1.-ss(.02,.2,b[i]))*ss(.25,.5,c[i]/${den});`);
      let zone=near;
      if(expandPx>=.5){const wide=await blur(clip,expandPx);zone=await op([near,wide],"out[i]=clamp(max(a[i],ss(0.,.5,b[i])),0.,1.);");drop(wide);drop(near);}
      const side=await blur(clip,edgeSigma,true);drop(clip);
      const bright=await op([luma],`out[i]=ss(.35,.7,a[i]/${den});`);
      const weighted=await op([luma,bright],"out[i]=a[i]*b[i];");
      const numerator=await blur(weighted,edgeSigma,true);drop(weighted);
      const denominator=await blur(bright,edgeSigma,true);
      const smoothLuma=await op([luma,side.buffer,bright,numerator.buffer,denominator.buffer],
        "let side=sample_b(x,y);let band=clamp(4.*side*(1.-side),0.,1.)*c[i];out[i]=a[i]+band*(sample_d(x,y)/max(sample_e(x,y),1e-6)-a[i]);",
        w,h,gridSample('b',side)+gridSample('d',numerator)+gridSample('e',denominator));
      for(const b of [luma,side.buffer,bright,numerator.buffer,denominator.buffer])drop(b);
      const luminance=smoothLuma;
      // Reuse source weights for all channels. Both weights and blurred
      // colours stay on reduced grids; native carried colours remain resident.
      const weights=[];
      for(let sigma=Math.max(2,.003*Math.max(w,h));sigma<.2*Math.max(w,h);sigma*=3)
        weights.push({sigma,grid:await blur(source,sigma,true)});
      const rebuilt=[];
      for(let channel=0;channel<3;channel++){
        const original=originalAt(channel);
        const chroma=await op([original,total],"out[i]=max(a[i],0.)/b[i];");dropOriginal(original);
        const seed=await op([chroma,source],"out[i]=a[i]*b[i];");
        drop(chroma);
        const grids=[];
        for(const {sigma,grid:weight} of weights){
          const colour=await blur(seed,sigma,true);
          // Pack each scale's colour and weight into one small binding, so
          // all scales can be combined in a single native-resolution pass.
          const packed=await op([colour.buffer,weight.buffer],
            "out[2u*i]=a[i];out[2u*i+1u]=b[i];",colour.width,colour.height,"",2);
          drop(colour.buffer);grids.push({...colour,buffer:packed});
        }
        drop(seed);
        const functions=grids.map((grid,k)=>gridSample(String.fromCharCode(97+k),grid)
          .replace('->f32','->vec2<f32>')
          .replace(/([a-d])\[([^\]]+)\]/g,'vec2<f32>($1[2u*($2)],$1[2u*($2)+1u])')).join("\n");
        const body=grids.map((_,k)=>{
          const name=String.fromCharCode(97+k);
          return `let v${k}=sample_${name}(x,y);${k===0?"var carried=v0.x/max(v0.y,1e-9);var found=ss(0.,.08,v0.y);":
            `let take${k}=1.-found;carried=carried*(1.-take${k})+v${k}.x/max(v${k}.y,1e-9)*take${k};found=max(found,ss(0.,.08,v${k}.y));`}`;
        }).join("\n")+"out[i]=carried;";
        rebuilt.push(await op(grids.map(grid=>grid.buffer),body,w,h,functions));
        for(const grid of grids)drop(grid.buffer);
      }
      for(const {grid} of weights)drop(grid.buffer);
      drop(source);
      const sum=await op(rebuilt,"out[i]=max(a[i]+b[i]+c[i],1e-12);");
      for(let k=0;k<3;k++){
        const original=originalAt(k),carried=rebuilt[k];
        const next=await op([original,total,zone,carried,sum],"let original=max(a[i],0.)/b[i];out[i]=original+c[i]*(d[i]/e[i]-original);");
        dropOriginal(original);drop(carried);rebuilt[k]=next;
      }
      drop(sum);drop(total);drop(zone);
      const finalLuma=luminance;
      const intensity=await op([...rebuilt,finalLuma],"out[i]=d[i]/max(.2627*a[i]+.678*b[i]+.0593*c[i],1e-12);");drop(finalLuma);
      for(let k=0;k<3;k++){
        const original=originalAt(k);
        const next=await op([rebuilt[k],intensity,original],"out[i]=select(a[i]*b[i],c[i],c[i]<0.);");
        drop(rebuilt[k]);dropOriginal(original);rebuilt[k]=next;
      }
      drop(intensity);
      const result=[];for(let k=0;k<3;k++)result.push(await op(rebuilt,`out[i]=${dot(fromBT,k)};`));
      // Every reconstructed channel is at most luminance/0.0593 (the smallest
      // BT.2020 luma weight), and luminance never exceeds the input's largest
      // magnitude; fromBT adds under 5%. 32x leaves ample room for rounding,
      // so anything beyond it, or non-finite, is corrupted memory. Throwing
      // sends Grade and Library to their existing CPU fallback.
      const limit=f(32*Math.max(input.largest,1e-6));
      const output=await scan(result,`if(bad(v)||any(abs(v)>vec3<f32>(${limit}))){atomicAdd(&n,1u);}`);
      if(input.rejected===0&&output.rejected>0)
        throw Error(`GPU edge colour produced ${output.rejected} invalid pixels; using the CPU.`);
      for(const b of result)owned.delete(b);
      return {planes:result,applied:true,clip_luminance:median,clipped_pixel_fraction:count/(w*h)};
    } finally {await device.queue.onSubmittedWorkDone().catch(()=>{});for(const b of owned)release(b);u.destroy();}
  }
  root.HDREdgeColour=Object.freeze({reconstruct});
})(typeof window==="undefined"?globalThis:window);
