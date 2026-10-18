/* Reusable settings picker: selection is independent of the Library and future Looks UI. */
(function (root) {
  'use strict';
  function selectionModel(groups, saved) {
    const ids = groups.flatMap(group => group.settings.map(setting => setting.id));
    const settings = new Set((saved?.settings || ids.filter(id => !groups.some(group => ['geometry', 'lens-corrections', 'local-adjustments'].includes(group.id) && group.settings.some(setting => setting.id === id)))) .filter(id => ids.includes(id)));
    const lanes = new Set(saved?.lanes || ['hdr', 'sdr']);
    return {
      has: id => settings.has(id), lane: id => lanes.has(id),
      toggle(id, checked) { checked ? settings.add(id) : settings.delete(id); },
      toggleLane(id, checked) { checked ? lanes.add(id) : lanes.delete(id); },
      choose(choice) { settings.clear(); for (const group of groups) for (const setting of group.settings) if (choice === 'all' || choice === 'modified' && setting.modified) settings.add(setting.id); },
      value: () => ({lanes: [...lanes], settings: ids.filter(id => settings.has(id))}),
      active: () => groups.filter(group => (!group.lane || lanes.has(group.lane)) && group.settings.some(setting => settings.has(setting.id))),
    };
  }
  function create({api, prepare, changed, status}) {
    let copied = null, running = false;
    const notify = () => changed?.(copied);
    async function refresh() { copied = await api('/api/library/grade-copy'); notify(); return copied; }
    async function copy(path) {
      if (!path || running) return;
      copied = await api('/api/library/grade-copy', {path}); notify();
      status(`Grade copied from ${copied.name}`);
    }
    async function paste(paths, choose = false) {
      if (!paths.length || running) return;
      running = true;
      try {
        await refresh(); if (!copied?.name) return;
        const selection = await dialog(copied, paths, choose);
        if (!selection || !await prepare(paths)) return;
        // Photos never prepared need Grade's import for their own starting point.
        for (const [index, path] of paths.entries()) {
          if (paths.length > 1) status(`Preparing ${index + 1} of ${paths.length} photos for paste…`);
          await api('/api/library/grade-prepare', {path});
        }
        const result = await api('/api/library/grade-paste', {paths, selection});
        changed?.(copied, result);
      } finally { running = false; }
    }
    function dialog(clipboard, paths, expanded) {
      const {make} = root.HDRLibraryDialogs;
      return new Promise(resolve => {
        const model = selectionModel(clipboard.groups, clipboard.selection);
        const dialog = make('dialog', 'application-dialog library-ask library-smart-editor grade-paste-dialog');
        dialog.setAttribute('aria-label', `Paste Grade From ${clipboard.name}`);
        const header = make('div', 'application-dialog-header'), words = make('div');
        const title = make('h2', '', `Paste Grade From ${clipboard.name}`), summary = make('p');
        words.append(title, summary); header.append(words);
        const body = make('div', 'library-ask-body'), tools = make('div', 'library-options'), list = make('div', 'group-preset-list');
        const choose = make('button', 'text-button', 'Choose what to paste'); choose.type = 'button'; choose.setAttribute('aria-expanded', String(expanded));
        const choices = make('div'); choices.hidden = !expanded;
        choose.addEventListener('click', () => { choices.hidden = !choices.hidden; choose.setAttribute('aria-expanded', String(!choices.hidden)); });
        const checks = [], masters = [];
        function checkbox(label, checked, callback) {
          const row = make('label', 'checkbox-row'), input = make('input'); input.type = 'checkbox'; input.checked = checked;
          input.addEventListener('change', () => { callback(input.checked); update(); }); row.append(input, make('span', '', label));
          return {row, input};
        }
        for (const lane of ['hdr', 'sdr']) {
          const tick = checkbox(`${lane.toUpperCase()} side`, model.lane(lane), value => model.toggleLane(lane, value)); tools.append(tick.row); masters.push({lane, ...tick});
        }
        for (const [value, label] of [['all','All'], ['modified','Modified only'], ['none','None']]) {
          const button = make('button', 'text-button', label); button.type = 'button';
          button.addEventListener('click', () => { model.choose(value); update(); }); tools.append(button);
        }
        const sections = new Map();
        for (const group of clipboard.groups) {
          if (!sections.has(group.section)) { const section = make('section'); section.append(make('h3', 'group-preset-subheading', group.section)); list.append(section); sections.set(group.section, section); }
          const details = make('details'), label = make('summary');
          const tick = checkbox(`${group.lane ? group.lane.toUpperCase() + ' · ' : ''}${group.label}`, false, checked => { for (const setting of group.settings) model.toggle(setting.id, checked); });
          tick.input.setAttribute('aria-label', `${group.lane || ''} ${group.label}`.trim());
          // Keep disclosure keyboard behaviour separate from the checkbox.
          tick.row.addEventListener('click', event => event.stopPropagation());
          label.append(tick.row); if (group.modified) label.append(make('small', 'library-kicker', 'Mod')); details.append(label);
          const rows = make('div', 'library-ask-body');
          for (const setting of group.settings) {
            const child = checkbox(setting.label, model.has(setting.id), checked => model.toggle(setting.id, checked));
            child.input.dataset.setting = setting.id; if (setting.modified) child.row.append(make('small', 'library-kicker', 'Mod'));
            rows.append(child.row); checks.push({setting, group, ...child});
          }
          details.append(rows); sections.get(group.section).append(details); checks.push({group, ...tick});
        }
        choices.append(tools, list);
        const notes = make('p'), warnings = make('p'); notes.textContent = `${paths.length} ${paths.length === 1 ? 'photo will' : 'photos will'} change. Each keeps its previous grade. Ctrl+Z undoes the whole paste.`;
        body.append(choose, choices);
        const footer = make('div', 'library-ask-body'); footer.append(notes, warnings);
        const actions = make('div', 'app-dialog-actions'), cancel = make('button','button-secondary','Cancel'), yes = make('button','button-primary', paths.length > 1 ? `Paste onto ${paths.length} photos` : 'Paste grade');
        cancel.type = yes.type = 'button'; actions.append(cancel, yes); dialog.append(header, body, footer, actions); document.body.append(dialog);
        let answer = null, previewId = 0, timer;
        function update() {
          for (const row of checks) {
            if (row.setting) { row.input.checked = model.has(row.setting.id); row.input.disabled = !!row.group.lane && !model.lane(row.group.lane); }
            else { const count = row.group.settings.filter(setting => model.has(setting.id)).length; row.input.checked = count === row.group.settings.length; row.input.indeterminate = count > 0 && count < row.group.settings.length; row.input.disabled = !!row.group.lane && !model.lane(row.group.lane); }
          }
          const active = model.active(), names = [...new Set(active.map(group => group.section))];
          summary.textContent = `Paste ${names.length ? names.join(', ') + ' settings' : 'no settings'}${paths.length > 1 ? ` onto ${paths.length} photos` : ''}.`;
          // Paste is usable at once; the check below only refines the count and warnings.
          yes.disabled = !active.length; clearTimeout(timer); const id = ++previewId;
          if (active.length) timer = setTimeout(async () => {
            notes.textContent = `Checking ${paths.length === 1 ? 'the photo' : `${paths.length} photos`}… Photos not yet prepared take a few seconds each.`;
            try { const preview = await api('/api/library/grade-paste', {paths, selection: model.value(), preview:true}); if (id !== previewId || !dialog.isConnected) return; warnings.textContent = (preview.warnings || []).map(warning => typeof warning === 'string' ? warning : `${warning.path.split(/[\\/]/).at(-1)}: ${warning.message}`).join(' '); notes.textContent = `${preview.count} of ${paths.length} ${paths.length === 1 ? 'photo will' : 'photos will'} change. Each keeps its previous grade. Ctrl+Z undoes the whole paste.`; yes.disabled = !preview.count; }
            catch(error) { if (id === previewId && dialog.isConnected) { warnings.textContent = error.message; yes.disabled = true; } }
          }, 120);
        }
        cancel.addEventListener('click', () => dialog.close());
        yes.addEventListener('click', () => { answer = model.value(); dialog.close(); });
        dialog.addEventListener('close', () => { clearTimeout(timer); previewId++; dialog.remove(); resolve(answer); }, {once:true});
        update(); dialog.showModal(); cancel.focus();
      });
    }
    return Object.freeze({refresh, copy, paste, available: () => !!copied?.name, dialog});
  }
  const exported = Object.freeze({selectionModel, create});
  if (typeof module !== 'undefined') module.exports = exported; else root.HDRGradePaste = exported;
})(typeof window === 'undefined' ? globalThis : window);
