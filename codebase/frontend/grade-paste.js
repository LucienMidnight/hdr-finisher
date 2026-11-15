/* Reusable settings picker: selection is independent of the Library and future Looks UI. */
(function (root) {
  'use strict';
  function selectionModel(groups, saved, sameSides = true) {
    const ids = groups.flatMap(group => group.settings.map(setting => setting.id));
    const settings = new Set((saved?.settings || ids.filter(id => !groups.some(group => ['geometry', 'perspective', 'lens-corrections', 'local-adjustments'].includes(group.id) && group.settings.some(setting => setting.id === id)))) .filter(id => ids.includes(id)));
    const lanes = new Set(saved?.lanes || ['hdr', 'sdr']);
    let linked = sameSides;
    const peer = id => {
      const other = id.replace(/\.(hdr|sdr)\./, (_, lane) => '.' + (lane === 'hdr' ? 'sdr' : 'hdr') + '.');
      if (ids.includes(other)) return other;
      return other.replace(/_(nits|percent)$/, (_, unit) => unit === 'nits' ? '_percent' : '_nits');
    };
    if (saved && (lanes.has('hdr') !== lanes.has('sdr') || ids.some(id => ids.includes(peer(id)) && settings.has(id) !== settings.has(peer(id))))) linked = false;
    function toggle(id, checked) {
      checked ? settings.add(id) : settings.delete(id);
      if (linked && ids.includes(peer(id))) checked ? settings.add(peer(id)) : settings.delete(peer(id));
    }
    return {
      linked: () => linked,
      link(value) {
        linked = value;
        if (linked) {
          for (const id of [...settings]) toggle(id, true);
          if (lanes.size) { lanes.add('hdr'); lanes.add('sdr'); }
        }
      },
      has: id => settings.has(id), lane: id => lanes.has(id),
      peer,
      toggle,
      toggleLane(id, checked) { for (const lane of linked ? ['hdr','sdr'] : [id]) checked ? lanes.add(lane) : lanes.delete(lane); },
      choose(choice, lane) {
        const scope = groups.filter(group => lane === undefined || (lane === 'shared' ? !group.lane : linked ? !!group.lane : group.lane === lane));
        for (const group of scope) for (const setting of group.settings) settings.delete(setting.id);
        for (const group of scope) for (const setting of group.settings) if (choice === 'all' || choice === 'modified' && setting.modified) toggle(setting.id, true);
      },
      value: () => ({lanes: [...lanes], settings: ids.filter(id => settings.has(id))}),
      active: () => groups.filter(group => (!group.lane || lanes.has(group.lane)) && group.settings.some(setting => settings.has(setting.id))),
    };
  }
  // Stored-grade checks never prepare cold photos; those remain eligible to paste.
  function previewState(total, active, preview, error) {
    const pasteLabel = total > 1 ? `Paste onto ${total} photos` : 'Paste grade';
    if (!active) return {state:'empty', disabled:true, label:'Choose settings', message:'Choose at least one setting and a side to paste.'};
    if (error) return {state:'error', disabled:true, label:'Check failed', message:'Could not check these photos. Change the choices to try again.'};
    if (!preview) return {state:'checking', disabled:true, label:'Checking\u2026', message:'Checking stored grades\u2026'};
    const {count, unchecked = 0} = preview;
    const matching = total - count - unchecked;
    if (!count && !unchecked) return {state:'matching', disabled:true, label:'Already matches', message:`${total === 1 ? 'This photo already has' : `These ${total} photos already have`} these settings. Choose other settings or other photos.`};
    const message = unchecked
      ? `${count} checked ${count === 1 ? 'photo will' : 'photos will'} change; ${unchecked} ${unchecked === 1 ? 'photo will be checked' : 'photos will be checked'} after you confirm.${matching ? ` ${matching} already ${matching === 1 ? 'matches' : 'match'}.` : ''}`
      : `${count} of ${total} ${total === 1 ? 'photo will' : 'photos will'} change${matching ? `; ${matching} already ${matching === 1 ? 'matches' : 'match'}` : ''}.`;
    return {state:'ready', disabled:false, label:pasteLabel, message};
  }
  function create({api, prepare, changed, status, progress}) {
    let copied = null, running = false;
    const notify = () => changed?.(copied);
    async function refresh() { copied = await api('/api/library/grade-copy'); notify(); return copied; }
    async function copy(path) {
      if (!path || running) return;
      try {
        copied = await api('/api/library/grade-copy', {path}); notify();
        status(`Grade copied from ${copied.name}`);
      } catch (error) { status(`Could not copy grade: ${error.message}`); }
    }
    async function paste(paths, choose = false) {
      if (!paths.length || running) return;
      running = true;
      let confirmed = false, result = null;
      try {
        await refresh(); if (!copied?.name) return;
        const selection = await dialog(copied, paths, choose, () => {
          confirmed = true;
          progress?.(paths, "preparing");
        });
        if (!selection || !await prepare(paths)) return;
        result = await prepareAndPaste(paths, selection);
        if (!result) return;
        progress?.(paths, "updating", result);
        changed?.(copied, result);
      } finally {
        if (confirmed) progress?.(paths, "settled", result);
        running = false;
      }
    }
    async function prepareAndPaste(paths, selection) {
      const {make} = root.HDRLibraryDialogs;
      const box = make('dialog', 'application-dialog library-ask grade-paste-preparing');
      box.setAttribute('aria-label', 'Preparing photos for paste');
      const header = make('div', 'application-dialog-header');
      header.append(make('h2', '', 'Preparing photos for paste'));
      const body = make('div', 'library-ask-body'), message = make('p', '', 'Starting preparation\u2026');
      message.setAttribute('role', 'status');
      body.append(message, make('p', 'grade-paste-help', 'Photos are prepared one at a time. You can cancel before the grade is applied.'));
      const actions = make('div', 'app-dialog-actions'), cancel = make('button', 'button-secondary', 'Cancel');
      cancel.type = 'button'; actions.append(cancel); box.append(header, body, actions);
      let token, cancelled = false, applying = false;
      const stop = () => {
        if (applying) return;
        cancelled = true; cancel.disabled = true;
        message.textContent = 'Stopping preparation… No grades have changed.';
        if (token) void api('/api/library/grade-preparation-cancel', {token}).catch(() => {});
      };
      cancel.addEventListener('click', stop);
      box.addEventListener('cancel', event => { event.preventDefault(); stop(); });
      root.addEventListener('pagehide', stop);
      document.body.append(box); box.showModal(); cancel.focus();
      try {
        // A body makes the Library api() helper send POST, as the route requires.
        ({token} = await api('/api/library/grade-preparation', {}));
        for (const [index, path] of paths.entries()) {
          if (cancelled) return null;
          message.textContent = `Preparing ${index + 1} of ${paths.length} photos\u2026`;
          status(message.textContent);
          await api('/api/library/grade-prepare', {path, token});
        }
        if (cancelled) return null;
        applying = true; cancel.disabled = true;
        message.textContent = 'Applying grade…';
        return await api('/api/library/grade-paste', {paths, selection, token});
      } catch (error) {
        if (!cancelled) throw error;
        return null;
      } finally {
        root.removeEventListener('pagehide', stop);
        box.close(); box.remove();
        if (token) {
          // The transaction result owns success/Undo. Optional token cleanup
          // cannot replace it with an HTTP error or keep the dialog waiting.
          let timer;
          try {
            await Promise.race([
              Promise.resolve().then(() => api('/api/library/grade-preparation-end', {token})).catch(() => {}),
              new Promise(resolve => { timer = setTimeout(resolve, 1000); }),
            ]);
          } finally { clearTimeout(timer); }
        }
        if (cancelled) status('Paste cancelled. No grades changed.');
      }
    }
    function dialog(clipboard, paths, expanded, confirmed) {
      const {make} = root.HDRLibraryDialogs;
      return new Promise(resolve => {
        const model = selectionModel(clipboard.groups, clipboard.selection);
        const dialog = make('dialog', 'application-dialog library-ask library-smart-editor grade-paste-dialog');
        dialog.setAttribute('aria-label', `Paste Grade From ${clipboard.name}`);
        const header = make('div', 'application-dialog-header'), words = make('div');
        const title = make('h2', '', 'Paste grade'), summary = make('p');
        words.append(title, make('p', 'grade-paste-help', `Source: ${clipboard.name} · ${paths.length} target ${paths.length === 1 ? 'photo' : 'photos'}`)); header.append(words);
        const body = make('div', 'library-ask-body'), list = make('div', 'group-preset-list');
        const choose = make('button', 'button-secondary grade-paste-choose', 'Choose what to paste'); choose.type = 'button'; choose.setAttribute('aria-expanded', String(expanded));
        const choices = make('div', 'grade-paste-choices'); choices.id = 'grade-paste-choices'; choices.hidden = !expanded;
        choose.setAttribute('aria-controls', choices.id);
        choose.addEventListener('click', () => { choices.hidden = !choices.hidden; choose.setAttribute('aria-expanded', String(!choices.hidden)); update(); });
        const checks = [], masters = [], sections = [], pairs = [];
        function checkbox(label, checked, callback) {
          const row = make('label', 'checkbox-row'), input = make('input'); input.type = 'checkbox'; input.checked = checked;
          input.addEventListener('change', () => { callback(input.checked); update(); }); row.append(input, make('span', '', label));
          return {row, input};
        }
        const mode = make('div', 'control-mode-switch grade-paste-mode');
        mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', 'Side selection');
        const modeButtons = [];
        for (const [linked, text] of [[true, 'Same on both sides'], [false, 'Separately']]) {
          const button = make('button', '', text); button.type = 'button';
          button.addEventListener('click', () => { model.link(linked); update(); }); mode.append(button); modeButtons.push({button, linked});
        }
        const hint = make('p', 'grade-paste-help');
        function quickTools(lane) {
          const bar = make('div', 'library-options');
          for (const [value, text] of [['all','All'], ['modified','Modified only'], ['none','None']]) {
            const button = make('button', 'button-secondary', text); button.type = 'button';
            button.addEventListener('click', () => { model.choose(value, lane); update(); }); bar.append(button);
          }
          return bar;
        }
        function groupCell(group, partner) {
          if (!group) return make('div', 'grade-paste-cell');
          const details = make('details', 'grade-paste-cell'), label = make('summary');
          details.dataset.group = group.id;
          const tick = checkbox(group.label, false, checked => {
            for (const setting of model.linked() && partner ? [...group.settings, ...partner.settings] : group.settings) model.toggle(setting.id, checked);
          });
          tick.input.setAttribute('aria-label', `${group.lane || ''} ${group.label}`.trim());
          tick.row.addEventListener('click', event => event.stopPropagation());
          const marker = make('small', 'grade-paste-mod', 'Mod');
          tick.row.append(marker);
          label.append(tick.row); details.append(label);
          const rows = make('div', 'grade-paste-subsettings');
          const extra = group.lane === 'hdr' && partner ? partner.settings.filter(setting => !group.settings.some(other => other.id === model.peer(setting.id))) : [];
          for (const setting of [...group.settings, ...extra]) {
            const child = checkbox(setting.label, model.has(setting.id), checked => model.toggle(setting.id, checked));
            child.input.dataset.setting = setting.id;
            const modified = make('small', 'grade-paste-mod', 'Mod'); child.row.append(modified);
            rows.append(child.row); checks.push({setting, group, partner, linkedOnly:extra.includes(setting), marker:modified, ...child});
          }
          details.append(rows); checks.push({group, partner, marker, ...tick}); return details;
        }
        function section(title, groups, lane) {
          const container = make('section', 'grade-paste-section');
          const heading = make('h3', 'group-preset-subheading');
          const tick = checkbox(title, false, checked => {
            for (const group of groups) for (const setting of group.settings) model.toggle(setting.id, checked);
          });
          tick.input.setAttribute('aria-label', `${lane ? lane.toUpperCase() + ' ' : ''}${title}`);
          heading.append(tick.row); container.append(heading);
          sections.push({groups, lane, ...tick});
          return container;
        }
        const shared = make('section', 'grade-paste-shared');
        shared.append(make('h3', 'group-preset-subheading', 'Shared settings'), quickTools('shared'));
        const sharedGroups = clipboard.groups.filter(group => !group.lane);
        for (const title of [...new Set(sharedGroups.map(group => group.section))]) {
          const groups = sharedGroups.filter(group => group.section === title), container = section(title, groups);
          for (const group of groups) container.append(groupCell(group));
          shared.append(container);
        }
        const laneHeaders = make('div', 'grade-paste-lane-headers');
        const linkedHeader = make('div', 'grade-paste-linked-header');
        const linkedMaster = checkbox('HDR and SDR settings', true, checked => model.toggleLane('hdr', checked));
        linkedHeader.append(linkedMaster.row); masters.push({lane:'hdr', ...linkedMaster});
        const linkedTools = quickTools('hdr'); linkedTools.className += ' grade-paste-linked-tools';
        const laneTools = [];
        for (const lane of ['hdr', 'sdr']) {
          const column = make('div', 'grade-paste-lane-header');
          const tick = checkbox(`${lane.toUpperCase()} side`, model.lane(lane), value => model.toggleLane(lane, value));
          const bar = quickTools(lane); column.append(tick.row, bar); laneHeaders.append(column);
          masters.push({lane, ...tick}); laneTools.push(bar);
          column.append(section('Rendition settings', clipboard.groups.filter(group => group.lane === lane), lane));
        }
        const linkedSection = section('Rendition settings', clipboard.groups.filter(group => group.lane), 'hdr');
        linkedHeader.append(linkedSection);
        const keys = [...new Set(clipboard.groups.filter(g => g.lane).map(g => g.id.replace(/^(hdr|sdr)-/, '')))];
        for (const key of keys) {
          const pair = make('div', 'grade-paste-pair');
          const groups = ['hdr','sdr'].map(lane => clipboard.groups.find(group => group.id === lane + '-' + key));
          const cells = groups.map((group, index) => groupCell(group, groups[1-index]));
          pairs.push({pair, cells});
          pair.append(...cells); list.append(pair);
        }
        choices.append(shared, linkedTools, linkedHeader, laneHeaders, list);
        const notes = make('p', 'grade-paste-status'), warnings = make('p', 'grade-paste-warnings');
        notes.setAttribute('role', 'status');
        warnings.hidden = true;
        const overview = make('div', 'grade-paste-overview'); overview.append(summary, choose);
        body.append(overview, mode, hint, choices);
        const footer = make('div', 'library-ask-body grade-paste-footer');
        footer.append(notes, warnings, make('p', 'grade-paste-help', 'Each photo keeps its previous grade. Ctrl+Z undoes the whole paste.'));
        const actions = make('div', 'app-dialog-actions'), cancel = make('button','button-secondary','Cancel'), yes = make('button','button-primary', paths.length > 1 ? `Paste onto ${paths.length} photos` : 'Paste grade');
        cancel.type = yes.type = 'button'; actions.append(cancel, yes); dialog.append(header, body, footer, actions); document.body.append(dialog);
        let answer = null, previewId = 0, timer;
        function update() {
          for (const {button, linked} of modeButtons) button.setAttribute('aria-pressed', String(model.linked() === linked));
          hint.textContent = model.linked() ? 'Checkbox choices are linked. Each side uses its own source values.' : 'Choose settings for each side independently.';
          mode.hidden = hint.hidden = choices.hidden;
          linkedTools.hidden = !model.linked();
          linkedHeader.hidden = !model.linked(); laneHeaders.hidden = model.linked();
          linkedSection.hidden = !model.linked();
          for (const {pair, cells} of pairs) {
            pair.dataset.linked = String(model.linked());
            cells[1].hidden = model.linked();
          }
          for (const row of sections) {
            const settings = row.groups.flatMap(group => group.settings), count = settings.filter(setting => model.has(setting.id)).length;
            row.input.checked = count === settings.length;
            row.input.indeterminate = count > 0 && count < settings.length;
            row.input.disabled = !!row.lane && !model.lane(row.lane);
          }
          for (const bar of laneTools) bar.hidden = model.linked();
          for (const master of masters) {
            const settings = clipboard.groups.filter(g => g.lane === master.lane).flatMap(g => g.settings);
            const count = settings.filter(s => model.has(s.id)).length;
            master.input.checked = model.lane(master.lane);
            master.input.indeterminate = model.lane(master.lane) && count > 0 && count < settings.length;
          }
          for (const row of checks) {
            if (row.linkedOnly) row.row.hidden = !model.linked();
            row.marker.hidden = !(row.setting ? row.setting.modified || model.linked() && row.partner?.settings.some(setting => setting.id === model.peer(row.setting.id) && setting.modified) : row.group.modified || model.linked() && row.partner?.modified);
            if (row.setting) { row.input.checked = model.has(row.setting.id); row.input.disabled = !!row.group.lane && !model.lane(row.group.lane); }
            else { const settings = model.linked() && row.partner ? [...row.group.settings, ...row.partner.settings] : row.group.settings; const count = settings.filter(setting => model.has(setting.id)).length; row.input.checked = count === settings.length; row.input.indeterminate = count > 0 && count < settings.length; row.input.disabled = !!row.group.lane && !model.lane(row.group.lane); }
          }
          const active = model.active(), modules = new Set(active.map(group => group.id.replace(/^(hdr|sdr)-/, '')));
          const sides = ['hdr','sdr'].filter(lane => active.some(g => g.lane === lane)).map(lane => lane.toUpperCase());
          summary.textContent = `${modules.size} ${modules.size === 1 ? 'module' : 'modules'} selected${sides.length ? ' (' + sides.join(' and ') + ')' : ''}.`;
          clearTimeout(timer); const id = ++previewId;
          function show(preview, error) {
            const result = previewState(paths.length, active.length, preview, error);
            dialog.dataset.previewState = result.state;
            notes.textContent = result.message; yes.textContent = result.label; yes.disabled = result.disabled;
            notes.setAttribute('aria-busy', String(result.state === 'checking'));
          }
          warnings.textContent = ''; warnings.hidden = true;
          show();
          if (active.length) timer = setTimeout(async () => {
            try {
              const preview = await api('/api/library/grade-paste', {paths, selection: model.value(), preview:true});
              if (id !== previewId || !dialog.isConnected) return;
              warnings.textContent = (preview.warnings || []).map(warning => typeof warning === 'string' ? warning : `${warning.path.split(/[\\/]/).at(-1)}: ${warning.message}`).join(' ');
              warnings.hidden = !warnings.textContent;
              show(preview);
            } catch(error) {
              if (id !== previewId || !dialog.isConnected) return;
              warnings.textContent = error.message; warnings.hidden = false; show(null, error);
            }
          }, 120);
        }

        cancel.addEventListener('click', () => dialog.close());
        yes.addEventListener('click', () => { if (yes.disabled) return; answer = model.value(); confirmed?.(); dialog.close(); });
        dialog.addEventListener('close', () => { clearTimeout(timer); previewId++; dialog.remove(); resolve(answer); }, {once:true});
        update(); dialog.showModal(); cancel.focus();
      });
    }
    return Object.freeze({refresh, copy, paste, available: () => !!copied?.name, dialog});
  }
  const exported = Object.freeze({selectionModel, previewState, create});
  if (typeof module !== 'undefined') module.exports = exported; else root.HDRGradePaste = exported;
})(typeof window === 'undefined' ? globalThis : window);
