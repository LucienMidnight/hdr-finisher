/* Focused filter UI acceptance: synthetic metadata over disposable real pictures. */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,".."),output=path.join(root,"output","library-filter-bar");fs.mkdirSync(output,{recursive:true});
const folder=fs.mkdtempSync(path.join(output,"shoot-"));
const photos=[
 {name:"one.png",type:"ARW",camera:"Alpha",iso:400,aperture:2.8,shutter:1/250,focal_length:24,marks:{rating:5,pick:"pick",label:"blue",tags:["Family"]}},
 {name:"two.png",type:"DNG",camera:"Beta",iso:3200,aperture:5.6,shutter:1/30,focal_length:85,edited:true,marks:{rating:3,pick:"unmarked",label:"red",tags:["Travel"]}},
 {name:"three.png",type:"JPG",camera:"Beta",iso:800,aperture:4,shutter:.5,focal_length:35,copy_id:"test-copy",marks:{rating:0,pick:"reject",label:"",tags:[]}},
 {name:"four.png",type:"PNG",marks:{rating:0,pick:"unmarked",label:"",tags:[]}}
].map(p=>({...p,path:path.join(folder,p.name),indexed:true,capture_time:"2026-10-13T12:00:00",library_pins:[folder]}));
for(const p of photos)fs.copyFileSync(path.join(root,"tests/fixtures/sdr_gradient.png"),p.path);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.context().route("**/api/library/scan*",route=>route.fulfill({json:{photos,undo_available:false,unreadable_folders:[]}}));
 await page.context().route("**/api/library/settings-status",route=>route.fulfill({json:{photos:[],events:[]}}));
 await page.context().route("**/api/library/smart-candidates*",route=>route.fulfill({json:{photos,version:"filters",indexing:false}}));
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});const lib=page.frame({url:/\/library(?:\?|$)/});await lib.waitForFunction(()=>window.HDRLibrary);
 await lib.evaluate(folder=>HDRLibrary.browse(folder),folder);await lib.waitForFunction(()=>HDRLibrary.getSnapshot().count===4);
 await lib.locator("#filter-button").click();
 const count=async n=>lib.waitForFunction(n=>HDRLibrary.getSnapshot().count===n,n);
 const open=async name=>{await lib.locator("#filter-add").click();await lib.getByRole("menuitem",{name,exact:true}).click();};
 const apply=async()=>lib.locator("#library-filter-panel").getByRole("button",{name:"Apply",exact:true}).click();
 const clear=async()=>{await lib.locator("#filter-clear").click();await count(4);};
 assert.equal(await lib.locator("#filter-match,#filter-type,#filter-grade").count(),0);
 await lib.locator('#raw-only').click();await count(2);
 await lib.getByRole('button',{name:'3 stars',exact:true}).click();await count(2);
 await lib.getByLabel('Rating comparison',{exact:true}).selectOption('is');await count(1);
 await lib.locator('#filter-clear').click();await count(2);
 assert.equal(await lib.locator('#raw-only').getAttribute('aria-pressed'),'true');
 await lib.locator('#raw-only').click();await count(4);
 await lib.getByRole("button",{name:"3 stars",exact:true}).click();await count(2);
 await lib.getByLabel("Rating comparison",{exact:true}).selectOption("is");await count(1);
 await lib.getByLabel("Rating comparison",{exact:true}).selectOption("at-most");await count(3);
 await lib.getByRole("button",{name:"3 stars",exact:true}).click();await count(4);
 await lib.getByRole("button",{name:"Unrated",exact:true}).click();await count(2);await clear();
 await lib.locator("#filter-pick button[data-value=pick]").click();await count(1);
 await lib.locator("#filter-pick button[data-value=unmarked]").click();await count(3);
 await lib.locator("#filter-label button[data-value=blue]").click();await count(1);
 await lib.getByRole("button",{name:"No label",exact:true}).click();await count(2);await clear();
 await lib.locator("#filter-search").fill("family");await count(1);await clear();
 await open("Camera");assert.deepEqual(await lib.locator("#library-folder-menu .library-menu-header").allTextContents(),["File","Shot with","When"]);
 await lib.getByLabel("Alpha",{exact:true}).check();await lib.getByLabel("Beta",{exact:true}).check();await apply();await count(3);
 await open("ISO");await lib.getByLabel("From ISO",{exact:true}).selectOption("800");await apply();await count(2);
 await lib.getByRole("button",{name:"Edit Camera",exact:true}).click();assert.equal(await lib.getByLabel("Alpha",{exact:true}).isChecked(),true);
 await lib.getByLabel("Beta",{exact:true}).uncheck();await apply();await count(0);
 assert.equal(await lib.locator(".library-rule-chip").count(),2);
 await lib.getByRole("button",{name:"Remove ISO filter",exact:true}).click();await count(1);
 await open("Camera");await page.keyboard.press("Escape");assert.equal(await lib.locator("#filter-add").evaluate(e=>e===document.activeElement),true);await clear();
 await open("File type");await lib.getByRole("button",{name:"Select all RAW file types",exact:true}).click();await apply();await count(2);await clear();
 for(const [name,from,to,n] of [["Focal length","24","35",2],["Aperture","2.8","4",2],["Shutter speed",String(1/30),"",2]]){
  await open(name);await lib.getByLabel(`From ${name}`,{exact:true}).selectOption(from);if(to)await lib.getByLabel(`To ${name}`,{exact:true}).selectOption(to);await apply();await count(n);await clear();
 }
 for(const name of ["Edited","Virtual copy"]){await open(name);await lib.getByLabel(name,{exact:true}).selectOption(name==="Edited"?"edited":"virtual copy");await apply();await count(1);await clear();}
 await open("Capture date");await lib.getByRole("button",{name:"Last 7 days",exact:true}).click();assert.ok(await lib.getByLabel("From Capture date",{exact:true}).inputValue());await page.keyboard.press("Escape");
 await open("Capture date");await lib.getByLabel("From Capture date",{exact:true}).fill("2026-10-13");await lib.getByLabel("To Capture date",{exact:true}).fill("2026-10-13");await apply();await count(4);await clear();
 await open("Tag");await lib.getByLabel("No tags",{exact:true}).check();await apply();await count(2);await clear();
 await open("Camera");await lib.getByLabel("Alpha",{exact:true}).check();await lib.getByLabel("Beta",{exact:true}).check();await apply();await count(3);
 await lib.locator("#raw-only").click();await count(2);
 await lib.locator("#filter-save-smart").click();const editor=lib.getByRole("dialog",{name:"New smart album",exact:true});
 assert.equal(await editor.getByLabel("Comparison",{exact:true}).inputValue(),"in");assert.equal(await editor.getByLabel("Alpha",{exact:true}).isChecked(),true);assert.equal(await editor.getByLabel("Beta",{exact:true}).isChecked(),true);
 assert.equal(await editor.getByText(/Required:/).count(),0);await editor.getByText("3 matching photos",{exact:true}).waitFor();await editor.getByLabel("Beta",{exact:true}).uncheck();await editor.getByText("1 matching photos",{exact:true}).waitFor();await editor.getByRole("button",{name:"Cancel",exact:true}).click();
 await page.screenshot({path:path.join(output,"filter-bar.png")});
 assert.deepEqual(errors,[]);console.log("PASS: fixed controls, grouped lists, RAW shortcut, ranges, dates, yes/no, chip editing/removal, Escape focus, smart multi-tick transfer and live counting.");
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
