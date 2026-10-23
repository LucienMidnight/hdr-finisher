/* Native Clone/Heal gestures plus an optional real-RAW comparison.
 * Reads owner files; import and autosave are confined to disposable copies.
 */
const {chromium}=require("playwright");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const output=path.resolve("output/retouch-transfer");fs.mkdirSync(output,{recursive:true});
const source=process.env.HDR_FINISHER_RETOUCH_PHOTO;
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
(async()=>{
 const browser=await chromium.launch();const page=await browser.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto(process.env.HDR_FINISHER_URL||"http://127.0.0.1:8765",{waitUntil:"networkidle"});
  const data=await page.evaluate(()=>{
   const c=document.createElement("canvas");c.width=512;c.height=384;
   const ctx=c.getContext("2d"),d=ctx.createImageData(512,384);
   for(let y=0;y<384;y++)for(let x=0;x<512;x++){
    const v=(x<256?90:170)+((x+y)%2?8:-8),i=(y*512+x)*4;
    d.data[i]=v;d.data[i+1]=v;d.data[i+2]=v;d.data[i+3]=255;
   }
   ctx.putImageData(d,0,0);return c.toDataURL().split(",")[1];
  });
  await page.locator("#file-input").setInputFiles({name:"transfer-texture.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")});
  await page.waitForFunction(()=>state.session&&!state.importInProgress&&state.gpuPreview?.lastPresentedFrame,null,{timeout:120000});
  // The same six compact rows and permanent rail are used by both panels.
  await page.locator("#grade-mode-local").click();
  const localLayout = await page.evaluate(() => {
    const surface=document.querySelector("#local-adjustments-panel > .local-stack-surface");
    const list=document.getElementById("local-adjustment-list"), style=getComputedStyle(surface);
    return {height:surface.clientHeight, overflow:style.overflowY, rail:style.getPropertyValue("scrollbar-gutter"), nested:getComputedStyle(list).overflowY};
  });
  assert.equal(localLayout.height,192);assert.equal(localLayout.overflow,"scroll");assert.equal(localLayout.nested,"visible");
  await page.locator("#grade-mode-retouch").click();
  const repairLayout = await page.evaluate(() => {
    const surface=document.querySelector(".repair-stack-surface"), tools=document.querySelector(".retouch-mode-switch");
    return {height:surface.clientHeight,overflow:getComputedStyle(surface).overflowY,above:surface.getBoundingClientRect().bottom<=tools.getBoundingClientRect().top};
  });
  assert.equal(repairLayout.height,localLayout.height);assert.equal(repairLayout.overflow,"scroll");assert(repairLayout.above);
  await page.locator("#retouch-brush").click();
  const screen=point=>page.evaluate(p=>{const r=activePreviewElement().getBoundingClientRect(),q=sourcePointToDisplay(p);return{x:r.left+q.x*r.width,y:r.top+q.y*r.height};},point);
  const altClick=async p=>{await page.keyboard.down("Alt");try{await page.mouse.click(p.x,p.y);}finally{await page.keyboard.up("Alt");}};
  const paint=async(point,drag=false,count=1)=>{
   const p=await screen(point);await page.mouse.move(p.x,p.y);await page.mouse.down();
   if(drag)await page.mouse.move(p.x+8,p.y,{steps:4});
   await page.mouse.up();
   await page.waitForFunction(n=>!retouchUI.busy&&state.editDocument.repairs.length===n,count,{timeout:60000});
  };
  const settled=async()=>{
   await page.waitForFunction(()=>!state.gpuDraftInFlight&&state.gpuPreview?.lastPresentedFrame?.applicationGeneration===state.previewGeneration[state.currentView],null,{timeout:60000});
  };
  const meanAt=async point=>{
   await settled();await page.evaluate(()=>{retouchUI.active=false;renderLocalMaskOverlay();});
   const p=await screen(point),png=await page.screenshot({clip:{x:Math.floor(p.x)-8,y:Math.floor(p.y)-8,width:16,height:16}});
   const v=await page.evaluate(async b=>{const im=new Image();im.src=`data:image/png;base64,${b}`;await im.decode();const c=document.createElement("canvas");c.width=c.height=16;const ctx=c.getContext("2d");ctx.drawImage(im,0,0);const rgba=ctx.getImageData(0,0,16,16).data;let sum=0;for(let i=0;i<rgba.length;i+=4)sum+=rgba[i];return sum/256;},png.toString("base64"));
   await page.evaluate(()=>{retouchUI.active=true;renderLocalMaskOverlay();});return v;
  };
  const target={x:.625,y:.5},donor={x:.25,y:.5};
  const baseline=await meanAt(target);
  await page.locator("#retouch-mode-clone").click();
  assert(await page.locator("#retouch-source-controls").isVisible());
  assert(!(await page.locator("#retouch-method").isVisible()));
  // Painting without a source must not create a repair or history entry.
  const initial=await page.evaluate(()=>state.editRevision),p=await screen(target);
  await page.mouse.click(p.x,p.y);
  assert.equal(await page.evaluate(()=>state.editRevision),initial);
  await page.locator("#retouch-source-pick").click();
  const d=await screen(donor);await page.mouse.click(d.x,d.y);
  assert.equal(await page.evaluate(()=>state.editRevision),initial,"source pick created history");
  await page.locator("#retouch-size").fill("40");await paint(target,true);
  assert.equal(await page.evaluate(()=>state.editDocument.repairs[0].recipe.mode),"clone");
  assert(await page.evaluate(()=>state.editDocument.repairs[0].recipe.points.length>1));
  const cloned=await meanAt(target);assert(cloned<baseline-20,`clone did not copy source ${baseline} -> ${cloned}`);
  assert.equal(await page.getByRole("button",{name:"Retry Spot 1",exact:true}).count(),0);
  // Full reload and bounded source refresh must agree on the same source copy.
  await page.evaluate(async()=>{state.gpuPreview.resetSession(state.session.session_id);await renderGpuDraft(state.currentView,{longEdge:settledProxyLongEdge(),tier:"settled"});});
  assert.equal(await meanAt(target),cloned);
  await page.locator("#retouch-opacity").fill("0");await page.locator("#retouch-apply").click();
  await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs[0].recipe.strength===0);
  assert.equal(await meanAt(target),baseline,"zero-opacity clone changed the picture");
  await page.evaluate(()=>queueEditCommand("undo"));assert.equal(await meanAt(target),cloned);
  assert.equal(await page.locator("#retouch-opacity").inputValue(),"100","undo did not restore controls");
  await page.getByRole("button",{name:"Remove Spot 1",exact:true}).click();
  await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length===0);
  await page.locator("#retouch-mode-heal").click();
  // Alt-click is the second source-selection path.
  await altClick(d);
  assert.equal(await page.evaluate(()=>state.editDocument.repairs.length),0,"source pick painted a repair");
  await page.locator("#retouch-opacity").fill("100");await paint(target);
  const healed=await meanAt(target);assert(Math.abs(healed-baseline)<=2,`heal did not match boundary tone ${baseline} -> ${healed}`);
  await page.evaluate(()=>queueEditCommand("undo"));assert.equal(await page.evaluate(()=>state.editDocument.repairs.length),0);
  await page.evaluate(()=>queueEditCommand("redo"));assert.equal(await page.evaluate(()=>state.editDocument.repairs[0].recipe.mode),"heal");
  // Edit the source of an already placed repair and save the new location.
  const changed=await screen({x:.3,y:.5});await altClick(changed);
  await page.locator("#retouch-apply").click();await page.waitForFunction(()=>!retouchUI.busy);
  assert(Math.abs(await page.evaluate(()=>state.editDocument.repairs[0].recipe.source_point.x)-.3)<.002);
  // Switching tools starts a new stroke, retaining each brush's source/settings.
  const savedHeal=await page.evaluate(()=>JSON.stringify(state.editDocument.repairs[0]));
  await page.locator("#retouch-mode-clone").click();
  assert.equal(await page.evaluate(()=>retouchUI.selected),null);
  assert.equal(await page.locator("#retouch-size").inputValue(),"40");
  assert.equal(await page.evaluate(()=>retouchUI.active),true);
  await paint({x:.7,y:.6},false,2);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.editDocument.repairs[0])),savedHeal,"new Clone altered saved Heal");
  await page.locator("#retouch-mode-inpaint").click();
  await page.locator("#retouch-size").fill("12");await paint({x:.75,y:.7},false,3);
  assert.deepEqual(await page.evaluate(()=>state.editDocument.repairs.map(r=>r.recipe.mode)),["heal","clone","inpaint"]);
  assert.equal(await page.locator("#retouch-list > li").count(),3);
  await page.locator("#retouch-mode-heal").click();
  assert.equal(await page.evaluate(()=>retouchUI.selected),null);
  assert(Math.abs(await page.evaluate(()=>retouchUI.source.x)-.3)<.002,"Heal lost its own source");
  assert.equal(await page.locator("#retouch-apply").isDisabled(),true);
  // Check six-row fit and seventh-row scrolling with presentation-only rows.
  await page.evaluate(()=>{
    const list=document.getElementById("retouch-list");
    while(list.children.length<7){const row=list.firstElementChild.cloneNode(true);row.dataset.layoutFixture="true";list.append(row);}
  });
  const rows=await page.evaluate(()=>{
    const surface=document.querySelector(".repair-stack-surface"),r=[...document.querySelectorAll("#retouch-list > li")].map(el=>el.getBoundingClientRect());
    return {sixFit:r[5].bottom<=surface.getBoundingClientRect().bottom,seventhBelow:r[6].bottom>surface.getBoundingClientRect().bottom,heights:r.map(x=>x.height)};
  });
  assert(rows.sixFit&&rows.seventhBelow);assert(rows.heights.every(h=>h===32));
  await page.screenshot({path:path.join(output,"compact-repairs-ui.png")});
  await page.evaluate(()=>document.querySelectorAll("[data-layout-fixture]").forEach(row=>row.remove()));
  await page.screenshot({path:path.join(output,"synthetic-heal-ui.png")});
  console.log("PASS: Clone/Heal source picking, drag, source editing, opacity, history and GPU refresh",{baseline,cloned,healed});
  if(source){
   const sidecar=source+".hdrf",beforeHash=hash(source),beforeSidecarHash=fs.existsSync(sidecar)?hash(sidecar):null;
   const saved=beforeSidecarHash?JSON.parse(fs.readFileSync(sidecar,"utf8")).grade:null;
   const scratch=fs.mkdtempSync(path.join(output,"photo-")),copy=path.join(scratch,path.basename(source));fs.copyFileSync(source,copy);
   await page.evaluate(async({photo,rawSettings,adjustments})=>{
    const grant=await desktop.grantSourcePath(photo);
    const created=await projectIo.createImportJob(fetch,{grant:grant.grant,rawImportSettings:rawSettings});
    let job=created.payload;if(!created.response.ok)throw Error(JSON.stringify(job));
    while(!["ready","error","cancelled"].includes(job.state)){await new Promise(r=>setTimeout(r,100));job=(await projectIo.pollImportJob(fetch,job.job_id)).payload;}
    if(job.state!=="ready")throw Error(JSON.stringify(job));
    await activateDesktopSession((await projectIo.fetchSession(fetch,job.session_id)).payload.session,"");
    if(adjustments&&!await queueEditCommand("set_global_adjustments",{adjustments}))throw Error("Saved grade was not applied");
   },{photo:copy,rawSettings:saved?.source.raw_import_settings,adjustments:saved?.global_adjustments});
   await page.waitForFunction(()=>state.gpuPreview?.lastPresentedFrame&&!state.importInProgress,null,{timeout:120000});
   await page.locator("#grade-mode-retouch").click();await page.locator("#retouch-brush").click();
   const spot={x:.81,y:.424},clean={x:.77,y:.43};
   await page.evaluate(async spot=>{
    setCustomZoom(100);await new Promise(requestAnimationFrame);
    const r=activePreviewElement().getBoundingClientRect(),z=els.dropzone.getBoundingClientRect(),p=sourcePointToDisplay(spot);
    els.dropzone.scrollLeft+=r.left+p.x*r.width-z.left-z.width/2;
    els.dropzone.scrollTop+=r.top+p.y*r.height-z.top-z.height/2;
    await new Promise(requestAnimationFrame);
    await renderGpuDraft(state.currentView,{longEdge:settledProxyLongEdge(),tier:"settled"});
   },spot);
   await settled();
   const capture=async name=>{
    await settled();await page.evaluate(()=>{retouchUI.active=false;renderLocalMaskOverlay();});
    const p=await screen(spot);assert(p.x>270&&p.y>210,"spot is outside comparison crop");
    await page.screenshot({path:path.join(output,`photo-${name}.png`),clip:{x:Math.floor(p.x)-260,y:Math.floor(p.y)-200,width:520,height:400}});
    await page.evaluate(()=>{retouchUI.active=true;renderLocalMaskOverlay();});
   };
   await capture("before");
   await page.locator("#retouch-size").fill("166");await page.locator("#retouch-feather").fill("71");await page.locator("#retouch-opacity").fill("100");
   const timings=[];
   for(const mode of ["clone","heal"]){
    await page.locator(`#retouch-mode-${mode}`).click();
    const q=await screen(clean);await altClick(q);
    const started=Date.now();await paint(spot);await settled();timings.push({mode,paintToFrameMs:Date.now()-started});
    await capture(mode);await page.screenshot({path:path.join(output,`photo-${mode}-ui.png`)});
    await page.evaluate(()=>queueEditCommand("undo"));await settled();
   }
   assert.equal(hash(source),beforeHash,"owner RAW changed");
   if(beforeSidecarHash)assert.equal(hash(sidecar),beforeSidecarHash,"owner grade changed");
   fs.writeFileSync(path.join(output,"photo-result.json"),JSON.stringify({source,usedSavedGrade:Boolean(saved),existingRepairsOmitted:saved?.repairs.length||0,spot,clean,size:166,feather:71,opacity:100,timings,ownerFilesUnchanged:true},null,2));
   fs.writeFileSync(path.join(output,"comparison.html"),`<!doctype html><meta charset="utf-8"><title>Clone and Heal · DSC00264</title><style>body{background:#171c20;color:#eee;font:16px system-ui;margin:24px}main{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}img{width:520px;max-width:100%}figcaption{padding:12px 0}</style><h1>Clone and Heal · DSC00264.ARW</h1><p>Saved grade applied; existing repairs omitted. Same source and destination, 166 px, 71% feather, 100% opacity.</p><main><figure><img src="photo-before.png"><figcaption>Before · original dark spot</figcaption></figure><figure><img src="photo-clone.png"><figcaption>Clone · direct source copy</figcaption></figure><figure><img src="photo-heal.png"><figcaption>Heal · source texture with boundary tone matching</figcaption></figure></main>`);
   console.log("PASS: supplied ARW with saved grade; owner files unchanged",timings);
  }
  assert.deepEqual(errors,[]);
 }catch(error){
  await page.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
  console.error(await page.evaluate(()=>({status:document.getElementById("retouch-status").textContent,mode:retouchUI.mode,source:retouchUI.source,repairs:state.editDocument?.repairs})).catch(()=>null));
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
