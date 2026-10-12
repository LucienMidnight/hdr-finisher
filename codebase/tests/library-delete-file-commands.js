const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','library-delete-file-commands');fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(out,'shoot-')),a=path.join(folder,'delete.png'),b=path.join(folder,'keep.png'),c=path.join(folder,'rejected.png');
for(const p of [a,b,c])fs.copyFileSync(path.join(root,'tests','fixtures','sdr_gradient.png'),p);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
 await lib.evaluate(async ({folder,a,b,c})=>{
  const post=async(route,data)=>{const r=await fetch('/api/library/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(await r.text());return r.json();};
  await post('pins',{paths:[folder]});await post('marks',{paths:[a,c],change:{pick:'reject',rating:4}});
  await post('virtual-copies',{paths:[a],action:'create',start:'clean',name:'Attached'});await post('virtual-copies',{paths:[b],action:'create',start:'clean',name:'Separate'});
 },{folder,a,b,c});
 await lib.goto(new URL('/library',process.env.HDR_FINISHER_URL).href);await lib.waitForFunction(()=>window.HDRLibrary);await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);
 const cell=name=>lib.locator('#grid-space .library-cell').filter({has:lib.locator('.name',{hasText:new RegExp('^'+name.replaceAll('.','\\.')+'$')})}).first();
 await cell('delete.png').click();await cell('keep.png · Separate').click({modifiers:['Control']});
 // Exercise the no-Bin wording without falsely deleting a local file under a
 // simulated route. Cancel proves that this confirmation changes nothing.
 await page.route('**/api/library/file-command',async route=>{
  const data=route.request().postDataJSON();if(data.action==='delete'&&!data.token){const r=await HDRFinisherElectronTestHarness.fetch(route.request().url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),body=await r.json();assert.equal(r.status,200);body.permanent=body.count;body.recycle=0;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});}else await route.continue();
 });
 await cell('delete.png').click({button:'right'});await lib.locator('#library-folder-menu button').filter({hasText:/^Delete…Del$/}).click();let dialog=lib.getByRole('dialog',{name:'Delete photos',exact:true});await dialog.waitFor({timeout:5000}).catch(async e=>{throw new Error(e.message+'; Library status: '+await lib.locator('#library-status').innerText());});let text=await dialog.innerText();
 assert.ok(text.includes('1 photos')&&text.includes('settings, grades and 1 attached virtual copies')&&text.includes('1 separately selected virtual copies')&&text.includes('original photos stay on disk')&&text.includes('There is no Recycle Bin')&&text.includes('gone for good'));
 assert.equal(await dialog.getByRole('button',{name:'Delete permanently',exact:true}).count(),1);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(fs.existsSync(a)&&fs.existsSync(b));await page.unroute('**/api/library/file-command');
 await lib.locator('body').press('Delete');dialog=lib.getByRole('dialog',{name:'Delete photos',exact:true});text=await dialog.innerText();assert.ok(text.includes('1 photos and their settings go to the Recycle Bin')&&text.includes('Restore both entries'));
 await dialog.getByRole('button',{name:'Move to Recycle Bin',exact:true}).click();await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===2);assert.ok(!fs.existsSync(a)&&!fs.existsSync(a+'.hdrf')&&fs.existsSync(b),JSON.stringify({a:fs.existsSync(a),side:fs.existsSync(a+'.hdrf'),b:fs.existsSync(b),status:await lib.locator('#library-status').innerText(),snapshot:await lib.evaluate(()=>HDRLibrary.getSnapshot())}));
 await lib.locator('#filter-button').click();await lib.getByLabel('Pick status',{exact:true}).selectOption('hide-rejected');await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===1);
 await lib.getByRole('button',{name:'More',exact:true}).click();await lib.getByRole('menuitem',{name:'Delete all rejected…',exact:true}).click();dialog=lib.getByRole('dialog',{name:'Delete all rejected',exact:true});text=await dialog.innerText();assert.ok(text.includes('1 photos')&&text.includes('even when hidden by the current filters'));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.ok(fs.existsSync(c));
 await lib.getByRole('button',{name:'More',exact:true}).click();await lib.getByRole('menuitem',{name:'Delete all rejected…',exact:true}).click();await lib.getByRole('dialog',{name:'Delete all rejected',exact:true}).getByRole('button',{name:'Move to Recycle Bin',exact:true}).click();await lib.waitForFunction(()=>document.querySelector('#library-status').textContent.includes('1 photos deleted'));assert.ok(!fs.existsSync(c)&&!fs.existsSync(c+'.hdrf')&&fs.existsSync(b));assert.deepEqual(errors,[]);
 console.log('PASS: mixed selection counts/settings/grades/copies, no-Bin permanent warning and Cancel, actual Bin deletion via Delete key, and Delete all rejected including filtered-out originals. Disposable PNGs only.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
