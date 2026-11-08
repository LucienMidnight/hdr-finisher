// Persistent per-check photos: exFAT cannot hard-link, so copy once and reuse.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const cache=path.resolve(__dirname,'../../output/test-photos');
const sidecars=new Map();
function source(file) {
  const candidates=[file,path.join(cache,path.basename(file)),path.join(cache,'library-live-grid',path.basename(file)),
    path.join(cache,createHash('sha256').update(path.resolve(file)).digest('hex')+path.extname(file))];
  const found=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
  if(!found)throw Error('Missing reusable test photo: '+file);
  return path.resolve(found);
}
function reusePhoto(original,target) {
  const relative=path.relative(path.resolve(__dirname,'../../output'),target).split(path.sep);
  const check=relative[0];
  if(!check||check==='..'||path.isAbsolute(check))throw Error('Test target must be under output/<check>/');
  const file=path.join(cache,check,path.basename(target));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(!fs.existsSync(file))fs.copyFileSync(source(original),file,fs.constants.COPYFILE_EXCL);
  const sidecar=file+'.hdrf';
  if(!sidecars.has(sidecar)) {
    sidecars.set(sidecar,fs.existsSync(sidecar)?fs.readFileSync(sidecar):null);
    fs.rmSync(sidecar,{force:true});
  }
  return file;
}
// Original saved grades restored for the checks (read-only; never write them).
const savedGrades=path.join(cache,'saved-grades');
// Fresh working copy of an original saved grade in the check's own photo
// folder, replaced on every run so the check always starts from the original.
// The copy is not named as the RAW's sidecar, so the app never loads it alone.
function savedGrade(name,check) {
  const original=path.join(savedGrades,name);
  if(!fs.existsSync(original))throw Error('Missing saved grade: '+original);
  const folder=path.join(cache,check);
  fs.mkdirSync(folder,{recursive:true});
  const copy=path.join(folder,path.basename(name,'.hdrf')+'.saved-grade.hdrf');
  if(fs.existsSync(copy)){fs.chmodSync(copy,0o666);fs.rmSync(copy);}
  fs.copyFileSync(original,copy);
  fs.chmodSync(copy,0o666);
  return copy;
}
function cleanup() {
  for(const [file,bytes] of sidecars) {
    if(bytes===null)fs.rmSync(file,{force:true});else fs.writeFileSync(file,bytes);
  }
  sidecars.clear();
}
process.once('exit',cleanup);
module.exports=Object.assign(reusePhoto,{source,savedGrade,cleanup});
