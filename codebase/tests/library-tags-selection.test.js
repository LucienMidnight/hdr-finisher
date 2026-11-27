const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(){
 const elements=[];
 const make=(tag,cls='',text='')=>{const e={tag,className:cls,textContent:text,value:'',style:{},dataset:{},children:[],events:{},attributes:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;},showModal(){this.open=true;},focus(){}};elements.push(e);return e;};
 const context={window:{HDRShortcuts:{text:value=>value}},document:{body:{append(){}}},HDRLibraryDialogs:{make,ask:async()=>false}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../frontend/library-tags.js'),'utf8'),context);
 const tags=[{tag:'Zulu',count:3},{tag:'Alpha',count:2},{tag:'Beta',count:1}];
 const control=context.window.HDRLibraryTags.create({api:async()=>({tags}),labelNames:()=>({}),indexing:()=>false,undoAvailable:()=>false});
 return {open:()=>control.open(),get:id=>elements.find(e=>e.id===id),find:text=>elements.find(e=>e.textContent===text),selected:()=>elements.find(e=>e.id==='library-tags-list').children.filter(e=>e.attributes['aria-selected']==='true').map(e=>e.dataset.tag)};
}
test('filtering tags after selecting the last row makes Shift-click safe',async()=>{
 const h=harness();await h.open();let list=h.get('library-tags-list');list.children[2].events.click({});
 const search=h.get('library-tags-search');search.value='Zulu';search.events.input();
 assert.doesNotThrow(()=>list.children[0].events.click({shiftKey:true}));assert.deepEqual(h.selected(),['Zulu']);
});
test('tag range selection follows the same tag after sorting and preserves Meta additions',async()=>{
 const h=harness();await h.open();const list=h.get('library-tags-list');list.children[0].events.click({});
 h.find('Name').events.click(); // Alpha, Beta, Zulu; anchor stays Zulu.
 list.children[1].events.click({shiftKey:true});assert.deepEqual(h.selected(),['Beta','Zulu']);
 list.children[0].events.click({metaKey:true});
 list.children[1].events.click({shiftKey:true,metaKey:true});assert.deepEqual(h.selected(),['Alpha','Beta','Zulu']);
});
