(() => {
  const desktop = window.hdrFinisherDesktop || null;
  document.documentElement.classList.toggle("desktop-shell", Boolean(desktop));
  if (!desktop) return;

  const usesNativeApplicationMenu = desktop.platform === "darwin";
  document.documentElement.classList.toggle("native-application-menu", usesNativeApplicationMenu);

  document.querySelectorAll("[data-window-menu-slot]").forEach((slot) => {
    const control = document.getElementById(slot.dataset.windowMenuSlot);
    if (!control) return;
    control.className = "";
    control.setAttribute("role", "menuitem");
    if (control.id === "project-open") control.textContent = "Open Project…";
    if (control.id === "project-save") control.textContent = "Save Project";
    if (control.id === "settings-open") control.textContent = "Settings…";
    if (control.id === "help-open") control.textContent = "HDR Finisher Help";
    slot.replaceWith(control);
  });
  document.querySelector(".top-actions")?.remove();
  const menuBar = document.querySelector(".window-menu-bar");
  if (menuBar && usesNativeApplicationMenu) {
    menuBar.hidden = true;
    menuBar.setAttribute("aria-hidden", "true");
    document.querySelector(".window-chrome")?.setAttribute("aria-label", "Window controls");
  }

  const menus = [...document.querySelectorAll(".window-menu")];
  const closeMenus = ({ restoreFocus = false } = {}) => {
    for (const menu of menus) {
      const trigger = menu.querySelector(".window-menu-trigger");
      const popover = menu.querySelector(".window-menu-popover");
      const wasOpen = !popover.hidden;
      popover.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus && wasOpen) trigger.focus();
    }
  };

  const openMenu = (menu, { focusFirst = false } = {}) => {
    const trigger = menu.querySelector(".window-menu-trigger");
    const popover = menu.querySelector(".window-menu-popover");
    const wasOpen = !popover.hidden;
    closeMenus();
    if (wasOpen) return;
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (focusFirst) popover.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  };

  for (const menu of menus) {
    const trigger = menu.querySelector(".window-menu-trigger");
    trigger.addEventListener("click", () => openMenu(menu));
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openMenu(menu, { focusFirst: true });
    });
    menu.querySelector(".window-menu-popover").addEventListener("keydown", (event) => {
      const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index = items.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenus({ restoreFocus: true });
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(index + delta + items.length) % items.length]?.focus();
      }
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".window-menu")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus({ restoreFocus: true });
  });

  menuBar?.addEventListener("click", (event) => {
    const item = event.target.closest('[role="menuitem"]');
    if (!item || item.disabled) return;
    if (item.dataset.desktopCommand) {
      document.dispatchEvent(new CustomEvent("hdr:desktop-command", { detail: { command: item.dataset.desktopCommand } }));
    } else if (item.dataset.nativeEdit) {
      void desktop.performNativeEdit?.(item.dataset.nativeEdit);
    } else if (item.dataset.viewAction) {
      const targetId = { "reset-zoom": "zoom-actual", "zoom-in": "zoom-in", "zoom-out": "zoom-out" }[item.dataset.viewAction];
      document.getElementById(targetId)?.click();
    } else if (item.dataset.shellAction === "about") {
      void desktop.performShellAction?.("about");
    }
    closeMenus();
  });

  const setWindowState = (state = {}) => {
    const maximize = document.querySelector('.window-control[data-window-action="toggle-maximize"]');
    if (!maximize) return;
    const maximized = Boolean(state.maximized);
    maximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    maximize.title = maximized ? "Restore" : "Maximize";
    maximize.classList.toggle("is-maximized", maximized);
    const icon = maximize.querySelector("img");
    if (icon) icon.src = maximized ? "/static/assets/icons/tabler/square-half.svg" : "/static/assets/icons/tabler/square.svg";
  };
  document.querySelectorAll("[data-window-action]").forEach((button) => {
    button.addEventListener("click", () => void desktop.performWindowAction?.(button.dataset.windowAction));
  });
  desktop.onWindowStateChanged?.(setWindowState);
  void desktop.getWindowState?.().then(setWindowState);
})();
