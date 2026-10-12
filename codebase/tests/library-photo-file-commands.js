const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','library-photo-file-commands');fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(out,'shoot-')),target=fs.mkdtempSync(path.join(out,'target-'));
for(const name of ['photo.png','taken.png'])fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'),path.join(folder,name));
fs.copyFileSync(path.join(folder,'photo.png'),path.join(target,'photo.png'));
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
 await lib.evaluate(async paths=>{await fetch('/api/library/pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths})});},[folder,target]);
 await lib.goto(new URL('/library',process.env.HDR_FINISHER_URL).href);await lib.waitForFunction(()=>window.HDRLibrary);await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
 const cell=name=>lib.locator('#grid-space .library-cell').filter({has:lib.locator('.name',{hasText:new RegExp('^'+name.replace('.','\\.')+'$')})}).first();
 await cell('photo.png').click({button:'right'});await lib.getByRole('menuitem',{name:'Rename photo…',exact:true}).click();
 let dialog=lib.getByRole('dialog',{name:'Rename photo',exact:true});assert.ok((await dialog.innerText()).includes('ending stays .png'));await dialog.locator('input').fill('taken');await dialog.getByRole('button',{name:'Rename photo',exact:true}).click();
 dialog=lib.getByRole('dialog',{name:'Rename photo',exact:true});await dialog.getByText('That name is taken. Nothing was renamed.',{exact:true}).waitFor();await dialog.locator('input').fill('เที่ยว');await dialog.getByRole('button',{name:'Rename photo',exact:true}).click();await cell('เที่ยว.png').waitFor();assert.ok(fs.existsSync(path.join(folder,'เที่ยว.png')));
 await lib.locator('#library-undo').click();await cell('photo.png').waitFor();assert.ok(fs.existsSync(path.join(folder,'photo.png')));
 async function move(){await cell('photo.png').click({button:'right'});await lib.getByRole('menuitem',{name:'Move to folder…',exact:true}).click();const d=lib.getByRole('dialog',{name:'Move to folder',exact:true});await d.getByLabel('Destination folder',{exact:true}).selectOption(target);await d.getByRole('button',{name:'Choose folder',exact:true}).click();}
 await move();dialog=lib.getByRole('dialog',{name:'Name clash',exact:true});assert.ok((await dialog.innerText()).includes('Nothing has been moved or overwritten yet'));assert.equal(await dialog.getByRole('button').count(),3);await dialog.getByRole('button',{name:'Cancel move',exact:true}).click();assert.ok(fs.existsSync(path.join(folder,'photo.png')));
 await move();await lib.getByRole('dialog',{name:'Name clash',exact:true}).getByRole('button',{name:'Skip this one',exact:true}).click();await lib.waitForFunction(()=>document.querySelector('#library-status').textContent.includes('skipped'));assert.ok(fs.existsSync(path.join(folder,'photo.png')));
 await move();await lib.getByRole('dialog',{name:'Name clash',exact:true}).getByRole('button',{name:'Keep both',exact:true}).click();dialog=lib.getByRole('dialog',{name:'Move photos',exact:true});assert.ok((await dialog.innerText()).includes('Move 1 photos') && (await dialog.innerText()).includes(target));await dialog.getByRole('button',{name:'Move photos',exact:true}).click();
 await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===1);assert.ok(!fs.existsSync(path.join(folder,'photo.png'))&&fs.existsSync(path.join(target,'photo (2).png')));
 await lib.locator('#library-undo').click();await cell('photo.png').waitFor();assert.ok(fs.existsSync(path.join(target,'photo.png')));assert.deepEqual(errors,[]);
 console.log('PASS: rename fixed extension/clash/Unicode/Undo; move chooser, all clash answers, count/destination confirmation and Undo on disposable photos.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
