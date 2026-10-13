/* Real 155,000-row SQLite index and HTTP endpoint, isolated from Steve's library. */
const assert=require("node:assert/strict"),path=require("node:path"),{spawn}=require("node:child_process");
async function check(page) {
 const root=path.resolve(__dirname,"../.."),child=spawn(path.join(root,".venv/Scripts/python.exe"),[path.join(__dirname,"library-smart-index.py"),"--serve"],{cwd:root,windowsHide:true});
 let output="",failure="";
 const context=page.context(),pattern="**/api/library/{smart-candidates,smart-albums}*";
 child.stderr.on("data",data=>{failure+=data;});
 try {
  const url=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error(`Synthetic index startup timed out: ${failure}`)),60000);
   child.once("exit",code=>{clearTimeout(timer);reject(new Error(`Synthetic server exited ${code}: ${failure}`));});
   child.on("error",error=>{clearTimeout(timer);reject(error);});
   child.stdout.on("data",data=>{output+=data;for(const line of output.split(/\r?\n/)){
    if(line.startsWith('{"url"')){clearTimeout(timer);resolve(JSON.parse(line).url);}
   }});
  });
  const base=new URL(url).origin;
  const deadline=Date.now()+10000;
  while(true){try{if((await fetch(url)).ok)break;}catch(error){if(Date.now()>deadline)throw error;}await new Promise(resolve=>setTimeout(resolve,25));}
  // Keep the fixture on the app origin, where its normal security policy allows workers.
  await context.route("**/smart-editor-test",async route=>{
   const response=await route.fetch({url});
   await route.fulfill({response,body:(await response.text()).replaceAll('src="/','src="/static/')});
  });
  await context.route(pattern,async route=>{
   const target=new URL(route.request().url());
   await route.fulfill({response:await route.fetch({url:base+target.pathname+target.search})});
  });
  await page.goto(new URL("/smart-editor-test",page.url()).href);
  const lib=page;
  await lib.waitForFunction(()=>window.HDRLibrarySmartAlbums);
  const timing=await lib.evaluate(async()=>{
   const smart=HDRLibrarySmartAlbums.create({root:document.querySelector("#albums"),pins:()=>[{path:"D:/Missing",name:"Offline folder"}],api:async url=>(await fetch(url)).json(),status:()=>{}});
   window.largeSmart=smart;
   const s=performance.now();await smart.editor(null,{rules:[{field:"rating",op:"at-least",value:5},{field:"camera",op:"is",value:"trial camera"}]});
   const choice=document.querySelector('[data-rule-value="1"]');choice.value="trial camera";choice.dispatchEvent(new Event("input"));
   return {open_ms:performance.now()-s,loading:document.querySelector(".library-smart-count").textContent,enabled:!document.querySelector('[aria-label="Smart album name"]').disabled};
  });
  assert.ok(timing.open_ms<250,JSON.stringify(timing));assert.equal(timing.loading,"Counting…");assert.equal(timing.enabled,true);
  const dialog=lib.getByRole("dialog",{name:"New smart album",exact:true});
  await dialog.getByLabel("Smart album name",{exact:true}).fill("Large library");
  await dialog.getByText("15,500 matching photos",{exact:true}).waitFor({timeout:60000});
  const edits=await lib.evaluate(async()=>{
   let last=performance.now(),gap=0;const ticker=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;},10);
   const input=document.querySelector('[aria-label="Rule value"]'),s=performance.now();input.value="0";input.dispatchEvent(new Event("input"));
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{clearInterval(watch);reject(new Error("Large count timed out"));},10000);const watch=setInterval(()=>{if(document.querySelector(".library-smart-count").textContent==="155,000 matching photos"){clearInterval(watch);clearTimeout(timeout);resolve();}},10);});
   clearInterval(ticker);return {rule_count_ms:performance.now()-s,max_page_gap_ms:gap};
  });
  assert.ok(edits.max_page_gap_ms<250,JSON.stringify(edits));
  await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
  const warm=await lib.evaluate(async()=>{const s=performance.now();await largeSmart.editor({name:"Large edit",filters:{rules:[{field:"rating",op:"at-least",value:5}]}});return performance.now()-s;});
  assert.ok(warm<250,`warm open ${warm} ms`);
  await lib.getByText("15,500 matching photos",{exact:true}).waitFor();
  await lib.getByRole("button",{name:"Cancel",exact:true}).click();
  // Warm candidates are reused by album open and poll too: no second full response.
  const cache=await lib.evaluate(async()=>{
   const albums=await largeSmart.refresh(),first=await largeSmart.open(albums[0].id),second=await largeSmart.open(albums[0].id),poll=await largeSmart.poll();
   return {size:first.photos.length,unchanged:first.photos===second.photos&&second.photos===poll.photos&&!poll.changed,
    membership:HDRLibraryQuery.apply(first.photos,"name",false,first.filters).length};
  });
  assert.deepEqual(cache,{size:155000,unchanged:true,membership:15500});
  console.log("PASS: real 155,000-row smart editor",JSON.stringify({...timing,warm_open_ms:warm,...edits}));
 }finally {child.kill();await context.unroute("**/smart-editor-test");await context.unroute(pattern);}
}
module.exports={check};
