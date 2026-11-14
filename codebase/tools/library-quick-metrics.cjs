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
 return {valid:probe?.hidden===false&&probe.native_hidden===false&&probe.frames>0,hidden:probe?.hidden??null,native_hidden:probe?.native_hidden??null,frames:probe?.frames??0};
}
function viewportCoverage(files,seen,shown){
 const normalize=path=>String(path).replaceAll('\\','/');
 const visited=new Set((seen||[]).map(row=>normalize(row.path)));
 return {...coverage(files.filter(path=>visited.has(normalize(path))),shown),
  unvisited:files.filter(path=>!visited.has(normalize(path)))};
}
// Keep unfinished grants too: a missing picture is not evidence of a decode failure.
function photoDiagnostics(files,events,openedAt,log,grants={},work={},facts={},actions=[]){
 const normalized=p=>String(p||'').replaceAll('\\','/');
 const rows=new Map(files.map(path=>[normalized(path),{path:normalized(path),type:normalized(path).split('.').at(-1).toUpperCase(),...facts[normalized(path)],first_request_s:null,first_picture_s:null,route:null,grants:[],failures:[],work:[]} ]));
 const records=new Map();
 for(const line of log.split('\n')){
  const match=line.match(/^\[library\] (library_grant_\w+) (\{.*\})$/);if(!match)continue;
  let d;try{d=JSON.parse(match[2]);}catch{continue;}
  if(!rows.has(normalized(d.path)))continue;
  const previous=records.get(d.request);
  records.set(d.request,{...previous,...d,event:match[1]});
 }
 for(const d of records.values())rows.get(normalized(d.path)).grants.push(d);
 for(const d of grants.jobs||[]){
  const row=rows.get(normalized(d.path));if(!row)continue;
  row.pending_grants??=[];row.pending_grants.push(d);
 }
 for(const queue of Object.values(work))for(const d of queue.jobs||[]){
  const row=rows.get(normalized(d.path));if(row)row.work.push(d);
 }
 for(const e of events||[]){
  const row=rows.get(normalized(e.path));if(!row||e.at<openedAt)continue;
  if(e.stage==='picture_work_waiting'&&row.first_request_s===null)row.first_request_s=+((e.at-openedAt)/1000).toFixed(3);
  if(e.stage==='picture_shown'&&row.first_picture_s===null){row.first_picture_s=+( (e.at-openedAt)/1000).toFixed(3);const requestedAt=openedAt+(row.first_request_s??row.first_picture_s)*1000;const action=[...actions].reverse().find(a=>a.at<=requestedAt);row.action_start_s=action?(action.at-openedAt)/1000:0;row.action_to_picture_s=+(row.first_picture_s-row.action_start_s).toFixed(3);row.route=e.reason||e.route;row.draw_route=e.route;row.production_path=row.route==='camera picture'?'embedded preview':row.route==='original file'?'decoded SDR file':row.saved_grade?'saved grade':/^(ARW|CR2|CR3|DNG|NEF|ORF|RAF|RW2)$/.test(row.type)?'developed RAW':'decoded HDR file';row.request_to_picture_s=row.first_request_s===null?null:+(row.first_picture_s-row.first_request_s).toFixed(3);}
  if(e.stage==='picture_development_start')row.development_reason=e.reason;
  if(e.stage==='picture_work_failed')row.failures.push(e.reason);
 }
 const types={};
 for(const row of rows.values()){
  const group=types[row.type]??={eligible:0,requested:0,pictured:0,action_to_picture_s:[],request_to_picture_s:[],first_picture_s:[],routes:{},granted:0,ungranted:0,max_wait_ms:0,wait_reasons:[],failures:0};
  group.eligible++;if(row.first_request_s!==null)group.requested++;if(row.first_picture_s!==null){group.pictured++;group.action_to_picture_s.push(row.action_to_picture_s);if(row.request_to_picture_s!==null)group.request_to_picture_s.push(row.request_to_picture_s);group.first_picture_s.push(row.first_picture_s);group.routes[row.production_path]=(group.routes[row.production_path]||0)+1;}
  for(const d of row.grants){if(d.granted_at!=null)group.granted++;else group.ungranted++;group.max_wait_ms=Math.max(group.max_wait_ms,d.wait_ms||0);if(d.waited_for||d.reason)group.wait_reasons.push(d.waited_for||d.reason);}
  group.failures+=row.failures.length;
 }
 for(const group of Object.values(types)){group.action_to_picture_s.sort((a,b)=>a-b);group.request_to_picture_s.sort((a,b)=>a-b);group.first_picture_s.sort((a,b)=>a-b);group.wait_reasons=[...new Set(group.wait_reasons)];}
 return {photos:[...rows.values()],by_type:types};
}
module.exports={pictures,coverage,visibility,photoDiagnostics,viewportCoverage};
