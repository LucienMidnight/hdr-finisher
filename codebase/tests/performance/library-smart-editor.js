/* Real 155,000-row SQLite index and HTTP endpoint, isolated from Steve's library. */
const fs=require("node:fs"),assert=require("node:assert/strict"),path=require("node:path"),{spawn}=require("node:child_process");
async function check(page) {
 const root=path.resolve(__dirname,"../.."),child=spawn(path.join(root,".venv/Scripts/python.exe"),[path.join(__dirname,"library-smart-index.py"),"--serve"],{cwd:root,windowsHide:true});
 let output="",failure="",pulseTimer,pulseFlight=null,pulseCount=0;const pulseErrors=[];
 // Redirect only the page's app-origin API calls. The worker already fetches the
 // fixture directly; intercepting that request in Electron left its 155,000-photo
 // response undelivered, so the count stayed at "Counting…".
 const context=page.context(),appOrigin=new URL(page.url()).origin;
 const pattern=url=>url.origin===appOrigin&&/^\/api\/library\/(smart-candidates|smart-albums|smart-grid)/.test(url.pathname);
 child.stderr.on("data",data=>{failure+=data;});
 // Worker and request traces, printed only when the count never arrives.
 const trace=[],stamp=()=>Math.round(performance.now());
 const onRequest=kind=>request=>{if(/smart-(candidates|albums)|smart-worker/.test(request.url()))trace.push(`${stamp()} ${kind} ${request.url()} ${request.failure?.()?.errorText||""}`);};
 const onWorker=worker=>{trace.push(`${stamp()} worker ${worker.url()}`);worker.on("close",()=>trace.push(`${stamp()} worker closed`));};
 const onConsole=message=>{if(message.type()==="error"||message.type()==="warning")trace.push(`${stamp()} console ${message.type()} ${message.text()}`);};
 page.on("request",onRequest("request"));page.on("requestfinished",onRequest("finished"));page.on("requestfailed",onRequest("failed"));page.on("worker",onWorker);page.on("console",onConsole);
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
  // Probe the same Python server while it builds and sends the large list.
  // Keep the app memory monitor's existing two-second HTTP deadline.
  pulseTimer=setInterval(()=>{
   if(pulseFlight)return;
   pulseFlight=fetch(`${base}/heartbeat`,{signal:AbortSignal.timeout(2000)})
    .then(async response=>{assert.equal(response.status,200);assert.equal((await response.json()).alive,true);pulseCount++;})
    .catch(error=>pulseErrors.push(error.message)).finally(()=>{pulseFlight=null;});
  },100);
  await context.route("**/smart-editor-test",async route=>{
   const response=await route.fetch({url});
   await route.fulfill({response,body:(await response.text()).replaceAll('src="/','src="/static/')});
  });
  await context.route(pattern,async route=>{
   const target=new URL(route.request().url());
   await route.fulfill({response:await route.fetch({url:base+target.pathname+target.search})});
  });
  // Electron's page-route adapter cannot intercept fetches inside workers.
  // Keep the worker on the app origin and point only its synthetic API at the fixture.
  await page.addInitScript(base=>{
   const OriginalWorker=window.Worker;
   window.Worker=class extends OriginalWorker {
    constructor(url,options){
     if(String(url).includes('library-smart-worker.js')){
      const source=`const originalImport=self.importScripts.bind(self);self.importScripts=(...urls)=>originalImport(...urls.map(u=>new URL(u,${JSON.stringify(String(url))}).href));const originalFetch=self.fetch.bind(self);self.fetch=(url,options)=>originalFetch(new URL(String(url),${JSON.stringify(base)}).href,options);importScripts(${JSON.stringify(String(url))});`;
      super(URL.createObjectURL(new Blob([source],{type:'text/javascript'})),options);
     }else super(url,options);
    }
   };
  },base);
  await page.goto(new URL("/smart-editor-test",page.url()).href);
  const lib=page;
  await lib.waitForFunction(()=>window.HDRLibrarySmartAlbums);
  const timing=await lib.evaluate(async()=>{
   const smart=HDRLibrarySmartAlbums.create({root:document.querySelector("#albums"),pins:()=>[{path:"D:/Missing",name:"Offline folder"}],api:async (url,body)=>(await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:undefined)).json(),status:()=>{}});
   window.largeSmart=smart;
   const s=performance.now();await smart.editor(null,{rules:[{field:"rating",op:"at-least",value:5},{field:"camera",op:"is",value:"trial camera"}]});
   const choice=document.querySelector('[data-rule-value="1"]');choice.value="trial camera";choice.dispatchEvent(new Event("input"));
   return {open_ms:performance.now()-s,loading:document.querySelector(".library-smart-count").textContent,enabled:!document.querySelector('[aria-label="Smart album name"]').disabled};
  });
  assert.ok(timing.open_ms<250,JSON.stringify(timing));assert.equal(timing.loading,"Counting…");assert.equal(timing.enabled,true);
  const dialog=lib.getByRole("dialog",{name:"New smart album",exact:true});
  await dialog.getByLabel("Smart album name",{exact:true}).fill("Large library");
  await dialog.getByText("15,500 matching photos",{exact:true}).waitFor({timeout:60000}).catch(async error=>{throw new Error(error.message+" count="+await lib.evaluate(()=>document.querySelector(".library-smart-count")?.textContent)+" alert="+await lib.evaluate(()=>document.querySelector(".library-smart-editor [role=alert]")?.textContent)+" trace="+trace.join(" | ").slice(-3000)+" server="+failure.slice(-2000));});
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
  // A fresh controller reuses the durable matched grid without a worker.
  const cache=await lib.evaluate(async()=>{
   const albums=await largeSmart.refresh(),first=await largeSmart.open(albums[0].id),second=await largeSmart.open(albums[0].id),poll=await largeSmart.poll();
   const OriginalWorker=window.Worker;
   let restored;
   try {
    window.Worker=class { constructor(){throw new Error("Cached opening rebuilt candidates");} };
    const fresh=HDRLibrarySmartAlbums.create({root:document.querySelector("#albums"),pins:()=>[{path:"D:/Missing",name:"Offline folder"}],api:async (url,body)=>(await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:undefined)).json(),status:()=>{}});
    restored=await fresh.open(albums[0].id);
   } finally { window.Worker=OriginalWorker; }
   return {first:HDRLibraryQuery.apply(first.photos,"name",false,first.filters).length,
    cached:second.photos.length,refreshed:HDRLibraryQuery.apply(poll.photos,"name",false,poll.filters).length,
    restored:restored.photos.length};
  });
  assert.deepEqual(cache,{first:15500,cached:15500,refreshed:15500,restored:15500});
  clearInterval(pulseTimer);await pulseFlight;
  assert.ok(pulseCount>0,"No backend heartbeat completed");assert.deepEqual(pulseErrors,[],"Backend heartbeat missed memory-monitor deadline");
  console.log("PASS: real 155,000-row smart editor",JSON.stringify({...timing,warm_open_ms:warm,...edits}));
 }finally {
  await context.unroute("**/smart-editor-test");await context.unroute(pattern);
  child.kill();
  await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode)resolve();else child.once("exit",resolve);});
  const row=output.split(/\r?\n/).find(line=>line.startsWith('{"photos"'));
  if(row){const folder=path.dirname(JSON.parse(row).candidates),parent=path.join(root,"output");
   if(path.dirname(folder)===parent&&path.basename(folder).startsWith("smart-155000-"))fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
}
module.exports={check};
