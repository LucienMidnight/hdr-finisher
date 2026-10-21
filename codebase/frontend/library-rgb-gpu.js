/* Library RGB preparation reuses RAW's measurement and linear-reduction maths.
 * Grade, export and Proof retain their existing preparation entry points. */
window.HDRLibraryRGB = (() => {
  "use strict";
  const {gpu,COMMON,TURN,FINISHING,reducedSize}=HDRLibraryGpuRaw.shared;
  const compiled=new WeakMap();
  const INPUT = `
  @group(0) @binding(1) var<storage, read> rgbInput: array<u32>;
  fn encoded(i:u32)->f32 {
    if(p.dims2.y==1u){return bitcast<f32>(rgbInput[i]);}
    return f32((rgbInput[i>>2u]>>((i&3u)*8u))&255u)*(1.0/255.0);
  }
  fn eotf(value:f32)->f32 {
    if(p.dims2.z==1u){return value;}
    let x=max(value,0.0);
    if(p.dims2.z==3u){
      let v=pow(clamp(x,0.0,1.0),1.0/(2523.0/32.0));
      return pow(max(v-3424.0/4096.0,0.0)/max(2413.0/128.0-2392.0/128.0*v,1e-10),1.0/(2610.0/16384.0))*10000.0*p.lensc.w;
    }
    if(p.dims2.z==4u){
      let v=clamp(x,0.0,1.0);
      return select((exp((v-0.55991073)/0.17883277)+0.28466892)/12.0,v*v/3.0,v<=0.5);
    }
    if(p.dims2.z==5u){return select(pow((x+0.099)/1.099,1.0/0.45),x/4.5,x<0.081);}
    if(p.dims2.z==2u){let v=clamp(x,0.0,1.0);return select(pow((v+0.099)/1.099,1.0/0.45),v/4.5,v<0.081);}
    return select(pow((x+0.055)/1.055,2.4),x/12.92,x<=0.04045);
  }
  fn linear_rgb(i:u32)->vec3<f32> {
    var lin=vec3<f32>(eotf(encoded(i)),eotf(encoded(i+1u)),eotf(encoded(i+2u)));
    if(p.dims2.z==4u){
      let y=dot(lin,vec3<f32>(0.2627,0.6780,0.0593));
      lin=lin*pow(max(y,0.0),0.2)*1000.0*p.lensc.w;
    }
    return lin;
  }`;

  // Decoded RGB shares full-source measurement and linear reduction with RAW.
  // Decoder orientation and ICC policy is carried explicitly in the contract.
  const RGB = COMMON + TURN + FINISHING + INPUT + /* wgsl */ `
  @compute @workgroup_size(16,16)
  fn main(@builtin(global_invocation_id) g0:vec3<u32>, @builtin(local_invocation_index) li:u32) {
    let g=g0+vec3<u32>(0u,p.dispatch.y,0u);
    if(li<3u){atomicStore(&wgPeak[li],0u);} workgroupBarrier();
    if(g.x<p.dims.x && g.y<p.dims.y){
      let i=(g.y*p.dims.x+g.x)*3u;
      let lin=linear_rgb(i);
      let aces=vec3<f32>(dot(p.m0.xyz,lin),dot(p.m1.xyz,lin),dot(p.m2.xyz,lin));
      finish(aces,i32(g.y),i32(g.x));
    }
    workgroupBarrier(); if(li<3u){atomicMax(&peaks[li],atomicLoad(&wgPeak[li]));}
  }`;
  // Same integer-centre mapping and a=-0.75 bicubic/clamped-border sampler as
  // dng_opcodes.py. Warp samples camera RGB before the DNG colour matrix.
  const DNG_INPUT = `
  struct DNG { coeff:array<vec4<f32>,6>, center:vec4<f32>, ax:vec4<f32>, ay:vec4<f32>, size:vec4<u32> };
  @group(0) @binding(1) var<storage,read> rgbInput:array<f32>;
  @group(0) @binding(2) var<uniform> d:DNG;
  fn cubic(value:f32)->f32 {
    let x=abs(value);let a=-0.75;
    if(x>=2.0){return 0.0;}
    if(x>=1.0){return ((a*x-5.0*a)*x+8.0*a)*x-4.0*a;}
    return ((a+2.0)*x-(a+3.0))*x*x+1.0;
  }
  fn sample_camera(pos:vec2<f32>,channel:u32)->f32 {
    let safe=clamp(pos,vec2<f32>(0.0),vec2<f32>(d.size.xy)-1.0);
    let base=vec2<i32>(floor(safe));let f=safe-vec2<f32>(base);
    var value=0.0;var total=0.0;
    for(var row=-1;row<=2;row++){
      let y=u32(clamp(base.y+row,0,i32(d.size.y)-1));
      let wy=cubic(f32(row)-f.y);
      for(var col=-1;col<=2;col++){
        let x=u32(clamp(base.x+col,0,i32(d.size.x)-1));
        let weight=wy*cubic(f32(col)-f.x);
        value+=rgbInput[(y*d.size.x+x)*3u+channel]*weight;total+=weight;
      }
    }
    return value/total;
  }
  fn linear_rgb(index:u32)->vec3<f32> {
    let i=index/3u;let out=vec3<f32>(f32(i%p.dims.x),f32(i/p.dims.x),1.0);
    let pixel=vec2<f32>(dot(d.ax.xyz,out),dot(d.ay.xyz,out));
    let xy=(pixel-d.center.xy)/d.center.z;
    let x=xy.x;let y=xy.y;let r2=min(dot(xy,xy),1.0);
    var result=vec3<f32>(0.0);
    for(var c=0u;c<3u;c++){
      let k=d.coeff[c*2u];let tang=d.coeff[c*2u+1u];
      let radial=k.x+k.y*r2+k.z*r2*r2+k.w*r2*r2*r2;
      let source=d.center.xy+d.center.z*vec2<f32>(x*radial+2.0*tang.x*x*y+tang.y*(r2+2.0*x*x),
        y*radial+tang.x*(r2+2.0*y*y)+2.0*tang.y*x*y);
      result[c]=sample_camera(source,c);
    }
    return result;
  }`;
  const DNG_RGB=RGB.replace(INPUT,DNG_INPUT);
  const RGB_SDR = COMMON + INPUT + /* wgsl */ `
  @group(0) @binding(4) var<storage,read_write> outR:array<f32>;
  @group(0) @binding(5) var<storage,read_write> outG:array<f32>;
  @group(0) @binding(6) var<storage,read_write> outB:array<f32>;
  @group(0) @binding(7) var<storage,read_write> peaks:array<atomic<u32>>;
  @compute @workgroup_size(16,16) fn main(@builtin(global_invocation_id) g0:vec3<u32>){
    let g=g0+vec3<u32>(0u,p.dispatch.y,0u);if(g.x>=p.dims.x||g.y>=p.dims.y){return;}
    let i=g.y*p.dims.x+g.x;let k=i*3u;
    let lin=linear_rgb(k);
    let aces=vec3<f32>(dot(p.m0.xyz,lin),dot(p.m1.xyz,lin),dot(p.m2.xyz,lin));
    let rendition=max(vec3<f32>(dot(p.x0.xyz,aces),dot(p.x1.xyz,aces),dot(p.x2.xyz,aces)),vec3<f32>(0.0));
    outR[i]=rendition.x;outG[i]=rendition.y;outB[i]=rendition.z;
    atomicMax(&peaks[3],bitcast<u32>(max(rendition.x,max(rendition.y,rendition.z))));
  }`;

  async function developRGB({ mosaic, meta, edges = [640,2560], beforeSubmit = null, memoryBudget = Infinity }) {
    const shared = await gpu(), {device,errors} = shared;
    let pipelines=compiled.get(device);
    if(!pipelines){
      pipelines={REDUCE:shared.pipelines.REDUCE};
      for(const [name,code] of Object.entries({RGB,RGB_SDR,DNG_RGB}))
        pipelines[name]=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code}),entryPoint:"main"}});
      compiled.set(device,pipelines);
    }
    errors.length = 0;
    const w = meta.width, h = meta.height, n = w * h;
    const outW = w, outH = h;
    const st = meta.sample_stride, sw = Math.ceil(outW / st), sh = Math.ceil(outH / st);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const owned = new Set(); let liveBytes = 0, peakBytes = 0;
    const own = buffer => { if(liveBytes+buffer.size>memoryBudget){buffer.destroy();throw Error("RGB preparation exceeds the reserved memory budget.");} owned.add(buffer); liveBytes += buffer.size; peakBytes = Math.max(peakBytes, liveBytes); return buffer; };
    const release = buffer => { if (owned.delete(buffer)) { liveBytes -= buffer.size; buffer.destroy(); } };
    const make = bytes => {
      const size = Math.max(4, Math.ceil(bytes / 4) * 4);
      if(size>device.limits.maxStorageBufferBindingSize) throw Error("Decoded source exceeds the GPU storage binding limit.");
      if (liveBytes + size > memoryBudget) throw Error("RGB preparation exceeds the reserved memory budget.");
      return own(device.createBuffer({ size, usage }));
    };
    const timings = {}; let mark = performance.now();
    const stage = async name => { await device.queue.onSubmittedWorkDone(); const now = performance.now(); timings[name] = (timings[name] || 0) + now - mark; mark = now; };
    try {
      const params = new ArrayBuffer(22 * 16);
      const u32 = new Uint32Array(params), f32 = new Float32Array(params);
      const setU = (slot, values) => values.forEach((v, k) => { u32[slot * 4 + k] = v; });
      const setF = (slot, values) => values.forEach((v, k) => { f32[slot * 4 + k] = v; });
      setU(0, [w, h, 0, st]); setU(1, [0, meta.layout?.dtype === "float32" ? 1 : 0, meta.colour.transfer === "LINEAR" || meta.colour.transfer === "ACEScg" ? 1 : meta.colour.transfer === "BT.709" ? 2 : meta.colour.transfer === "PQ" ? 3 : meta.colour.transfer === "HLG" ? 4 : meta.colour.transfer === "BT.2020" ? 5 : 0, sw]);
      meta.rgb_to_acescg.forEach((row, k) => setF(10 + k, row));
      meta.acescg_to_srgb.forEach((row, k) => setF(13 + k, row));
      meta.acescg_to_bt2020.forEach((row, k) => setF(16 + k, row));
      setF(20, [0, 0, 0, .18 / meta.colour.reference_white_nits]);
      setF(19, [(meta.colour.authored_sdr ? .18 : 1) * (meta.colour.scale || 1), 0, 0, 0]);
      const uniform = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      own(uniform);
      device.queue.writeBuffer(uniform, 0, params);

      if(beforeSubmit) await beforeSubmit();
      const mosaicBuf = make(meta.mosaic_bytes);
      const whole = Math.floor(mosaic.byteLength / 4) * 4;
      const transferBand = w * 128 * 3 * (meta.layout?.dtype === "float32" ? 4 : 1);
      for(let offset=0;offset<whole;offset+=transferBand){
        if(beforeSubmit) await beforeSubmit();
        device.queue.writeBuffer(mosaicBuf,offset,mosaic.buffer,mosaic.byteOffset+offset,Math.min(transferBand,whole-offset));
      }
      if (whole < mosaic.byteLength) { const tail = new Uint8Array(4); tail.set(mosaic.subarray(whole)); device.queue.writeBuffer(mosaicBuf, whole, tail); }
      await stage("upload");

      let dngUniform=null;
      if(meta.dng_warp){
        const warp=meta.dng_warp, data=new ArrayBuffer(160),f=new Float32Array(data),u=new Uint32Array(data);
        for(let c=0;c<3;c++){const k=warp.coefficients[warp.coefficients.length===1?0:c];f.set(k.slice(0,4),c*8);f.set(k.slice(4),c*8+4);}
        f.set([...warp.center,warp.radius,0],24);f.set(warp.affine_x,28);f.set(warp.affine_y,32);u.set([warp.width,warp.height,0,0],36);
        dngUniform=own(device.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
        device.queue.writeBuffer(dngUniform,0,data);
      }
      let planes, peaks, samples;
      const wgX = Math.ceil(w / 16), wgY = Math.ceil(h / 16);
      const run = async (name, entries, x, y) => {
        const pipe = pipelines[name];
        const group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.flatMap((buffer, binding) => buffer ? [{ binding, resource: { buffer } }] : []) });
        const band = beforeSubmit && name !== "REDUCE" ? 8 : y;
        for (let row = 0; row < y; row += band) {
          if (beforeSubmit) await beforeSubmit();
          if (name !== "REDUCE") device.queue.writeBuffer(uniform, 21 * 16, new Uint32Array([0, row * 16, 0, 0]));
          const encoder = device.createCommandEncoder(); const pass = encoder.beginComputePass();
          pass.setPipeline(pipe); pass.setBindGroup(0, group); pass.dispatchWorkgroups(x, Math.min(band, y - row)); pass.end();
          device.queue.submit([encoder.finish()]);
          if (beforeSubmit) await device.queue.onSubmittedWorkDone();
        }
      };
      const read = async (buffer, bytes) => {
        const staging = own(device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
        const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ); const copy = staging.getMappedRange().slice(0); release(staging); return copy;
      };

      planes = Array.from({length:meta.colour.authored_sdr ? 6 : 3},()=>make(n*4));
      peaks = make(16); samples = make(sw*sh*3*4);
      window.HDRLibraryScenes?.stage(meta.path,meta.dng_warp?"Correcting DNG distortion on GPU":"Converting colour and measuring source");
      await run(meta.dng_warp?"DNG_RGB":"RGB", [uniform,mosaicBuf,dngUniform,null,...planes.slice(0,3),peaks,samples],wgX,wgY);
      if(meta.colour.authored_sdr) await run("RGB_SDR",[uniform,mosaicBuf,null,null,...planes.slice(3),peaks],wgX,wgY);
      await device.queue.onSubmittedWorkDone(); release(mosaicBuf);
      await stage(meta.dng_warp?"warp_colour_measure":"colour_measure");
      window.HDRLibraryScenes?.stage(meta.path,"Reducing Library pictures on GPU");
      const reduced = {};
      for (const edge of edges) {
        const [rh, rw] = reducedSize(meta, edge);
        reduced[edge] = { height: rh, width: rw, planes: [] };
        for (const plane of planes) {
          if(rh===h && rw===w){
            const start=performance.now();
            reduced[edge].planes.push(await read(plane,n*4));
            timings.rgb_readback=(timings.rgb_readback||0)+performance.now()-start;
            continue;
          }
          const mid = make(h * rw * 4), out = make(rh * rw * 4);
          for (const [src, dst, inLen, outLen, across, axis] of [[plane, mid, w, rw, h, 0], [mid, out, h, rh, rw, 1]]) {
            const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            own(settings);
            device.queue.writeBuffer(settings, 0, new Uint32Array([inLen, outLen, across, axis]));
            await run("REDUCE", [settings, src, dst], Math.ceil(outLen / 16), Math.ceil(across / 16));
          }
          await device.queue.onSubmittedWorkDone();
          release(mid);
          {
            const start=performance.now();
            reduced[edge].planes.push(await read(out,rh*rw*4));
            timings.rgb_readback=(timings.rgb_readback||0)+performance.now()-start;
            release(out);
          }
        }
      }
      await stage("reduce");
      await device.queue.onSubmittedWorkDone();
      for (const buffer of planes) release(buffer);
      const peakValues = new Float32Array(await read(peaks, 16));
      const sampleData = new Float32Array(await read(samples, sw * sh * 3 * 4));
      await stage("readback");
      timings.reduce-=timings.rgb_readback||0;timings.readback+=timings.rgb_readback||0;delete timings.rgb_readback;
      if (errors.length) throw new Error(errors.join("\n"));
      return { timings, memory_peak_bytes: peakBytes, errors: [...errors],
        peaks: { peak: peakValues[0], peak_luma: peakValues[1], peak_bt2020: peakValues[2], sdr: peakValues[3] },
        samples: sampleData, sampleShape: [sh, sw], reduced };
    } finally {
      await device.queue.onSubmittedWorkDone().catch(() => {});
      for (const buffer of [...owned]) release(buffer);
    }
  }

  return Object.freeze({develop:developRGB});
})();
