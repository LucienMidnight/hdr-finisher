const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const reuse=require('./helpers/reuse-test-photo.cjs');
test('persistent test copies reuse pixels and restore disposable sidecars on success or failure',()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-reuse-'));
 const name='reuse-helper-unit-'+process.pid;
 const target=path.resolve(__dirname,'../output',name,'run','fixture.dat');
 const persistent=path.resolve(__dirname,'../output/test-photos',name);
 try {
  const source=path.join(scratch,'fixture.dat');fs.writeFileSync(source,'original');
  const file=reuse(source,target);assert.equal(fs.readFileSync(file,'utf8'),'original');
  fs.writeFileSync(file+'.hdrf','disposable');reuse.cleanup();assert.equal(fs.existsSync(file+'.hdrf'),false);
  fs.writeFileSync(file+'.hdrf','saved');fs.writeFileSync(source,'changed');
  assert.equal(reuse(source,target),file);assert.equal(fs.readFileSync(file,'utf8'),'changed');
  assert.equal(fs.existsSync(file+'.hdrf'),false);
  try {fs.writeFileSync(file+'.hdrf','failed run');throw Error('failure');} catch {} finally {reuse.cleanup();}
  assert.equal(fs.readFileSync(file+'.hdrf','utf8'),'saved');
  assert.equal(fs.readFileSync(source,'utf8'),'changed');
 } finally {reuse.cleanup();fs.rmSync(persistent,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});}
});

test('reused photos and saved grades have the backend identity through shared-directory links',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hdr-finisher-reuse-test-')));
 let reuse,helper;
 try{
  const codebase=path.join(root,'checkout'),shared=path.join(root,'shared');
  fs.mkdirSync(path.join(codebase,'tests/helpers'),{recursive:true});fs.mkdirSync(path.join(codebase,'output'),{recursive:true});fs.mkdirSync(shared);
  fs.symlinkSync(shared,path.join(codebase,'output/test-photos'),process.platform==='win32'?'junction':'dir');
  helper=path.join(codebase,'tests/helpers/reuse-test-photo.cjs');
  fs.copyFileSync(path.join(__dirname,'helpers/reuse-test-photo.cjs'),helper);reuse=require(helper);
  const original=path.join(root,'photo.png'),target=path.join(codebase,'output/probe/photo.png');
  fs.writeFileSync(original,Buffer.from([1,2,3,4]));
  const photo=reuse(original,target);
  const backendIndex=new Map([[fs.realpathSync(path.join(shared,'probe/photo.png')),'selected']]);
  assert.equal(backendIndex.get(photo),'selected');assert.deepEqual(fs.readFileSync(photo),fs.readFileSync(original));
  reuse.cleanup();
  const saved=Buffer.from('{"grade":"original"}');fs.writeFileSync(photo+'.hdrf',saved);
  assert.equal(reuse(original,target),photo);assert.equal(fs.existsSync(photo+'.hdrf'),false);
  fs.writeFileSync(photo+'.hdrf','temporary test grade');reuse.cleanup();assert.deepEqual(fs.readFileSync(photo+'.hdrf'),saved);
  const clone=reuse.savedGrade(photo+'.hdrf','saved-grade-probe');assert.equal(clone,fs.realpathSync(clone));assert.deepEqual(fs.readFileSync(clone),saved);
  assert.deepEqual(fs.readFileSync(original),Buffer.from([1,2,3,4]));
 }finally{if(reuse){reuse.cleanup();process.removeListener('exit',reuse.cleanup);}if(helper)delete require.cache[helper];fs.rmSync(root,{recursive:true,force:true});}
});
