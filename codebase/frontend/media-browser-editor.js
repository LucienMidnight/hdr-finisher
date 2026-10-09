// Only this adapter knows the editor. The browser itself has private state.
const editorMediaBrowser = window.HDRMediaBrowser.create({
  root: document.getElementById("directory-browser"),
  backendUrl: window.location.origin,
  callbacks: {
    grantSourcePath: desktop ? (path) => desktop.grantSourcePath(path) : null,
    grantProjectPath: desktop?.grantProjectPath ? (path, intent) => desktop.grantProjectPath(path, intent) : null,
    onOpenSource: (selection) => openDesktopSelection(selection),
    onOpenError: (message) => showUploadError(message),
    onPreviewSelected: (entry) => renderExperimentalDngNote(entry),
    pickSourceFile: () => els.fileInput.click(),
    onDirectorySelected: (directory) => {
      els.exportDirectory.value = directory;
      els.exportStatus.textContent = `Save folder set to ${directory}`;
    },
    makeProjectPath: (directory, filename) => joinExportPath(directory, sanitizeProjectFilename(filename)),
    confirmReplace: (path) => window.HDRDialogs.confirm(`Replace the existing project?\n\n${path}`, {
      title: "Replace project", confirmLabel: "Replace", destructive: true,
    }),
    reportError: (entry) => status.post(entry),
  },
});
const { openMediaBrowser, chooseProjectPath, recordSuccessfulMediaImport, closeExportDirectoryBrowser, loadMediaDirectory } = editorMediaBrowser;
