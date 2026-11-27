const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('delivery idle reports await the main process collection acknowledgement',async()=>{
 let bridge,ack;
 const calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/delivery-memory-preload.cjs'),'utf8'),{
  require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{
   send:()=>{throw Error('Idle must be acknowledged');},
   invoke:(channel,idle)=>{calls.push([channel,idle]);return new Promise(resolve=>{ack=resolve;});}
  }})
 });
 let settled=false;
 const pending=bridge.idle(true).then(()=>{settled=true;});
 await Promise.resolve();assert.equal(settled,false);
 assert.deepEqual(calls,[['desktop:delivery-memory-idle',true]]);
 ack();await pending;assert.equal(settled,true);
});
