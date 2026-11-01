// One physical copy per large source; each disposable test gets a hard link.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=(source,target)=>{
  const folder=path.resolve(__dirname,'../../output/test-photos');
  fs.mkdirSync(folder,{recursive:true});
  const key=createHash('sha256').update(path.resolve(source)).digest('hex');
  const cached=path.join(folder,key+path.extname(source));
  if(!fs.existsSync(cached))fs.copyFileSync(source,cached,fs.constants.COPYFILE_EXCL);
  fs.linkSync(cached,target);
};
