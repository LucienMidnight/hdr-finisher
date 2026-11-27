const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8');

test('typed midpoint rule accepts 200 and preserves migrated half steps', () => {
  const source=read('app-state.js');
  const rules=vm.runInNewContext(source.slice(source.indexOf('const MANUAL_VALUE_RULES'),source.indexOf('const TONE_EQUALIZER_MIN_EV'))+'; MANUAL_VALUE_RULES');
  assert.equal(rules['current.vignette.midpoint'].max,200);
  assert.equal(rules['current.vignette.midpoint'].decimals,1);
});

test('on-image outlines follow the new midpoint and unchanged feather width', () => {
  const paths={};
  const rect={left:0,top:0,width:600,height:400};
  const overlay={style:{},classList:{toggle(){}},setAttribute(){},querySelector:selector=>({setAttribute:(name,value)=>{paths[selector]=value;}})};
  const vignette={midpoint:100,center_x:.5,center_y:.5,roundness:0,scale_x:100,scale_y:100,feather:0};
  const context=vm.createContext({state:{session:{},vignetteShowOverlay:true,activeWorkflow:'grade',currentView:'sdr',adjustments:{sdr:{vignette}}},els:{vignetteShapeOverlay:overlay,previewPrimaryPane:{getBoundingClientRect:()=>rect}},document:{querySelector:()=>({classList:{contains:()=>false}})},HTMLCanvasElement:class{},activePreviewElement:()=>({naturalWidth:600,naturalHeight:400,getBoundingClientRect:()=>rect})});
  vm.runInContext(read('color-wheels.js'),context);
  for(const [midpoint,radius] of [[25,100],[100,310],[200,590]]) {
    vignette.midpoint=midpoint;
    vm.runInContext('renderVignetteShape()',context);
    const first=selector=>Number(paths[selector].match(/^M([\d.]+)/)[1]);
    assert.equal(first('.vignette-shape-inner'),299.5+radius);
    assert.equal(first('.vignette-shape-outer'),299.5+radius+4);
  }
});
