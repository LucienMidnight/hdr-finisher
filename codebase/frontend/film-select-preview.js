/* Native base-select options expose focus while their picker is open. Keep
 * those previews out of the document/history until the picker commits. */
(function(root) {
  'use strict';
  function transaction({flush, read, preview, restore, commit}) {
    let baseline, latest, ready=false, closed=false;
    const pending=Promise.resolve(flush()).then(ok=>{
      if(ok===false) throw Error('The previous edit could not be saved.');
      baseline=read(); ready=true;
      if(!closed && latest!==undefined) preview(baseline,latest);
    });
    pending.catch(()=>{}); // Report flush failures on close, without an unhandled rejection.
    return {
      choose(value) { if(closed) return; latest=value; if(ready) preview(baseline,value); },
      close(accept, value=latest) {
        if(closed) return pending;
        closed=true;
        const finish=()=>{ restore(baseline); if(accept && value!==undefined && value!==baseline.value) return commit(value); };
        return ready ? Promise.resolve(finish()) : pending.then(finish);
      },
    };
  }
  if(typeof module==='object') module.exports={transaction};
  root.HDRFilmSelectPreview={transaction};
  if(!root.document) return;

  root.bindFilmSelectPreview=function(control) {
    if(!control.matches('select[data-path^="current.film_look."]')) return false;
    let draft=null;
    const key=control.dataset.path.split('.').at(-1);
    const current=()=>state.session?.session_id;
    function open() {
      if(draft || !state.session || control.disabled) return;
      const session=current(), lane=state.currentView, openingValue=control.value;
      draft=transaction({
        flush:()=>syncGlobalEditState(),
        read:()=>({value:openingValue, before:structuredClone(state.adjustments), session, lane}),
        preview:(base,value)=>{
          if(current()!==session || state.currentView!==lane) return;
          state.filmSelectDraft=base;
          state.adjustments=structuredClone(base.before);
          const film=state.adjustments[lane].film_look;
          if(value!==base.value) {
            if(key==='film_stock') HDRFilmCharacter.select(film,value);
            else HDRFilmCharacter.set(film,key,value);
          }
          if(lane==='sdr' && value!==base.value) state.adjustments.sdr.linked_to_hdr=false;
          invalidatePreview(lane,{markDirty:false});
          debouncePreview(lane);
        },
        restore:base=>{
          if(state.filmSelectDraft===base) state.filmSelectDraft=null;
          if(current()!==session || state.currentView!==lane) return;
          state.adjustments=base.before;
          // Retire every render made from an intermediate option, including Escape.
          invalidatePreview(lane,{markDirty:false});
          syncControlsFromState(); renderControlState(); debouncePreview(lane);
        },
        commit:value=>{
          if(current()!==session || state.currentView!==lane) return;
          beginGlobalEditGesture(control);
          commitAdjustmentValue(control.dataset.path,value);
          endGlobalEditGesture(control);
        },
      });
    }
    function finish(accept,value) {
      const active=draft; draft=null;
      if(active) void active.close(accept,value).catch(error=>console.error(error));
    }
    control.addEventListener('focusin',event=>{
      if(event.target.tagName==='OPTION' && control.matches(':open')) {
        open(); draft?.choose(event.target.value);
      } else if(event.target===control && draft && !control.matches(':open')) finish(true);
    });
    control.addEventListener('focusout',()=>{
      requestAnimationFrame(()=>{if(draft && !control.matches(':open')) finish(true);});
    });
    document.addEventListener('pointerdown',event=>{
      if(draft && !control.contains(event.target)) finish(true);
    },true);
    control.addEventListener('keydown',event=>{
      if(event.key==='Escape' && draft) finish(false);
    },true);
    control.addEventListener('input',event=>{
      event.stopImmediatePropagation();
      if(draft) finish(true,control.value);
      else {
        beginGlobalEditGesture(control);
        commitAdjustmentValue(control.dataset.path,readControlValue(control));
        endGlobalEditGesture(control);
      }
    },true);
    return true;
  };
})(typeof window==='object' ? window : globalThis);
