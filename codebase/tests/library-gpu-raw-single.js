// Grid, Single, full-screen and native detail share GPU-developed RAW pictures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {chromium}=require('playwright');
const uiOnly=process.argv.includes('--ui-only');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'output/library-gpu-raw-single',String(Date.now()));
fs.mkdirSync(folder,{recursive:true});
const photos=['DSC07060','DSC07061','DSC07072'].map(name=>{
 const file=path.join(folder,name+'.ARW');fs.copyFileSync('D:/test-photos-delete-later/'+name+'.ARW',file);return file;
});
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL);
  const library=page.locator('#library-frame'),frame=page.frameLocator('#library-frame');
  const result=await library.evaluate(async(element,{photos,uiOnly})=>{
   const win=element.contentWindow, rows=[];
   const location=(await(await win.fetch('/api/library/cache-settings')).json()).location;
   for(const photo of photos){
    let start=performance.now();
    const [grid,screen]=await Promise.all([win.HDRLibraryGpuRaw.thumbnail(photo,640),win.HDRLibraryGpuRaw.thumbnail(photo,2560)]);
    if(grid.route!=='gpu-raw-thumbnail'||screen.route!==grid.route)throw Error('RAW did not use GPU');
    const reserve=screen.source_width*screen.source_height*44+64*1024*1024;
    if(screen.gpu_memory_peak_bytes>reserve)throw Error('RAW exceeded its reservation');
    const coldMs=performance.now()-start;start=performance.now();
    const again=await win.HDRLibraryGpuRaw.thumbnail(photo,2560);
    if(!again.cache_hit||again.key!==screen.key)throw Error('Screen picture was redeveloped');
    const reuseMs=performance.now()-start;start=performance.now();
    let native=null;
    if(!uiOnly){
    const ready=await win.HDRLibraryGpuRaw.thumbnail(photo,2560,undefined,{nativeMode:true});
    if(!ready.native_ready)throw Error('Native source was not prepared on GPU');
    const response=await win.fetch('/api/library/native',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({path:photo,center_x:.5,center_y:.5,width:1280,height:720})});
    native=await response.json();if(!response.ok||native.renderer!=='gpu')throw Error(JSON.stringify(native));
    }
    rows.push({path:photo,grid,screen,native,coldMs,reuseMs,nativeMs:performance.now()-start});
   }
   return {location,rows};
  },{photos,uiOnly});
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));
  console.log('GPU grid, screen and native sources prepared for three RAWs.');
  await page.evaluate(()=>activateWorkflowTab('import'));
  await library.evaluate((element,folder)=>element.contentWindow.HDRLibrary.browse(folder),folder);
  await frame.locator('#single-view').click();
  await page.waitForFunction(()=>{
   const win=document.querySelector('#library-frame').contentWindow,c=win.document.querySelector('#single-picture');
   return Number(c.dataset.pictureEdge)>=1280&&!!c.dataset.pictureKey;
  },null,{timeout:120000});
  await page.waitForFunction(keys=>{
   const win=document.querySelector('#library-frame').contentWindow;
   return keys.every(key=>win.HDRLibraryPictures.resident(key));
  },result.rows.map(row=>row.screen.key),{timeout:120000});
  const previous=await frame.locator('#single-picture').getAttribute('data-picture-path');
  let start=Date.now();await frame.locator('#filmstrip').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(previous=>{
   const c=document.querySelector('#library-frame').contentWindow.document.querySelector('#single-picture');
   return c.dataset.picturePath&&c.dataset.picturePath!==previous&&Number(c.dataset.pictureEdge)>=1280;
  },previous,{timeout:30000});
  const neighbourMs=Date.now()-start;
  await frame.locator('#zoom-button').click();
  await page.waitForFunction(()=>{
   const win=document.querySelector('#library-frame').contentWindow;
   return !win.document.querySelector('#native-picture').hidden&&!!win.document.querySelector('#native-picture').dataset.picturePath;
  },null,{timeout:120000});
  await frame.locator('#zoom-button').click();
  await frame.locator('#review-view').click();
  assert.equal(await frame.locator('#single-view').getAttribute('aria-pressed'),'true');
  await page.keyboard.press('f');
  await frame.locator('#review-view').waitFor({state:'visible'});
  let report={photos:[],uiOnly:true};
  if(!uiOnly){
  const compared=await execFile(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'tests/helpers/gpu_raw_single_compare.py'),path.join(folder,'result.json')],{cwd:root,maxBuffer:1<<24});
  report=JSON.parse(compared.stdout.trim().split('\n').at(-1));
  }
  fs.writeFileSync(path.join(folder,'comparison.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({timings:result.rows.map(r=>({photo:path.basename(r.path),coldMs:r.coldMs,reuseMs:r.reuseMs,nativeMs:r.nativeMs,memory:r.screen.gpu_memory_peak_bytes})),neighbourMs,report}));
  for(const row of report.photos)for(const check of row.comparisons)assert.ok(check.passed,JSON.stringify({photo:row.photo,...check}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
