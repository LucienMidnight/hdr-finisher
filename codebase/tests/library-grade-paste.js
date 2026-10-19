/* Real Library clipboard/dialog/Undo using disposable photos and profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'library-grade-paste');
fs.mkdirSync(output, {recursive:true});
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
const photos = ['copied.png','target.png','other.png'].map(name => path.join(folder,name));
for (const photo of photos) fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'),photo);
const originals = photos.map(photo => fs.readFileSync(photo));
(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page = await browser.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message)); page.setDefaultTimeout(30000);
    await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
    const api = (route, body) => page.evaluate(async ({route,body}) => {
      const response=await fetch('/api/library/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json(); if(!response.ok)throw Error(JSON.stringify(result)); return result;
    },{route,body});
    const written = async photo => {
      await page.waitForFunction(async photo => { const result=await fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json());return result.photos[0]?.storage==='sidecar';},photo);
    };
    const savedWhen=async (photo,predicate)=>{
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){try{const saved=JSON.parse(fs.readFileSync(photo+'.hdrf','utf8'));if(predicate(saved))return saved;}catch{}await page.waitForTimeout(75);}
      throw Error('Settings writer did not reach expected saved contents: '+photo);
    };
    const open=photo=>page.evaluate(async photo=>{await openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)});},photo);
    const edit=exposure=>page.evaluate(async exposure=>{const adjustments=structuredClone(state.adjustments);adjustments.hdr.exposure=exposure;await queueEditCommand('set_global_adjustments',{adjustments});await HDRGradeSaving.save();},exposure);
    await open(photos[0]);await page.waitForFunction(()=>HDRGradeSaving.ready());
    await edit(.75);await written(photos[0]);
    // Saved targets have a visible previous grade, so stale drawings are detectable.
    for(const photo of photos.slice(1)){await open(photo);await edit(.25);await written(photo);}
    await page.evaluate(()=>activateWorkflowTab('import'));
    const iframe=page.locator('#library-frame'), frame=page.frameLocator('#library-frame');
    await iframe.evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    const cell=key=>frame.locator('.library-cell').filter({has:frame.locator('.name').filter({hasText:key})});
    const physical=name=>cell(new RegExp('^'+name.replace('.','[.]')+'$'));
    await physical('target.png').waitFor();
    await physical('target.png').click({button:'right'});
    await frame.getByRole('menuitem',{name:/^Create virtual copy/}).click();
    const create=frame.getByRole('dialog',{name:'Create Virtual Copy of target.png',exact:true});
    await create.locator('select').selectOption('current');await create.locator('input').fill('Paste target');
    await create.getByRole('button',{name:'Create copy',exact:true}).click();
    const copyCell=cell('target.png · Paste target');await copyCell.waitFor();await written(photos[1]);
    const copy=(await savedWhen(photos[1],saved=>saved.virtual_copies?.some(copy=>copy.name==='Paste target'))).virtual_copies.find(copy=>copy.name==='Paste target');
    const copyPath=photos[1]+'|copy|'+copy.photo_id, targets=[photos[1],photos[2],copyPath];
    await physical('copied.png').click();await frame.locator('#library-grid').press('Control+c');
    await frame.locator('#library-status').filter({hasText:'Grade copied from copied.png'}).waitFor();
    // Text shortcuts remain native; a paste into a text control cannot open a grade dialog.
    const text=frame.locator('#library-tag-input');await text.fill('normal text');await text.selectText();
    await text.press('Control+c');await text.press('End');await text.press('Control+v');
    assert.equal(await text.inputValue(),'normal textnormal text');
    assert.equal(await frame.locator('dialog[open]').count(),0);
    await physical('target.png').click();await frame.locator('#library-grid').press('Control+v');
    const dialog=frame.getByRole('dialog',{name:'Paste Grade From copied.png',exact:true});await dialog.waitFor();
    assert.match(await dialog.innerText(),/1 photo will change/);
    const choose=dialog.getByRole('button',{name:'Choose what to paste',exact:true});
    assert.equal(await choose.getAttribute('aria-expanded'),'false');await choose.click();
    await dialog.getByRole('button',{name:'None',exact:true}).click();
    const exposure=dialog.locator('input[data-setting="global_adjustments.hdr.exposure"]');
    await exposure.evaluate(el=>el.closest('details').open=true);await exposure.check();
    await page.screenshot({path:path.join(output,'paste-settings.png')});
    const firstPaste=page.waitForResponse(response=>response.url().endsWith('/api/library/grade-paste')&&!JSON.parse(response.request().postData()).preview);
    await dialog.getByRole('button',{name:'Paste grade',exact:true}).click();assert.equal((await firstPaste).status(),200);await written(photos[1]);
    // Undo the single confirmation before the bulk transaction.
    const firstUndo=page.waitForResponse(response=>response.url().endsWith('/api/library/undo'));
    await frame.locator('#library-grid').press('Control+z');assert.equal((await firstUndo).status(),200);await written(photos[1]);
    const describe=await api('grade-copy');
    assert.deepEqual(describe.selection.settings,['global_adjustments.hdr.exposure']);
    const scene=target=>iframe.evaluate((el,target)=>el.contentWindow.HDRLibraryScenes.load(target,640),target);
    const drawn=async keys=>page.waitForFunction(keys=>{
      const doc=document.querySelector('#library-frame').contentDocument;
      return Object.entries(keys).every(([path,key])=>[...doc.querySelectorAll('#grid-space .library-cell')]
        .some(cell=>cell.dataset.path===path&&[...cell.querySelectorAll('canvas[data-picture-key]')]
          .some(canvas=>!canvas.hidden&&canvas.dataset.pictureKey===key)));
    },keys,{timeout:60000});
    const oldScenes={},oldKeys={};
    for(const target of targets){oldScenes[target]=await scene(target);oldKeys[target]=oldScenes[target].key;}
    await drawn(oldKeys);
    await physical('target.png').click();await physical('other.png').click({modifiers:['Control']});await copyCell.click({modifiers:['Control']});
    assert.equal((await iframe.evaluate(el=>el.contentWindow.HDRLibraryCommands.selection())).length,3);
    await frame.locator('#library-grid').press('Control+Shift+v');await dialog.waitFor();
    assert.equal(await choose.getAttribute('aria-expanded'),'true');
    await exposure.evaluate(el=>el.closest('details').open=true);assert.equal(await exposure.isChecked(),true);
    assert.equal(await dialog.locator('input[data-setting="global_adjustments.sdr.exposure"]').isChecked(),false);
    // The open photo is a target; its reload must not flash the Grade page.
    await page.evaluate(()=>{window.__pages=[];addEventListener('hdrfinisher:workflowchange',event=>window.__pages.push(event.detail.workflow));});
    const pasted=page.waitForResponse(response=>response.url().endsWith('/api/library/grade-paste')&&!JSON.parse(response.request().postData()).preview);
    await dialog.getByRole('button',{name:'Paste onto 3 photos',exact:true}).click();
    const result=await (await pasted).json();assert.equal(result.count,3);assert.equal(result.undo_available,true);
    const pastedKeys={};
    for(const target of targets){
      const picture=await scene(target);
      assert.equal(picture.source_key,oldScenes[target].source_key,'Paste reuses the developed scene');
      assert.equal(picture.adjustments.hdr.exposure,.75);
      assert.notEqual(picture.key,oldKeys[target]);pastedKeys[target]=picture.key;
    }
    await drawn(pastedKeys);
    await page.screenshot({path:path.join(output,'paste-live.png')});
    await savedWhen(photos[1],saved=>saved.grade.global_adjustments.hdr.exposure===.75&&saved.virtual_copies?.find(copy=>copy.name==='Paste target')?.grade.global_adjustments.hdr.exposure===.75);
    await savedWhen(photos[2],saved=>saved.grade.global_adjustments.hdr.exposure===.75);
    assert.deepEqual(await page.evaluate(()=>window.__pages.filter(page=>page!=='import')),[],'paste stays on the Library');
    let saved=JSON.parse(fs.readFileSync(photos[1]+'.hdrf','utf8'));assert.equal(saved.grade.global_adjustments.hdr.exposure,.75);assert.equal(saved.virtual_copies.find(copy=>copy.name==='Paste target').grade.global_adjustments.hdr.exposure,.75);
    assert.equal(JSON.parse(fs.readFileSync(photos[2]+'.hdrf','utf8')).grade.global_adjustments.hdr.exposure,.75);
    const undo=page.waitForResponse(response=>response.url().endsWith('/api/library/undo'));
    await frame.locator('#library-grid').press('Control+z');const restored=await(await undo).json();assert.equal(restored.grade_changed,true);
    await savedWhen(photos[1],saved=>saved.grade.global_adjustments.hdr.exposure===.25&&saved.virtual_copies?.find(copy=>copy.name==='Paste target')?.grade.global_adjustments.hdr.exposure===.25);
    await savedWhen(photos[2],saved=>saved.grade.global_adjustments.hdr.exposure===.25);
    for(const target of targets){const picture=await scene(target);assert.equal(picture.key,oldKeys[target]);assert.equal(picture.source_key,oldScenes[target].source_key);assert.equal(picture.adjustments.hdr.exposure,.25);}
    await drawn(oldKeys);
    saved=JSON.parse(fs.readFileSync(photos[1]+'.hdrf','utf8'));assert.equal(saved.grade.global_adjustments.hdr.exposure,.25);assert.equal(saved.virtual_copies.find(copy=>copy.name==='Paste target').grade.global_adjustments.hdr.exposure,.25);
    for(let i=0;i<photos.length;i++)assert.deepEqual(fs.readFileSync(photos[i]),originals[i]);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'native text clipboard, single confirmation, expandable picker, remembered HDR exposure only, three targets including virtual copy, live redraw reuses stored scenes, single Undo restores saved grades and drawings',screenshots:output}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
