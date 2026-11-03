async function scenario(config) {
  const started = performance.now(), errors = [];
  let stage = 'start', stopped = false;
  const mark = value => { stage = value; console.log('QUICK_LIBRARY_STAGE:' + value); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const probe = {started, frame_gaps:[], main_blocks:[], long_tasks:[]};
  const gridProgress=[], gridSeen=new Set();let gridAt=started;
  const gridTimer=setInterval(()=>{
    for(const c of document.querySelectorAll('#grid-space canvas[data-picture-key]'))if(!c.hidden&&c.dataset.picturePath)gridSeen.add(c.dataset.picturePath);
    gridProgress.push({at_ms:performance.now()-gridAt,shown:gridSeen.size,total:HDRLibrary.getSnapshot().total});
  },1000);
  let frameAt = performance.now(), timerAt = frameAt;
  function tick(now) {
    if (stopped) return;
    if (now-frameAt >= 50) probe.frame_gaps.push({from_ms:Math.round(frameAt), ms:Math.round(now-frameAt)});
    frameAt=now; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  const timer = setInterval(() => {
    const now=performance.now();
    if(now-timerAt>=50)probe.main_blocks.push({from_ms:Math.round(timerAt),ms:Math.round(now-timerAt)});
    timerAt=now;
  },20);
  let observer;
  try { observer=new PerformanceObserver(list=>{for(const e of list.getEntries())probe.long_tasks.push({start_ms:Math.round(e.startTime),ms:Math.round(e.duration)});});observer.observe({type:'longtask',buffered:false}); } catch {}
  const onError=e=>errors.push(String(e.message || e.reason));
  window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onError);
  const events=[], inherited=window.HDRLibraryStopwatch;
  window.HDRLibraryStopwatch=(stage,fields={})=>{
    events.push({stage,at:performance.now(),...fields}); inherited(stage,fields);
  };
  const wait=async(condition,timeout=30000)=>{
    const until=performance.now()+timeout;
    while(!condition()){if(performance.now()>until)throw Error('Timed out at '+stage);await frame();}
  };
  const visible = e => e && !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
  const nameOf = p => String(p).replaceAll('\\','/').split('/').pop();
  let openedAt, single=null, redisplay=null, retention=null;
  try {
    mark('memory setting');
    const set=await fetch('/api/library/memory-setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:4e9})});
    if(!set.ok)throw Error('memory-setting: '+set.status);
    const size=document.getElementById('thumbnail-size');if(size){size.value=300;size.dispatchEvent(new Event('input'));}
    // Opening a folder restores its own sort; selecting before browse is overwritten.
    localStorage.setItem('hdr-finisher:library-source-sorts',JSON.stringify({['folder:'+config.folder.replaceAll('\\','/').replace(/\/$/,'').toLowerCase()]:{sort:'name',descending:false}}));
    mark('browse');openedAt=performance.now();gridAt=openedAt;
    void HDRLibrary.browse(config.folder).catch(e=>errors.push(String(e)));
    if(config.singleMode){
      await wait(()=>document.querySelector('#grid-space .library-cell canvas[data-picture-key]'),60000);
      if(HDRLibrary.getSnapshot().sort!=='name')throw Error('Folder did not use name sort');
      async function measure(index,action){
        mark(index===0?'single open':'single step '+index);
        const at=performance.now();action();
        const selected=HDRLibrary.getSnapshot().selected;
        const prepared=!!document.querySelector(`#single-picture[data-picture-path]`) && document.getElementById('single-picture').dataset.picturePath===selected;
        let first=null, full=null;
        await wait(()=>{
          const canvas=document.getElementById('single-picture');
          const sharp=visible(canvas)&&canvas.dataset.picturePath===selected&&Number(canvas.dataset.pictureEdge)===2560;
          const standin=[...document.querySelectorAll('#single-stage [data-picture-path]')].some(e=>visible(e)&&e.dataset.picturePath===selected);
          if(first===null&&(sharp||standin)){first=-1;requestAnimationFrame(()=>{first=performance.now();});}
          if(sharp){full=performance.now();return true;}return false;
        },45000);
        // The updated canvas has reached a compositor opportunity on the next frame.
        await frame();
        const shownAt=performance.now();
        const ms=shownAt-at;
        const app=events.filter(e=>e.stage==='picture_navigation_to_present'&&e.path===selected&&e.at>=at&&e.sharp_draw).at(-1);
        const record={index,name:nameOf(selected),path:selected,ms:Math.round(ms),wall_ms:Math.round(ms),first_ms:Math.round((first>0?first:shownAt)-at),canvas_updated_ms:Math.round(full-at),appMs:app?Math.round(app.duration_ms):null,prepared,started_ms:at,presented_ms:shownAt};
        console.log('QUICK_LIBRARY_STEP:'+JSON.stringify(record));
        return record;
      }
      const singleAt=performance.now();
      const open=await measure(0,()=>{(config.diagnosticPhoto?[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path.endsWith(config.diagnosticPhoto)):document.querySelector('#grid-space .library-cell')).click();document.getElementById('single-view').click();});
      const steps=[];let lastAt=open.started_ms;
      for(let i=1;i<=config.steps;i++){
        await sleep(Math.max(0,config.pace-(performance.now()-lastAt)));
        const step=await measure(i,()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
        steps.push(step);lastAt=step.started_ms;
      }
      const times=steps.map(s=>s.ms).sort((a,b)=>a-b);
      single={first_photo:open.name,open_ms:open.ms,open_wall_ms:open.ms,open_first_ms:open.first_ms,open,steps,
        step_mean_ms:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null,
        step_median_ms:times.length?times[Math.floor(times.length/2)]:null,step_max_ms:times.at(-1)??null,elapsed_ms:Math.round(performance.now()-singleAt),
        timing_note:'Library performance.now(): input dispatch to matching 2560 canvas update plus the next animation frame. No CDP. This measures compositor opportunity, not physical display scanout.'};
    }
    mark('observe');
    await sleep(Math.max(0,config.seconds*1000-(performance.now()-openedAt)));
    await frame();
    if(config.retention){
      retention=[];
      const settle=async name=>{
        mark('settle '+name);const at=performance.now();await sleep(30000);
        retention.push({stage:name,start_epoch_ms:performance.timeOrigin+at,end_epoch_ms:performance.timeOrigin+performance.now(),snapshot:HDRLibraryScenes.snapshot()});
      };
      // Keep this folder and its finished cells alive while opening Grade.
      // Switching folders first releases the callbacks and masks the leak.
      const gradePhoto=(config.gradeReturn&&HDRLibrary.getSnapshot().paths.find(p=>/DSC06615\.ARW$/i.test(p)))||HDRLibrary.getSnapshot().paths.find(p=>/\.ARW$/i.test(p));
      if(!gradePhoto)throw Error('Retention workload needs a full-size RAW copy');
      mark('open Grade');
      if(config.gradeReturn){
        const cell=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===gradePhoto);
        if(!cell)throw Error('Grade RAW is not visible in grid');
        cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      }else await parent.openDesktopSelection({kind:'source',...await parent.hdrFinisherDesktop.grantSourcePath(gradePhoto),fromLibrary:true});
      await wait(()=>parent.HDRGradeSaving.active(),60000);
      if(config.gradeReturn){
        await wait(()=>parent.HDRGradeSaving.ready()&&!parent.document.body.classList.contains('grade-opening'),60000);
        mark('adjust Grade slider');
        const control=parent.document.getElementById('hdr-exposure');
        control.dispatchEvent(new parent.PointerEvent('pointerdown',{bubbles:true,pointerId:991}));
        control.value=String(Number(control.value)+.25);
        let exposure=Number(control.value);
        control.dispatchEvent(new parent.Event('input',{bubbles:true}));
        control.dispatchEvent(new parent.Event('change',{bubbles:true}));
        control.dispatchEvent(new parent.PointerEvent('pointerup',{bubbles:true,pointerId:991}));
        await sleep(1200);
        mark('type Grade exposure');
        const output=parent.document.querySelector('[data-value-path="hdr.exposure"]');
        output.dispatchEvent(new parent.MouseEvent('dblclick',{bubbles:true}));
        exposure+=.15;output.textContent=String(exposure);
        output.dispatchEvent(new parent.InputEvent('input',{bubbles:true,inputType:'insertText',data:String(exposure)}));
        output.dispatchEvent(new parent.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        await sleep(1600);
        config.gradeReturnResult={path:gradePhoto,exposure};
        mark('click Library tab');
        parent.document.querySelector('[data-workflow-tab="import"]').click();
        await sleep(600);
        const worker=await (await fetch('/api/library-worker/status')).json();
        console.log('GRADE_RETURN_HOLDS:'+JSON.stringify(worker.pause_owners));
        if(worker.paused)throw Error('Helper stayed paused after leaving Grade: '+JSON.stringify(worker.pause_owners));
        const findCell=()=>[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path?.replaceAll('\\','/')===gradePhoto.replaceAll('\\','/'));
        await wait(()=>findCell(),30000);
        const cell=findCell();
        cell.click();
        mark('Grade photo full screen');
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
        await wait(()=>{const c=document.getElementById('single-picture');return visible(c)&&c.dataset.picturePath===gradePhoto&&Number(c.dataset.pictureEdge)===2560;},60000);
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
        document.getElementById('grid-view').click();
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'[',bubbles:true}));
        mark('Compare after Grade');
        await wait(()=>HDRLibrary.getSnapshot().compare.enabled,10000);
        const alternate=HDRLibrary.getSnapshot().paths.find(p=>/2L1B8631\.CR2$/i.test(p));
        if(alternate){
          const filmCell=[...document.querySelectorAll('.library-cell')].find(c=>c.dataset.path===alternate);
          if(filmCell)filmCell.click();
          else throw Error('Named Compare alternate is not available in filmstrip');
        }
        await wait(()=>{
          const panes=[...document.querySelectorAll('#library-compare .compare-fit')].filter(c=>visible(c)&&c.dataset.pictureKey&&Number(c.dataset.pictureEdge)>=1280);
          const paths=panes.map(c=>c.dataset.picturePath);
          return panes.length===2&&new Set(paths).size===2&&paths.includes(gradePhoto)&&(!alternate||paths.includes(alternate));
        },60000);
        const compareWorker=await (await fetch('/api/library-worker/status')).json();
        if(compareWorker.paused)throw Error('Grade holds returned during Compare: '+JSON.stringify(compareWorker.pause_owners));
        document.getElementById('grid-view').click();
        mark('keyboard return from Grade');
        parent.document.querySelector('[data-workflow-tab="grade"]').click();
        parent.document.querySelector('[data-workflow-tab="grade"]').dispatchEvent(new parent.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
        await sleep(600);
        const keyboardWorker=await (await fetch('/api/library-worker/status')).json();
        if(keyboardWorker.paused)throw Error('Helper stayed paused after keyboard return: '+JSON.stringify(keyboardWorker.pause_owners));
        parent.document.getElementById('eject-button').click();
        await wait(()=>parent.document.getElementById('eject-button').disabled,15000);
        await settle('Grade save, full screen and Compare');
      } else {
      parent.activateWorkflowTab('import');
      await settle('return from Grade in same folder');
      // Returning keeps the open Grade document by design; close through its save gate too.
      await parent.closePhotoInGrade();await settle('close Grade');
      mark('cancel and scroll away');
      const grid=document.getElementById('library-grid');
      grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));await sleep(1000);
      await settle('cancel in same folder');
      await HDRLibrary.browse(config.retentionFolder);
      await wait(()=>document.querySelector('#grid-space canvas[data-picture-key]'),60000);
      await settle('scroll away');
      const cell=document.querySelector('#grid-space .library-cell');cell.click();
      const photo=HDRLibrary.getSnapshot().selected;
      document.getElementById('single-view').click();
      await wait(()=>document.getElementById('single-picture').dataset.picturePath===photo,60000);
      document.getElementById('zoom-button').click();
      await wait(()=>!document.getElementById('native-picture').hidden&&!!document.getElementById('native-picture').dataset.picturePath,60000);
      document.getElementById('grid-view').click();await settle('leave Single');
      document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'[',bubbles:true}));
      await wait(()=>HDRLibrary.getSnapshot().compare.enabled,10000);
      if(!HDRLibrary.getSnapshot().zoom)document.getElementById('zoom-button').click();
      await wait(()=>HDRLibrary.getSnapshot().compare.sides.every(s=>s.native),60000);
      document.getElementById('grid-view').click();await settle('leave Compare');
      }
    }
    if(config.redisplay){
      const grid=document.getElementById('library-grid');
      if(!grid)throw Error('Grid scroller missing');
      const cells=()=>[...document.querySelectorAll('#grid-space .library-cell')].filter(c=>{const r=c.getBoundingClientRect(),g=grid.getBoundingClientRect();return r.bottom>g.top&&r.top<g.bottom;});
      const paths=cells().map(c=>c.dataset.path);
      const stored=paths.filter(p=>document.querySelector('#grid-space canvas[data-picture-path="'+CSS.escape(p)+'"]'));
      async function measure(name,action){
        mark(name);await action();
        const at=performance.now(),seen=new Map();
        while(performance.now()-at<5000){
          for(const c of cells()){const canvas=c.querySelector('canvas[data-picture-key]');if(canvas&&!canvas.hidden&&stored.includes(c.dataset.path)&&!seen.has(c.dataset.path))seen.set(c.dataset.path,performance.now()-at);}
          if(seen.size===stored.length)break;await frame();
        }
        await frame();
        return {stored:stored.length,shown:seen.size,within_100ms:[...seen.values()].filter(t=>t<=100).length,percent:stored.length?100*[...seen.values()].filter(t=>t<=100).length/stored.length:null,times_ms:Object.fromEntries(seen)};
      }
      grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));await sleep(600);
      const backAt=performance.now();
      const back=await measure('scroll back',async()=>{grid.scrollTop=0;grid.dispatchEvent(new Event('scroll'));await wait(()=>events.some(e=>e.stage==='grid_scroll_settled'&&e.scroll_top===0&&e.at>=backAt),2000);});
      await HDRLibrary.browse(config.folder+'/../');
      const reopen=await measure('folder reopen',async()=>{await HDRLibrary.browse(config.folder);});
      redisplay={back,reopen,timing_note:'Visible matching canvas, polled each animation frame after scroll settle or browse rows listed. Only pictures finished during the cold fill count.'};
    }
    for(const record of single?[single.open,...single.steps]:[]){
      const matches=events.filter(e=>e.path===record.path&&e.at>=record.started_ms&&e.at<=record.presented_ms+100);
      const app=matches.filter(e=>e.stage==='picture_navigation_to_present'&&e.sharp_draw).at(-1);
      record.appMs=app?Math.round(app.duration_ms):null;
      record.prepared=matches.some(e=>e.stage==='picture_window_wait'&&e.kept);
      record.app_difference_ms=record.appMs===null?null:record.ms-record.appMs;
      record.app_trace_starts_after_input_ms=app?Math.round(app.at-app.duration_ms-record.started_ms):null;
      record.app_event_after_presentation_ms=app?Math.round(app.at-record.presented_ms):null;
    }
    return {opened_ms:openedAt,opened_epoch_ms:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,browse_ms:performance.now()-openedAt,probe,grid_progress:gridProgress,single,redisplay,retention,grade_return:config.gradeReturnResult,finished_snapshot:window.HDRLibraryFinishedThumbnails?.snapshot(),events,errors,stage:'done'};
  } catch(error) {
    return {opened_epoch_ms:openedAt===undefined?null:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,probe,grid_progress:gridProgress,single,redisplay,retention,grade_return:config.gradeReturnResult,events,errors:[...errors,String(error.stack||error)],stage};
  } finally {
    stopped=true;clearInterval(timer);clearInterval(gridTimer);observer?.disconnect();window.HDRLibraryStopwatch=inherited;
    window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onError);
  }
}
