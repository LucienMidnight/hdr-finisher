const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../main.js'),'utf8');
const start=source.indexOf('function saveWindowBounds('),end=source.indexOf('async function createWindow(',start);
test('unwritable window-state storage cannot interrupt window close or session end',()=>{
 const warnings=[],calls=[];
 const context={fs:{writeFileSync:(...args)=>{calls.push(args);throw Error('Disk full');}},windowStatePath:role=>role+'.json',console:{warn:value=>warnings.push(value)}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const record={role:'library',window:{isDestroyed:()=>false,isMinimized:()=>false,getNormalBounds:()=>({width:1100,height:720})}};
 assert.doesNotThrow(()=>context.saveWindowBounds(record));assert.equal(calls.length,1);assert.match(warnings[0],/Disk full/);
 for(const flag of ['isDestroyed','isMinimized']){const skipped={role:'main',window:{...record.window,[flag]:()=>true}};context.saveWindowBounds(skipped);}
 assert.equal(calls.length,1,'Destroyed and minimized windows keep their previous saved bounds');
});
