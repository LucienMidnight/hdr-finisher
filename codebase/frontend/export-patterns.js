/* Filename examples use the same documented tokens as the backend. */
(() => {
  function safeComponent(value) {
    let name=String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").trim().replace(/[. ]+$/,"")||"untitled";
    if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name="_"+name;
    return [...name].slice(0,180).join("");
  }
  function render(pattern, photo, sequence, version, preset) {
    const date=String(photo.capture_time||"").match(/^(\d{4})-(\d{2})-(\d{2})/);
    const dateFormats=date?{"YYYY-MM-DD":`${date[1]}-${date[2]}-${date[3]}`,YYYYMMDD:date[1]+date[2]+date[3],YYYY:date[1],"YYYY-MM":`${date[1]}-${date[2]}`,"DD-MM-YYYY":`${date[3]}-${date[2]}-${date[1]}`} : {};
    const values={filename:String(photo.source_path||"example.raw").split(/[\\/]/).at(-1).replace(/\.[^.]+$/,""),copy:photo.copy_name||"",sequence:String(sequence),date:dateFormats["YYYY-MM-DD"]||"undated",rating:String(photo.rating||0),version,preset};
    return safeComponent(String(pattern).replace(/\{([^{}]+)\}/g,(_,token)=>{
      if(token.startsWith("sequence:")){
        const value=token.slice(9);if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>12)throw Error("Sequence padding must be 1 to 12.");
        return String(sequence).padStart(Number(value),"0");
      }
      if(token.startsWith("date:")){
        const format=token.slice(5);if(!["YYYY-MM-DD","YYYYMMDD","YYYY","YYYY-MM","DD-MM-YYYY"].includes(format))throw Error("Unknown capture date format.");
        return dateFormats[format]||"undated";
      }
      if(!Object.hasOwn(values,token))throw Error(`Unknown filename token: ${token}`);
      return values[token];
    }));
  }
  const api=Object.freeze({safeComponent,render});
  if(typeof module!=="undefined")module.exports=api;else window.HDRExportPatterns=api;
})();
