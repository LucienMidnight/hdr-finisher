// Picture timing is exclusively the Library page clock; backend logs are diagnostic.
function pictures(events,openedAt){
 const shown=new Map(),preview=new Map();
 for(const e of events||[]){
  const t=(e.at-openedAt)/1000,name=String(e.path||'').replaceAll('\\','/').split('/').pop();
  if(!name||!Number.isFinite(t)||t<0)continue;
  if(e.stage==='picture_shown'&&!shown.has(name))shown.set(name,t);
  if(e.stage==='picture_camera_preview_decoded'&&!preview.has(name))preview.set(name,t);
 }
 return {shown,preview};
}
module.exports={pictures};
