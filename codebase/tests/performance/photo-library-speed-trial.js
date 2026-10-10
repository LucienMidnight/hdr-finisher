/* External measurement only. Existing shaders/readback/Ultra HDR encoder;
 * no shipped UI, preview pipeline, job type, or cache policy is changed.
 * Run through run-in-electron.js at 2560x1440. Service is owned by this driver.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn,execFileSync} = require("node:child_process");
const {chromium} = require("playwright");
const root = path.resolve(__dirname,"../..");
const out = path.join(root,"output/library-speed-trial");
fs.mkdirSync(out,{recursive:true});
const opt = (name,fallback) => {const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const mode=opt("--mode","pilot"), shortcut=opt("--shortcut","early");
const median = a => {const v=[...a].sort((a,b)=>a-b),i=Math.floor(v.length/2);return v.length%2?v[i]:(v[i-1]+v[i])/2;};
const p95 = a => [...a].sort((a,b)=>a-b)[Math.ceil(a.length*.95)-1];
const write=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2));
(async()=>{
  const log=fs.openSync(path.join(out,`service-${mode}.log`),"w");
  const service=spawn(path.join(root,".venv/Scripts/python.exe"),[path.join(__dirname,"photo-library-speed-trial.py"),"serve"],
    {cwd:root,stdio:["ignore",log,log],windowsHide:true});
  let browser;
  try {
    const deadline=Date.now()+120000;
    while(true){
      try{const r=await fetch("http://127.0.0.1:8799/health");if(r.ok)break;}catch{}
      assert.equal(service.exitCode,null,"Trial service exited before ready");
      assert.ok(Date.now()<deadline,"Trial service startup timed out");
      await new Promise(r=>setTimeout(r,500));
    }
    browser=await chromium.launch({headless:true,channel:"msedge"});
    const page=await browser.newPage();
    page.on("console",message=>{if(message.type()==="error"||message.text().startsWith("trial phase"))console.error("browser: "+message.text());});
    page.on("crash",()=>console.error("Trial renderer process crashed"));
    const cdp=await page.context().newCDPSession(page);
    await cdp.send("Page.setBypassCSP",{enabled:true});
    await page.goto(process.env.HDR_FINISHER_URL,{waitUntil:"networkidle"});
    // This disposable test page alone can talk to the loopback instrument.
    // The shipped CSP is unchanged. Bulk pixels travel over HTTP, never CDP
    // route.fulfill/postDataBuffer, whose base64 conversion swamps GPU timings.
    await cdp.send("Browser.grantPermissions",{origin:new URL(page.url()).origin,permissions:["localNetworkAccess"]});
    await page.evaluate(()=>{
      const original=window.fetch.bind(window);
      window.fetch=(input,options)=>{
        const url=new URL(String(input),location.href);
        if(url.pathname.startsWith("/__library_trial/")){
          return original("http://127.0.0.1:8799"+url.pathname.replace("/__library_trial","")+url.search,options);
        }
        if(url.pathname.startsWith("/api/session/trial-")){
          const key=url.pathname.split("/")[3].replace("trial-","");
          url.searchParams.set("trial_key",key);
          return original("http://127.0.0.1:8799/proxy/"+url.pathname.split("/").at(-1)+url.search,options);
        }
        return original(input,options);
      };
    });
    const adapter=await page.evaluate(async()=>{
      window.trialCanvas=document.createElement("canvas");
      window.trialCanvases={hdr:document.createElement("canvas"),sdr:document.createElement("canvas")};
      window.trialGpu=new HDRWebGPUPreview(trialCanvas);
      await trialGpu.initialize();
      if(!trialGpu.available)throw new Error(trialGpu.detail);
      trialGpu.setSourceTransport("single");
      window.trialMeta=null;
      window.trialDraw=async(edge,edited=false)=>{
        const started=performance.now(), meta=trialMeta;
        const grade=structuredClone(meta.adjustments);
        if(edited){grade.hdr.exposure+=.25;grade.sdr.exposure+=.25;}
        let drawMs=0,readbackMs=0;
        const pictures=[];
        for(const lane of ["hdr","sdr"]){
          const start=performance.now();
          const canvas=trialCanvases[lane];
          const render=await trialGpu.renderTo(canvas,"trial-"+meta.key,lane,grade,sampleCurvePoints,edge,[],0,null,meta.white,
            {width:meta.width,height:meta.height}, {measureOnly:true,scopeAnalysis:true,forceSdrSurface:true,retainPresentation:true});
          if(render?.execution!=="direct")throw new Error("Trial did not draw direct: "+JSON.stringify(render));
          await trialGpu.waitForSubmittedWork();
          drawMs+=performance.now()-start;
          const readStart=performance.now();
          const pixels=await trialGpu.analyzeScope(canvas,{width:render.width,height:render.height,tier:"picture",raw:true});
          render.presentationTexture?.destroy();
          if(!pixels)throw new Error("GPU picture readback failed");
          readbackMs+=performance.now()-readStart;
          pictures.push(pixels);
        }
        const width=pictures[0].width,height=pictures[0].height;
        if(pictures[1].width!==width||pictures[1].height!==height)throw new Error("Lane dimensions differ");
        const body=new Uint16Array(pictures[0].halves.length+pictures[1].halves.length);
        body.set(pictures[0].halves);body.set(pictures[1].halves,pictures[0].halves.length);
        window.trialPixels={body,width,height,edge,edited,key:meta.key};
        const encodeStarted=performance.now();
        let response=await fetch("/__library_trial/begin",{method:"POST",body:JSON.stringify({bytes:body.byteLength})});
        if(!response.ok)throw new Error(await response.text());
        for(let offset=0;offset<body.byteLength;offset+=4*1024*1024){
          response=await fetch("/__library_trial/upload?offset="+offset,{method:"POST",
            body:new Blob([new Uint8Array(body.buffer,offset,Math.min(4*1024*1024,body.byteLength-offset))])});
          if(!response.ok)throw new Error(await response.text());
        }
        response=await fetch(`/__library_trial/encode?key=${meta.key}&edge=${edge}&width=${width}&height=${height}`,{method:"POST",body:"{}"});
        if(!response.ok)throw new Error(await response.text());
        const encoding=await response.json();
        return {edge,edited,draw_ms:drawMs,readback_ms:readbackMs,encode_transport_ms:performance.now()-encodeStarted,
          total_ms:performance.now()-started,...encoding};
      };
      return trialGpu.adapterInfo;
    });
    assert.ok(adapter&&!adapter.fallback,"Trial must use the real GPU");
    console.log("GPU instrument ready: "+adapter.vendor+" "+adapter.architecture);
    async function prepare(index,key="current",method=shortcut,edge=2560){
      if(key==="current")key="photo"+index;
      const start=performance.now();
      const meta=await page.evaluate(async request=>{
        const response=await fetch("/__library_trial/prepare",{method:"POST",body:JSON.stringify(request)});
        if(!response.ok)throw new Error(await response.text());
        return response.json();
      },{index,key,shortcut:method,edge});
      await page.evaluate(meta=>{window.trialMeta=meta;},meta);
      return {...meta,prepare_wall_ms:performance.now()-start};
    }
    async function draw(edge,edited=false){return page.evaluate(async({edge,edited})=>trialDraw(edge,edited),{edge,edited});}
    const rows=opt("--resume","false")==="true"&&fs.existsSync(path.join(out,`gpu-${mode}.json`))
      ?JSON.parse(fs.readFileSync(path.join(out,`gpu-${mode}.json`))).rows:[];
    if(mode==="pilot"||mode==="matrix"){
      for(const index of (mode==="pilot"?[1]:Array.from({length:10},(_,i)=>i))){
        const expected=opt("--edges","1920,2560,3840").split(",").length*Number(opt("--repeats",2))*2;
        if(rows.filter(row=>row.index===index).length===expected)continue;
        // B is already open at the requested size: full source preparation is
        // excluded and proxy upload/cache warm-up recorded separately.
        const meta=await prepare(index,"current","full",3840);
        for(const edge of opt("--edges","1920,2560,3840").split(",").map(Number)){
          if(rows.filter(row=>row.index===index&&row.edge===edge).length===Number(opt("--repeats",2))*2)continue;
          console.log(`Starting ${path.basename(meta.path)} ${edge}`);
          const first=await draw(edge);
          const comparison=await page.evaluate(async()=>{
            const p=trialPixels;
            const response=await fetch(`/__library_trial/compare?key=${p.key}&edge=${p.edge}&width=${p.width}&height=${p.height}&edited=${p.edited}`,{method:"POST",body:"{}"});
            if(!response.ok)throw new Error(await response.text());
            return response.json();
          });
          for(let repeat=0;repeat<Number(opt("--repeats",2));repeat++)for(const edited of [false,true]){
            if(rows.some(row=>row.index===index&&row.edge===edge&&row.repeat===repeat&&row.edited===edited))continue;
            const row={index,path:meta.path,repeat,opening:meta.opening,first,comparison,...await draw(edge,edited)};
            rows.push(row);write(`gpu-${mode}.json`,{adapter,rows,complete:false});
          }
          console.log(`${path.basename(meta.path)} ${edge}: ${rows.at(-1).total_ms.toFixed(1)}ms`);
        }
      }
      write(`gpu-${mode}.json`,{adapter,rows,complete:true});
    } else if(mode==="normal-open"){
      const paths=await (await fetch("http://127.0.0.1:8799/paths")).json();
      for(let repeat=0;repeat<2;repeat++){
        const source=path.join(out,"normal-app-"+repeat,path.basename(paths[0]));
        fs.mkdirSync(path.dirname(source),{recursive:true});
        fs.copyFileSync(paths[0],source);
        const start=performance.now();
        await page.evaluate(async source=>{
          const selection=await desktop.grantSourcePath(source);
          await openDesktopSelection({kind:"source",...selection});
        },source);
        await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==="ready",null,{timeout:180000});
        rows.push({repeat,source,wall_ms:performance.now()-start,...await page.evaluate(()=>({metadata:state.session.metadata,adapter:state.gpuPreview.adapterInfo}))});
        write("normal-open.json",{rows,complete:false});
        console.log(`DJI normal app open ${rows.at(-1).wall_ms/1000}s`);
      }
      write("normal-open.json",{rows,complete:true});
    } else if(mode==="screen"){
      const start=performance.now();
      const workers=Number(opt("--workers",1));
      if(workers>1)await page.evaluate(async request=>{
        const response=await fetch("/__library_trial/parallel",{method:"POST",body:JSON.stringify(request)});
        if(!response.ok)throw new Error(await response.text());
      },{workers,shortcut});
      const screenFile=workers>1?`screen-30-${workers}-workers.json`:"screen-30.json";
      for(let index=0;index<30;index++){
        const jobStart=performance.now(),meta=await prepare(index);
        const result=await draw(2560);
        rows.push({index,path:meta.path,opening:meta.opening,prepare_wall_ms:meta.prepare_wall_ms,...result,end_to_end_ms:performance.now()-jobStart});
        write(screenFile,{adapter,shortcut,workers,rows,elapsed_ms:performance.now()-start,complete:false});
        console.log(`screen ${index+1}/30 ${(rows.at(-1).end_to_end_ms/1000).toFixed(2)}s`);
      }
      write(screenFile,{adapter,shortcut,workers,rows,elapsed_ms:performance.now()-start,complete:true});
    } else if(mode==="refresh"){
      const paths=await (await fetch("http://127.0.0.1:8799/paths")).json();
      for(let index=0;index<10;index++)await prepare(index,"cached"+index);
      const gradeSource=paths.find(source=>path.basename(source)==="DSC00264.ARW");
      assert.ok(gradeSource,"Reuse the original Grade interaction source");
      await page.evaluate(async source=>{
        const selection=await desktop.grantSourcePath(source);
        await openDesktopSelection({kind:"source",...selection});
      },gradeSource);
      await page.waitForFunction(()=>state.acceptedPresentation?.exact&&viewerState().status==="ready",null,{timeout:180000});
      async function gestures(){
        const samples=[];
        await page.evaluate(()=>{
          window.trialGaps=[];window.trialLast=performance.now();window.trialRAF=true;
          function tick(now){if(!trialRAF)return;trialGaps.push(now-trialLast);trialLast=now;requestAnimationFrame(tick);}
          requestAnimationFrame(tick);
        });
        for(let i=0;i<20;i++){
          const before=await page.evaluate(()=>state.acceptedPresentation.generation),start=performance.now();
          await page.evaluate(value=>{const c=document.querySelector("#hdr-exposure");c.value=String(value);
            c.dispatchEvent(new Event("input",{bubbles:true}));c.dispatchEvent(new Event("change",{bubbles:true}));},.25+(i%5)*.1);
          await page.waitForFunction(previous=>state.acceptedPresentation?.generation>previous&&state.acceptedPresentation?.exact&&viewerState().status==="ready",before,{timeout:30000,polling:16});
          samples.push(performance.now()-start);
        }
        const gaps=await page.evaluate(()=>{trialRAF=false;return trialGaps;});
        return {samples_ms:samples,median_ms:median(samples),p95_ms:p95(samples),raf_gap_max_ms:Math.max(...gaps)};
      }
      const baseline=await gestures();
      // Start the real async render/readback/encode jobs in the same renderer
      // process as Grade, on a second real GPU device. No synthetic GPU load.
      const job=page.evaluate(async shortcut=>{
        window.trialRefreshRows=[];window.trialRefreshActive=true;
        const start=performance.now();
        try{
          for(let i=0;i<50;i++){
            const index=i%10, response=await fetch("/__library_trial/meta?key=cached"+index);
            trialMeta=await response.json();
            const row=await trialDraw(2560,true);
            trialRefreshRows.push({index,...row});
          }
          return {rows:trialRefreshRows,elapsed_ms:performance.now()-start};
        }finally{trialRefreshActive=false;}
      },shortcut);
      await page.waitForFunction(()=>window.trialRefreshActive,null,{timeout:10000});
      const concurrent=await gestures();
      const completedDuringSample=await page.evaluate(()=>({completed:trialRefreshRows.length,active:trialRefreshActive}));
      const batch=await job;
      assert.ok(completedDuringSample.active,"Grade sampling must overlap the preview batch");
      write("refresh-50.json",{adapter,shortcut,gradeSource,baseline,concurrent,completedDuringSample,...batch,complete:true});
      console.log(JSON.stringify({baseline,concurrent,elapsed_ms:batch.elapsed_ms}));
    }else throw new Error("Unknown mode "+mode);
  }finally{
    if(browser)await browser.close();
    if(process.platform==="win32"){
      try{execFileSync("taskkill",["/PID",String(service.pid),"/T","/F"],{stdio:"ignore",windowsHide:true});}catch{}
    }else service.kill();
    fs.closeSync(log);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
