// Developer-only F1 page: deliberately loads no editor state or scripts.
(async () => {
  const desktop = window.hdrFinisherDesktop;
  if (!desktop) return;
  window.foundationDisplay = await desktop.environment();
  desktop.onDisplayStateChanged((environment) => { window.foundationDisplay = environment; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "F11") {
      event.preventDefault();
      desktop.performWindowAction("fullscreen");
    }
  });
  await desktop.rendererReady();
})().catch(console.error);
