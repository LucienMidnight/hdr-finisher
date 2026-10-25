const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,lib,folder,output})=>{
  const browse=path.join(folder,'browse'),index=path.join(folder,'index');
  fs.mkdirSync(browse);fs.mkdirSync(index);
  const photos=['idle.ARW','indexing.ARW'].map(name=>{const p=path.join(browse,name);fs.copyFileSync(path.join(folder,'photo-0.ARW'),p);return p;});
  const image=fs.readFileSync(path.resolve(__dirname,'../fixtures/sdr_gradient.png'));
  for(let n=0;n<1024;n++)fs.writeFileSync(path.join(index,n+'.png'),image);
  await lib.evaluate(async()=>{window.HDRLibraryProfile=true;await HDRLibraryPictures.initialize();});
  const rows=[];
  for(let n=0;n<2;n++){
    if(n){
      await lib.evaluate(async index=>{const r=await fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[index]})});if(!r.ok)throw Error(await r.text());},index);
      await lib.waitForFunction(async()=>{const r=await(await fetch('/api/library/health')).json();return r.index.total===1024&&r.helper.pending>0;},null,{timeout:30000});
    }
    const row=await lib.evaluate(async({photo,indexing})=>{
      let busySeen=false;const timer=setInterval(()=>fetch('/api/library/health').then(r=>r.json()).then(r=>{busySeen ||= r.helper.source_busy;}),75);
      try{const start=performance.now();const meta=await HDRLibraryScenes.load(photo,2560,undefined,0);return {indexing,meta,total_ms:performance.now()-start,busySeen,development:window.part0bEvents.filter(e=>e.stage==='picture_development'&&e.path===photo).at(-1)};}
      finally{clearInterval(timer);}
    },{photo:photos[n],indexing:!!n});
    assert.ok(row.busySeen,'Live GPU development notifies the index helper');
    assert.ok(row.development?.source_ms?.libraw_unpack>=0,'Separate LibRaw timing');
    assert.ok(row.development?.gpu_stages_ms?.readback>=0,'GPU transfer timing');rows.push(row);
  }
  await lib.evaluate(async()=>{window.HDRLibraryProfile=false;await fetch('/api/library/index',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});});
  await lib.evaluate(folder=>HDRLibrary.browse(folder),browse);
  await lib.locator('.library-cell').filter({hasText:'idle.ARW'}).first().click();await page.keyboard.press('f');
  const sharp=name=>lib.waitForFunction(name=>{const c=document.querySelector('#single-picture');return !c.hidden&&c.dataset.picturePath?.endsWith(name)&&Number(c.dataset.pictureEdge)>=1280;},name,{timeout:60000});
  await sharp('idle.ARW');await page.keyboard.press('ArrowRight');await sharp('indexing.ARW');await page.keyboard.press('ArrowLeft');await sharp('idle.ARW');
  await lib.evaluate(()=>{window.part0eFrames=[];window.part0eMonitor=true;const tick=()=>{if(!window.part0eMonitor)return;const c=document.querySelector('#single-picture');window.part0eFrames.push({hidden:c.hidden,path:c.dataset.picturePath,width:c.width,height:c.height});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  for(const key of ['ArrowRight','ArrowLeft','ArrowRight','ArrowLeft']){await page.keyboard.press(key);await sharp(key==='ArrowRight'?'indexing.ARW':'idle.ARW');await page.waitForTimeout(35);}
  const result=await lib.evaluate(()=>{window.part0eMonitor=false;return {frames:window.part0eFrames,events:window.part0bEvents};});
  fs.writeFileSync(path.join(output,'part0e-results.json'),JSON.stringify({rows,...result},null,2));
  assert.ok(result.frames.length);assert.ok(result.frames.every(f=>!f.hidden&&f.width>0&&f.height>0),'No blank frame during ready-window swaps');
  assert.deepEqual(fs.readdirSync(browse).sort(),['idle.ARW','indexing.ARW']);
  console.log(JSON.stringify(rows.map(r=>({indexing:r.indexing,total_ms:r.total_ms,busySeen:r.busySeen,...r.development})),null,2));
  console.log('PASS: isolated live development with index idle/active, foreground notification, and four ready-window swaps without blank frames.');
};
