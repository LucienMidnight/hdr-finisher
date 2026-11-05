async function scenario(config) {
  const started = performance.now(), errors = [];
  let stage = 'start', stopped = false;
  const mark = value => { stage = value; console.log('QUICK_LIBRARY_STAGE:' + value); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const memoryDiagnostic=[];
  const memoryPoint=async label=>{
    if(!config.memoryDiagnostic)return;
    await sleep(600);
    memoryDiagnostic.push({label,at:performance.now(),snapshot:await (await fetch('/api/library/memory')).json()});
  };
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
    if(config.loseReservation){
      const originalFetch=window.fetch.bind(window);let injected=false;
      window.fetch=async(url,options)=>{
        if(!injected && String(url).startsWith('/api/delivery/gpu/raw-budget/') && options?.method==='POST'){
          const payload=JSON.parse(options.body);
          if(payload.grant){injected=true;HDRLibraryGrants.release(payload.grant);await sleep(50);}
        }
        return originalFetch(url,options);
      };
    }
    mark('browse');openedAt=performance.now();gridAt=openedAt;
    void HDRLibrary.browse(config.folder).catch(e=>errors.push(String(e)));
    if(config.singleMode){
      await wait(()=>config.busy ? HDRLibraryScenes.snapshot().sources.jobs.some(j=>j.state==='running') && document.querySelector('#grid-space .library-cell') : document.querySelector('#grid-space .library-cell canvas[data-picture-key]'),60000);
      if(HDRLibrary.getSnapshot().sort!=='name')throw Error('Folder did not use name sort');
      if(config.idle)await wait(()=>HDRLibraryScenes.snapshot().sources.jobs.length===0,60000);
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
      if(config.hdr&&!HDRLibrary.getSnapshot().hdr)document.getElementById('hdr-button').click();
      const singleAt=performance.now();
      const open=await measure(0,()=>{(config.diagnosticPhoto?[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path.endsWith(config.diagnosticPhoto)):document.querySelector('#grid-space .library-cell')).click();document.getElementById('single-view').click();if(config.fullscreen)document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));});
      const steps=[];let lastAt=open.started_ms;
      for(let i=1;i<=config.steps;i++){
        await sleep(Math.max(0,config.pace-(performance.now()-lastAt)));
        const step=await measure(i,()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
        steps.push(step);lastAt=step.started_ms;
      }
      for(let i=1;config.back&&i<=config.steps;i++){
        await sleep(Math.max(0,config.pace-(performance.now()-lastAt)));
        const step=await measure(config.steps+i,()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
        step.back=true;steps.push(step);lastAt=step.started_ms;
      }
      if(config.detail){
        mark('zoom detail');
        const selected=HDRLibrary.getSnapshot().selected;
        document.getElementById('zoom-button').click();
        await wait(()=>{
          if(events.some(e=>e.stage==='picture_detail_refused'&&e.path===selected))throw Error('Detail refused');
          const canvas=document.getElementById('native-picture');
          return visible(canvas)&&canvas.dataset.picturePath===selected;
        },60000);
        await frame();
        const delivered=events.find(e=>e.stage==='picture_drawn'&&e.picture_size==='detail preview');
        if(!delivered)throw Error('No full-size detail delivery event');
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
    if(config.gradeHandoff){
      mark('handoff: finish initial grid');
      const cells=()=>[...document.querySelectorAll('#grid-space .library-cell')];
      const ready=c=>!!c?.querySelector('canvas[data-picture-key]:not([hidden])');
      await wait(()=>cells().length>0&&cells().every(ready),30000);
      if(!HDRLibrary.getSnapshot().hdr)document.getElementById('hdr-button').click();
      await wait(()=>cells().every(c=>{const canvas=c.querySelector('canvas[data-picture-key]:not([hidden])');return ready(c)&&(canvas.dataset.cameraPreview==='true'||canvas.dataset.rendition==='hdr');}),30000);
      await frame();await frame();
      const before=new Map(cells().map(c=>[c.dataset.path,c.querySelector('canvas[data-picture-key]')]));
      const photo=HDRLibrary.getSnapshot().paths.find(p=>/DSC07061\.ARW$/i.test(p))||HDRLibrary.getSnapshot().paths.find(p=>/\.ARW$/i.test(p));
      const cell=cells().find(c=>c.dataset.path===photo);if(!cell)throw Error('No visible RAW to edit');
      mark('handoff: open Grade');cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      await wait(()=>parent.HDRGradeSaving.ready(),60000);
      await wait(()=>parent.HDRGradeLibraryPictures.getSnapshot().clean,30000);
      mark('handoff: release exposure');
      const control=parent.document.getElementById('hdr-exposure');
      control.dispatchEvent(new parent.PointerEvent('pointerdown',{bubbles:true,pointerId:991}));
      control.value=String(Number(control.value)+.5);const exposure=Number(control.value);
      control.dispatchEvent(new parent.Event('input',{bubbles:true}));control.dispatchEvent(new parent.Event('change',{bubbles:true}));
      control.dispatchEvent(new parent.PointerEvent('pointerup',{bubbles:true,pointerId:991}));
      const releasedAt=performance.timeOrigin+performance.now();
      await wait(()=>events.some(e=>e.stage==='grade_picture_handoff'&&e.path===photo),30000);
      const handoff=events.filter(e=>e.stage==='grade_picture_handoff'&&e.path===photo).at(-1);
      if(!handoff.route.startsWith('Grade picture'))errors.push('Clean Grade picture was not handed off: '+JSON.stringify(handoff));
      if(handoff.available_to_picture_ms===null||handoff.available_to_picture_ms>500)errors.push('Grade picture missed the 500 ms availability target: '+handoff.available_to_picture_ms);
      const returnedAt=performance.timeOrigin+performance.now();
      mark('handoff: return to Library');parent.document.querySelector('[data-workflow-tab="import"]').click();
      let blanks=0;
      for(let i=0;i<30;i++){await frame();for(const c of cells())if(!ready(c))blanks++;}
      const edited=cells().find(c=>c.dataset.path===photo)?.querySelector('canvas[data-grade-handoff]');
      if(!edited)errors.push('Edited tile did not reuse its handed-off picture');
      const reused=cells().filter(c=>c.dataset.path!==photo&&c.querySelector('canvas[data-picture-key]')===before.get(c.dataset.path)).length;
      if(reused!==before.size-1)errors.push('Unedited visible thumbnails were rebuilt on return');
      if(blanks)errors.push('Blank tiles after returning from Grade: '+blanks);
      const row=await (await fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})})).json();
      if(row.photos[0].grade_identity!==handoff.grade_identity)errors.push('Library picture is not the latest grade');
      await sleep(600);
      const after=events.filter(e=>e.at+performance.timeOrigin>=returnedAt&&e.path===photo);
      if(after.some(e=>e.stage==='picture_drawn'))errors.push('Edited photo was redrawn on return');
      config.gradeHandoffResult={path:photo,exposure,releasedAt,returnedAt,blank_tiles:blanks,reused,visible:before.size,handoff};
      mark('handoff: autosave off');parent.document.querySelector('[data-workflow-tab="grade"]').click();
      parent.document.getElementById('grade-autosave').click();
      await wait(()=>parent.document.getElementById('grade-autosave').getAttribute('aria-pressed')==='false');
      control.dispatchEvent(new parent.PointerEvent('pointerdown',{bubbles:true,pointerId:992}));
      control.value=String(exposure+.25);control.dispatchEvent(new parent.Event('input',{bubbles:true}));
      control.dispatchEvent(new parent.Event('change',{bubbles:true}));control.dispatchEvent(new parent.PointerEvent('pointerup',{bubbles:true,pointerId:992}));
      await sleep(1500);
      const unsaved=await (await fetch('/api/library/settings-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[photo]})})).json();
      if(unsaved.photos[0].grade_identity!==handoff.grade_identity)errors.push('Autosave off changed the Library grade before Save');
      if(events.some(e=>e.stage==='grade_picture_handoff'&&e.path===photo&&e.request!==handoff.request))errors.push('Unsaved grade published a picture');
      mark('handoff: manual save');parent.document.getElementById('grade-save-now').click();
      await wait(()=>events.some(e=>e.stage==='grade_picture_handoff'&&e.path===photo&&e.request!==handoff.request),30000);
      const manual=events.filter(e=>e.stage==='grade_picture_handoff'&&e.path===photo).at(-1);
      if(manual.grade_identity===handoff.grade_identity||!manual.route.startsWith('Grade picture'))errors.push('Manual save did not hand off its new grade');
      if(manual.available_to_picture_ms===null||manual.available_to_picture_ms>500)errors.push('Manual save missed the 500 ms target: '+manual.available_to_picture_ms);
      if(manual.release_to_picture_ms<1500)errors.push('Manual Save replaced the original slider-release timestamp');
      config.gradeHandoffResult.manual_save=manual;config.gradeHandoffResult.autosave_off_preserved=true;
      parent.document.getElementById('grade-autosave').click();
    }
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
      await memoryPoint('before Grade');
      mark('open Grade');
      if(config.gradeReturn){
        const cell=[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path===gradePhoto);
        if(!cell)throw Error('Grade RAW is not visible in grid');
        cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      }else await parent.openDesktopSelection({kind:'source',...await parent.hdrFinisherDesktop.grantSourcePath(gradePhoto),fromLibrary:true});
      await wait(()=>parent.HDRGradeSaving.active(),60000);
      if(config.gradeReturn){
        await wait(()=>parent.HDRGradeSaving.ready()&&!parent.document.body.classList.contains('grade-opening'),60000);
        await memoryPoint('Grade loaded');
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
        await memoryPoint('after leaving Grade');
        const findCell=()=>[...document.querySelectorAll('#grid-space .library-cell')].find(c=>c.dataset.path?.replaceAll('\\','/')===gradePhoto.replaceAll('\\','/'));
        await wait(()=>findCell(),30000);
        const cell=findCell();
        cell.click();
        config.gradeReturnResult.fullscreenAt=performance.now();
        mark('Grade photo full screen');
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
        await wait(()=>{const c=document.getElementById('single-picture');return visible(c)&&c.dataset.picturePath===gradePhoto&&Number(c.dataset.pictureEdge)===2560;},60000).catch(error=>{if(!config.memoryDiagnostic)throw error;errors.push(String(error));});
        document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true}));
        document.getElementById('grid-view').click();
        config.gradeReturnResult.compareAt=performance.now();
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
        },60000).catch(error=>{if(!config.memoryDiagnostic)throw error;errors.push(String(error));});
        const compareWorker=await (await fetch('/api/library-worker/status')).json();
        if(compareWorker.paused)throw Error('Grade holds returned during Compare: '+JSON.stringify(compareWorker.pause_owners));
        if(config.memoryDiagnostic){
          await memoryPoint('Compare');
          mark('idle in Library 60 seconds');await sleep(60000);
          await memoryPoint('idle before trim');
          const pid=memoryDiagnostic.at(-1).snapshot.backendPid;
          mark('trim backend '+pid);await sleep(3000);
          await memoryPoint('after trim');
        }
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
        await memoryPoint('Grade closed');
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
    return {visible_files:HDRLibrary.getSnapshot().paths,opened_ms:openedAt,opened_epoch_ms:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,browse_ms:performance.now()-openedAt,probe,grid_progress:gridProgress,single,redisplay,retention,memory_diagnostic:memoryDiagnostic,grade_handoff:config.gradeHandoffResult,grade_return:config.gradeReturnResult,finished_snapshot:window.HDRLibraryFinishedThumbnails?.snapshot(),events,errors,stage:'done'};
  } catch(error) {
    return {opened_epoch_ms:openedAt===undefined?null:performance.timeOrigin+openedAt,scenario_ms:performance.now()-started,probe,grid_progress:gridProgress,single,redisplay,retention,memory_diagnostic:memoryDiagnostic,grade_handoff:config.gradeHandoffResult,grade_frame:config.gradeHandoff?parent.HDRGradeLibraryPictures?.getSnapshot():null,handoff_state:config.gradeHandoff?window.HDRLibraryGradeHandoffSnapshot?.():null,grade_return:config.gradeReturnResult,events,errors:[...errors,String(error.stack||error)],stage};
  } finally {
    stopped=true;clearInterval(timer);clearInterval(gridTimer);observer?.disconnect();window.HDRLibraryStopwatch=inherited;
    window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onError);
  }
}
