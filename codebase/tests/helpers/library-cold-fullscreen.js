const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({page,lib,folder,output})=>{
  await lib.evaluate(()=>{
    const scenes=HDRLibraryScenes;
    // Keep the grid cold: the actual selected and neighbour scheduler is intact.
    window.HDRLibraryScenes={...scenes,load:(p,e,s,priority=10,...rest)=>{
      if(priority>=10) return Promise.reject(new DOMException('Cold fullscreen fixture','AbortError'));
      return scenes.load(p,e,s,priority,...rest);
    }};
  });
  await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
  await lib.locator('.library-cell').filter({hasText:'photo-0.ARW'}).first().click();
  await page.keyboard.press('f');
  await page.waitForTimeout(200);await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);await page.keyboard.press('ArrowRight');
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden && document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-2.ARW'),null,{timeout:90000});
  await page.waitForTimeout(100);
  let events=await lib.evaluate(()=>window.part0bEvents);
  const developed=events.filter(e=>e.stage==='picture_development');
  assert.equal(developed[0]?.path.endsWith('photo-2.ARW'),true,'Stopped photo develops first');
  assert.ok(events.some(e=>e.stage==='picture_present'&&e.quick_draw),'Developed thumbnail presents before sharp');
  const cold=events.filter(e=>e.view==='fullscreen'&&e.stage==='picture_present');
  assert.equal(cold[0].quick_draw,true);assert.ok(cold.some(e=>e.sharp_draw));
  // One more cold selection, including promotion if neighbour work has begun.
  await page.keyboard.press('ArrowLeft');
  await lib.waitForFunction(()=>!document.querySelector('#single-picture').hidden && document.querySelector('#single-picture').dataset.picturePath?.endsWith('photo-1.ARW'),null,{timeout:90000});
  await lib.waitForFunction(()=>window.part0bEvents.filter(e=>e.stage==='picture_store'&&e.success).length>=2,null,{timeout:30000});
  events=await lib.evaluate(()=>window.part0bEvents);
  fs.writeFileSync(path.join(output,'part0d-events.json'),JSON.stringify(events,null,2));
  console.log('PASS: fresh developed thumbnail then sharp draw; saves finish in background.');
};
