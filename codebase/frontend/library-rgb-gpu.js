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
      var aces=vec3<f32>(dot(p.m0.xyz,lin),dot(p.m1.xyz,lin),dot(p.m2.xyz,lin));
      // Match the Ultra HDR decoder's working-space clamp before finishing.
      if(p.lensc.x>0.0){aces=max(aces,vec3<f32>(0.0));}
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
  const DNG_TILE_RGB=DNG_RGB
    .replace('let g=g0+vec3<u32>(0u,p.dispatch.y,0u);','let g=g0;')
    .replace('if (t.x % st == 0 && t.y % st == 0)', 'if ((t.x+i32(p.dispatch.y)) % st == 0 && (t.y+i32(p.dispatch.x)) % st == 0)')
    .replace('f32(i%p.dims.x),f32(i/p.dims.x)', 'f32(i%p.dims.x)+d.ax.w,f32(i/p.dims.x)+d.ay.w')
    .replace('rgbInput[(y*d.size.x+x)*3u+channel]', 'rgbInput[((y-d.size.w)*u32(p.lensc.x)+(x-d.size.z))*3u+channel]');
  // Grade owns its import gamut mapping and calibration after this handoff.
  const DNG_TILE_GRADE=DNG_TILE_RGB.replace(
    'if (lo < 0.0)', 'if (false && lo < 0.0)');
  const DNG_GAIN=COMMON+`
    struct DNG { coeff:array<vec4<f32>,6>, center:vec4<f32>, ax:vec4<f32>, ay:vec4<f32>, size:vec4<u32> };
    @group(0) @binding(1) var<storage,read_write> camera:array<f32>;
    @group(0) @binding(2) var<uniform> d:DNG;
    @group(0) @binding(3) var<storage,read> maps:array<f32>;
    fn gain(v:u32,h:u32,c:u32,base:u32,cols:u32,planes:u32)->f32{return maps[base+(v*cols+h)*planes+c];}
    @compute @workgroup_size(16,16)
    fn main(@builtin(global_invocation_id) g0:vec3<u32>){
      let g=g0+vec3<u32>(0u,p.dispatch.y,0u);let w=d.size.x;let h=d.size.y;
      if(g.x>=w||g.y>=h){return;}
      var offset=1u;
      for(var m=0u;m<u32(maps[0]);m++){
        let top=u32(maps[offset]);let left=u32(maps[offset+1u]);let bottom=u32(maps[offset+2u]);let right=u32(maps[offset+3u]);
        let plane=u32(maps[offset+4u]);let planes=u32(maps[offset+5u]);let rp=u32(maps[offset+6u]);let cp=u32(maps[offset+7u]);
        let rows=u32(maps[offset+8u]);let cols=u32(maps[offset+9u]);let channels=u32(maps[offset+10u]);let base=offset+15u;
        if(g.x>=left&&g.x<right&&g.y>=top&&g.y<bottom&&(g.x-left)%cp==0u&&(g.y-top)%rp==0u){
          let pos=clamp((vec2<f32>((f32(g.y)+0.5)/f32(h),(f32(g.x)+0.5)/f32(w))-vec2<f32>(maps[offset+13u],maps[offset+14u]))/vec2<f32>(maps[offset+11u],maps[offset+12u]),vec2<f32>(0.0),vec2<f32>(f32(rows-1u),f32(cols-1u)));
          let v=u32(floor(pos.x));let x=u32(floor(pos.y));let v1=min(v+1u,rows-1u);let x1=min(x+1u,cols-1u);let f=pos-vec2<f32>(f32(v),f32(x));
          for(var c=plane;c<plane+planes;c++){
            let mc=min(c,channels-1u);
            let a=gain(v,x,mc,base,cols,channels)*(1.0-f.y)+gain(v,x1,mc,base,cols,channels)*f.y;
            let b=gain(v1,x,mc,base,cols,channels)*(1.0-f.y)+gain(v1,x1,mc,base,cols,channels)*f.y;
            camera[(g.y*w+g.x)*3u+c]*=a*(1.0-f.x)+b*f.x;
          }
        }
        offset=base+rows*cols*channels;
      }
    }`;
  const DNG_TILE_GAIN=DNG_GAIN
    .replace('let g=g0+vec3<u32>(0u,p.dispatch.y,0u);let w=d.size.x;let h=d.size.y;',
      'let local=g0;let g=local+vec3<u32>(d.size.zw,0u);let w=d.size.x;let h=d.size.y;')
    .replace('if(g.x>=w||g.y>=h)', 'if(local.x>=u32(p.lensc.x)||local.y>=u32(p.lensc.y))')
    .replace('camera[(g.y*w+g.x)*3u+c]', 'camera[(local.y*u32(p.lensc.x)+local.x)*3u+c]');
  const LINEAR_INPUT=`
    struct Linear { ax:vec4<f32>, ay:vec4<f32>, size:vec4<u32>, neutral:vec4<f32>, recovery:vec4<f32> };
    @group(0) @binding(1) var<storage,read> camera:array<f32>;
    @group(0) @binding(2) var<uniform> d:Linear;
    @group(0) @binding(3) var<storage,read> support:array<f32>;
    fn linear_rgb(index:u32)->vec3<f32>{
      let i=index/3u;let out=vec3<f32>(f32(i%p.dims.x),f32(i/p.dims.x),1.0);
      let xy=vec2<u32>(u32(dot(d.ax.xyz,out)),u32(dot(d.ay.xyz,out)));let k=(xy.y*d.size.x+xy.x)*3u;
      let value=vec3<f32>(camera[k],camera[k+1u],camera[k+2u]);
      if(d.recovery.y<=0.0){return value;}
      let pos=(vec2<f32>(xy)+0.5)/d.recovery.y-0.5;
      let p0=clamp(floor(pos),vec2<f32>(0.0),d.recovery.zw-1.0);let p1=min(p0+1.0,d.recovery.zw-1.0);let f=clamp(pos-p0,vec2<f32>(0.0),vec2<f32>(1.0));
      let sw=u32(d.recovery.z);
      let a=support[u32(p0.y)*sw+u32(p0.x)]*(1.0-f.x)+support[u32(p0.y)*sw+u32(p1.x)]*f.x;
      let b=support[u32(p1.y)*sw+u32(p0.x)]*(1.0-f.x)+support[u32(p1.y)*sw+u32(p1.x)]*f.x;
      let confidence=a*(1.0-f.y)+b*f.y;let signal=max(value.x,max(value.y,value.z));let limit=d.recovery.x;let onset=limit*0.35;
      var weight=clamp((signal-onset)/max(limit-onset,1e-6),0.0,1.0);weight=sqrt(weight*weight*(3.0-2.0*weight))*confidence;
      if(signal>=limit-max(1.0/1024.0,limit*0.005)){weight=1.0;}
      let ratios=value/d.neutral.xyz;let reconstructed=max(ratios.x,max(ratios.y,ratios.z))*d.neutral.xyz;
      return value+(reconstructed-value)*weight;
    }`;
  const DNG_LINEAR=RGB.replace(INPUT,LINEAR_INPUT);
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

  // Reference preparation runs after scene buffers are released, inside the
  // same reservation and cancellation gate. Never hold two native GPU frames.
  const REFERENCE=RGB_SDR.replace(
    "let rendition=max(vec3<f32>(dot(p.x0.xyz,aces),dot(p.x1.xyz,aces),dot(p.x2.xyz,aces)),vec3<f32>(0.0));",
    `var rendition=clamp(select(vec3<f32>(dot(p.x0.xyz,aces),dot(p.x1.xyz,aces),dot(p.x2.xyz,aces)),lin,p.dims2.x>0u),vec3<f32>(0.0),vec3<f32>(1.0));
    if(p.dims2.x==2u){
      let bits=bitcast<vec3<u32>>(rendition);
      let rounded=bitcast<vec3<f32>>((bits+vec3<u32>(4095u)+((bits>>vec3<u32>(13u))&vec3<u32>(1u)))&vec3<u32>(4294959104u));
      rendition=select(floor(rendition*16777216.0+0.5)/16777216.0,rounded,rendition>=vec3<f32>(0.00006103515625));
    }`);
  async function developRGB(options) {
    const result=await developFrame(options),ref=options.meta.sdr_reference;
    if(!ref)return result;
    const meta={...options.meta,width:ref.width,height:ref.height,mosaic_bytes:ref.bytes,
      layout:{dtype:ref.dtype},colour:{...options.meta.colour,transfer:ref.transfer,authored_sdr:false},
      rgb_to_acescg:ref.rgb_to_acescg,dng_linear:null,dng_warp:null,sdr_reference:null,
      reference_only:true,direct_srgb:ref.direct_srgb,quantize_half:ref.quantize_half};
    const reference=await developFrame({...options,meta,mosaic:ref.samples});
    for(const [edge,picture] of Object.entries(reference.reduced))result.reduced[edge].planes.push(...picture.planes);
    result.peaks.sdr=reference.peaks.sdr;
    result.memory_peak_bytes=Math.max(result.memory_peak_bytes,reference.memory_peak_bytes);
    for(const [stage,ms] of Object.entries(reference.timings))result.timings['reference_'+stage]=ms;
    return result;
  }
  async function developFrame({ mosaic, meta, edges = [640,2560], beforeSubmit = null, memoryBudget = Infinity }) {
    const shared = await gpu(), {device,errors} = shared;
    let pipelines=compiled.get(device);
    if(!pipelines){
      pipelines={REDUCE:shared.pipelines.REDUCE};
      for(const [name,code] of Object.entries({RGB,RGB_SDR,REFERENCE,DNG_RGB,DNG_GAIN,DNG_TILE_RGB,DNG_TILE_GRADE,DNG_TILE_GAIN,DNG_LINEAR}))
        pipelines[name]=await device.createComputePipelineAsync({layout:"auto",compute:{module:device.createShaderModule({code}),entryPoint:"main"}});
      compiled.set(device,pipelines);
    }
    if(meta.dng_warp)return developDNGTiles({mosaic,meta,edges,beforeSubmit,memoryBudget,device,errors,pipelines});
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
      setU(0, [w, h, 0, st]); setU(1, [meta.quantize_half ? 2 : meta.direct_srgb ? 1 : 0, meta.layout?.dtype === "float32" ? 1 : 0, meta.colour.transfer === "LINEAR" || meta.colour.transfer === "ACEScg" ? 1 : meta.colour.transfer === "BT.709" ? 2 : meta.colour.transfer === "PQ" ? 3 : meta.colour.transfer === "HLG" ? 4 : meta.colour.transfer === "BT.2020" ? 5 : 0, sw]);
      meta.rgb_to_acescg.forEach((row, k) => setF(10 + k, row));
      meta.acescg_to_srgb.forEach((row, k) => setF(13 + k, row));
      meta.acescg_to_bt2020.forEach((row, k) => setF(16 + k, row));
      setF(20, [meta.colour.clip_working_negative ? 1 : 0, 0, 0, .18 / meta.colour.reference_white_nits]);
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
      let extra=null;
      if(meta.dng_linear){
        const lin=meta.dng_linear,data=new ArrayBuffer(80),f=new Float32Array(data),u=new Uint32Array(data);
        f.set(lin.affine_x,0);f.set(lin.affine_y,4);u.set([lin.width,lin.height,0,0],8);f.set(lin.neutral,12);
        f.set([lin.response_limit||1,lin.support?.block||0,lin.support?.width||0,lin.support?.height||0],16);
        dngUniform=own(device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));device.queue.writeBuffer(dngUniform,0,data);
        const mask=meta.dng_support||new Float32Array(1);extra=make(mask.byteLength);device.queue.writeBuffer(extra,0,mask);
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

      if(meta.dng_gain_maps?.length){
        const packed=[meta.dng_gain_maps.length];
        for(const map of meta.dng_gain_maps){packed.push(...map.area,...map.points,...map.spacing,...map.origin);for(const value of map.gains)packed.push(value);}
        const data=new Float32Array(packed),gainBuffer=make(data.byteLength);device.queue.writeBuffer(gainBuffer,0,data);
        window.HDRLibraryScenes?.stage(meta.path,"Correcting DNG brightness on GPU");
        await run("DNG_GAIN",[uniform,mosaicBuf,dngUniform,gainBuffer],Math.ceil(meta.dng_warp.width/16),Math.ceil(meta.dng_warp.height/16));
        await stage("gain_map");release(gainBuffer);
      }
      planes = Array.from({length:meta.colour.authored_sdr ? 6 : 3},()=>make(n*4));
      peaks = make(16); samples = make(sw*sh*3*4);
      window.HDRLibraryScenes?.stage(meta.path,meta.dng_warp?"Correcting DNG distortion on GPU":meta.dng_linear?"Reconstructing highlights and converting DNG colour on GPU":"Converting colour and measuring source");
      if(meta.reference_only)await run("REFERENCE",[uniform,mosaicBuf,null,null,...planes,peaks],wgX,wgY);
      else await run(meta.dng_warp?"DNG_RGB":meta.dng_linear?"DNG_LINEAR":"RGB", [uniform,mosaicBuf,dngUniform,extra,...planes.slice(0,3),peaks,samples],wgX,wgY);
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

  async function developDNGTiles({mosaic,meta,edges,beforeSubmit,memoryBudget,device,errors,pipelines}) {
    errors.length=0;
    const {dngFootprint}=HDRLibraryGpuRaw.shared;
    const w=meta.width,h=meta.height,st=meta.sample_stride,sw=Math.ceil(w/st),sh=Math.ceil(h/st);
    const warp=meta.dng_warp,owned=new Set(),timings={};let live=0,peak=0;
    const make=(bytes,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST)=>{
      const size=Math.max(4,Math.ceil(bytes/4)*4);
      if(size>device.limits.maxBufferSize || ((usage&GPUBufferUsage.STORAGE)&&size>device.limits.maxStorageBufferBindingSize))throw Error("DNG tile exceeds the GPU binding limit.");
      if(live+size>memoryBudget)throw Error("DNG preparation exceeds the reserved memory budget.");
      const buffer=device.createBuffer({size,usage});owned.add(buffer);live+=size;peak=Math.max(peak,live);return buffer;
    };
    const free=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
    const timed=async(name,fn)=>{const start=performance.now();const value=await fn();await device.queue.onSubmittedWorkDone();timings[name]=(timings[name]||0)+performance.now()-start;return value;};
    const read=async b=>{
      const staging=make(b.size,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
      const enc=device.createCommandEncoder();enc.copyBufferToBuffer(b,0,staging,0,b.size);device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);const data=new Float32Array(staging.getMappedRange().slice(0));free(staging);return data;
    };
    const dispatch=(name,buffers,width,height)=>{
      const pipe=pipelines[name],group=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:buffers.flatMap((b,binding)=>b?[{binding,resource:{buffer:b}}]:[])});
      const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(width/16),Math.ceil(height/16));pass.end();device.queue.submit([enc.finish()]);
    };
    const permit=async()=>{if(beforeSubmit)await timed("permits",beforeSubmit);};
    // Full developed planes are held in host RAM. GPU memory contains only
    // one distortion footprint and one output tile, then one reduction plane.
    const planes=Array.from({length:3},()=>new Float32Array(w*h));
    const samples=new Float32Array(sw*sh*3),peaks=new Float32Array(4),source=new Float32Array(mosaic.buffer,mosaic.byteOffset,mosaic.byteLength/4);
    let tiles=0,maxSourceBytes=0;
    try {
      const uniform=make(352,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),dng=make(160,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      let gains=null;
      if(meta.dng_gain_maps?.length){
        const packed=[meta.dng_gain_maps.length];for(const m of meta.dng_gain_maps){packed.push(...m.area,...m.points,...m.spacing,...m.origin);for(const v of m.gains)packed.push(v);}
        const data=new Float32Array(packed);gains=make(data.byteLength);device.queue.writeBuffer(gains,0,data);
      }
      const render=async(x,y,tw,th)=>{
        const box=dngFootprint(warp,x,y,tw,th),bytes=box.width*box.height*12;
        const cap=Math.min(16*1024*1024,device.limits.maxStorageBufferBindingSize);
        if(bytes>cap){
          if(tw===1&&th===1)throw Error("DNG footprint exceeds the bounded GPU tile allowance.");
          if(tw>=th&&tw>1){const a=Math.floor(tw/2);await render(x,y,a,th);await render(x+a,y,tw-a,th);}
          else{const a=Math.floor(th/2);await render(x,y,tw,a);await render(x,y+a,tw,th-a);}return;
        }
        await permit();tiles++;maxSourceBytes=Math.max(maxSourceBytes,bytes);
        const input=make(bytes),out=Array.from({length:3},()=>make(tw*th*4)),pk=make(16);
        // Samples use global output coordinates, including after adaptive splits.
        const tsw=Math.ceil(tw/st),tsh=Math.ceil(th/st),sample=make(tsw*tsh*12);
        const params=new ArrayBuffer(352),u=new Uint32Array(params),f=new Float32Array(params);
        u.set([tw,th,0,st],0);u.set([0,1,1,tsw],4);
        meta.rgb_to_acescg.forEach((row,k)=>f.set(row,40+k*4));meta.acescg_to_bt2020.forEach((row,k)=>f.set(row,64+k*4));
        f[76]=meta.colour.scale||1;f.set([box.width,box.height,0,0],80);
        // Offset the local sample lattice to the full output lattice.
        u.set([x%st,y%st,0,0],84);
        device.queue.writeBuffer(uniform,0,params);
        const data=new ArrayBuffer(160),df=new Float32Array(data),du=new Uint32Array(data);
        for(let c=0;c<3;c++){const k=warp.coefficients[warp.coefficients.length===1?0:c];df.set(k.slice(0,4),c*8);df.set(k.slice(4),c*8+4);}
        df.set([...warp.center,warp.radius,0],24);df.set([...warp.affine_x,x],28);df.set([...warp.affine_y,y],32);du.set([warp.width,warp.height,box.left,box.top],36);device.queue.writeBuffer(dng,0,data);
        await timed("upload",async()=>{
          const packed=new Float32Array(bytes/4);for(let r=0;r<box.height;r++)packed.set(source.subarray(((box.top+r)*warp.width+box.left)*3,((box.top+r)*warp.width+box.left+box.width)*3),r*box.width*3);
          device.queue.writeBuffer(input,0,packed);
        });
        await permit();
        if(gains)await timed("gain_map",async()=>dispatch("DNG_TILE_GAIN",[uniform,input,dng,gains],box.width,box.height));
        await permit();
        await timed("warp_colour_measure",async()=>dispatch(meta.preserve_signed?"DNG_TILE_GRADE":"DNG_TILE_RGB",[uniform,input,dng,null,...out,pk,sample],tw,th));
        await permit();
        await timed("readback",async()=>{
          for(let c=0;c<3;c++){const a=await read(out[c]);for(let r=0;r<th;r++)planes[c].set(a.subarray(r*tw,(r+1)*tw),(y+r)*w+x);}
          const p=await read(pk);for(let c=0;c<3;c++)peaks[c]=Math.max(peaks[c],p[c]);
          const a=await read(sample);
          for(let r=(st-y%st)%st;r<th;r+=st)for(let c=(st-x%st)%st;c<tw;c+=st){
            const local=(Math.floor(r/st)*tsw+Math.floor(c/st))*3,global=((y+r)/st*sw+(x+c)/st)*3;samples.set(a.subarray(local,local+3),global);
          }
        });
        for(const b of [input,...out,pk,sample])free(b);
      };
      // Align usual tile origins with the measurement lattice; adaptive splits
      // still use global coordinates for sampling and interpolation.
      const tileW=Math.max(st,Math.floor(1024/st)*st),tileH=Math.max(st,Math.floor((st===1?256:512)/st)*st);
      window.HDRLibraryScenes?.stage(meta.path,"Correcting DNG tiles on GPU");
      for(let y=0;y<h;y+=tileH)for(let x=0;x<w;x+=tileW)await render(x,y,Math.min(tileW,w-x),Math.min(tileH,h-y));
      free(gains);free(dng);free(uniform);
      const reduced={};for(const edge of edges){const [rh,rw]=reducedSize(meta,edge);reduced[edge]={height:rh,width:rw,planes:[]};}
      window.HDRLibraryScenes?.stage(meta.path,"Reducing Library pictures on GPU");
      for(let c=0;c<3;c++){
        let input=null;
        for(const edge of edges){
          const target=reduced[edge],rh=target.height,rw=target.width;
          if(rh===h&&rw===w){target.planes.push(planes[c].buffer);continue;}
          await permit();
          if(!input){input=make(w*h*4);await timed("upload",async()=>device.queue.writeBuffer(input,0,planes[c]));}
          const mid=make(h*rw*4),out=make(rh*rw*4),settings=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
          for(const [src,dst,inLen,outLen,across,axis] of [[input,mid,w,rw,h,0],[mid,out,h,rh,rw,1]]){
            await permit();
            await timed("reduce",async()=>{device.queue.writeBuffer(settings,0,new Uint32Array([inLen,outLen,across,axis]));dispatch("REDUCE",[settings,src,dst],outLen,across);});
          }
          free(mid);free(settings);target.planes.push((await timed("readback",()=>read(out))).buffer);free(out);
        }free(input);
      }
      if(errors.length)throw Error(errors.join("\n"));
      return {timings,memory_peak_bytes:peak,dng_tiles:tiles,dng_max_source_bytes:maxSourceBytes,errors:[...errors],peaks:{peak:peaks[0],peak_luma:peaks[1],peak_bt2020:peaks[2],sdr:0},samples,sampleShape:[sh,sw],reduced};
    }finally{await device.queue.onSubmittedWorkDone().catch(()=>{});for(const b of [...owned])free(b);}
  }

  return Object.freeze({develop:developRGB});
})();
