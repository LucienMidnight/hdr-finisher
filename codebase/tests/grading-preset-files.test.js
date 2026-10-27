const {test}=require("node:test");
const assert=require("node:assert/strict");
const files=require("../frontend/grading-preset-files");
test("saved grading presets round trip without changing settings",()=>{
 const presets=[{groupId:"hdr-detail",name:"Fine",recipeVersion:1,values:{"hdr.detail":{sharpen_amount:42,sharpen_radius_px:1.2,sharpen_threshold:3}}},
 {groupId:"hdr-detail",name:"Soft",recipeVersion:1,values:{"hdr.detail":{sharpen_amount:0}}}];
 assert.deepEqual(files.decode(files.encode(presets)),presets);
});
test("import keeps both on case-insensitive and repeated name clashes",()=>{
 const preset={groupId:"sdr-detail",name:"Detail",recipeVersion:1,values:{"sdr.detail":{sharpen_amount:75}}};
 const existing=[{...preset,name:"DETAIL"},{...preset,name:"Detail (imported)"}];
 const before=JSON.stringify(existing);
 const incoming=files.keepBoth([preset,preset],existing);
 assert.deepEqual(incoming.map(p=>p.name),["Detail (imported 2)","Detail (imported 3)"]);
 assert.equal(JSON.stringify(existing),before);assert.deepEqual(incoming[0].values,preset.values);
});
test("portable files never carry a built-in flag or storage id",()=>{
 const [preset]=files.decode(files.encode([{groupId:"hdr-detail",name:"Default",id:"built-in:default",builtIn:true,values:{"hdr.detail":{}}}]));
 assert.equal(preset.builtIn,undefined);assert.equal(preset.id,undefined);
 assert.throws(()=>files.decode('{"format":"other","version":1,"presets":[]}'));
});
test("export names preserve case and remove cross-platform illegal characters",()=>{
 assert.equal(files.exportName([{name:"Portra 400 natural"}]),"Portra-400-natural-preset.json");
 assert.equal(files.exportName([{name:' A<>:"/\\|?* B. '}]),"A-B-preset.json");
 assert.equal(files.exportName([{name:"CON"}]),"CON-preset.json");
 assert.equal(files.exportName([{name:"..."}]),"Grading-preset.json");
 assert.equal(files.exportName([{},{}],"Film Look"),"Film-Look-presets.json");
});
test("search narrows built-in and saved names and clearing restores them",()=>{
 const presets=[{name:"Portra 400",builtIn:true},{name:"Natural"},{name:"Portra soft"}];
 assert.deepEqual(files.filter(presets,"pORtra"),[presets[0],presets[2]]);
 assert.deepEqual(files.filter(presets,"absent"),[]);
 assert.deepEqual(files.filter(presets,""),presets);
});
