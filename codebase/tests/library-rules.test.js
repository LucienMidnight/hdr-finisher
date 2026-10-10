const test = require("node:test");
const assert = require("node:assert/strict");
const { apply, values, describe, matches } = require("../frontend/library-query.js");
const facts = require("../frontend/library-facts.js");

const photos = [
  { path: "a", name: "a.ARW", type: "ARW", bytes: 1048576, mtime_ns: 3e18, indexed: true, capture_time: "2024-02-03T04:05:06", camera: "ILCE-7RM3", lens: "FE 85mm F1.8", iso: 400, shutter: 1 / 250, aperture: 2.8, focal_length: 85, marks: { tags: ["Family", "Beach"] } },
  { path: "b", name: "b.ARW", type: "ARW", bytes: 2097152, mtime_ns: 1e18, indexed: true, capture_time: "2024-06-01T10:00:00", camera: "ILCE-7RM3", lens: null, iso: 3200, shutter: 2, aperture: 8, focal_length: 24, marks: { tags: ["beach"] } },
  { path: "c", name: "c.RAF", type: "RAF", bytes: 3145728, mtime_ns: 2e18, indexed: true, capture_time: null, camera: "X-E2S", lens: "XF35mmF1.4 R", iso: 200, shutter: 0.004, aperture: 2.8, focal_length: 35, marks: { tags: [] } },
  { path: "d", name: "d.PNG", type: "PNG", bytes: 512, mtime_ns: 4e18, indexed: true, capture_time: null, camera: null, lens: null, iso: null, shutter: null, aperture: null, focal_length: null },
];
const paths = filters => apply(photos, "name", false, filters).map(photo => photo.path);

test("Offered values come from the photos on screen, with counts and honest gaps", () => {
  assert.deepEqual(values(photos, "camera"), [{ value: "ilce-7rm3", label: "ILCE-7RM3", count: 2 }, { value: "x-e2s", label: "X-E2S", count: 1 }, { value: "", label: "Not recorded", count: 1 }]);
  assert.deepEqual(values(photos, "lens").at(-1), { value: "", label: "Unknown", count: 2 });
  assert.deepEqual(values(photos, "shutter").map(item => item.label), ["1/250 s", "2 s", "Not recorded"]);
  assert.deepEqual(values(photos, "aperture").map(item => [item.label, item.count]), [["f/2.8", 2], ["f/8", 1], ["Not recorded", 1]]);
  assert.deepEqual(values(photos, "focal_length").map(item => item.label), ["24 mm", "35 mm", "85 mm", "Not recorded"]);
  assert.deepEqual(values(photos, "tag"), [{ value: "beach", label: "Beach", count: 2 }, { value: "family", label: "Family", count: 1 }, { value: "", label: "No tags", count: 2 }]);
});

test("Rules filter by camera, lens, tag, ISO range and capture date", () => {
  assert.deepEqual(paths({ rules: [{ field: "camera", value: "ilce-7rm3" }] }), ["a", "b"]);
  assert.deepEqual(paths({ rules: [{ field: "camera", value: "ilce-7rm3", not: true }] }), ["c", "d"]);
  assert.deepEqual(paths({ rules: [{ field: "lens", value: "" }] }), ["b", "d"]);
  assert.deepEqual(paths({ rules: [{ field: "tag", value: "beach" }] }), ["a", "b"]);
  assert.deepEqual(paths({ rules: [{ field: "tag", value: "" }] }), ["c", "d"]);
  assert.deepEqual(paths({ rules: [{ field: "iso", from: "400", to: "" }] }), ["a", "b"]);
  assert.deepEqual(paths({ rules: [{ field: "iso", from: "", to: "400" }] }), ["a", "c"]);
  assert.deepEqual(paths({ rules: [{ field: "iso", from: "200", to: "200", not: true }] }), ["a", "b", "d"]);
  assert.deepEqual(paths({ rules: [{ field: "date", from: "2024-02-03", to: "2024-02-03" }] }), ["a"]);
  assert.deepEqual(paths({ rules: [{ field: "date", from: "2024-03-01" }] }), ["b"]);
  assert.deepEqual(paths({ rules: [{ field: "shutter", value: "1/250 s" }] }), ["a", "c"]);
  assert.equal(matches(photos[0], { field: "no-such-field" }), true);
});

