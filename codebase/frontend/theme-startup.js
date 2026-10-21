// Runs before stylesheets and first paint, using the desktop's saved preference.
(() => {
  let theme = window.hdrFinisherDesktop?.startupTheme;
  try {
    if (parent !== window) theme = parent.document.documentElement.dataset.theme;
    else if (!theme) theme = JSON.parse(localStorage.getItem("hdr-finisher:application-preferences:v1") || "{}").theme;
  } catch {}
  if (["default-dark", "default-light", "studio-gray"].includes(theme)) document.documentElement.dataset.theme = theme;
})();
