const test = require("node:test");
const assert = require("node:assert/strict");
const { apply } = require("../frontend/library-query.js");
const photos = [
 { path: "a", name: "photo-10.ARW", type: "ARW", capture_time: "2024-01-01T12:00:00", marks: { rating: 5, pick: "pick", label: "blue", tags: ["Family"] } },
 { path: "b", name: "photo-2.PNG", type: "PNG", capture_time: "2025-01-01T12:00:00", marks: { rating: 2, pick: "reject", tags: [] } },
 { path: "c", name: "photo-1.DNG", type: "DNG", marks: { rating: 0, pick: "unmarked", tags: [] } },
];
const paths = (...args) => apply(photos, ...args).map(photo => photo.path);
test("Capture dates sort with unknown dates last in both directions", () => {
 assert.deepEqual(paths("time"), ["a", "b", "c"]);
 assert.deepEqual(paths("time", true), ["b", "a", "c"]);
 assert.deepEqual(apply(photos.map(photo => ({ ...photo, capture_time: null }))).map(photo => photo.path), ["c", "b", "a"]);
});
test("All sort keys work in either direction without changing input", () => {
 assert.deepEqual(paths("name"), ["c", "b", "a"]);
 assert.deepEqual(paths("name", true), ["a", "b", "c"]);
 assert.deepEqual(paths("rating"), ["c", "b", "a"]);
 assert.deepEqual(paths("rating", true), ["a", "b", "c"]);
 assert.deepEqual(paths("pick"), ["a", "c", "b"]);
 assert.deepEqual(paths("pick", true), ["b", "c", "a"]);
 assert.deepEqual(paths("type"), ["a", "c", "b"]);
 assert.deepEqual(paths("type", true), ["b", "c", "a"]);
 assert.deepEqual(photos.map(photo => photo.path), ["a", "b", "c"]);
});
test("Filters combine rating, picks, label, tag search and file type", () => {
 assert.deepEqual(paths("name", false, { rules: [{field:"type",op:"in",values:["arw","dng","ori"]}] }), ["c", "a"]);
 assert.deepEqual(paths("name", false, { rules: [{field:"rating",op:"at-least",value:3},{field:"pick",op:"in",values:["pick"]},{field:"label",op:"in",values:["blue"]},{field:"search",op:"contains",value:"FaMiLy"},{field:"type",op:"in",values:["arw"]}] }), ["a"]);
 assert.deepEqual(paths("name", false, {rules:[{field:"pick",op:"in",values:["pick","unmarked"]}]}), ["c", "a"]);
 assert.deepEqual(paths("name", false, {rules:[{field:"pick",op:"in",values:["unmarked"]}]}), ["c"]);
 assert.deepEqual(paths("name", false, {rules:[{field:"search",value:"photo-2"}]}), ["b"]);
 assert.deepEqual(paths("name", false, {rules:[{field:"type",op:"in",values:["arw","dng"]},{field:"type",value:"png"}]}), []);
 assert.equal(apply([{ name: "a", path: "a", type: "ORI" }], "name", false, { rules: [{field:"type",op:"in",values:["arw","dng","ori"]}] }).length, 1);
});
test("copies stay after their original in either sort direction; marks and copy filters remain independent", () => {
  const family = [
    {path:"a",name:"a",marks:{rating:1}},
    {path:"a|copy|1",source_path:"a",copy_id:"1",copy_order:0,name:"a · Copy 1",marks:{rating:5}},
    {path:"b",name:"b",marks:{rating:3}},
  ];
  assert.deepEqual(apply(family,"rating").map(p=>p.path),["a","a|copy|1","b"]);
  assert.deepEqual(apply(family,"rating",true).map(p=>p.path),["b","a","a|copy|1"]);
  assert.deepEqual(apply(family,"rating",false,{rules:[{field:"rating",op:"at-least",value:4}]}).map(p=>p.path),["a|copy|1"]);
  assert.deepEqual(apply(family,"name",false,{rules:[{field:"copy",value:"virtual copy"}]}).map(p=>p.path),["a|copy|1"]);
});

test("Grade filters use saved grades independently of marks, including virtual copies", () => {
 const rows = [{...photos[0], edited: false}, {...photos[1], edited: true}, {...photos[2], edited: true, copy_id: "copy"}];
 assert.deepEqual(apply(rows, "name", false, {rules:[{field:"state",value:"edited"}]}).map(p=>p.path), ["c", "b"]);
 assert.deepEqual(apply(rows, "name", false, {rules:[{field:"state",value:"not edited"}]}).map(p=>p.path), ["a"]);
 assert.deepEqual(apply(rows, "name", false, {rules:[{field:"state",value:"edited"},{field:"rating",op:"at-least",value:2}]}).map(p=>p.path), ["b"]);
});
