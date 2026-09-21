// MINOR-10, the Electron half -- a confirmation must not raise a native modal.
//
// Reported from manual testing: after dismissing the native confirmation on
// Crop & Rotate Reset, the Maximum preview size dropdown could no longer be
// opened. Clicking it did nothing until another Windows application was
// focused and the window returned. A `<select>` popup in Chromium is a native
// window, and after a blocking native modal the renderer's focus state will
// not open one.
//
//   node tests/confirmation-focus.js
//
// What this proves, and what it does not. The popup itself is not observable:
// it is a native window, the renderer cannot tell whether it opened, and
// Playwright's `selectOption` sets the value without opening one -- so a
// scripted click does not take the path that broke. What is assertable, and
// what this asserts, is that the cause is gone: the confirmation is an
// in-application `<dialog>`, no native modal reaches the page at all, and the
// selector is still focusable and operable immediately afterwards with no
// focus round trip. The reported symptom itself remains verified by hand.
//
// This runs in Electron rather than a browser because the renderer's focus
// behaviour after a native modal is what the report is about, and because
// `tests/in-app-confirmations.js` already covers the rest in a browser.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");
const electronExecutable = require("electron");

async function main() {
  const checkpoint = (label) => process.stdout.write(`[confirmation-focus] ${label}\n`);
  const desktopDirectory = path.resolve(__dirname, "..");
  const codebase = path.resolve(desktopDirectory, "..");
  const outputDirectory = path.join(codebase, "output", "confirmation-focus");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const userDataPath = fs.mkdtempSync(path.join(outputDirectory, "user-data-"));
  fs.writeFileSync(path.join(userDataPath, "application-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    defaultReferenceWhiteNits: 203,
    renderingMode: "auto",
    folders: { projectSave: outputDirectory, projectImport: outputDirectory, fileSave: "", fileImport: "", presetSave: "" },
    shortcuts: {},
    shortcutPresets: {},
    updates: { checkAutomatically: false, dismissedVersion: "" },
  }));

  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: ["--no-sandbox", "."],
    cwd: desktopDirectory,
    env: { ...process.env, HDR_FINISHER_USER_DATA_DIR: userDataPath, HDR_FINISHER_DISABLE_GPU: "1" },
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForSelector("#empty-import-button", { state: "visible", timeout: 30000 });
    checkpoint("window ready");

    // No source is imported. The reported control lives in the viewer's
    // Preview popover, which opens without one, and every confirmation in
    // this test is reachable from Settings -- so the run stays short and does
    // not depend on the desktop import path, which is covered by
    // electron-smoke.js.

    // Recorded, but not the thing that catches a regression here.
    //
    // In a browser a surviving window.confirm surfaces as Playwright's
    // `dialog` event, and `tests/in-app-confirmations.js` relies on that. In
    // Electron it does not: the negative control for this test put a real
    // native window on screen and the run simply blocked until the wait below
    // timed out, with nothing delivered to this listener. So what fails the
    // run when a native modal comes back is the in-app `<dialog>` never
    // opening -- verified by restoring one window.confirm at this call site
    // and watching this test time out at exactly that wait.
    const nativeDialogs = [];
    window.on("dialog", async (dialog) => {
      nativeDialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    // A confirmation that needs no image loaded, reached the way a user
    // reaches it: Settings -> Shortcuts -> Reset every shortcut.
    // Settings lives behind the window menu bar on Windows and Linux and
    // behind the native application menu on macOS, the same split
    // electron-smoke.js handles.
    if (process.platform === "darwin") {
      await electronApp.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()?.items.find((entry) => entry.label === "Edit")
          ?.submenu?.items.find((entry) => entry.label === "Settings…");
        if (!item || !item.enabled) throw new Error("Settings is unavailable in the application menu");
        item.click(undefined, BrowserWindow.getAllWindows()[0]);
      });
    } else {
      await window.getByRole("button", { name: "File", exact: true }).click();
      await window.locator("#settings-open").click();
    }
    await window.waitForSelector("#settings-dialog", { state: "visible", timeout: 10000 });
    await window.click('[data-settings-tab="shortcuts"]');
    await window.waitForSelector("#shortcuts-reset-all", { state: "visible", timeout: 10000 });

    await window.click("#shortcuts-reset-all");
    await window.waitForFunction(
      () => document.getElementById("app-dialog")?.open === true,
      null, { timeout: 10000 },
    );
    checkpoint("in-app confirmation opened");

    await window.evaluate(() => {
      document.querySelector('#app-dialog-actions [data-app-dialog-action="true"]').click();
    });
    await window.waitForFunction(
      () => document.getElementById("app-dialog")?.open !== true,
      null, { timeout: 10000 },
    );
    checkpoint("confirmation dismissed");

    assert.equal(nativeDialogs.length, 0,
      `A native modal was raised: ${JSON.stringify(nativeDialogs)}`);

    // Close Settings so the selector under test is the one the report names:
    // Maximum preview size, in the viewer's Preview popover.
    await window.evaluate(() => document.getElementById("settings-dialog")?.close());
    await window.click("#preview-toggle");
    await window.waitForSelector("#preview-resolution", { state: "visible", timeout: 10000 });

    // The selector, immediately, with no focus round trip. Clicking it must
    // reach the element and leave it focused and usable.
    const selector = window.locator("#preview-resolution");
    await selector.click();
    const state = await window.evaluate(() => {
      const element = document.getElementById("preview-resolution");
      return {
        focused: document.activeElement === element,
        disabled: element.disabled,
        options: element.options.length,
        value: element.value,
      };
    });
    assert.equal(state.disabled, false, "The preview resolution selector was disabled.");
    assert.ok(state.options > 1, `The selector had no choices: ${JSON.stringify(state)}`);
    assert.equal(state.focused, true,
      `Clicking the selector did not focus it after a confirmation: ${JSON.stringify(state)}`);

    // And it still changes, without the window having lost and regained focus.
    const target = state.value === "1024" ? "2048" : "1024";
    await selector.selectOption(target);
    const after = await window.evaluate(() => document.getElementById("preview-resolution").value);
    assert.equal(after, target,
      `The selector did not change after a confirmation: ${JSON.stringify({ after, target })}`);

    assert.equal(nativeDialogs.length, 0,
      `A native modal was raised: ${JSON.stringify(nativeDialogs)}`);

    checkpoint("selector operable immediately after a confirmation");
    process.stdout.write("[confirmation-focus] pass\n");
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
