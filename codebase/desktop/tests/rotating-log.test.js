const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {create} = require('../lib/rotating-log');
test('rotation bounds old logs, oversized writes and restart', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-log-'));
 try {
  const file=path.join(dir,'backend.log');
  const log=create(file,{maxBytes:10,backups:2});
  log.append('0123456789');
  assert.equal(fs.existsSync(file+'.1'),false);
  log.append('abcdefghijK');
  assert.equal(fs.readFileSync(file+'.1','utf8'),'abcdefghij');
  assert.equal(fs.readFileSync(file+'.2','utf8'),'0123456789');
  log.append('1234567890');
  assert.equal(fs.readFileSync(file+'.1','utf8'),'K');
  assert.equal(fs.readFileSync(file,'utf8'),'1234567890');
  log.append('x'.repeat(50));
  assert.equal(fs.readdirSync(dir).length,3);
  for(const name of fs.readdirSync(dir)) assert.ok(fs.statSync(path.join(dir,name)).size<=10);
  fs.writeFileSync(file,'old'.repeat(50));
  const restarted=create(file,{maxBytes:10,backups:2});
  assert.equal(fs.statSync(file).size,10);
  restarted.append('new');
  assert.equal(fs.readFileSync(file,'utf8'),'new');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('stream serializes backend and main-process records across rotations', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-stream-log-'));
 try {
  const file=path.join(dir,'backend.log');
  const {stream}=create(file,{maxBytes:10,backups:2});
  const done=require('node:stream/promises').finished(stream);
  stream.write('0123456789');
  stream.write('abcdefghij');
  stream.end('new');
  await done;
  assert.equal(fs.readFileSync(file,'utf8'),'new');
  assert.equal(fs.readFileSync(file+'.1','utf8'),'abcdefghij');
  assert.equal(fs.readFileSync(file+'.2','utf8'),'0123456789');
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('seven-backup startup trim, growth from two backups and reduced allowance', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-log-seven-'));
 try {
  const file=path.join(dir,'backend.log');
  for (let i=0;i<=2;i++) fs.writeFileSync(i ? file+'.'+i : file,'old'.repeat(20));
  const log=create(file,{maxBytes:10,backups:7});
  for (let i=0;i<=2;i++) assert.equal(fs.statSync(i ? file+'.'+i : file).size,10);
  for (let i=0;i<10;i++) log.append(String(i).repeat(10));
  assert.equal(fs.readdirSync(dir).length,8);
  for (let i=1;i<=7;i++) assert.equal(fs.readFileSync(file+'.'+i,'utf8'),String(9-i).repeat(10));
  fs.writeFileSync(file+'.7','tail'.repeat(30));
  create(file,{maxBytes:10,backups:7});
  assert.equal(fs.readFileSync(file+'.7','utf8'),'iltailtail');
  create(file,{maxBytes:10,backups:1});
  assert.deepEqual(fs.readdirSync(dir).sort(),['backend.log','backend.log.1']);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
