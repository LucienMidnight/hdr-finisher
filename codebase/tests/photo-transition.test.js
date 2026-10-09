const assert = require("node:assert/strict");
const test = require("node:test");
const { leaveCurrentPhoto } = require("../frontend/photo-transition");

test("clean transitions and synchronous system exit avoid prompting", () => {
  const choose = () => { throw new Error("Unexpected prompt"); };
  assert.equal(leaveCurrentPhoto({ dirty: false, choose }), true);
  assert.equal(leaveCurrentPhoto({ dirty: false, systemExit: true, choose }), true);
  assert.equal(leaveCurrentPhoto({ dirty: true, systemExit: true, choose }), false);
});

test("dirty transitions respect Cancel, Discard and unknown choices", async () => {
  const save = () => { throw new Error("Unexpected save"); };
  for (const choice of ["cancel", "discard", null, "unknown"]) {
    assert.equal(await leaveCurrentPhoto({ dirty: true, choose: async () => choice, save }), choice === "discard");
  }
});

test("Save allows leaving only after a successful save", async () => {
  for (const saved of [true, false, undefined]) {
    let saves = 0;
    assert.equal(await leaveCurrentPhoto({ dirty: true, choose: async () => "save", save: async () => {
      saves += 1; return saved;
    } }), saved === true);
    assert.equal(saves, 1);
  }
  await assert.rejects(leaveCurrentPhoto({ dirty: true, choose: async () => "save", save: async () => {
    throw new Error("disk failure");
  } }), /disk failure/);
});
