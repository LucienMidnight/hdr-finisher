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
  let openedAt, single=null;
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
    for(const record of single?[single.open,...single.steps]:[]){
      const matches=events.filter(e=>e.path===record.path&&e.at>=record.started_ms&&e.at<=record.presented_ms+100);
      const app=matches.filter(e=>e.stage==='picture_navigation_to_present'&&e.sharp_draw).at(-1);
      record.appMs=app?Math.round(app.duration_ms):null;
      record.prepared=matches.some(e=>e.stage==='picture_window_wait'&&e.kept);
      record.app_difference_ms=record.appMs===null?null:record.ms-record.appMs;
      record.app_trace_starts_after_input_ms=app?Math.round(app.at-app.duration_ms-record.started_ms):null;
      record.app_event_after_presentation_ms=app?Math.round(app.at-record.presented_ms):null;
    }
    return {opened_epoch_ms:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,browse_ms:performance.now()-openedAt,probe,grid_progress:gridProgress,single,events,errors,stage:'done'};
  } catch(error) {
    return {opened_epoch_ms:openedAt===undefined?null:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,probe,grid_progress:gridProgress,single,events,errors:[...errors,String(error.stack||error)],stage};
  } finally {
    stopped=true;clearInterval(timer);clearInterval(gridTimer);observer?.disconnect();window.HDRLibraryStopwatch=inherited;
    window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onError);
  }
}
