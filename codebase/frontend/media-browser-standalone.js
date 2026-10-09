// Development foundation page: reuse today's browser, without editor scripts.
const browserDesktop = window.hdrFinisherDesktop;
const standaloneMediaBrowser = window.HDRMediaBrowser.create({
  root: document.getElementById("directory-browser"),
  backendUrl: window.location.origin,
  modal: false,
  closeOnSelect: false,
  callbacks: {
    // The shell grants this path through the backend before handing it to Grade.
    grantSourcePath: browserDesktop ? (path) => Promise.resolve({ path }) : null,
    onOpenSource: ({ path }) => browserDesktop.openSourceInMain(path),
    onOpenError: (message) => { document.getElementById("directory-browser-status").textContent = message; },
    onClose: () => browserDesktop?.performWindowAction("close"),
  },
});
standaloneMediaBrowser.bindEvents();
standaloneMediaBrowser.openMediaBrowser("source");
window.addEventListener("keydown", (event) => {
  if (event.key !== "F11" || !browserDesktop) return;
  event.preventDefault();
  browserDesktop.performWindowAction("toggle-fullscreen");
});
browserDesktop?.rendererReady();
