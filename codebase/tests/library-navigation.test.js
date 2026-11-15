const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
class Element {
 constructor(path=''){this.dataset={path};this.events={};this.classes=new Set();this.children=[];this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x)};}
 addEventListener(name,fn){this.events[name]=fn;}setAttribute(){}append(child){this.children.push(child);}querySelector(){return {textContent:this.dataset.path};}getBoundingClientRect(){return {top:0,height:32};}contains(other){return this===other;}
}
test('pin drag previews before/after insertion, persists that order and ignores photo drops',()=>{
 const rows=['A','B','C'].map(p=>new Element(p)),writes=[];let refreshes=0;
 const root={append(){},querySelectorAll:selector=>selector==='.library-nav-section'?[]:rows.filter(row=>row.classes.size)};
 const document={createElement:()=>new Element(),getElementById:()=>({children:rows.map(row=>({querySelector:()=>row}))})};
 const context=vm.createContext({window:{},document,localStorage:{getItem:()=>null,setItem:(_key,value)=>writes.push(JSON.parse(value))}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/library-navigation.js'),'utf8'),context);
 const nav=context.window.HDRLibraryNavigation.create({root,refresh:()=>refreshes++});rows.forEach(row=>nav.pinHandle(row,row.dataset.path));
 const event=y=>({clientY:y,preventDefault(){},stopPropagation(){},dataTransfer:{setData(){}}});
 rows[0].children[0].events.dragstart(event(0));rows[1].events.dragover(event(2));assert.ok(rows[1].classes.has('nav-insert-before'));
 rows[1].events.dragover(event(30));assert.ok(rows[1].classes.has('nav-insert-after'));assert.ok(!rows[1].classes.has('nav-insert-before'));
 rows[1].events.drop(event(30));assert.deepEqual(writes.at(-1).pins,['B','A','C']);assert.equal(refreshes,1);assert.equal(rows[1].classes.size,0);
 assert.deepEqual(Array.from(nav.orderPins(rows.map(row=>({path:row.dataset.path}))),item=>item.path),['B','A','C']);
 let swallowed=false;rows[1].events.dragover({...event(2),preventDefault:()=>swallowed=true});assert.equal(swallowed,false);assert.equal(rows[1].classes.size,0);
});
