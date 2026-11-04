// Runs before stylesheets and first paint, using the desktop's saved preference.
(() => {
  let accent = window.hdrFinisherDesktop?.startupAccent;
  let theme = window.hdrFinisherDesktop?.startupTheme;
  try {
    if (parent !== window) { theme = parent.document.documentElement.dataset.theme; accent = JSON.parse(parent.document.documentElement.dataset.accent || "null"); }
    else { const saved = JSON.parse(localStorage.getItem("hdr-finisher:application-preferences:v1") || "{}"); theme ||= saved.theme; accent ||= saved.accent; }
  } catch {}
  if (["default-dark", "default-light", "studio-gray"].includes(theme)) document.documentElement.dataset.theme = theme;
  window.HDRAppearance?.apply(accent);
})();
