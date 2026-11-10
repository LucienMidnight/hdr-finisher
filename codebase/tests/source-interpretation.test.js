const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function extract(file,name){
 const source=fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('function '+name+'(');assert.ok(start>=0);
 return source.slice(start,source.indexOf('\n}',start)+2);
}
test('unresolved interpretation stays visible and export stays blocked until real resolution',()=>{
 let posted,opened=0,cleared=0;
 const context=vm.createContext({state:{session:{analysis:{needs_color_override:true}},capabilities:{encoder:{status:'available'}},importInProgress:false},
  els:{exportFormat:{value:'jpegxl_hdr'},exportConfirmButton:{}},capabilityForFormat:{jpegxl_hdr:'encoder'},
  status:{post:value=>posted=value,clear:()=>cleared++},overrideMessage:()=> 'unknown source',openManualInterpretation:()=>opened++});
 vm.runInContext(extract('session-import.js','renderInterpretationGate')+'\n'+extract('export-ui.js','updateExportAvailability'),context);
 vm.runInContext('renderInterpretationGate();updateExportAvailability()',context);
 assert.equal(posted.persistent,true);assert.equal(context.els.exportConfirmButton.disabled,true);
 assert.equal(posted.actions.length,1);posted.actions[0].run();assert.equal(opened,1);
 vm.runInContext('updateExportAvailability()',context);assert.equal(context.els.exportConfirmButton.disabled,true);
 context.state.session.analysis.needs_color_override=false;
 vm.runInContext('renderInterpretationGate();updateExportAvailability()',context);
 assert.equal(cleared,1);assert.equal(context.els.exportConfirmButton.disabled,false);
});
