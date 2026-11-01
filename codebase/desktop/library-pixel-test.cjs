// Explicit test-profile mode of the plain Electron runner.
const fs=require('node:fs'),path=require('node:path');
async function run({frame,config,stage}){
 const {phase,edge,out,photos,resume}=config.pixelCapture;
 const report=resume?JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8')):{phase,edge,view:edge===640?'grid':'single',rows:[]};
 const completed=new Set(report.rows.map(row=>row.name));
 const source=fs.readFileSync(path.join(__dirname,'../tools/library-pixel-scenario.js'),'utf8');
 await frame.executeJavaScript(`fetch('/api/library/memory-setting',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bytes:4e9})}).then(()=>true)`);
 try{
  for(const {index,photo} of photos){
   if(completed.has(path.basename(photo)))continue;
   stage(path.basename(photo));
   const row=await frame.executeJavaScript(`(${source})(${JSON.stringify({photo,edge})})`);
   if(row.lanes)for(const [lane,length] of Object.entries(row.lanes)){
    const file=index+'-'+lane+'.f16',target=path.join(out,file);fs.writeFileSync(target,Buffer.alloc(0));
    for(let offset=0;offset<length;offset+=1024*1024){
     const bytes=await frame.executeJavaScript(`Array.from(window.__fixtureCaptured[${JSON.stringify(lane)}].subarray(${offset},${offset+1024*1024}))`);
     fs.appendFileSync(target,Buffer.from(bytes));
    }
    row.lanes[lane]=file;
   }
   await frame.executeJavaScript('delete window.__fixtureCaptured');
   report.rows.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
  }
  report.complete=true;
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));}
}
module.exports={run};
