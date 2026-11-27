function installTestDialogs(dialog, { fail, log = console.error }) {
  const answer = args => {
    const options = args.at(-1) || {};
    if (JSON.stringify(options.buttons) === JSON.stringify(['Save', 'Discard', 'Cancel'])) return 1;
    log(`[test-mode] blocked native dialog: ${options.title || ''}: ${options.message || ''}`);
    fail();
    return options.cancelId ?? Math.max(0, (options.buttons?.length || 1) - 1);
  };
  dialog.showMessageBox = async (...args) => ({ response: answer(args), checkboxChecked: false });
  dialog.showMessageBoxSync = (...args) => answer(args);
  dialog.showErrorBox = (title, message) => { log(`[test-mode] blocked error box: ${title}: ${message}`); fail(); };
  dialog.showOpenDialog = async () => { fail(); return { canceled: true, filePaths: [] }; };
  dialog.showSaveDialog = async () => { fail(); return { canceled: true }; };
  dialog.showOpenDialogSync = dialog.showSaveDialogSync = () => { fail(); return undefined; };
}
module.exports = { installTestDialogs };
