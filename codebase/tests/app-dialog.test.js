const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function pressKey(key, { open, insideDialog }) {
  const window = new EventTarget();
  const dialog = { open };
  const document = { getElementById: (id) => id === "app-dialog" ? dialog : null };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../frontend/app-dialog.js"), "utf8"),
    { window, document });

  let reachedPage = false;
  window.addEventListener("keydown", (event) => {
    reachedPage = true;
    if (event.key === "Escape") event.preventDefault();
  }, true);
  const event = Object.assign(new Event("keydown", { cancelable: true }), {
    key,
    composedPath: () => insideDialog ? [{}, dialog, document, window] : [{}, document, window],
  });
  const defaultAllowed = window.dispatchEvent(event);
  return { reachedPage, defaultAllowed };
}

test("Escape in the open app dialog allows native cancel without reaching page controls", () => {
  const result = pressKey("Escape", { open: true, insideDialog: true });
  assert.equal(result.defaultAllowed, true);
  assert.equal(result.reachedPage, false);
});

test("the app dialog leaves other key presses and Escape in other surfaces alone", () => {
  assert.deepEqual(pressKey("Escape", { open: false, insideDialog: true }),
    { reachedPage: true, defaultAllowed: false });
  assert.deepEqual(pressKey("Escape", { open: true, insideDialog: false }),
    { reachedPage: true, defaultAllowed: false });
  assert.deepEqual(pressKey("Enter", { open: true, insideDialog: true }),
    { reachedPage: true, defaultAllowed: true });
});
