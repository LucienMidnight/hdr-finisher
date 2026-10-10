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
 assert.deepEqual(paths("name", false, { raw: true }), ["c", "a"]);
 assert.deepEqual(paths("name", false, { rating: 3, pick: "pick", label: "blue", search: "FaMiLy", type: "ARW" }), ["a"]);
 assert.deepEqual(paths("name", false, { pick: "hide-rejected" }), ["c", "a"]);
 assert.deepEqual(paths("name", false, { pick: "unmarked" }), ["c"]);
 assert.deepEqual(paths("name", false, { search: "photo-2" }), ["b"]);
 assert.deepEqual(paths("name", false, { raw: true, type: "PNG" }), []);
 assert.equal(apply([{ name: "a", path: "a", type: "ORI" }], "name", false, { raw: true }).length, 1);
});
