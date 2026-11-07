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
  assert.equal(reuse(source,target),file);assert.equal(fs.readFileSync(file,'utf8'),'original');
  assert.equal(fs.existsSync(file+'.hdrf'),false);
  try {fs.writeFileSync(file+'.hdrf','failed run');throw Error('failure');} catch {} finally {reuse.cleanup();}
  assert.equal(fs.readFileSync(file+'.hdrf','utf8'),'saved');
  assert.equal(fs.readFileSync(source,'utf8'),'changed');
 } finally {reuse.cleanup();fs.rmSync(persistent,{recursive:true,force:true});fs.rmSync(scratch,{recursive:true,force:true});}
});
