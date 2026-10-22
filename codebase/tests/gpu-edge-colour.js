/* Focused shared reconstruction execution; no source photos are written. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),python=path.join(root,'.venv/Scripts/python.exe');
const folder=path.join(root,'output/edge-colour-gpu');fs.mkdirSync(folder,{recursive:true});
const helper=path.join(__dirname,'helpers/edge_colour_fixture.py');
const meta=JSON.parse(execFileSync(python,[helper,folder],{encoding:'utf8'}));
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
  const frame=page.frame({url:/\/library(?:\?|$)/})||page.mainFrame();
  await frame.waitForFunction(()=>window.HDREdgeColour&&window.HDRLibraryGpuRaw);
  for(const expand of [0,.5,3]){
  const result=await frame.evaluate(async({meta,base64,expand})=>{
   const {device}=await HDRLibraryGpuRaw.shared.gpu(),owned=new Set();let live=0,peak=0;
   const make=size=>{const b=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.add(b);live+=size;peak=Math.max(peak,live);return b;};
   const release=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
   const read=async(buffer,size)=>{const b=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});owned.add(b);live+=size;peak=Math.max(peak,live);
    const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,size);device.queue.submit([e.finish()]);
    await b.mapAsync(GPUMapMode.READ);const copy=b.getMappedRange().slice(0);release(b);return copy;};
   device.pushErrorScope('validation');device.pushErrorScope('out-of-memory');
   try{
    const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),bytes=meta.width*meta.height*4,inputs=[];
    for(let k=0;k<4;k++){const b=make(bytes);device.queue.writeBuffer(b,0,data,k*bytes,bytes);inputs.push(b);}
    const start=performance.now(),out=await HDREdgeColour.reconstruct({device,planes:inputs.slice(0,3),ratio:inputs[3],...meta,expand,make,release,read});
    const buffers=[];for(const b of out.planes)buffers.push(new Uint8Array(await read(b,bytes)));
    delete out.planes;let binary='';for(const bytes of buffers)for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {base64:btoa(binary),diagnostics:out,peak,ms:performance.now()-start};
   }finally{await device.queue.onSubmittedWorkDone();for(const b of owned)release(b);
    const oom=await device.popErrorScope(),validation=await device.popErrorScope();if(oom||validation)throw Error((oom||validation).message);}
  },{meta,expand,base64:fs.readFileSync(path.join(folder,'input.bin')).toString('base64')});
  fs.writeFileSync(path.join(folder,`gpu-${expand}.bin`),Buffer.from(result.base64,'base64'));delete result.base64;
  assert.equal(result.diagnostics.applied,true);
  assert.ok(result.peak<=meta.width*meta.height*44+64*1024*1024,'Scratch stays inside the existing RAW reservation');
  console.log(JSON.stringify({expand,...result}));
  console.log(execFileSync(python,[helper,folder,'compare',String(expand)],{encoding:'utf8'}));
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
