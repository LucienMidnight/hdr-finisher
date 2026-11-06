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
  const menuBar = document.querySelector(".window-menu-bar");
  if (menuBar && usesNativeApplicationMenu) {
    menuBar.hidden = true;
    menuBar.setAttribute("aria-hidden", "true");
    const chrome = document.querySelector(".window-chrome");
    if (chrome) chrome.hidden = true;
  }

  const bar = document.querySelector(".top-bar");
  const lockup = bar.querySelector(".product-lockup");
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "unified-menu-button text-button";
  menuButton.textContent = "≡";
  menuButton.setAttribute("aria-label", "Application menus");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-controls", "unified-menus");
  menuButton.hidden = usesNativeApplicationMenu;
  lockup.append(menuButton);
  menuBar.id = "unified-menus";
  lockup.append(menuBar);
  menuBar.hidden = true;
  bar.querySelector(".top-actions").append(document.querySelector(".window-controls"));
  document.getElementById("project-recents").hidden = true;
  document.querySelector(".window-chrome").hidden = true;
  const showMenus = (show) => {
    menuBar.hidden = !show;
    menuButton.setAttribute("aria-expanded", String(show));
  };
  menuButton.addEventListener("click", () => showMenus(menuBar.hidden));
  bar.addEventListener("dblclick", event => {
    if (!event.target.closest("button, nav, input")) void desktop.performWindowAction?.("toggle-maximize");
  });
  const menus = [...document.querySelectorAll(".window-menu")];
  const submenus = [...document.querySelectorAll(".window-submenu")];
  const setSubmenuOpen = (submenu, open, { focusFirst = false } = {}) => {
    for (const candidate of submenus) {
      const show = open && candidate === submenu;
      candidate.querySelector(".window-submenu-popover").hidden = !show;
      candidate.querySelector(".window-submenu-trigger").setAttribute("aria-expanded", String(show));
    }
    if (open && focusFirst) {
      (submenu.querySelector('[aria-checked="true"]') || submenu.querySelector(".window-submenu-popover button"))?.focus();
    }
  };
  for (const submenu of submenus) {
    submenu.addEventListener("pointerenter", () => setSubmenuOpen(submenu, true));
    submenu.addEventListener("pointerleave", () => setSubmenuOpen(submenu, false));
  }
  const closeMenus = ({ restoreFocus = false } = {}) => {
    setSubmenuOpen(null, false);
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
    if (focusFirst) popover.querySelector('[role^="menuitem"]:not(:disabled)')?.focus();
  };

  for (const menu of menus) {
    const trigger = menu.querySelector(".window-menu-trigger");
    trigger.addEventListener("click", () => openMenu(menu));
    trigger.addEventListener("pointerenter", () => {
      const isOpen = !menu.querySelector(".window-menu-popover").hidden;
      const menuBarOpen = menus.some(item => !item.querySelector(".window-menu-popover").hidden);
      if (menuBarOpen && !isOpen) openMenu(menu);
    });
    trigger.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      openMenu(menu, { focusFirst: true });
    });
    menu.querySelector(".window-menu-popover").addEventListener("keydown", (event) => {
      // Arrow keys walk whichever level holds the focus: the items of an open
      // submenu, or the top level with submenu contents skipped.
      const submenu = document.activeElement?.closest?.(".window-submenu");
      const inSubmenu = Boolean(document.activeElement?.closest?.(".window-submenu-popover"));
      const level = inSubmenu ? submenu.querySelector(".window-submenu-popover") : event.currentTarget;
      const items = [...level.querySelectorAll('[role^="menuitem"]:not(:disabled)')]
        .filter((item) => inSubmenu || !item.closest(".window-submenu-popover"));
      const index = items.indexOf(document.activeElement);
      if (submenu && !inSubmenu && ["ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setSubmenuOpen(submenu, true, { focusFirst: true });
      } else if (inSubmenu && (event.key === "ArrowLeft" || event.key === "Escape")) {
        event.preventDefault();
        event.stopPropagation();
        setSubmenuOpen(submenu, false);
        submenu.querySelector(".window-submenu-trigger").focus();
      } else if (event.key === "Escape") {
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
    if (!event.target.closest(".window-menu, .unified-menu-button, .window-menu-bar")) { closeMenus(); showMenus(false); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { closeMenus(); showMenus(false); menuButton.focus(); }
    if (!usesNativeApplicationMenu && (event.key === "F10" || (event.key === "Alt" && !event.ctrlKey && !event.shiftKey))) {
      event.preventDefault(); showMenus(true); menus[0]?.querySelector("button").focus();
    }
  });

  menuBar?.addEventListener("click", (event) => {
    const item = event.target.closest('[role^="menuitem"]');
    if (!item || item.disabled) return;
    if (item.classList.contains("window-submenu-trigger")) {
      setSubmenuOpen(item.closest(".window-submenu"), true);
      return;
    }
    const send = (command, payload) => document.dispatchEvent(new CustomEvent("hdr:desktop-command", { detail: { command, payload } }));
    if (item.dataset.compareMode) send("compare-mode", { mode: item.dataset.compareMode });
    else if (item.dataset.navigationWindow) send("navigation-window", { mode: item.dataset.navigationWindow });
    else if (item.dataset.desktopCommand) {
      document.dispatchEvent(new CustomEvent("hdr:desktop-command", { detail: { command: item.dataset.desktopCommand } }));
    } else if (item.dataset.nativeEdit) {
      void desktop.performNativeEdit?.(item.dataset.nativeEdit);
    } else if (item.dataset.viewAction) {
      const targetId = { "reset-zoom": "zoom-actual", "zoom-in": "zoom-in", "zoom-out": "zoom-out" }[item.dataset.viewAction];
      document.getElementById(targetId)?.click();
    } else if (item.dataset.shellAction === "about") {
      void desktop.performShellAction?.("about");
    }
    closeMenus(); showMenus(false);
  });

  const setWindowState = (state = {}) => {
    document.documentElement.classList.toggle("window-fullscreen", Boolean(state.fullscreen));
    const maximize = document.querySelector('.window-control[data-window-action="toggle-maximize"]');
    if (!maximize) return;
    const maximized = Boolean(state.maximized);
    maximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    maximize.title = maximized ? "Restore" : "Maximize";
    maximize.classList.toggle("is-maximized", maximized);
  };
  document.querySelectorAll("[data-window-action]").forEach((button) => {
    button.addEventListener("click", () => void desktop.performWindowAction?.(button.dataset.windowAction));
  });
  desktop.onWindowStateChanged?.(setWindowState);
  void desktop.getWindowState?.().then(setWindowState);
})();
