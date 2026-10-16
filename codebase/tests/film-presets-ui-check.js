const assert = require('node:assert/strict');
module.exports = async function(page) {
 const result=await page.evaluate(async()=>{
  const check=(ok,label)=>{if(!ok) throw Error(label);};
  const original=structuredClone(state.adjustments), shell=window.HDRApplicationShell;
  const saved=[];
  // Keep preset persistence in memory so this driver cannot write Steve's preset folder.
  window.HDRApplicationShell={...shell,listGradingPresets:async()=>saved,saveGradingPreset:async p=>saved.push(structuredClone(p))};
  const group=document.querySelector('[data-group="film-look"]');
  const applyLook=async id=>{
   state.groupPresetContext=groupPresetContextForElement(group);
   const preset=builtInGroupPresets(state.groupPresetContext).find(p=>p.id===`built-in:${id}`);
   check(preset,`missing Look ${id}`); applyGroupPreset(preset); await syncGlobalEditState();
  };
  try {
   for(const lane of ['hdr','sdr']) {
    await switchLane(lane);
    const outside=structuredClone(state.adjustments);
    for(const [stage,entries] of Object.entries(HDRFilmCharacter.stages)) {
     const menu=document.querySelector(`[data-film-stage="${stage}"]`); check(menu,`missing ${stage}`);
     for(let i=0;i<entries.length;i++) {
      menu.value=String(i);menu.dispatchEvent(new Event('change',{bubbles:true})); await syncGlobalEditState();
      const f=state.adjustments[lane].film_look;
      for(const [key,value] of Object.entries(entries[i][1])) {
       check(f[key]===value,`${stage} value ${key}`);
       check(!document.querySelector(`[data-stock-reset="${key}"]`)?.hidden,`${stage} missing dot ${key}`);
      }
     }
    }
    for(const look of FILM_LOOK_PRESETS) {
     await applyLook(look.id);
     const expected=HDRFilmCharacter.expand(look.recipe);
     for(const key of Object.keys(expected)) check(JSON.stringify(state.adjustments[lane].film_look[key])===JSON.stringify(expected[key]),`${lane} ${look.id} replacement ${key}`);
    }
    const after=structuredClone(state.adjustments);
    delete outside[lane].film_look;delete after[lane].film_look;
    check(JSON.stringify(outside)===JSON.stringify(after),'Look touched another group or lane');
    await applyLook('high-speed-texture');
    await queueEditCommand('undo');
    check(state.adjustments[lane].film_look.film_stock==='kodak_vision3_200t','undo Look');
    await queueEditCommand('redo');check(state.adjustments[lane].film_look.push_pull===1,'redo Look');
    await openGroupPresetDialog(group);els.groupPresetName.value=`Generated ${lane}`;await saveCurrentGroupPreset();
    const stored=saved.at(-1).values[`${lane}.film_look`];
    check(!Object.hasOwn(stored,'grain_amount') && stored.push_pull===1,'saved Look expanded stock defaults');
    await applyLook('portra-400-natural');
    state.groupPresetContext=groupPresetContextForElement(group);applyGroupPreset(saved.at(-1));await syncGlobalEditState();
    check(state.adjustments[lane].film_look.push_pull===1 && !state.adjustments[lane].film_look.stock_overrides.includes('grain_amount'),'saved Look reapply');
    HDRFilmCharacter.select(state.adjustments[lane].film_look,'kodak_gold_200');syncControlsFromState();await syncGlobalEditState();
    check(state.adjustments[lane].film_look.grain_film_format==='super16' && state.adjustments[lane].film_look.grain_amount===HDRFilmCharacterData.stocks.kodak_gold_200.defaults.grain_amount,'stock swap in Look');
   }
   await switchLane('sdr');matchHdrFilmLookToSdr();await syncGlobalEditState();
   check(JSON.stringify(state.adjustments.hdr.film_look)===JSON.stringify(state.adjustments.sdr.film_look),'Match HDR sparse ownership');
   const control=document.querySelector('[data-path="current.film_look.lens_size"]');control.value='1.7';control.dispatchEvent(new Event('input',{bubbles:true}));await syncGlobalEditState();
   check(state.adjustments.hdr.film_look.lens_size!==1.7,'Match HDR shared references');
   document.querySelector('[data-stock-reset="lens_size"]').click();await syncGlobalEditState();
   check(state.adjustments.sdr.film_look.lens_size===1 && !state.adjustments.sdr.film_look.stock_overrides.includes('lens_size'),'new control dot reset');
   return true;
  } finally {
   window.HDRApplicationShell=shell;state.adjustments=original;syncControlsFromState();invalidatePreview('hdr');invalidatePreview('sdr');await syncGlobalEditState();
  }
 });
 assert.equal(result,true);console.log('Phase 5 UI: every stage/Look, HDR/SDR, sparse save/reapply, stock swap, undo/redo, reset and Match HDR PASS');
};
