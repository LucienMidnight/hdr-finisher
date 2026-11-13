const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('shared export progress offers pause/resume and cancel, completion removes controls',async()=>{
 const source=fs.readFileSync(require.resolve('../frontend/batch-export.js'),'utf8');
 const start=source.indexOf('  function appStatus('),end=source.indexOf('  // Observation',start);
 let entry;const calls=[];
 const ctx={window:{HDRStatus:{post:e=>entry=e,get:()=>entry}},control:async a=>calls.push(a),report:e=>{throw e;}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const job={state:'running',completed:2,total:12};const counts={exported:12,renamed:0,failed:0};
 ctx.appStatus(job,false,counts);assert.equal(entry.progress,100*2/12);assert.equal(entry.actions.length,2);
 assert.equal(entry.actions[0].label,'Pause the current export');assert.equal(entry.actions[0].icon,'player-pause');await entry.actions[0].run();await entry.actions[1].run();
 job.state='paused';ctx.appStatus(job,false,counts);assert.equal(entry.actions[0].label,'Resume the current export');assert.equal(entry.actions[0].icon,'player-play');await entry.actions[0].run();
 assert.deepEqual(calls,['pause','cancel','resume']);job.state='finished';ctx.appStatus(job,true,counts);assert.equal(entry.actions,undefined);assert.equal(entry.severity,'success');assert.match(entry.message,/12 files/);
});
test('Activity button leaves export progress to the shared bar',async()=>{
 const oldWindow=global.window,oldDocument=global.document;
 try{
  global.window={addEventListener(){}};global.document={addEventListener(){}};
  const button={hidden:true,setAttribute(){},addEventListener(){}};
  const activity=require('../frontend/library-activity.js').create({button,panel:{hidden:true},api:async path=>path.endsWith('health')?{writer:{waiting:0,attention:[]},index:{state:'idle'},helper:{}}:{jobs:[{id:'test',state:'running',completed:2,total:12}]},status(){}});
  await activity.refresh();assert.equal(button.textContent,'Activity');
 }finally{global.window=oldWindow;global.document=oldDocument;}
});
test('Export Batch footer includes the non-empty selection and drops it when cleared',()=>{
 const source=fs.readFileSync(require.resolve('../frontend/batch-export.js'),'utf8');const start=source.indexOf('  function example('),end=source.indexOf('  function terminal(',start),nodes=new Map();
 const ctx={model:{draft:{versions:[{name:'SDR',pattern:'photo',settings:{format:'sdr_jpeg'}}]},version:0,photos:[{path:'one'},{path:'two'}],selected:new Set(['one'])},els:{exportResizeMode:{selectedOptions:[{textContent:'Original'}]}},$:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},setAttribute(){}});return nodes.get(id);},HDRExportPatterns:{render:()=> 'photo'},exportExtensionForFormat:()=>'.jpg',hdrSkipped:()=>false,fileCount:()=>1};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);ctx.example();assert.match(nodes.get('batch-count').textContent,/2 photos.*2 files.*1 selected$/);ctx.model.selected.clear();ctx.example();assert.doesNotMatch(nodes.get('batch-count').textContent,/selected/);
});

test('each workspace chooses its hints before Grade tools or sliders',()=>{
 const node={clientWidth:2000,scrollWidth:0,parentElement:{clientWidth:2000},text:'',replaceChildren(){this.text='';},append(...parts){this.text+=parts.map(p=>typeof p==='string'?p:p.textContent).join('');}};
 const body={dataset:{workflow:'grade'},classList:{toggle(){}}};let pending;const listeners={};class Element {closest(s){return s==='.viewport-frame';}}
 const ctx={document:{body,querySelector:()=>node,createElement:()=>({textContent:''}),addEventListener:(type,fn)=>listeners[type]=fn},window:{HDRApplicationShell:{shortcutLabel:id=>id==='app.help'?'F2':'Alt+E'},addEventListener(){}},Element,requestAnimationFrame:fn=>{pending=fn;return 1;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../frontend/key-hints.js'),'utf8')+';globalThis.hints=keyHints;',ctx);
 const render=()=>{ctx.hints.refresh();pending();return node.text;};assert.match(render(),/Ctrl fine.*Shift snap/);
 ctx.hints.register(()=>[['Brush','paint']]);listeners.pointermove({target:new Element()});assert.equal(render(),'Brush paint');
 for(const [page,expected] of [['import',/Arrows browse.*Space grid\/single.*Enter Grade.*Ctrl\+Shift\+E quick export/],['export',/Ctrl\+A select all.*Space\/Enter select photo/],['proof',/Alt\+E export.*F2 help/]]){body.dataset.workflow=page;assert.match(render(),expected);}
 body.dataset.workflow='grade';assert.equal(render(),'Brush paint');body.dataset.workflow='import';node.clientWidth=1;node.scrollWidth=200;assert.equal(render(),'Arrows browse');
});
