/* Shared editable-name proposal for both album kinds. */
(() => {
 "use strict";
 function copyName(name,names) {
  const taken=new Set(names.map(value=>value.toLocaleLowerCase())),base=`Copy of ${name}`;
  let candidate=base.slice(0,120),number=2;
  while(taken.has(candidate.toLocaleLowerCase())) {
   const suffix=` (${number++})`;candidate=base.slice(0,120-suffix.length)+suffix;
  }
  return candidate;
 }
 const api=Object.freeze({copyName});
 if(typeof module!=="undefined")module.exports=api;else globalThis.HDRLibraryAlbumNames=api;
})();
