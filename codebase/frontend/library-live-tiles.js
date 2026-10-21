window.addEventListener("hdrfinisher:webgpulost",()=>{
  if(parent!==window)parent.dispatchEvent(new parent.CustomEvent("hdrfinisher:webgpulost"));
});
/* Shared visible-only tile drawing for the Export page. */
window.HDRLibraryLiveTiles = Object.freeze({
  async draw(path, canvas, signal, current, hdr=false) {
    const wait=ms=>new Promise((resolve,reject)=>{
      if(signal.aborted)return reject(new DOMException("Cancelled","AbortError"));
      const stop=()=>{clearTimeout(timer);reject(new DOMException("Cancelled","AbortError"));};
      const timer=setTimeout(()=>{signal.removeEventListener("abort",stop);resolve();},ms);
      signal.addEventListener("abort",stop,{once:true});
    });
    let fallback;
    try {
      while(current()&&!signal.aborted){
        try {
          await HDRLibraryPictures.initialize();
          const meta=await HDRLibraryScenes.load(path,640,signal,80);
          if(!current())return;
          await HDRLibraryPictures.show(meta,canvas,signal,current,hdr);
          if(!current())return;
          fallback?.remove();fallback=null;canvas.hidden=false;canvas.dataset.liveTile=meta.key;
          return meta;
        }catch(error){
          if(signal.aborted||!current()||error.name==="AbortError")return;
          if(error.libraryYield){await wait(50);continue;}
          if(HDRLibraryPictures.usable())throw error;
          if(!fallback){
            const response=await fetch("/api/library/fallback-picture",{method:"POST",signal,
              headers:{"Content-Type":"application/json"},body:JSON.stringify({path,edge:640,priority:80})});
            if(response.status===202){await wait(150);continue;}
            if(!response.ok)throw Error("The CPU tile could not be prepared.");
            const meta=await response.json();if(!current())return;
            fallback=canvas.ownerDocument.createElement("img");fallback.alt="";fallback.src=meta.url;
            await fallback.decode();if(!current())return;
            fallback.dataset.cpuFallback="true";canvas.after(fallback);canvas.hidden=true;
          }
          await wait(2000);
        }
      }
    }finally{fallback?.remove();}
  }
});
