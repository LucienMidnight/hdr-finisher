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
    // Saved targets have a visible previous grade, so stale pictures are detectable.
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
    const oldKeys={};
    for(const target of targets){
      const deadline=Date.now()+60000;let picture;
      do{picture=await api('picture',{path:target,edge:256,quality:'quick',priority:1});if(!picture.kept)await page.waitForTimeout(100);}while(!picture.kept&&Date.now()<deadline);
      assert.equal(picture.kept,true,'previous saved picture ready: '+target);oldKeys[target]=picture.key;
    }
    await api('paste-pictures',{action:'pause'});
    await physical('target.png').click();await physical('other.png').click({modifiers:['Control']});await copyCell.click({modifiers:['Control']});
    assert.equal((await iframe.evaluate(el=>el.contentWindow.HDRLibraryCommands.selection())).length,3);
    await frame.locator('#library-grid').press('Control+Shift+v');await dialog.waitFor();
    assert.equal(await choose.getAttribute('aria-expanded'),'true');
    await exposure.evaluate(el=>el.closest('details').open=true);assert.equal(await exposure.isChecked(),true);
    assert.equal(await dialog.locator('input[data-setting="global_adjustments.sdr.exposure"]').isChecked(),false);
    const pasted=page.waitForResponse(response=>response.url().endsWith('/api/library/grade-paste')&&!JSON.parse(response.request().postData()).preview);
    await dialog.getByRole('button',{name:'Paste onto 3 photos',exact:true}).click();
    const result=await (await pasted).json();assert.equal(result.count,3);assert.equal(result.undo_available,true);
    await frame.locator('.library-picture-updating').first().waitFor();
    await page.screenshot({path:path.join(output,'paste-updating.png')});
    const stale=await iframe.evaluate((el,oldKeys)=>[...el.contentDocument.querySelectorAll('.library-cell')].filter(cell=>oldKeys[cell.dataset.path]).some(cell=>[...cell.querySelectorAll('[data-picture-key]')].some(picture=>picture.dataset.pictureKey===oldKeys[cell.dataset.path])),oldKeys);
    assert.equal(stale,false,'no old saved picture remains displayed after paste');
    for(const target of targets){const picture=await api('picture',{path:target,edge:256,quality:'quick',priority:1});assert.equal(Boolean(picture.kept),false,'default while updating');assert.notEqual(picture.key,oldKeys[target]);}
    await savedWhen(photos[1],saved=>saved.grade.global_adjustments.hdr.exposure===.75&&saved.virtual_copies?.find(copy=>copy.name==='Paste target')?.grade.global_adjustments.hdr.exposure===.75);
    await savedWhen(photos[2],saved=>saved.grade.global_adjustments.hdr.exposure===.75);
    let saved=JSON.parse(fs.readFileSync(photos[1]+'.hdrf','utf8'));assert.equal(saved.grade.global_adjustments.hdr.exposure,.75);assert.equal(saved.virtual_copies.find(copy=>copy.name==='Paste target').grade.global_adjustments.hdr.exposure,.75);
    assert.equal(JSON.parse(fs.readFileSync(photos[2]+'.hdrf','utf8')).grade.global_adjustments.hdr.exposure,.75);
    const undo=page.waitForResponse(response=>response.url().endsWith('/api/library/undo'));
    await frame.locator('#library-grid').press('Control+z');const restored=await(await undo).json();assert.equal(restored.grade_changed,true);
    await savedWhen(photos[1],saved=>saved.grade.global_adjustments.hdr.exposure===.25&&saved.virtual_copies?.find(copy=>copy.name==='Paste target')?.grade.global_adjustments.hdr.exposure===.25);
    await savedWhen(photos[2],saved=>saved.grade.global_adjustments.hdr.exposure===.25);
    for(const target of targets){const picture=await api('picture',{path:target,edge:256,quality:'quick',priority:1});assert.equal(picture.kept,true);assert.equal(picture.key,oldKeys[target]);}
    saved=JSON.parse(fs.readFileSync(photos[1]+'.hdrf','utf8'));assert.equal(saved.grade.global_adjustments.hdr.exposure,.25);assert.equal(saved.virtual_copies.find(copy=>copy.name==='Paste target').grade.global_adjustments.hdr.exposure,.25);
    await api('paste-pictures',{action:'resume'});
    for(let i=0;i<photos.length;i++)assert.deepEqual(fs.readFileSync(photos[i]),originals[i]);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'native text clipboard, single confirmation, expandable picker, remembered HDR exposure only, three targets including virtual copy, default while updating, single Undo restores saved grades and picture keys',screenshots:output}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
