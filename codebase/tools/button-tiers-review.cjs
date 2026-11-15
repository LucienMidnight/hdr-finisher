// Focused real-Electron geometry/crop review; run through gpu-run-lock.py.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('output/review/button-tiers');fs.mkdirSync(out,{recursive:true});
const records=[],issues=[],shots=[];
function geometry(e){
 const r=e.getBoundingClientRect(),s=getComputedStyle(e,'::before'),p=e.parentElement.getBoundingClientRect();
 let offset={x:0,y:0};if(e.ownerDocument.defaultView.frameElement){const f=e.ownerDocument.defaultView.frameElement.getBoundingClientRect();offset={x:f.x,y:f.y};}
 return {centreError:Math.abs(r.y+r.height/2-p.y-p.height/2),x:r.x+offset.x,y:r.y+offset.y,width:r.width,height:r.height,parent:{x:p.x+offset.x,y:p.y+offset.y,width:p.width,height:p.height},glyph:{width:parseFloat(s.width)||0,height:parseFloat(s.height)||0,align:getComputedStyle(e).alignItems,justify:getComputedStyle(e).justifyItems},hit:e.contains(e.ownerDocument.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
}
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:2560,height:1440}});
 await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:'networkidle'});
 const library=page.frameLocator('#library-frame');
 await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=192;c.height=128;const x=c.getContext('2d');x.fillStyle='#889aaf';x.fillRect(0,0,192,128);x.fillStyle='#222';x.fillRect(94,62,4,4);await importByteFile(new File([await new Promise(r=>c.toBlob(r))],'button-tiers.png',{type:'image/png'}));});
 await page.waitForFunction(()=>state.session&&!state.importInProgress&&document.body.dataset.workflow==='grade');
 const settle=()=>page.evaluate(()=>document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 const crop=async(name,loc)=>{await loc.screenshot({path:path.join(out,name+'.png')});shots.push(name+'.png');};
 const measure=async(theme,label,loc,size)=>{const g=await loc.evaluate(geometry);records.push({theme,label,...g});if(size===30&&/(expanded|collapsed)$/.test(label)&&(g.glyph.width!==14||g.glyph.height!==14||g.glyph.align!=='center'||g.glyph.justify!=='center'))issues.push({theme,label,reason:'chevron centring or size',g});if((label.includes('local-')||label.startsWith('retouch-action'))&&g.centreError>1)issues.push({theme,label,reason:'row centring',g});if(Math.abs(g.width-size)>0.1||Math.abs(g.height-size)>0.1||!g.hit)issues.push({theme,label,reason:'size or hit target',g});return g;};
 for(const theme of ['modern-dark','default-light','studio-gray']){
  await page.evaluate(t=>{HDRApplicationShell.openSettings('appearance');document.querySelector(`[data-theme-option="${t}"]`).click();},theme);await page.locator('#settings-close').click();
  await library.locator('html').evaluate((e,t)=>new Promise(r=>{const f=()=>e.dataset.theme===t?r():requestAnimationFrame(f);f();}),theme);
  for(const workflow of ['import','grade','proof','export']){
   await page.evaluate(w=>activateWorkflowTab(w),workflow);
   if(workflow==='export')await page.evaluate(async p=>{await desktop.grantSourcePath(p);await batchExport.open([p],{fromLibrary:true});},path.resolve('tests/fixtures/sdr_gradient.png'));
   const loc=workflow==='import'?library.locator('#collapse-left'):page.locator(workflow==='export'?'#batch-presets-collapse':'#source-rail-expand');
   const head=workflow==='import'?library.locator('.library-panel-heading'):page.locator(workflow==='export'?'.batch-preset-rail .workflow-rail-header':'.source-rail .rail-title-row');
   for(const collapsed of [false,true]){
    if(await loc.getAttribute('aria-expanded')!==String(!collapsed))await loc.click();await settle();
    await measure(theme,`${workflow}-${collapsed?'collapsed':'expanded'}`,loc,30);
    await crop(`${theme}-${workflow}-${collapsed?'collapsed':'expanded'}`,head);
   }
   await loc.click();await settle();
   if(workflow==='grade'||workflow==='proof'){
    const dock=page.locator('#dock-collapse');
    for(const collapsed of [false,true]){if(await dock.getAttribute('aria-expanded')!==String(!collapsed))await dock.click();await settle();await measure(theme,`${workflow}-scopes-${collapsed?'collapsed':'expanded'}`,dock,30);await crop(`${theme}-${workflow}-scopes-${collapsed?'collapsed':'expanded'}`,page.locator('.dock-bar'));}
    await dock.click();
   }
   if(workflow==='export'){
    await measure(theme,'export-header-menu',page.locator('.batch-preset-rail .workflow-rail-header .top-icon-button'),30);
    const card=page.locator('.batch-preset-row').first();await measure(theme,'export-card-menu',card.locator('.top-icon-button'),26);
    const name=await card.locator('strong').evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
    const menu=await card.locator('.top-icon-button').evaluate(geometry);
    // The strong block reserves the menu column; inspect the actual name ink.
    const ink=await card.locator('strong').evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};});
    records.push({theme,label:'card-name',name,ink,menu});if(ink.x+ink.width>menu.x-1||Math.abs(ink.y+ink.height/2-menu.y-menu.height/2)>1)issues.push({theme,label:'card-name',ink,menu});
    await crop(`${theme}-export-cards`,page.locator('#batch-preset-list'));
    const original=await card.locator('strong').textContent();await card.locator('strong').evaluate(e=>e.textContent='A very long export preset name that must leave room for its actions');const long=await card.locator('strong').evaluate(e=>{const r=e.getBoundingClientRect();return {right:r.right,scroll:e.scrollWidth,client:e.clientWidth,overflow:getComputedStyle(e).textOverflow};});records.push({theme,label:'long-card-name',...long});if(long.right>menu.x-1||long.overflow!=='ellipsis')issues.push({theme,label:'long-card-name',long,menu});await crop(`${theme}-export-long-name`,card);await card.locator('strong').evaluate((e,t)=>e.textContent=t,original);
    await measure(theme,'output-version-menu',page.locator('.batch-version-row .top-icon-button'),26);
    await crop(`${theme}-output-version`,page.locator('.batch-version-row'));
    await card.locator('.top-icon-button').click();await settle();await crop(`${theme}-open-menu`,page.locator('[role="menu"]').last());await page.keyboard.press('Escape');
   }
  }
  await page.evaluate(()=>{activateWorkflowTab('grade');setGradeMode('global');});
  const preset=page.locator('[data-group="curves"] .group-preset');await preset.scrollIntoViewIfNeeded();await measure(theme,'grade-preset',preset,26);await measure(theme,'grade-eye',page.locator('[data-group="curves"] .section-bypass'),26);
  await page.evaluate(()=>setGradeMode('local'));if(!await page.locator('#local-adjustment-list > li').count())await page.locator('[data-local-tool="brush"]').click();
  const local=page.locator('#local-adjustment-list > li').first();await local.scrollIntoViewIfNeeded();for(const selector of ['.local-adjustment-menu-button','.local-adjustment-bypass'])await measure(theme,'local-'+selector,local.locator(selector),26);await crop(`${theme}-local-row`,local);
  await page.keyboard.press('Escape');await page.evaluate(()=>setGradeMode('retouch'));
  if(!await page.locator('#retouch-list > li').count()){
   if(!await page.evaluate(()=>retouchUI.active))await page.locator('#retouch-mode-inpaint').click();
   const point=await page.evaluate(()=>{const r=activePreviewElement().getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>!retouchUI.busy&&state.editDocument.repairs.length>0,null,{timeout:60000});
  }
  const retouch=page.locator('#retouch-list > li').first();await retouch.scrollIntoViewIfNeeded();const actions=retouch.locator('button:not(.local-adjustment-select)');for(let i=0;i<await actions.count();i++)await measure(theme,'retouch-action-'+i,actions.nth(i),26);await crop(`${theme}-retouch-row`,retouch);
 }
 for(const theme of ['modern-dark','default-light','studio-gray'])for(const state of ['expanded','collapsed']){const rows=records.filter(r=>r.theme===theme&&['import','grade','proof','export'].some(w=>r.label===`${w}-${state}`));for(const axis of ['x','y'])if(Math.max(...rows.map(r=>r[axis]))-Math.min(...rows.map(r=>r[axis]))>1)issues.push({theme,state,axis,rows});}
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({conditions:{machine:'Windows PC',viewport:'2560x1440',positionTolerance:1},records,issues},null,2));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>Button tiers</title><style>body{font:14px system-ui}figure{display:inline-block;vertical-align:top}img{max-width:640px}figcaption{max-width:640px}</style><h1>Button tier review</h1>'+shots.map(f=>`<figure><figcaption>${f}</figcaption><img src="${f}"></figure>`).join(''));
 console.log(JSON.stringify({records:records.length,issues},null,2));assert.equal(issues.length,0,'geometry issues');
}finally{fs.writeFileSync(path.join(out,'partial.json'),JSON.stringify({records,issues},null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
