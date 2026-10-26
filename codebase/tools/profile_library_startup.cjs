/* One desktop launch against a disposable copy of Steve's Library. */
const fs=require('node:fs'), path=require('node:path');
const {_electron}=require('playwright');
const root=path.resolve(__dirname,'..'), profile=path.resolve(process.argv[2]);
(async()=>{
 const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 fs.writeFileSync(path.join(profile,'window-state.json'),JSON.stringify({x:0,y:0,width:2560,height:1440}));
 const launched=Date.now();
 const app=await _electron.launch({executablePath:require(path.join(root,'desktop/node_modules/electron')),args:[path.join(root,'desktop')],cwd:root,env,timeout:60000});
 try {
  const page=await app.firstWindow();
  await page.waitForURL(/^http:/,{timeout:60000});
  await page.waitForFunction(()=>document.body.dataset.ready==='true');
  const ui_ms=Date.now()-launched;
  const library=page.frame({url:/\/library(?:\?|$)/});
  await library.waitForFunction(()=>window.HDRLibrary?.getSnapshot().count>0);
  await library.locator('#grid-space canvas[data-picture-key]').first().waitFor({timeout:30000});
  const first_thumbnail_ms=Date.now()-launched;
  await page.waitForTimeout(1500);
  const stored=await library.evaluate(async()=>{
    const rows=HDRLibrary.getSnapshot().paths;
    for(const photo of rows.slice(0,8)) {
      const canvas=document.createElement('canvas');document.body.append(canvas);
      try {
        const started=performance.now();
        const meta=await HDRLibraryScreenPreviews.load({path:photo},canvas,new AbortController().signal,()=>true,false);
        if(meta)return {path:photo,draw_ms:performance.now()-started};
      } finally {canvas.remove();}
    }
    return {miss:true};
  });
  const result={ui_ms,first_thumbnail_ms,stored};
  fs.writeFileSync(path.join(profile,'startup-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
