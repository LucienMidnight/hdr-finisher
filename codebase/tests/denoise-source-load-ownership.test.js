const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const {test}=require('node:test');
const { frontendSource } = require('./frontend-source.js');
const source=frontendSource('webgpu-preview.js');
const start=source.indexOf('    sourceLoadIsCurrent(');const end=source.indexOf('    async render(',start);
const check=vm.runInNewContext(`(class {${source.slice(start,end)}}).prototype.sourceLoadIsCurrent`);
const canvas={};const renderer={resourceGeneration:2,renderSerials:new Map([[canvas,5]])};
test('adaptive source loading survives a grading supersession while its source stays current',()=>{
 assert.equal(check.call(renderer,canvas,4,2,{isSourceCurrent:()=>true,isCurrent:()=>false}),true);
});
test('source changes and device replacement stop a reusable source load',()=>{
 assert.equal(check.call(renderer,canvas,4,2,{isSourceCurrent:()=>false}),false);
 assert.equal(check.call(renderer,canvas,4,1,{isSourceCurrent:()=>true}),false);
});
test('legacy source loads retain render cancellation',()=>{
 assert.equal(check.call(renderer,canvas,4,2,{isCurrent:()=>true}),false);
 assert.equal(check.call(renderer,canvas,5,2,{isCurrent:()=>false}),false);
 assert.equal(check.call(renderer,canvas,5,2,{isCurrent:()=>true}),true);
});