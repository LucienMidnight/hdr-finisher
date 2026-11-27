const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
 constructor(tag,text='',className=''){this.tag=tag;this.textContent=text;this.className=className;this.children=[];this.dataset={};this.attributes={};}
 append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 setAttribute(name,value){this.attributes[name]=value;}
 get firstChild(){return this.children[0];} get lastChild(){return this.children.at(-1);}
 remove(){this.parent.children.splice(this.parent.children.indexOf(this),1);}
 querySelectorAll(){return this.children.filter(item=>item.className==='batch-badge'||item.tag==='progress');}
}
function harness(source=fs.readFileSync(require.resolve('../frontend/batch-export.js'),'utf8')){
 const model={photos:[],selected:new Set(),draft:{versions:[{}]},job:null},grid=new Element('div');
 const context={model,$:()=>grid,node:(...args)=>new Element(...args),fileCount:()=>1,hdrSkipped:()=>false,largeAvifRisk:()=>false,
  terminal:job=>['finished','failed','cancelled'].includes(job.state),syncTiles(){},example(){},selectPhoto(){}};
 vm.createContext(context);
 const start=source.indexOf('  function renderGrid()'),end=source.indexOf('  function renderJob()',start);
 assert.ok(start>=0&&end>start);
 vm.runInContext(source.slice(start,end),context);
 return {model,grid,render:()=>context.renderGrid()};
}
test('batch progress groups each photo without changing badge precedence or retained rows',()=>{
 const s=harness();s.model.photos=['a','b','c','d','e'].map(path=>({path,name:path}));s.model.selected.add('b');
 s.model.job={state:'running',active_photo:'d',stage:'Encoding',photo_progress:.5,results:[
  {photo:'a',outcome:'exported'},{photo:'b',outcome:'skipped'},{photo:'c',outcome:'failed'},
  {photo:'c',outcome:'skipped'},{photo:'d',outcome:'skipped'},{photo:'outside',outcome:'failed'}]};
 s.render();const rows=[...s.grid.children];
 const badges=()=>s.grid.children.map(row=>row.firstChild.children.find(item=>item.className==='batch-badge')?.textContent||'');
 assert.deepEqual(badges(),['Done','1 skipped','Failed','Encoding','']);
 assert.equal(rows[1].attributes['aria-selected'],'true');
 assert.equal(rows[3].firstChild.children.find(item=>item.tag==='progress').value,50);
 s.model.job={state:'finished',results:[{photo:'a',outcome:'renamed'}]};s.render();
 assert.deepEqual(badges(),['Done','','','','']);
 s.grid.children.forEach((row,i)=>assert.equal(row,rows[i],'Progress preserves photo row and keyboard focus'));
});
test('batch grid accepts an empty job and clears removed rows',()=>{
 const s=harness();s.model.photos=[{path:'a',name:'A'}];s.render();assert.equal(s.grid.children.length,1);
 s.model.photos=[];s.render();assert.equal(s.grid.children.length,0);
});
module.exports={harness};


test('late batch selection replies cannot replace newer photos or reset their destination',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/batch-export.js'),'utf8');
 const pending=[],display={};let renders=0;
 const model={paths:[],photos:[],selected:new Set(),directory:'',grant:null,anchor:0};
 const context={model,$:()=>display,renderGrid:()=>renders++,api:(_route,body)=>new Promise(resolve=>pending.push({body,resolve}))};
 vm.createContext(context);const start=source.indexOf('  let photoRequest='),end=source.indexOf('  async function authorizeDirectory',start);
 vm.runInContext(source.slice(start,end),context);
 const old=context.setPhotos(['old']),fresh=context.setPhotos(['fresh']);
 pending[1].resolve({photos:[{path:'fresh',source_path:'/new/photo.raw'}]});assert.equal(await fresh,true);
 model.directory='/chosen';model.grant='chosen-grant';model.selected.add('fresh');
 pending[0].resolve({photos:[{path:'old',source_path:'/old/photo.raw'}]});assert.equal(await old,false);
 assert.deepEqual(Array.from(model.paths),['fresh']);assert.equal(model.photos[0].path,'fresh');
 assert.equal(model.directory,'/chosen');assert.equal(model.grant,'chosen-grant');assert.deepEqual([...model.selected],['fresh']);assert.equal(renders,1);
});
