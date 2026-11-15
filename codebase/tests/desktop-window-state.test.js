const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Exercise the production event consumer without launching a Windows desktop.
const source=fs.readFileSync(path.join(__dirname,'../frontend/desktop-chrome.js'),'utf8');
const start=source.indexOf('  const setWindowState =');
const end=source.indexOf('  document.querySelectorAll("[data-window-action]")',start);
test('native window-state events update maximize/restore image and accessible name together',()=>{
 const attributes={},classes=new Set(),image={src:''};
 const button={setAttribute:(key,value)=>attributes[key]=value,classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)},querySelector:()=>image};
 const context=vm.createContext({document:{documentElement:{classList:{toggle(){}}},querySelector:()=>button},button});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.update=setWindowState;',context);
 for(const maximized of [false,true,false,true]){
  context.update({maximized});assert.equal(attributes['aria-label'],maximized?'Restore':'Maximize');assert.equal(button.title,attributes['aria-label']);
  assert.equal(image.src,`/static/assets/icons/tabler/${maximized?'copy':'square'}.svg`);assert.equal(classes.has('is-maximized'),maximized);
 }
});
