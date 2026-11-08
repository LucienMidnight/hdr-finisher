/* Isolated Electron layout check; no backend or user photos. */
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-test-grid-'));
 let app;
 try {
  const entry=path.join(profile,'main.cjs');
  fs.writeFileSync(entry,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1600,height:1300});w.loadURL('data:text/html,<html><body></body></html>');});`);
  const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:require(require.resolve('electron',{paths:[path.join(root,'desktop')]})),args:[entry],env});
  await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];if(w.webContents.isLoading())await new Promise(r=>w.webContents.once('did-finish-load',r));});
  const page=app.windows()[0];
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'frontend/photo-library.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/library-layout.js'),'utf8')});
  const result=await page.evaluate(async()=>{
   const grid=document.createElement('div');grid.id='library-grid';grid.style.cssText='width:1360px;position:absolute;';
   const space=document.createElement('div');space.id='grid-space';grid.append(space);document.body.append(grid);
   // Force a conventional 15px scrollbar so this check also works on overlay-scrollbar hosts.
   const style=document.createElement('style');style.textContent='#library-grid::-webkit-scrollbar{width:15px}';document.head.append(style);
   const measure=async(control=false)=>{
    grid.style.overflowY=control?'auto':'';space.style.height='0px';
    const wide=HDRLibraryLayout.gridLayout(37,1360,1000,0,190).totalHeight;
    const narrow=HDRLibraryLayout.gridLayout(37,1345,1000,0,190).totalHeight;
    grid.style.height=Math.floor((wide+narrow)/2)+'px';
    const widths=[];
    for(let i=0;i<20;i++){
     const width=grid.clientWidth; widths.push(width);
     space.style.height=HDRLibraryLayout.gridLayout(37,width,grid.clientHeight,0,190).totalHeight+'px';
     await new Promise(requestAnimationFrame);
    }
    return [...new Set(widths)];
   };
   const fixed=await measure();const broken=await measure(true);
   grid.style.overflowY='';grid.style.height='400px';space.style.height='10px';space.style.width='1600px';
   const railWithoutOverflow=grid.offsetWidth-grid.clientWidth;
   const horizontalRail=grid.offsetHeight-grid.clientHeight;
   space.style.height='1000px';
   const railWithOverflow=grid.offsetWidth-grid.clientWidth;
   return {fixed,broken,railWithoutOverflow,railWithOverflow,horizontalRail};
  });
  assert.ok(result.railWithoutOverflow>0,'vertical rail remains when all photos fit');
  assert.equal(result.railWithOverflow,result.railWithoutOverflow,'vertical rail width stays constant');
  assert.equal(result.horizontalRail,0,'wide content creates no bottom scrollbar or gap');
  assert.equal(result.fixed.length,1,'reserved scrollbar space keeps thumbnail width stable');
  assert.ok(result.broken.length>1,'control reproduces the repeated scrollbar/thumbnail resize');
  console.log('PASS: scrollbar feedback reproduced without the fix; fixed grid width stays stable.',result);
 }finally{if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5});}
})().catch(e=>{console.error(e);process.exitCode=1;});
