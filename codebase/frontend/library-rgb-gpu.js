/* Library RGB preparation reuses RAW's measurement and linear-reduction maths.
 * Grade, export and Proof retain their existing preparation entry points. */
window.HDRLibraryRGB = (() => {
  "use strict";
  const {gpu,COMMON,TURN,FINISHING,reducedSize}=HDRLibraryGpuRaw.shared;
  const compiled=new WeakMap();
  // Decoded RGB shares full-source measurement and linear reduction with RAW.
  // ICC and orientation have already been applied by the CPU decoder.
  const RGB = COMMON + TURN + FINISHING + /* wgsl */ `
  @group(0) @binding(1) var<storage, read> rgbInput: array<u32>;
  fn encoded(i:u32)->f32{return f32((rgbInput[i>>2u]>>((i&3u)*8u))&255u)*(1.0/255.0);}
  fn eotf(x:f32)->f32 { return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045); }
  @compute @workgroup_size(16,16)
  fn main(@builtin(global_invocation_id) g0:vec3<u32>, @builtin(local_invocation_index) li:u32) {
    let g=g0+vec3<u32>(0u,p.dispatch.y,0u);
    if(li<3u){atomicStore(&wgPeak[li],0u);} workgroupBarrier();
    if(g.x<p.dims.x && g.y<p.dims.y){
      let i=(g.y*p.dims.x+g.x)*3u;
      let lin=vec3<f32>(eotf(encoded(i)),eotf(encoded(i+1u)),eotf(encoded(i+2u)));
      let aces=vec3<f32>(dot(p.m0.xyz,lin),dot(p.m1.xyz,lin),dot(p.m2.xyz,lin));
      finish(aces,i32(g.y),i32(g.x));
    }
    workgroupBarrier(); if(li<3u){atomicMax(&peaks[li],atomicLoad(&wgPeak[li]));}
  }`;
  const RGB_SDR = COMMON + /* wgsl */ `
  @group(0) @binding(1) var<storage,read> rgbInput:array<u32>;
  fn encoded(i:u32)->f32{return f32((rgbInput[i>>2u]>>((i&3u)*8u))&255u)*(1.0/255.0);}
  @group(0) @binding(4) var<storage,read_write> outR:array<f32>;
  @group(0) @binding(5) var<storage,read_write> outG:array<f32>;
  @group(0) @binding(6) var<storage,read_write> outB:array<f32>;
  @group(0) @binding(7) var<storage,read_write> peaks:array<atomic<u32>>;
  fn eotf(x:f32)->f32 {return select(pow((x+0.055)/1.055,2.4),x/12.92,x<=0.04045);}
  @compute @workgroup_size(16,16) fn main(@builtin(global_invocation_id) g0:vec3<u32>){
    let g=g0+vec3<u32>(0u,p.dispatch.y,0u);if(g.x>=p.dims.x||g.y>=p.dims.y){return;}
    let i=g.y*p.dims.x+g.x;let k=i*3u;
    let lin=vec3<f32>(eotf(encoded(k)),eotf(encoded(k+1u)),eotf(encoded(k+2u)));
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
      for(const [name,code] of Object.entries({RGB,RGB_SDR}))
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
      setU(0, [w, h, 0, st]); setU(1, [0, 0, outW, sw]);
      meta.rgb_to_acescg.forEach((row, k) => setF(10 + k, row));
      meta.acescg_to_srgb.forEach((row, k) => setF(13 + k, row));
      meta.acescg_to_bt2020.forEach((row, k) => setF(16 + k, row));
      setF(19, [0.18, 0, 0, 0]);
      const uniform = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      own(uniform);
      device.queue.writeBuffer(uniform, 0, params);

      if(beforeSubmit) await beforeSubmit();
      const mosaicBuf = make(n * 3);
      const whole = Math.floor(mosaic.byteLength / 4) * 4;
      const transferBand = w * 128 * 3;
      for(let offset=0;offset<whole;offset+=transferBand){
        if(beforeSubmit) await beforeSubmit();
        device.queue.writeBuffer(mosaicBuf,offset,mosaic.buffer,mosaic.byteOffset+offset,Math.min(transferBand,whole-offset));
      }
      if (whole < mosaic.byteLength) { const tail = new Uint8Array(4); tail.set(mosaic.subarray(whole)); device.queue.writeBuffer(mosaicBuf, whole, tail); }
      await stage("upload");

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

        planes = Array.from({length:6},()=>make(n*4));
        peaks = make(16); samples = make(sw*sh*3*4);
        await run("RGB", [uniform,mosaicBuf,null,null,...planes.slice(0,3),peaks,samples],wgX,wgY);
        await run("RGB_SDR",[uniform,mosaicBuf,null,null,...planes.slice(3),peaks],wgX,wgY);
        await device.queue.onSubmittedWorkDone(); release(mosaicBuf);
        await stage("colour_measure");
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
