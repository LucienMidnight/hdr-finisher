const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('opening a photo closes modules and RAW settings without changing adjustments', () => {
 const attributes = {};
 const classes = new Set();
 const group = {classList:{add: value => classes.add(value)}, querySelector: () => ({setAttribute:(key,value)=>attributes[key]=value})};
 const state = {rawSettingsOpen:true, adjustments:{exposure:2}};
 const context = vm.createContext({state,document:{querySelectorAll:()=>[group]}});
 vm.runInContext(fs.readFileSync(require.resolve('../frontend/control-panel.js'),'utf8'),context);
 vm.runInContext('collapseGradeModules()',context);
 assert.equal(classes.has('collapsed'),true);
 assert.equal(attributes['aria-expanded'],'false');
 assert.equal(state.rawSettingsOpen,false);
 assert.equal(state.adjustments.exposure,2);
});
