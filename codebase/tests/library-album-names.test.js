const test=require("node:test"),assert=require("node:assert/strict");
const {copyName}=require("../frontend/library-album-names");
test("copy names are editable proposals, unique across album kinds and capitals",()=>{
 assert.equal(copyName("Keep",[]),"Copy of Keep");
 assert.equal(copyName("Keep",["copy OF keep"]),"Copy of Keep (2)");
 assert.equal(copyName("Keep",["Copy of Keep","Copy of Keep (2)"]),"Copy of Keep (3)");
 const name="x".repeat(120),first=copyName(name,[]),second=copyName(name,[first]);assert.equal(first.length,120);assert.equal(second.length,120);assert.ok(second.endsWith(" (2)"));
});
