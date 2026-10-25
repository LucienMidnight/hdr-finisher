const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,lib,folder,output})=>{
  await lib.evaluate(()=>{
    const scenes=HDRLibraryScenes,raw=HDRLibraryGpuRaw;
    window.HDRLibraryScenes={...scenes,load:(p,e,s,priority=10,...rest)=>priority>=10
      ?Promise.reject(new DOMException('Cold fullscreen fixture','AbortError')):scenes.load(p,e,s,priority,...rest)};
    const gate=new Promise(resolve=>{window.releaseColdDevelopment=resolve;});
    window.HDRLibraryGpuRaw={...raw,liveScene:async(p,...args)=>{if(p.endsWith('photo-0.ARW'))await gate;return raw.liveScene(p,...args);}};
  });
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
  await lib.locator('.library-cell').filter({hasText:'photo-0.ARW'}).first().click();
  await page.keyboard.press('f');
  await lib.waitForFunction(()=>document.querySelector('#single-stage img[data-camera-preview="true"]')?.dataset.picturePath?.endsWith('photo-0.ARW'),null,{timeout:15000});
  assert.equal(await lib.locator('#single-picture').isVisible(),false,'Old HDRF picture stays hidden during camera quick draw');
  await lib.waitForFunction(()=>window.part0bEvents.some(e=>e.stage==='picture_present'&&e.view==='fullscreen'&&e.quick_draw&&e.picture_size==='camera preview'),null,{timeout:15000});
  const camera=await lib.evaluate(()=>window.part0bEvents.find(e=>e.stage==='picture_present'&&e.view==='fullscreen'&&e.quick_draw&&e.picture_size==='camera preview'));
  assert.ok(camera?.quick_draw,'Camera preview is logged as the selected quick draw');
  await lib.evaluate(()=>window.releaseColdDevelopment());
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden&&document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-0.ARW'),null,{timeout:90000});
  assert.equal(await lib.locator('#single-stage img[data-camera-preview="true"]').count(),0,'HDRF replaces the camera quick draw');
  await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden&&document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-1.ARW'),null,{timeout:90000});
  const edited=await lib.evaluate(()=>window.part0bEvents.filter(e=>e.path?.endsWith('photo-1.ARW')));
  assert.ok(edited.some(e=>e.stage==='picture_denoise_prepare'),'Edited sharp draw prepares Denoise');
  assert.equal(edited.some(e=>e.stage==='picture_present'&&e.picture_size==='camera preview'),false,'Edited photo never shows its camera preview');
  await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden&&document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-2.ARW'),null,{timeout:90000});
  const events=await lib.evaluate(()=>window.part0bEvents);
  assert.ok(events.some(e=>e.stage==='picture_development'&&e.path?.endsWith('photo-2.ARW')),'Forward development finishes');
  fs.writeFileSync(path.join(output,'part0f-events.json'),JSON.stringify(events,null,2));
  console.log('PASS: cold camera quick draw, current HDRF replacement, edited Denoise, and forward development on disposable copies.');
};
