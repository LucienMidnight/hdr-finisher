const DEFAULT_APPLICATION_PREFERENCES = Object.freeze({
  schemaVersion: 3,
  theme: "default-dark",
  defaultReferenceWhiteNits: 203,
  renderingMode: "auto",
  previewResolution: "auto",
  fasterDragging: false,
  libraryTestPatterns: false,
  navigationWindow: "auto",
  maximumGpuMemoryGiB: "auto",
  folders: { projectSave: "", projectImport: "", fileSave: "", fileImport: "", presetSave: "" },
  shortcuts: {},
  shortcutPresets: {},
  updates: { checkAutomatically: true, dismissedVersion: "" },
});

function cleanFolderPreferences(value) {
  return Object.fromEntries(["projectSave", "projectImport", "fileSave", "fileImport", "presetSave"].map((key) => {
    const candidate = typeof value?.[key] === "string" ? value[key] : "";
    return [key, candidate.length <= 4096 ? candidate : ""];
  }));
}

function cleanShortcutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([action, shortcut]) => (
    typeof action === "string" && action.length <= 240 && typeof shortcut === "string" && shortcut.length <= 100
  )).slice(0, 1000));
}

function sanitizeApplicationPreferences(value = {}) {
  const tiers = ["1024", "2048", "4096", "full"];
  const presets = value.shortcutPresets && typeof value.shortcutPresets === "object" && !Array.isArray(value.shortcutPresets)
    ? Object.fromEntries(Object.entries(value.shortcutPresets).filter(([name, shortcuts]) => (
      typeof name === "string" && name.trim() && name.length <= 80 && shortcuts && typeof shortcuts === "object"
    )).slice(0, 50).map(([name, shortcuts]) => [name, cleanShortcutMap(shortcuts)]))
    : {};
  return {
    schemaVersion: 3,
    theme: ["default-dark", "default-light", "studio-gray"].includes(value.theme) ? value.theme : "default-dark",
    defaultReferenceWhiteNits: Number(value.defaultReferenceWhiteNits) === 100 ? 100 : 203,
    renderingMode: ["auto", "gpu", "cpu"].includes(value.renderingMode) ? value.renderingMode : "auto",
    previewResolution: tiers.includes(String(value.previewResolution)) ? String(value.previewResolution) : "auto",
    fasterDragging: value.fasterDragging === true,
    libraryTestPatterns: value.libraryTestPatterns === true,
    gradeAutosave: value.gradeAutosave !== false,
    navigationWindow: ["auto", "always", "off"].includes(value.navigationWindow) ? value.navigationWindow : "auto",
    maximumGpuMemoryGiB: (() => {
      if (value.maximumGpuMemoryGiB === "auto") return "auto";
      const numeric = Number(value.maximumGpuMemoryGiB);
      return Number.isFinite(numeric) && numeric >= 0.25 && numeric <= 64
        ? Math.round(numeric * 100) / 100
        : "auto";
    })(),
    folders: cleanFolderPreferences(value.folders),
    shortcuts: cleanShortcutMap(value.shortcuts),
    shortcutPresets: presets,
    updates: {
      checkAutomatically: value.updates?.checkAutomatically !== false,
      dismissedVersion: typeof value.updates?.dismissedVersion === "string" && value.updates.dismissedVersion.length <= 40
        ? value.updates.dismissedVersion
        : "",
    },
  };
}

module.exports = { DEFAULT_APPLICATION_PREFERENCES, sanitizeApplicationPreferences };
