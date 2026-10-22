// Isolated GPU and UI behavior driver; no app backend or photo projects loaded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-hsl-test-'));
  const app=await _electron.launch({executablePath:require('../desktop/node_modules/electron'),args:[path.resolve(__dirname,'../tools/hsl-prototype/electron-main.cjs')],env:{...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HSL_PROTOTYPE_TEST:'1'}});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>window.hslPrototype?.ready);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    console.log('HSL prototype ready; checking GPU pixels');
    const report=await page.evaluate(async()=>{
      const e=await import('/engine.mjs');const gpu=window.hslPrototype.gpu;
      if(!gpu)throw Error('WebGPU unavailable; parity test cannot pass on CPU fallback: '+document.getElementById('status').textContent);
      const pixels=new Float32Array(512*4),mask=new Float32Array(512);
      for(let i=0;i<512;i++){
        const h=i/512*Math.PI*2,scale=[.02,1,16,128][i%4];
        const rgb=e.fromLab([.65,.12*Math.cos(h),.12*Math.sin(h)]);
        pixels.set([...rgb.map(v=>v*scale),.7],i*4);mask[i]=i%5/4;
      }
      // Includes negative RGB channels as produced by wide-gamut conversion.
      pixels.set([3,-.02,.1,.4],0);
      const r=e.newRecipe();r.ranges=[{center:35,width:100,feather:25,subtract:false},{center:280,width:65,feather:20,subtract:false},{center:65,width:12,feather:8,subtract:true}];
      r.hue=55;r.saturation=37;r.luminance=.7;r.uniformity=63;r.opacity=.85;
      const cpu=e.processCPU(pixels,r,mask),actual=await gpu.process(pixels,r,mask),diff=[];
      for(let i=0;i<pixels.length;i+=4){
        if(!actual.subarray(i,i+4).every(Number.isFinite))throw Error('Non-finite GPU result');
        if(actual[i+3]!==pixels[i+3])throw Error('Alpha changed');
        const scale=Math.max(1,...cpu.subarray(i,i+3),...actual.subarray(i,i+3));
        const a=e.toLab(Array.from(actual.subarray(i,i+3),v=>v/scale)),b=e.toLab(Array.from(cpu.subarray(i,i+3),v=>v/scale));
        diff.push(Math.hypot(...a.map((v,j)=>v-b[j])));
        if(mask[i/4]===0)for(let j=0;j<4;j++)if(actual[i+j]!==pixels[i+j])throw Error('Outside local mask changed');
      }
      const neutral=await gpu.process(pixels,e.newRecipe());
      if(!neutral.every((v,i)=>v===pixels[i]))throw Error('Neutral GPU recipe changed pixels');
      diff.sort((a,b)=>a-b);
      return {mean:diff.reduce((a,b)=>a+b,0)/diff.length,p99:diff[Math.floor(diff.length*.99)],hdrPeak:Math.max(...actual)};
    });
    // Prototype agreement target: normalized Oklab distance mean < .002,
    // p99 < .01. This is an engineering check, not HDR perceptual validation.
    assert.ok(report.mean<.002,JSON.stringify(report));assert.ok(report.p99<.01,JSON.stringify(report));assert.ok(report.hdrPeak>1);
    console.log('HSL prototype GPU pixels pass; checking controls');
    // Local grade: one multi-colour selection; the dots are quick starts.
    await page.getByRole('button',{name:'Local grade',exact:true}).click();
    await page.getByRole('button',{name:'Select Orange band',exact:true}).click();
    await page.getByRole('button',{name:'Add +',exact:true}).click();
    await page.getByRole('button',{name:'Select Green band',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges.length),2);
    await page.getByRole('button',{name:'Subtract −',exact:true}).click();
    await page.getByRole('button',{name:'Select Orange band',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges[2].subtract),true);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges.length),2);
    await page.getByRole('button',{name:'Redo',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges.length),3);
    await page.getByRole('slider',{name:'Hue shift',exact:true}).focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.hue),1);
    await page.getByLabel('Show selection',{exact:true}).check();
    await page.getByLabel('Use CPU',{exact:true}).check();
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('CPU fallback'));
    await page.getByLabel('Use CPU',{exact:true}).uncheck();
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('WebGPU'));
    await page.getByRole('button',{name:'Reset all',exact:true}).click();
    await page.getByRole('button',{name:'Pick',exact:true}).click();
    const photo=page.locator('#photo');
    await photo.click({position:{x:400,y:330}});
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges.length),1);
    await page.getByRole('button',{name:'Add +',exact:true}).click();
    await photo.click({position:{x:100,y:100}});
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges.length),2);
    await page.getByRole('button',{name:'Subtract −',exact:true}).click();
    await photo.click({position:{x:400,y:330}});
    assert.equal(await page.evaluate(()=>window.hslPrototype.recipe.ranges[2].subtract),true);
    const saved=await page.evaluate(()=>window.hslPrototype.recipe);
    await page.locator('#load').setInputFiles({name:'recipe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,hue:35}))});
    await page.waitForFunction(()=>window.hslPrototype.recipe.hue===35);
    assert.deepEqual(await page.evaluate(()=>window.hslPrototype.recipe),{...saved,hue:35});
    // Global: channels keep separate edits; picking from All starts a Custom channel.
    await page.getByRole('button',{name:'Global',exact:true}).click();
    await page.getByRole('button',{name:'Blue channel',exact:true}).click();
    await page.getByRole('slider',{name:'Luminance',exact:true}).focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Tab');
    await page.getByRole('button',{name:'Red channel',exact:true}).click();
    const redWidth=await page.evaluate(()=>window.hslPrototype.recipe.ranges[0].width);
    await page.getByRole('slider',{name:'Range end',exact:true}).focus();await page.keyboard.press('ArrowRight');
    assert.ok(await page.evaluate(w=>window.hslPrototype.recipe.ranges[0].width>w,redWidth));
    await page.getByRole('button',{name:'All channel',exact:true}).click();
    await page.getByRole('button',{name:'Pick',exact:true}).click();
    await photo.click({position:{x:400,y:330}});
    const global=await page.evaluate(()=>window.hslPrototype.state.global);
    assert.equal(global.current,'custom-1');
    assert.equal(global.channels.find(c=>c.id==='custom-1').recipe.ranges.length,1);
    assert.ok(global.channels.find(c=>c.id==='blue').recipe.luminance<0);
    assert.equal(global.channels.find(c=>c.id==='red').recipe.luminance,0);
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('global 1 channel'));
    assert.deepEqual(errors,[]);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());
    const output=path.resolve(__dirname,'../output/hsl-prototype');fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'prototype.png'),fullPage:true});
    console.log('HSL prototype GPU + interaction PASS',JSON.stringify(report));
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
