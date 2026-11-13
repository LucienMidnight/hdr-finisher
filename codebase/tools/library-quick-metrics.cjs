// Picture timing is exclusively the Library page clock; backend logs are diagnostic.
function pictures(events,openedAt){
 const shown=new Map(),preview=new Map();
 for(const e of events||[]){
  const t=(e.at-openedAt)/1000,name=String(e.path||'').replaceAll('\\','/');
  if(!name||!Number.isFinite(t)||t<0)continue;
  if(e.stage==='picture_shown'&&!shown.has(name))shown.set(name,t);
  if(e.stage==='picture_camera_preview_decoded'&&!preview.has(name))preview.set(name,t);
 }
 return {shown,preview};
}
function coverage(files,shown){
 const eligible=[...new Set(files.map(file=>String(file).replaceAll('\\','/')))];
 const missing=eligible.filter(name=>!shown.has(name));
 return {eligible:eligible.length,pictured:eligible.length-missing.length,complete:eligible.length>0&&missing.length===0,missing};
}
function visibility(probe){
 return {valid:probe?.hidden===false&&probe.frames>0,hidden:probe?.hidden??null,frames:probe?.frames??0};
}
module.exports={pictures,coverage,visibility};
