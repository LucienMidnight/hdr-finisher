// In-application replacements for window.confirm / alert / prompt.
//
// MINOR-10. A `<select>` popup in Chromium is a native window, and after a
// blocking native modal the renderer's focus state is left in a condition
// where it will not open one -- clicking the Maximum preview size dropdown did
// nothing until the user focused another Windows application and came back.
// That is a property of the native modal, not of the selector, so it applied
// to every window.confirm, window.alert and window.prompt in the app.
//
// These build on the same `<dialog>` + `showModal()` pattern as
// `#settings-dialog`, `#directory-browser` and `#group-preset-dialog`, so
// nothing native is involved and the focus state is never disturbed. They also
// remove the last generic-OS styling from the authoring surface.
//
// Each returns a promise. `confirm` resolves true or false, `alert` resolves
// undefined, `prompt` resolves the string or null, and `choose` resolves the
// value of the chosen button or null -- which is what the three-way unsaved
// changes transition needs, since save / discard / cancel cannot be expressed
// as two sequential yes-or-no questions without asking the user twice.
(function () {
  const DIALOG_ID = "app-dialog";

  let queue = Promise.resolve();
  // Which presentation currently owns the element.
  let sequence = 0;
  // How many `close` events this module has caused and not yet seen.
  //
  // `close` is dispatched as a queued task, not synchronously, so the close
  // that ends one presentation arrives after the next one has opened and
  // attached its own listeners to the same element -- and is then read as the
  // user cancelling a dialog they have not answered yet. Measured: asking
  // save / discard / cancel in sequence returned save, cancel, cancel.
  //
  // Neither removing the listeners before closing nor tagging the
  // presentation helps, because the stale event is delivered to whatever is
  // attached when it finally runs, and by then that is legitimately the
  // current presentation. Counting the closes we caused is what distinguishes
  // them from a close somebody else performed.
  let selfClosed = 0;

  function elements() {
    const dialog = document.getElementById(DIALOG_ID);
    if (!dialog) return null;
    return {
      dialog,
      title: dialog.querySelector("#app-dialog-title"),
      message: dialog.querySelector("#app-dialog-message"),
      field: dialog.querySelector("#app-dialog-field"),
      input: dialog.querySelector("#app-dialog-input"),
      label: dialog.querySelector("#app-dialog-input-label"),
      actions: dialog.querySelector("#app-dialog-actions"),
    };
  }

  /**
   * Show one dialog and resolve with `{ value, text }`: the chosen action's
   * value, and the text field's contents read at the moment of choosing.
   *
   * Everything goes through a single element, so overlapping calls have to be
   * serialised: two `showModal()` calls on the same dialog throw, and a
   * confirmation that silently failed to appear would be far worse than one
   * that waits its turn.
   */
  function present({ title, message, actions, input = null }) {
    const run = () => new Promise((resolve) => {
      const parts = elements();
      // No dialog in the document -- a test harness page, or markup that has
      // drifted. Resolving with the cancelling answer keeps a missing dialog
      // from silently approving a destructive action.
      if (!parts) {
        resolve({ value: actions.find((action) => action.cancel)?.value ?? null, text: null });
        return;
      }
      const { dialog, actions: actionBar } = parts;
      const token = ++sequence;

      parts.title.textContent = title || "";
      parts.message.textContent = message || "";
      parts.message.hidden = !message;

      if (input) {
        parts.field.hidden = false;
        parts.label.textContent = input.label || title || "";
        parts.input.value = input.value || "";
        parts.input.placeholder = input.placeholder || "";
      } else {
        parts.field.hidden = true;
        parts.input.value = "";
      }

      actionBar.textContent = "";
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener("cancel", onCancel);
        dialog.removeEventListener("close", onClose);
        if (dialog.open) {
          selfClosed += 1;
          dialog.close();
        }
        // Focus returning to whatever opened the dialog is the platform's
        // own `<dialog>` behaviour, not ours. An explicit opener.focus() here
        // was removed after it was found to make no difference: the test for
        // it passed with the call deleted, so it was not evidence of anything.
        // Read the field here rather than after the await. The queue may have
        // started the next dialog by the time a caller's continuation runs,
        // and it shares this element.
        resolve({ value, text: parts.input.value });
      };

      const cancelValue = () => actions.find((action) => action.cancel)?.value ?? null;
      // Escape, and any other route that closes the dialog without a button.
      const onCancel = (event) => {
        if (token !== sequence) return;
        event.preventDefault();
        finish(cancelValue());
      };
      const onClose = () => {
        // A close we caused, arriving late. It belongs to a presentation that
        // has already resolved, not to this one.
        if (selfClosed > 0) { selfClosed -= 1; return; }
        if (token === sequence) finish(cancelValue());
      };
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClose);

      let defaultButton = null;
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.className = action.destructive
          ? "button-danger"
          : (action.primary ? "button-primary" : "");
        button.dataset.appDialogAction = String(action.value);
        button.addEventListener("click", () => finish(action.value));
        actionBar.appendChild(button);
        if (action.primary) defaultButton = button;
      }

      // Enter confirms. A text field swallows Enter for itself, so the field
      // submits the primary action rather than inserting a newline.
      if (input) {
        parts.input.onkeydown = (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          finish(actions.find((action) => action.primary)?.value ?? cancelValue());
        };
      } else {
        parts.input.onkeydown = null;
      }

      dialog.showModal();
      if (input) {
        parts.input.focus();
        parts.input.select();
      } else if (defaultButton) {
        defaultButton.focus();
      }
    });

    // Chain, and keep the chain alive if one call throws.
    const result = queue.then(run, run);
    queue = result.catch(() => null);
    return result;
  }

  async function confirm(message, {
    title = "Confirm",
    confirmLabel = "OK",
    cancelLabel = "Cancel",
    destructive = false,
  } = {}) {
    const { value } = await present({
      title,
      message,
      actions: [
        { label: cancelLabel, value: false, cancel: true },
        { label: confirmLabel, value: true, primary: true, destructive },
      ],
    });
    return value === true;
  }

  async function alert(message, { title = "HDR Finisher", confirmLabel = "OK" } = {}) {
    await present({
      title,
      message,
      actions: [{ label: confirmLabel, value: true, primary: true, cancel: true }],
    });
  }

  async function prompt(message, defaultValue = "", { title = "HDR Finisher", confirmLabel = "OK", placeholder = "" } = {}) {
    const { value, text } = await present({
      title,
      message: null,
      input: { label: message, value: defaultValue, placeholder },
      actions: [
        { label: "Cancel", value: null, cancel: true },
        { label: confirmLabel, value: true, primary: true },
      ],
    });
    return value === true ? text : null;
  }

  /** A choice with more than two answers, such as save / discard / cancel. */
  async function choose(message, actions, { title = "Confirm" } = {}) {
    const { value } = await present({ title, message, actions });
    return value;
  }

  window.HDRDialogs = { confirm, alert, prompt, choose };
}());
