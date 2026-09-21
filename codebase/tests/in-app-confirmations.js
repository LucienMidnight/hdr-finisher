// MINOR-10 -- confirmations are in-application, not native.
//
// Reported from manual testing: after dismissing the native confirmation on
// Crop & Rotate Reset, the Maximum preview size dropdown could no longer be
// opened. Clicking it did nothing until another Windows application was
// focused and the window returned. A `<select>` popup in Chromium is a native
// window, and after a blocking native modal the renderer will not open one.
// That is a property of the native modal, so it applied to every
// window.confirm, window.alert and window.prompt in the application.
//
//   node tests/in-app-confirmations.js --url http://127.0.0.1:8765
//
// The lockout itself does not reproduce in a plain browser -- it needs the
// Electron renderer -- so what is asserted here is everything that made it
// possible: that no native dialog is raised at all, that the replacement is
// reachable through real call sites, that both answers keep their outcome,
// and that it is keyboard-operable with focus returned. The Electron-side
// assertion that the selector opens on the first click is recorded as still
// owed in the backlog.

const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // Any native dialog at all is the defect. Playwright dismisses these
  // automatically, so without this listener a surviving window.confirm would
  // simply answer itself and the run would look clean.
  const nativeDialogs = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push({ type: dialog.type(), message: dialog.message() });
    await dialog.dismiss();
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    // 1. Nothing native is left in the code that ships. A behavioural test can
    //    only cover the call sites it can reach; this covers all of them.
    const sources = await page.evaluate(async () => {
      const read = async (name) => (await fetch(`/static/${name}`)).text();
      const files = ["app.js", "application-shell.js", "app-dialog.js"];
      const out = {};
      for (const name of files) out[name] = await read(name);
      return out;
    });
    for (const [name, text] of Object.entries(sources)) {
      // app-dialog.js names them in its own explanation of what it replaces,
      // so match a call rather than a mention.
      const calls = text.match(/window\.(confirm|alert|prompt)\s*\(/g) || [];
      assert(calls.length === 0,
        `${name} still calls a native dialog: ${JSON.stringify(calls)}`);
    }

    assert(await page.evaluate(() => typeof window.HDRDialogs?.confirm === "function"),
      "window.HDRDialogs.confirm is not installed.");

    // 2. A real call site: Settings -> Shortcuts. Drive the recording UI to
    //    give Reset an observable outcome, which also exercises the capture
    //    handler that had to become async to await its questions.
    await page.evaluate(() => {
      const dialog = document.getElementById("settings-dialog");
      if (!dialog.open) dialog.showModal();
      document.querySelector('[data-settings-tab="shortcuts"]')?.click();
    });

    const firstRow = page.locator("#shortcut-list [data-shortcut-action]").first();
    const commandId = await firstRow.getAttribute("data-shortcut-action");
    const defaultLabel = (await firstRow.textContent()).trim();
    const labelFor = () => page.locator(`[data-shortcut-action="${commandId}"]`).textContent()
      .then((text) => text.trim());

    await firstRow.click();
    await page.keyboard.press("Control+Shift+F9");
    const customLabel = await labelFor();
    assert(customLabel !== defaultLabel,
      `Recording a shortcut did not change it: still ${JSON.stringify(customLabel)}. `
      + "The capture handler is the one that now awaits its confirmations.");

    const dialogVisible = () => page.evaluate(
      () => Boolean(document.getElementById("app-dialog")?.open),
    );
    const waitOpen = () => page.waitForFunction(
      () => document.getElementById("app-dialog")?.open === true, null, { timeout: 5000 },
    );
    const waitClosed = () => page.waitForFunction(
      () => document.getElementById("app-dialog")?.open !== true, null, { timeout: 5000 },
    );
    const clickAction = (value) => page.evaluate((wanted) => {
      const button = document.querySelector(`#app-dialog-actions [data-app-dialog-action="${wanted}"]`);
      if (!button) throw new Error("no action button for " + wanted);
      button.click();
    }, value);

    // Cancel keeps the recorded shortcut.
    await page.click("#shortcuts-reset-all");
    await waitOpen();
    assert(await dialogVisible(), "Reset all did not open the in-app dialog.");
    await clickAction("false");
    await waitClosed();
    assert(await labelFor() === customLabel,
      "Cancelling the reset still cleared the shortcut.");

    // Escape cancels, and focus goes back to the button that opened it.
    // The focus return is the platform's own `<dialog>` behaviour rather than
    // anything this code does -- an explicit opener.focus() was tried and
    // deleted again, because the assertion passed either way. It is asserted
    // here because the acceptance criterion names it, not as cover for our
    // own code.
    await page.click("#shortcuts-reset-all");
    await waitOpen();
    await page.keyboard.press("Escape");
    await waitClosed();
    assert(await labelFor() === customLabel, "Escape did not cancel the reset.");
    const focusedAfterEscape = await page.evaluate(() => document.activeElement?.id || null);
    assert(focusedAfterEscape === "shortcuts-reset-all",
      "Focus did not return to the control that opened the dialog: " + focusedAfterEscape);

    // Confirming does clear it.
    await page.click("#shortcuts-reset-all");
    await waitOpen();
    await clickAction("true");
    await waitClosed();
    assert(await labelFor() === defaultLabel,
      "Confirming the reset did not restore the default shortcut.");

    // 3. The prompt replacement, through Save shortcut preset. Enter confirms
    //    from inside the field.
    const presetNames = () => page.evaluate(
      () => Object.keys(window.HDRApplicationShell.preferences().shortcutPresets || {}),
    );

    await page.click("#shortcut-save-preset");
    await waitOpen();
    assert(await page.evaluate(() => document.getElementById("app-dialog-field")?.hidden === false),
      "The prompt dialog did not show its text field.");
    await page.fill("#app-dialog-input", "Test preset");
    await page.keyboard.press("Enter");
    await waitClosed();
    const presets = await presetNames();
    assert(presets.includes("Test preset"),
      "Enter in the prompt field did not save the preset: " + JSON.stringify(presets));

    // Cancelling a prompt yields null, so nothing is created.
    await page.click("#shortcut-save-preset");
    await waitOpen();
    await page.fill("#app-dialog-input", "Discarded preset");
    await page.keyboard.press("Escape");
    await waitClosed();
    const afterCancel = await presetNames();
    assert(!afterCancel.includes("Discarded preset"),
      "Escaping the prompt still saved the preset: " + JSON.stringify(afterCancel));

    // 4. The three-way answer the unsaved-changes transition needs. Two
    //    yes-or-no questions cannot express it without asking twice.
    const threeWay = await page.evaluate(async () => {
      const results = {};
      for (const wanted of ["save", "discard", "cancel"]) {
        const pending = window.HDRDialogs.choose("Save changes before you close?", [
          { label: "Cancel", value: "cancel", cancel: true },
          { label: "Discard", value: "discard", destructive: true },
          { label: "Save", value: "save", primary: true },
        ], { title: "Unsaved changes" });
        await new Promise((resolve) => setTimeout(resolve, 30));
        document.querySelector(`#app-dialog-actions [data-app-dialog-action="${wanted}"]`).click();
        results[wanted] = await pending;
      }
      return results;
    });
    assert(threeWay.save === "save" && threeWay.discard === "discard" && threeWay.cancel === "cancel",
      "The three-way choice did not return each answer: " + JSON.stringify(threeWay));

    // 5. Overlapping calls are serialised rather than throwing. Two
    //    showModal() calls on one element is an error, and a confirmation that
    //    failed to appear would be worse than one that waits.
    const overlapping = await page.evaluate(async () => {
      const first = window.HDRDialogs.confirm("first");
      const second = window.HDRDialogs.confirm("second");
      const seen = [];
      for (let index = 0; index < 2; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        seen.push(document.getElementById("app-dialog-message").textContent);
        document.querySelector('#app-dialog-actions [data-app-dialog-action="true"]').click();
      }
      return { seen, answers: [await first, await second] };
    });
    assert(overlapping.seen.join(",") === "first,second",
      "Overlapping confirmations were not serialised: " + JSON.stringify(overlapping));
    assert(overlapping.answers.every((answer) => answer === true),
      "A serialised confirmation lost its answer: " + JSON.stringify(overlapping));

    assert(nativeDialogs.length === 0,
      "A native dialog was raised: " + JSON.stringify(nativeDialogs));
    assert(pageErrors.length === 0, "Page errors: " + JSON.stringify(pageErrors));

    console.log("Confirmations are in-application: no native dialog raised, "
      + "both answers preserved, Escape cancels, focus returned, three-way answered.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
