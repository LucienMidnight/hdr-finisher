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


test("portable presets retain newer writer and section format versions", () => {
  const original = {groupId:"hdr-tone",name:"Future",recipeVersion:1,values:{"hdr.exposure":.5},app_version:"99.0.0",section_versions:{tone:9}};
  assert.deepEqual(files.decode(files.encode([original]))[0],original);
});


test("desktop presets persist scoped values and writer versions", () => {
 const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),os=require("node:os");
 const source=fs.readFileSync(require.resolve("../desktop/main.js"),"utf8");
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"hdr-test-presets-"));
 const context=vm.createContext({fs,path,crypto:require("node:crypto"),
  GRADING_PRESET_GROUPS:new Set(["hdr-tone","sdr-tone"]),gradingPresetDirectory:()=>folder});
 try {
  vm.runInContext(source.slice(source.indexOf("function cleanGradingPresetPayload("),source.indexOf("function semverParts(")),context);
  const original={groupId:"hdr-tone",name:"  Future   tone  ",recipeVersion:1,
   values:{"hdr.exposure":.5},app_version:"99.0.0",section_versions:{tone:9}};
  const saved=context.saveGradingPreset(original);
  original.values["hdr.exposure"]=2;
  const [loaded]=JSON.parse(JSON.stringify(context.listGradingPresets("hdr-tone")));
  assert.equal(loaded.name,"Future tone");assert.equal(loaded.values["hdr.exposure"],.5);
  assert.equal(loaded.app_version,"99.0.0");assert.deepEqual(loaded.section_versions,{tone:9});
  assert.equal(context.listGradingPresets("sdr-tone").length,0);
  assert.throws(()=>context.saveGradingPreset({...original,groupId:"unknown"}));
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,saved.id),"utf8")).schemaVersion,1);
  assert.equal(context.deleteGradingPreset(saved.id),true);
  assert.equal(context.listGradingPresets("hdr-tone").length,0);
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
