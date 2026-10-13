const test=require("node:test"),assert=require("node:assert/strict");
const query=require("../frontend/library-query");
test("whole library includes kept photos, selected and unpinned folder rules do not",()=>{
 const photos=[{path:"D:/pinned/a.jpg",name:"a.jpg",type:"JPG",library_pins:["D:/pinned"]},{path:"D:/kept/b.jpg",name:"b.jpg",type:"JPG",library_pins:[]}];
 assert.equal(query.count(photos,{folders:[]}),2);
 assert.equal(query.count(photos,{folders:["D:/pinned"]}),1);
 assert.equal(query.count(photos,{folders:["D:/kept"]}),0);
 photos[1].library_pins=["D:/kept"];assert.equal(query.count(photos,{folders:["D:/kept"]}),1);
});
