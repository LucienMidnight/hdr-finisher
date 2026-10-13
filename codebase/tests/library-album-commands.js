const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,".."),out=path.join(root,"output","library-album-commands");fs.mkdirSync(out,{recursive:true});
const folder=fs.mkdtempSync(path.join(out,"shoot-")),offline=fs.mkdtempSync(path.join(out,"offline-"));
const photos=[path.join(folder,"one.png"),path.join(folder,"two.png")],disconnected=path.join(offline,"offline.png");
for(const p of [...photos,disconnected])fs.copyFileSync(path.join(root,"tests","fixtures","sdr_gradient.png"),p);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
 const api=(route,body)=>lib.evaluate(async({route,body})=>{const r=await fetch("/api/library/"+route,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(await r.text());return r.json();},{route,body});
 await api("pins",{paths:[folder,offline]});await api("scan",{path:folder});await api("scan",{path:offline});
 await api("marks",{paths:[photos[0],disconnected],change:{rating:5}});await api("albums/create",{name:"Manual",paths:photos});await api("albums/create",{name:"Offline",paths:[disconnected]});
 await api("smart-albums",{action:"create",name:"Five stars",filters:{rules:[{field:"rating",op:"is",value:5}]}});
 await api("pins/remove",{path:offline});fs.renameSync(offline,offline+"-unplugged");
 await lib.goto(new URL("/library",process.env.HDR_FINISHER_URL).href);await lib.waitForFunction(()=>window.HDRLibrary&&HDRLibrary.getSnapshot().count===2);
 const manual=name=>lib.locator('#albums').getByRole("button",{name,exact:true}),smart=name=>lib.locator('#smart-albums').getByRole("button",{name,exact:true});
 const action=async(row,label)=>{await row.click({button:"right"});await lib.getByRole("menuitem",{name:label,exact:true}).click();};
 const undo=async()=>{await lib.locator('#library-undo').click();};
 // Edit already exists and is reachable by keyboard as well as right-click.
 await smart("Five stars").focus();await smart("Five stars").press("Shift+F10");await lib.getByRole("menuitem",{name:"Edit rules and name…",exact:true}).click();await lib.getByRole("dialog",{name:"Edit smart album",exact:true}).getByRole("button",{name:"Cancel",exact:true}).click();
 await action(manual("Manual"),"Duplicate");let dialog=lib.getByRole("dialog",{name:"Duplicate Album",exact:true});assert.equal(await dialog.getByLabel("Album name").inputValue(),"Copy of Manual");await dialog.getByLabel("Album name").fill("Hand-edited name");await dialog.getByRole("button",{name:"Duplicate",exact:true}).click();await manual("Hand-edited name").waitFor();assert.equal((await api("albums")).albums.find(a=>a.name==="Hand-edited name").count,2);await undo();await manual("Hand-edited name").waitFor({state:"detached"});
 await action(manual("Manual"),"Duplicate");dialog=lib.getByRole("dialog",{name:"Duplicate Album",exact:true});await dialog.getByRole("button",{name:"Duplicate",exact:true}).click();await manual("Copy of Manual").waitFor();await action(manual("Manual"),"Duplicate");dialog=lib.getByRole("dialog",{name:"Duplicate Album",exact:true});assert.equal(await dialog.getByLabel("Album name").inputValue(),"Copy of Manual (2)");await dialog.getByRole("button",{name:"Cancel",exact:true}).click();await undo();await manual("Copy of Manual").waitFor({state:"detached"});
 const original=(await api("smart-albums")).albums[0];await action(smart("Five stars"),"Duplicate");dialog=lib.getByRole("dialog",{name:"Duplicate Smart Album",exact:true});assert.equal(await dialog.getByLabel("Album name").inputValue(),"Copy of Five stars");await dialog.getByRole("button",{name:"Duplicate",exact:true}).click();await smart("Copy of Five stars").waitFor();assert.deepEqual((await api("smart-albums")).albums.find(a=>a.name==="Copy of Five stars").filters,original.filters);await undo();await smart("Copy of Five stars").waitFor({state:"detached"});
 await action(smart("Five stars"),"Save as manual album…");dialog=lib.getByRole("dialog",{name:"Save as Manual Album",exact:true});assert.equal(await dialog.getByLabel("Album name").inputValue(),"Copy of Five stars");
 // Membership is captured on confirmation, after this additional match arrives.
 await api("marks",{paths:[photos[1]],change:{rating:5}});await dialog.getByRole("button",{name:"Create manual album",exact:true}).click();await manual("Copy of Five stars").waitFor();assert.equal((await api("albums")).albums.find(a=>a.name==="Copy of Five stars").count,3);assert.deepEqual((await api("smart-albums")).albums,[original]);
 await undo();await manual("Copy of Five stars").waitFor({state:"detached"});assert.equal((await api("albums")).albums.find(a=>a.name==="Manual").count,2);assert.equal((await api("smart-albums")).albums.length,1);
 assert.deepEqual(errors,[]);assert.ok(photos.every(p=>fs.existsSync(p)));console.log("PASS: keyboard Edit, editable manual/smart Duplicate, collision naming, live smart snapshot including offline match, independent source albums, one-step Undo.");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
