/* Small question windows and menus for the Library, built from the shared dialog and menu styles. */
(() => {
  "use strict";
  const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text != null) element.textContent = text; return element; };
  // ask() resolves to the typed values, or null when cancelled.
  function ask({ title, message = "", fields = [], confirm = "OK", cancel = "Cancel" }) {
    return new Promise(resolve => {
      const dialog = make("dialog", "application-dialog library-ask"), form = make("form");
      form.method = "dialog"; dialog.setAttribute("aria-label", title);
      const header = make("div", "application-dialog-header"), words = make("div");
      words.append(make("h2", "", title)); if (message) words.append(make("p", "", message)); header.append(words);
      const body = make("div", "library-ask-body"), inputs = [];
      for (const field of fields) {
        const label = make("label", "library-ask-field"), input = make("input");
        input.type = "text"; input.value = field.value || ""; input.name = field.name; input.placeholder = field.placeholder || ""; input.autocomplete = "off"; input.spellcheck = false; input.maxLength = 120;
        label.append(make("span", "", field.label), input); body.append(label); inputs.push(input);
      }
      const actions = make("div", "app-dialog-actions"), no = make("button", "button-secondary", cancel), yes = make("button", "button-primary", confirm);
      no.type = "button"; yes.type = "submit"; actions.append(no, yes);
      form.append(header, ...(fields.length ? [body] : []), actions); dialog.append(form); document.body.append(dialog);
      let answer = null;
      const ready = () => { yes.disabled = inputs.some(input => !input.value.trim()); };
      inputs.forEach(input => input.addEventListener("input", ready)); ready();
      no.addEventListener("click", () => dialog.close());
      form.addEventListener("submit", () => { answer = Object.fromEntries(inputs.map(input => [input.name, input.value.trim()])); });
      dialog.addEventListener("close", () => { dialog.remove(); resolve(answer); });
      dialog.showModal(); (inputs[0] || yes).focus(); inputs[0]?.select();
    });
  }
  // One menu at a time. It is placed inside the open dialog, if any, so it stays on top.
  const menu = make("div", "window-menu-popover library-folder-menu"); menu.id = "library-folder-menu"; menu.setAttribute("role", "menu"); menu.hidden = true;
  let origin = null, failed = () => {};
  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    if (restoreFocus && origin?.isConnected) origin.focus({ preventScroll: true });
    origin = null;
  }
  function showMenu(event, actions, { label = "Actions", anchor = null, onError = () => {} } = {}) {
    event.preventDefault(); event.stopPropagation(); closeMenu();
    if (!actions.length) return;
    origin = anchor || event.target.closest("button") || document.activeElement; failed = onError;
    menu.setAttribute("aria-label", label);
    menu.replaceChildren(...actions.map(action => {
      if (action.separator) return make("hr", "library-menu-separator");
      const button = make("button", "", action.label); button.type = "button"; button.setAttribute("role", "menuitem"); button.disabled = !!action.disabled;
      button.addEventListener("click", async () => {
        const report = failed; closeMenu(true);
        try { await action.run(); } catch (error) { report(error); }
      });
      return button;
    }));
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    (dialogs.at(-1) || document.body).append(menu);
    menu.hidden = false;
    const bounds = origin?.getBoundingClientRect?.() || { left: 0, bottom: 0, top: 0 };
    const pointer = event.type === "contextmenu";
    const x = pointer ? event.clientX : bounds.left, y = pointer ? event.clientY : anchor?.dataset.menuAbove ? bounds.top - menu.offsetHeight : bounds.bottom;
    menu.style.left = `${Math.max(0, Math.min(x, innerWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, innerHeight - menu.offsetHeight))}px`;
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) closeMenu(); });
  document.addEventListener("keydown", event => {
    if (menu.hidden) return;
    const items = [...menu.querySelectorAll("button:not(:disabled)")], at = items.indexOf(document.activeElement);
    if (["Escape", "Tab"].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    }
  }, true);
  window.addEventListener("blur", () => closeMenu());
  window.addEventListener("resize", () => closeMenu());
  window.HDRLibraryDialogs = Object.freeze({ ask, showMenu, closeMenu, menuOpen: () => !menu.hidden, make });
})();
