/* Portable group preset files; storage identities and built-in flags never travel. */
(function(root) {
  "use strict";
  const format = "hdr-finisher-grading-presets";
  function clean(preset) {
    if (!preset || typeof preset.groupId !== "string" || !/^(hdr|sdr)-[a-z-]+$/.test(preset.groupId)
      || typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 80
      || !preset.values || typeof preset.values !== "object" || Array.isArray(preset.values)
      || Object.keys(preset.values).some(key => ["__proto__", "constructor", "prototype"].includes(key))
      || JSON.stringify(preset.values).length > 200000) throw Error("Invalid grading preset file.");
    return {groupId:preset.groupId,name:preset.name.trim().replace(/\s+/g," "),
      recipeVersion:Number.isInteger(preset.recipeVersion) && preset.recipeVersion > 0 ? preset.recipeVersion : 1,
      values:JSON.parse(JSON.stringify(preset.values))};
  }
  function encode(presets) {
    if (!Array.isArray(presets) || !presets.length || presets.length > 500) throw Error("Select 1 to 500 presets.");
    const text=JSON.stringify({format,version:1,presets:presets.map(clean)},null,2);
    if(text.length>2*1024*1024)throw Error("Preset file is too large (2 MiB maximum).");
    return text;
  }
  function decode(text) {
    if (text.length > 2*1024*1024) throw Error("Preset file is too large (2 MiB maximum).");
    const file=JSON.parse(text);
    if (file.format !== format || file.version !== 1 || !Array.isArray(file.presets) || !file.presets.length || file.presets.length > 500)
      throw Error("This is not a supported grading preset file.");
    return file.presets.map(clean);
  }
  function keepBoth(presets, existing) {
    const names=new Set(existing.map(p=>p.name.toLocaleLowerCase()));
    return presets.map(preset=>{
      const copy=clean(preset);let name=copy.name,index=1;
      while(names.has(name.toLocaleLowerCase())) {
        const suffix=` (imported${index===1?"":" "+index})`;
        name=copy.name.slice(0,80-suffix.length)+suffix;index++;
      }
      names.add(name.toLocaleLowerCase());return {...copy,name};
    });
  }
  const api=Object.freeze({encode,decode,keepBoth});
  if(typeof module!=="undefined")module.exports=api;else root.HDRGradingPresetFiles=api;
})(typeof window==="undefined"?globalThis:window);
