/** Read an existing cached native Detail texel; disposable session, no export. */
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const c=require('./heavy-project-review-common'),args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
(async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();await c.open(page,path.resolve(opt('--project','')),false);
  await page.evaluate(async()=>{
   for(const [key,value] of Object.entries({texture_amount:0,clarity_amount:0,sharpen_amount:200,sharpen_radius_px:3,sharpen_threshold:0}))commitAdjustmentValue('hdr.detail.'+key,value,{manual:true});
   await settlePreview('hdr',{});setCustomZoom(100);
  });
  await page.waitForFunction(()=>!state.zoomRefinementTimer&&!state.renderCoordinator.state('hdr').panTimerPending);
  await c.stable(page);
  const results=await page.evaluate(async ({x,y})=>{
   const renderer=state.gpuPreview,d=renderer.device,results=[];
   const half=v=>{const sign=v&32768?-1:1,e=(v>>10)&31,m=v&1023;return sign*(e?(1+m/1024)*2**(e-15):m*2**-24);};
   for(const [key,entry] of renderer.detailBandTiles){
    const match=key.match(/\|(\d+),(\d+),(\d+),(\d+)\|h\d+$/);if(!match||!key.startsWith('global|'))continue;
    const [left,top,width,height]=match.slice(1).map(Number);if(x<left||y<top||x>=left+width||y>=top+height)continue;
    const read=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=d.createCommandEncoder();encoder.copyTextureToBuffer({texture:entry.texture,origin:[x-left,y-top]},
     {buffer:read,bytesPerRow:256},[1,1]);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
     results.push({key,values:Array.from(new Uint16Array(read.getMappedRange()).slice(0,4),half)});read.unmap();}
    finally{read.destroy();}
   }
   return {pixel:{x,y},results,source:renderer.sourceTransportMetrics};
  },{x:Number(opt('--x',2535)),y:Number(opt('--y',4027))});
  const output=path.resolve(opt('--output','output/performance/detail-band-probe.json'));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
