/* Slice 3 Stage A: one real window, disposable originals and app profile. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), output = path.join(root, "output", "library-virtual-copies");
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, "photos-"));
const photos = ["first.png", "next.png"].map(name => path.join(folder, name));
for (const photo of photos) fs.copyFileSync(path.join(root, "tests", "fixtures", "sdr_gradient.png"), photo);
const original = fs.readFileSync(photos[0]);
const read = photo => JSON.parse(fs.readFileSync(photo + ".hdrf", "utf8"));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => {errors.push(error.message);console.log("pageerror",error.message);});
    page.on("console",message=>{if(message.text().includes("Library"))console.log("console",message.text());});
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: "networkidle" });
    const written = async photo => {
      const deadline=Date.now()+30000;
      while(Date.now()<deadline) {
        const saved=await page.evaluate(photo=>fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})}).then(r=>r.json()),photo);
        if(saved.photos[0]?.storage==='sidecar') return;
        await page.waitForTimeout(100);
      }
      throw new Error('Settings writer did not finish within 30 seconds.');
    };
    const open = photo => page.evaluate(async photo => {
      await openDesktopSelection({ kind: "source", ...await desktop.grantSourcePath(photo) });
    }, photo);
    const edit = exposure => page.evaluate(async exposure => {
      const adjustments = structuredClone(state.adjustments);
      adjustments.hdr.exposure = exposure;
      adjustments.sdr.exposure = -.25;
      adjustments.shared.geometry.crop = { x: .1, y: .1, width: .8, height: .8 };
      await queueEditCommand("set_global_adjustments", { adjustments });
    }, exposure);
    await open(photos[0]);
    await page.waitForFunction(() => window.HDRGradeSaving.active());
    await page.locator("#grade-autosave").click();
    await edit(.75);
    await page.evaluate(() => HDRGradeSaving.save());
    await written(photos[0]);

    await page.evaluate(()=>activateWorkflowTab('import'));
    const frame=page.frameLocator('#library-frame');
    await page.locator('#library-frame').evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    const cell=name=>frame.locator('.library-cell').filter({has:frame.locator('.name').filter({hasText:name})});
    const create=async (start,name,count)=>{
      await frame.locator('.library-cell').filter({has:frame.locator('.name').filter({hasText:/^first[.]png$/})}).click({button:'right'});
      await frame.getByRole('menuitem',{name:/^Create virtual copy/}).click();
      const dialog=frame.getByRole('dialog',{name:'Create Virtual Copy of first.png',exact:true});
      await dialog.locator('select').selectOption(start);
      if(name)await dialog.locator('input').fill(name);
      await dialog.getByRole('button',{name:'Create copy',exact:true}).click();
      await frame.locator('.library-cell').nth(count-1).waitFor();await written(photos[0]);
    };
    await frame.locator('.library-cell').first().waitFor();
    await create('current','',3);await create('clean','Clean',4);
    const copies=read(photos[0]).virtual_copies,key=id=>photos[0]+'|copy|'+id;
    const first=cell('first.png · Copy 1'),clean=cell('first.png · Clean');
    assert.equal(await first.locator('.library-copy').getAttribute('title'),'Virtual copy: Copy 1');
    assert.equal(await frame.locator('.library-cell').filter({has:frame.locator('.name').filter({hasText:/^first[.]png$/})}).locator('.library-copy').innerText(),'+2');
    await first.locator('canvas[data-kept="true"]').waitFor({timeout:60000});
    await first.dblclick();
    await page.waitForFunction(key=>HDRGradeSaving.ready() && HDRGradeSaving.item()===key && state.adjustments.hdr.exposure===.75,key(copies[0].photo_id),{timeout:30000});
    await page.evaluate(()=>activateWorkflowTab('import'));
    await first.click({button:'right'});await frame.getByRole('menuitem',{name:'Rename copy…',exact:true}).click();
    let naming=frame.getByRole('dialog',{name:'Rename Virtual Copy',exact:true});
    await naming.locator('input').fill('Shared');await naming.getByRole('button',{name:'Rename',exact:true}).click();
    await written(photos[0]);await cell('first.png · Shared').waitFor();
    await page.waitForFunction(()=>els.sessionName.textContent==='first.png · Shared');
    assert.equal(await page.evaluate(()=>state.documentDirty),false);
    assert.equal(read(photos[0]).virtual_copies[0].grade.global_adjustments.hdr.exposure,.75);
    await frame.locator('#library-grid').press('Control+z');await first.waitFor();await written(photos[0]);
    await page.waitForFunction(()=>els.sessionName.textContent==='first.png · Copy 1');
    await first.click();await frame.locator('#details').getByRole('button',{name:'Rename copy…',exact:true}).click();
    naming=frame.getByRole('dialog',{name:'Rename Virtual Copy',exact:true});
    await naming.locator('input').fill('Clean');await naming.getByRole('button',{name:'Rename',exact:true}).click();await written(photos[0]);
    assert.equal(read(photos[0]).virtual_copies.filter(copy=>copy.name==='Clean').length,2);
    await frame.locator('#library-grid').press('Control+z');await first.waitFor();await written(photos[0]);
    await edit(2);await page.evaluate(()=>activateWorkflowTab('import')); await clean.dblclick();
    await page.locator('#app-dialog[open]').waitFor();assert.match(await page.locator('#app-dialog-message').innerText(),/Copy 1/);
    await page.locator('#app-dialog-actions button').filter({hasText:/^Cancel$/}).click();
    assert.equal(await page.evaluate(()=>HDRGradeSaving.item()),key(copies[0].photo_id));
    await clean.dblclick();await page.locator('#app-dialog[open]').waitFor();
    await page.locator('#app-dialog-actions button').filter({hasText:/^Save$/}).click();
    await page.waitForFunction(key=>HDRGradeSaving.ready() && HDRGradeSaving.item()===key && state.adjustments.hdr.exposure===0,key(copies[1].photo_id),{timeout:30000});await written(photos[0]);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,.75);
    assert.equal(read(photos[0]).virtual_copies[0].grade.global_adjustments.hdr.exposure,2);
    console.log('Same-source gate and independent grades passed');
    await page.evaluate(()=>activateWorkflowTab('import'));await first.click({button:'right'});
    await frame.getByRole('menuitem',{name:/^Remove virtual copy/}).click();
    const removal=frame.getByRole('dialog',{name:/^Remove Virtual Copy .Copy 1.\?$/});
    assert.match(await removal.innerText(),/removes one grade of first[.]png.*The photo itself stays.*Nothing is deleted from disk/s);
    await removal.getByRole('button',{name:'Remove copy',exact:true}).click();await first.waitFor({state:'hidden'});await written(photos[0]);
    assert.equal(read(photos[0]).virtual_copies.length,1);
    const undo=page.waitForResponse(r=>r.url().endsWith('/api/library/undo'));
    await frame.locator('#library-grid').press('Control+z');assert.equal((await undo).status(),200);
    await first.waitFor();await written(photos[0]);assert.equal(read(photos[0]).virtual_copies.length,2);
    await open(photos[0]);await edit(3);
    const changed=read(photos[0]);changed.grade.global_adjustments.hdr.exposure=4;
    fs.writeFileSync(photos[0]+'.hdrf',JSON.stringify(changed));
    await page.locator('#app-dialog[open]').waitFor();
    await page.locator('#app-dialog-actions button').filter({hasText:/^Keep both$/}).click();
    await page.waitForFunction(()=>!state.documentDirty,null,{timeout:30000});await written(photos[0]);
    assert.equal(read(photos[0]).grade.global_adjustments.hdr.exposure,3);
    assert.equal(read(photos[0]).virtual_copies.at(-1).grade.global_adjustments.hdr.exposure,4);
    // Two originals, one create window and one Undo for the entire selection.
    await page.evaluate(()=>activateWorkflowTab('import'));
    await page.locator('#library-frame').evaluate((el,folder)=>el.contentWindow.HDRLibrary.browse(folder),folder);
    const physical=name=>frame.locator('.library-cell').filter({has:frame.locator('.name').filter({hasText:new RegExp('^'+name.replace('.','[.]')+'$')})});
    await physical('first.png').click();await physical('next.png').click({modifiers:['Control']});
    await physical('first.png').click({button:'right'});await frame.getByRole('menuitem',{name:/^Create virtual copy/}).click();
    let batch=frame.getByRole('dialog',{name:'Create 2 Virtual Copies',exact:true});
    await batch.locator('input').fill('Batch');await batch.getByRole('button',{name:'Create 2 copies',exact:true}).click();
    await cell('first.png · Batch').waitFor();await cell('next.png · Batch').waitFor();await written(photos[0]);await written(photos[1]);
    await frame.locator('#library-grid').press('Control+z');await cell('first.png · Batch').waitFor({state:'hidden'});await cell('next.png · Batch').waitFor({state:'hidden'});
    await written(photos[0]);await written(photos[1]);
    // Mixed selection removes closed copies and leaves the open one named in the result.
    await clean.dblclick();await page.waitForFunction(key=>HDRGradeSaving.ready() && HDRGradeSaving.item()===key,key(copies[1].photo_id));
    await page.evaluate(()=>activateWorkflowTab('import'));
    await physical('first.png').click();await first.click({modifiers:['Control']});await clean.click({modifiers:['Control']});
    await first.click({button:'right'});await frame.getByRole('menuitem',{name:/^Remove virtual copy/}).click();
    batch=frame.getByRole('dialog',{name:'Remove 2 Virtual Copies?',exact:true});
    assert.match(await batch.innerText(),/photos stay.*Nothing is deleted from disk/s);
    await batch.getByRole('button',{name:'Remove 2 copies',exact:true}).click();await first.waitFor({state:'hidden'});await written(photos[0]);
    await page.waitForFunction(()=>/Left "Clean".*open in Grade/.test(document.querySelector('#library-frame').contentWindow.document.querySelector('#library-status').textContent));
    await frame.locator('#library-grid').press('Control+z');await first.waitFor();await written(photos[0]);
    assert.deepEqual(fs.readFileSync(photos[0]),original);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'rename in menu and Details, duplicate names, Grade caption and save state, bulk create/Undo, mixed removal/skipped open copy/Undo, closed original clears grade/edited picture, fresh reopening/Undo, existing save gate/Keep both, sources unchanged'}));
  } catch(error) {
    const page=await browser.newPage();
    console.log('Failure state',await page.evaluate(()=>({workflow:state.activeWorkflow,importing:state.importInProgress,dialog:document.querySelector('#app-dialog')?.open,body:document.body.className,library:document.querySelector('#library-frame').contentWindow.document.body.innerText.slice(-4000)})));
    await page.screenshot({path:path.join(output,'failure.png')});throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
