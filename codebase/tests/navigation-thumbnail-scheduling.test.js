const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/app.js'), 'utf8');
function fixture() {
  const state={currentView:'sdr',previewGeneration:{sdr:3},gpuPreview:{activeRenderCount:0},
    acceptedPresentation:{lane:'sdr',exact:true,generation:3,geometrySignature:'geometry',processedLongEdge:7362}};
  const context=vm.createContext({state,geometrySignature:()=> 'geometry',requiredProcessingLongEdge:()=>7362});
  vm.runInContext(source.slice(source.indexOf('function navigationThumbnailWorkReady'),source.indexOf('async function refreshNavigationThumbnail')),context);
  return {state,ready:context.navigationThumbnailWorkReady};
}
test('CPU navigation overview waits for native presentation and active GPU work',()=>{
  const f=fixture(); assert.equal(f.ready(),true);
  for(const [key,value] of [['gpuDraftInFlight',{}],['zoomRefinementTimer',1],['importInProgress',true],['previewScheduler',{interacting:true}]]) {
    f.state[key]=value; assert.equal(f.ready(),false);delete f.state[key];
  }
  f.state.gpuPreview.activeRenderCount=1;assert.equal(f.ready(),false);
  f.state.gpuPreview.activeRenderCount=0;f.state.acceptedPresentation.processedLongEdge=1600;assert.equal(f.ready(),false);
  f.state.acceptedPresentation.processedLongEdge=7362;f.state.previewGeneration.sdr++;assert.equal(f.ready(),false);
});
