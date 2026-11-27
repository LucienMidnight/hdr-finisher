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
  for(const sheet of ['visual-tokens.css','photo-library.css','scrollbars.css'])
   await page.addStyleTag({content:fs.readFileSync(path.join(root,'frontend',sheet),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/library-layout.js'),'utf8')});
  const result=await page.evaluate(async()=>{
   const grid=document.createElement('div');grid.id='library-grid';grid.style.cssText='width:1360px;position:absolute;';
   const space=document.createElement('div');space.id='grid-space';grid.append(space);document.body.append(grid);
   const lane=parseFloat(getComputedStyle(grid).getPropertyValue('--scrollbar-w'));
   const wide=HDRLibraryLayout.gridLayout(37,1360,1000,0,190).totalHeight;
   const narrow=HDRLibraryLayout.gridLayout(37,1360-lane,1000,0,190).totalHeight;
   grid.style.height=Math.floor((wide+narrow)/2)+'px';
   const measure=async stable=>{
    space.style.height='0px';
    const widths=[];
    for(let i=0;i<8;i++){
     widths.push(grid.clientWidth);
     const layout=HDRLibraryLayout.gridLayout(37,stable?grid.offsetWidth:grid.clientWidth,
      grid.clientHeight,0,190,stable?lane:0);
     space.style.height=layout.totalHeight+'px';
     await new Promise(requestAnimationFrame);
    }
    return widths;
   };
   const stable=await measure(true), control=await measure(false);
   grid.style.height=wide+'px';
   space.style.width='1600px';
   space.style.height=HDRLibraryLayout.gridLayout(37,grid.offsetWidth,grid.clientHeight,0,190,lane).totalHeight+'px';
   const railWithoutOverflow=grid.offsetWidth-grid.clientWidth;
   const horizontalRail=grid.offsetHeight-grid.clientHeight;
   return {stable,control,railWithoutOverflow,horizontalRail,lane};
  });
  assert.equal(result.railWithoutOverflow,0,'no vertical lane when all photos fit');
  assert.equal(result.horizontalRail,0,'wide content creates no bottom scrollbar or gap');
  assert.deepEqual(result.stable,[1360,...Array(7).fill(1360-result.lane)],'the overflowing grid narrows once and stays stable');
  assert.ok(result.control.filter((width,i)=>i>0&&width!==result.control[i-1]).length>1,'control reproduces the thumbnail feedback loop');
  console.log('PASS: overflowing grid settles after one lane change; fitting grid uses its full width.',result);
 }finally{if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:5});}
})().catch(e=>{console.error(e);process.exitCode=1;});
