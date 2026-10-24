/* Source-sized framing rectangles, shared by Grade and Library. Never rasterize the photo. */
(() => {
  const defaults = () => ({enabled:false,frame:{enabled:true,color:"#ffffff",unit:"percent",value:5},border:{enabled:true,color:"#202020",unit:"percent",value:.25}});
  // Match the host's decimal half-up rule, including ties such as 1.005% of
  // 10000 pixels. Binary multiplication alone can round that tie downward.
  function fraction(value) {
    const [mantissa,exponent="0"]=String(value).toLowerCase().split("e"),parts=mantissa.split(".");
    const places=(parts[1]||"").length-Number(exponent),digits=BigInt(parts.join(""));
    return places>0?[digits,10n**BigInt(places)]:[digits*10n**BigInt(-places),1n];
  }
  function thickness(value,unit,w,h) {
    const [n,d]=fraction(value);return unit==="percent"?[n*BigInt(Math.min(w,h)),d*100n]:[n,d];
  }
  function layerPixels(layer,w,h) {
    if(!layer?.enabled)return 0;
    const [n,d]=thickness(layer.value,layer.unit,w,h);return Number((2n*n+d)/(2n*d));
  }
  function layout(w,h,settings) {
    w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));
    const frame=settings?.enabled?layerPixels(settings.frame,w,h):0,border=settings?.enabled?layerPixels(settings.border,w,h):0,inset=frame+border;
    return {width:w+2*inset,height:h+2*inset,frame,border,photo:[inset,inset,w,h]};
  }
  function convert(value,from,to,w,h) {
    if(from===to)return value;
    const [n,d]=fraction(value),shorter=BigInt(Math.min(Math.round(w),Math.round(h)));
    return from==="percent"?Number(n*shorter)/Number(d*100n):Number(n*100n)/Number(d*shorter);
  }
  function draw(parent,box,settings,{scale=1,left="50%",top="50%",visible=true}={}) {
    let svg=parent.querySelector(":scope > svg[data-photo-framing]");
    if(!svg){svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.dataset.photoFraming="";svg.setAttribute("aria-hidden","true");parent.prepend(svg);}
    svg.style.cssText=`position:absolute;pointer-events:none;z-index:0;left:${left};top:${top};transform:translate(-50%,-50%);width:${box.width*scale}px;height:${box.height*scale}px;display:${visible&&box.frame+box.border>0?"block":"none"}`;
    svg.setAttribute("viewBox",`0 0 ${box.width} ${box.height}`);
    const key=JSON.stringify([box,settings?.frame?.color,settings?.border?.color]);
    if(svg.dataset.layout!==key){
      svg.dataset.layout=key;svg.replaceChildren();
      for(const [inset,color] of [[0,settings?.border?.color],[box.border,settings?.frame?.color]]){
        const rect=document.createElementNS(svg.namespaceURI,"rect");
        for(const [name,value] of Object.entries({x:inset,y:inset,width:box.width-2*inset,height:box.height-2*inset,fill:color||"#000000"}))rect.setAttribute(name,String(value));
        svg.append(rect);
      }
    }
    return svg;
  }
  const api={defaults,layout,convert,draw};
  if(typeof module!=="undefined")module.exports=api;else window.HDRPhotoFraming=api;
})();