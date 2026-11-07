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
function cleanup() {
  for(const [file,bytes] of sidecars) {
    if(bytes===null)fs.rmSync(file,{force:true});else fs.writeFileSync(file,bytes);
  }
  sidecars.clear();
}
process.once('exit',cleanup);
module.exports=Object.assign(reusePhoto,{source,cleanup});