test("Rules match all or any, and combine with the basic filters", () => {
  const rules = [{ field: "camera", value: "x-e2s" }, { field: "aperture", value: "f/8" }];
  assert.deepEqual(paths({ rules }), []);
  assert.deepEqual(paths({ rules, any: true }), ["b", "c"]);
  assert.deepEqual(paths({ rules, any: true, raw: true, type: "RAF" }), ["c"]);
  assert.deepEqual(paths({ rules: [] }), ["a", "b", "c", "d"]);
});

test("Chips say what the rule does", () => {
  assert.equal(describe({ field: "camera", value: "x-e2s", label: "X-E2S" }), "Camera is X-E2S");
  assert.equal(describe({ field: "lens", value: "", label: "Unknown", not: true }), "Lens is not Unknown");
  assert.equal(describe({ field: "iso", from: "100", to: "800" }), "ISO is 100 to 800");
  assert.equal(describe({ field: "iso", from: "400", to: "400" }), "ISO is 400");
  assert.equal(describe({ field: "iso", from: "1600", to: "" }), "ISO is 1600 or more");
  assert.equal(describe({ field: "date", from: "", to: "2024-01-01" }), "Capture date is 2024-01-01 or earlier");
});

test("Date modified sorts in either direction", () => {
  assert.deepEqual(apply(photos, "modified").map(photo => photo.path), ["b", "c", "a", "d"]);
  assert.deepEqual(apply(photos, "modified", true).map(photo => photo.path), ["d", "a", "c", "b"]);
});

test("Details never guess: missing facts say so, and unread facts say they are being read", () => {
  assert.deepEqual(facts.summary(photos[0]), [["Camera", "ILCE-7RM3"], ["Lens", "FE 85mm F1.8"], ["Focal length", "85 mm"], ["Aperture", "f/2.8"], ["Shutter", "1/250 s"], ["ISO", "ISO 400"]]);
  assert.deepEqual(facts.summary(photos[3]).map(row => row[1]), ["Not recorded", "Unknown", "Not recorded", "Not recorded", "Not recorded", "Not recorded"]);
  const unread = { path: "C:\\Photos\\e.ARW", name: "e.ARW", type: "ARW", bytes: 1048576, mtime_ns: 1e18, storage: "none" };
  assert.ok(facts.summary(unread).every(row => row[1] === "Reading…"));
  const groups = Object.fromEntries(facts.groups({ ...unread, indexed: true, storage: "sidecar", latitude: -52.5, longitude: 13.41, exposure_bias: -1 / 3, width: 6000, height: 4000 }));
  assert.deepEqual(Object.keys(groups), ["File", "Camera", "Lens", "Exposure", "Location", "Written by the camera"]);
  const file = Object.fromEntries(groups.File);
  assert.equal(file.Folder, "C:\\Photos"); assert.equal(file["Settings file"], "Beside the photo"); assert.equal(file.Dimensions, "6000 × 4000");
  assert.equal(Object.fromEntries(groups.Lens).Lens, "Unknown");
  assert.equal(Object.fromEntries(groups.Exposure).Compensation, "-0.33 EV");
  assert.equal(groups.Location[0][1], "-52.50000, 13.41000");
  assert.equal(Object.fromEntries(facts.groups(unread).find(group => group[0] === "File")[1])["Settings file"], "None yet");
  assert.match(facts.headline(photos[1]), /^ARW · 2\.0 MB · /);
  assert.equal(facts.headline(photos[3]), "PNG · 0.0 MB");
});
