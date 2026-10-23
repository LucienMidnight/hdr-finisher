const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const HDRHSL=require('../frontend/hsl-engine.js');
function context(){const c=vm.createContext({HDRHSL});for(const name of ['adjustment-controls.js','range-controls.js','hsl-panel.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend',name),'utf8'),c);return c;}
test('edited status ignores object key order and default roundoff but preserves real changes and array order',()=>{
 const c=context();assert.equal(vm.runInContext('valuesEqual({a:1,b:{hue:27.567096839175015}},{b:{hue:27.567096839175008},a:1})',c),true);
 assert.equal(vm.runInContext('valuesEqual({hue:27},{hue:27.01})',c),false);
 assert.equal(vm.runInContext('valuesEqual([1,2],[2,1])',c),false);
 assert.equal(vm.runInContext('valuesEqual({a:1},{a:1,b:2})',c),false);
});
test('print exposure shows small changes in signed stops',()=>{
 const c=context();for(const [v,text] of [[0,'0.00 EV'],[.14,'+0.14 EV'],[-.03,'-0.03 EV']])assert.equal(vm.runInContext(`formatControlValue('current.film_look.print_exposure',${v})`,c),text);
});
test('HSL primary directions match grading hues and wheel dragging round-trips',()=>{
 const c=context();for(const [i,rgb] of [[1,0,0],[1,1,0],[0,1,0],[0,1,1],[0,0,1],[1,0,1]].entries()){
  const lab=HDRHSL.toLab(rgb),h=HDRHSL.wrap(Math.atan2(lab[2],lab[1])*180/Math.PI);c.hue=h;
  assert(Math.abs(vm.runInContext('hslWheelAngle(hue)',c)-(210+i*60))<1e-9);
 }
 for(let h=0;h<360;h+=3){c.hue=h;assert(Math.abs(HDRHSL.delta(vm.runInContext('hslWheelHue(hslWheelAngle(hue))',c),h))<1e-9);}
});
