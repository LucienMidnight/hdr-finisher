const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,".."),out=path.join(root,"output","library-folder-controls");fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(out,"shoot-")),newName="เที่ยว";fs.copyFileSync(path.join(root,"tests","fixtures","sdr_gradient.png"),path.join(folder,"photo.png"));
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
 await lib.evaluate(async folder=>{await fetch("/api/library/pins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paths:[folder]})});},folder);
 await lib.goto(new URL("/library",process.env.HDR_FINISHER_URL).href);await lib.waitForFunction(()=>window.HDRLibrary && HDRLibrary.getSnapshot().count===1);
 const row=()=>lib.locator('.library-folder-row[data-path]').filter({hasText:path.basename(folder)}).first();
 await row().click({button:"right"});await lib.getByRole("menuitem",{name:"New folder inside…",exact:true}).click();
 await lib.locator('.library-ask input[name="name"]').fill(newName);await lib.getByRole("button",{name:"Create folder",exact:true}).click();
 await lib.waitForFunction(()=>document.querySelector("#library-status").textContent.includes("created"));assert.ok(fs.existsSync(path.join(folder,newName)));
 await lib.locator("#library-undo").click();for(let i=0;i<100 && fs.existsSync(path.join(folder,newName));i++)await new Promise(r=>setTimeout(r,50));assert.ok(!fs.existsSync(path.join(folder,newName)));
 await row().click({button:"right"});await lib.getByRole("menuitem",{name:"Rename label…",exact:true}).click();await lib.locator('.library-ask input[name="name"]').fill("Disposable shoot");await lib.getByRole("button",{name:"Save label",exact:true}).click();
 await lib.getByRole("button",{name:"Disposable shoot",exact:true}).waitFor();assert.ok(fs.existsSync(folder));await lib.locator("#library-undo").click();await lib.getByRole("button",{name:path.basename(folder),exact:true}).waitFor();
 await row().click({button:"right"});assert.equal(await lib.getByRole("menuitem",{name:"Show in Explorer",exact:true}).count(),1);await page.keyboard.press("Escape");
 assert.deepEqual(errors,[]);console.log("PASS: Unicode folder, safe empty-folder Undo, pin label and Undo, Explorer entry on disposable shoot.");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
