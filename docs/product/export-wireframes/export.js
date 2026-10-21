/* Export page mock-up behaviour. Pretend data only; nothing is exported. */
(() => {
  const $ = id => document.getElementById(id);
  const app = $('app');

  const FORMATS = {
    avif_gain_map: { label: 'AVIF + gain map', ext: 'avif', hdr: true },
    jpeg_ultrahdr: { label: 'JPEG Ultra HDR', ext: 'jpg', hdr: true },
    jpegxl_hdr: { label: 'JPEG XL HDR', ext: 'jxl', hdr: true },
    sdr_jpegxl: { label: 'JPEG XL (SDR)', ext: 'jxl', hdr: false },
    sdr_png: { label: 'PNG (SDR)', ext: 'png', hdr: false },
    sdr_jpeg: { label: 'JPEG (SDR)', ext: 'jpg', hdr: false },
  };
  const TOKENS = [
    ['{name}', 'File name'], ['{copy}', 'Copy name'], ['{seq}', 'Number 001'],
    ['{date}', 'Capture date'], ['{rating}', 'Rating'], ['{version}', 'Version'], ['{preset}', 'Preset'],
  ];

  const presets = [
    { name: 'Web delivery', versions: [
      { name: 'web-hdr', format: 'avif_gain_map', quality: 'web_optimized', q: 75, resize: 'long_edge', edge: 2560, pattern: '{name}_{version}', sub: 'HDR' },
      { name: 'web-sdr', format: 'sdr_jpeg', quality: 'web_default', q: 85, resize: 'long_edge', edge: 2048, pattern: '{name}_{version}', sub: 'SDR' },
    ] },
    { name: 'Client proofs', versions: [
      { name: 'proof', format: 'jpeg_ultrahdr', quality: 'web_default', q: 85, resize: 'fit', edge: 2048, pattern: '{seq}_{name}', sub: '' },
    ] },
    { name: 'Archive master', versions: [
      { name: 'master', format: 'jpegxl_hdr', quality: 'maximum_fidelity', q: 100, resize: 'original', edge: 0, pattern: '{date}_{name}{copy}', sub: '' },
    ] },
    { name: 'Instagram', versions: [
      { name: 'ig', format: 'jpeg_ultrahdr', quality: 'web_optimized', q: 80, resize: 'long_edge', edge: 1080, pattern: '{name}_ig', sub: '' },
    ] },
  ];
  let saved = JSON.parse(JSON.stringify(presets));

  const names = ['DSCF6495.RAF', 'DSCF6501.RAF', 'DSCF6510.RAF', 'DSCF6512.RAF', 'DSCF6512.RAF · Warm', 'DSCF6520.RAF',
    'DSCF6533.RAF', 'DSCF6540.RAF', 'DSCF6544.RAF', 'DSCF6551.RAF', 'DSCF6560.JPG', 'DSCF6571.RAF'];
  const photos = names.map((name, i) => ({
    name, img: `../library-wireframes/photos/${String(i * 3).padStart(3, '0')}.jpg`, graded: i % 4 !== 3,
    rating: [5, 4, 4, 3, 5, 2, 4, 3, 5, 4, 3, 4][i], date: `2026-10-${String(3 + (i >> 2)).padStart(2, '0')}`,
    unsaved: i === 2, sdrOnly: i === 10,
  }));

  const state = { preset: 0, version: 0, batch: 'many', view: 'grid', selected: new Set([0]), run: 'idle' };
  const batchPhotos = () => state.batch === 'one' ? [photos[0]] : photos;
  const problems = () => $('opt-problems').checked;
  const preset = () => presets[state.preset];
  const version = () => preset().versions[state.version];

  function fileName(photo, v, index) {
    const base = photo.name.split(' · ')[0].replace(/\.[^.]+$/, '');
    const copy = photo.name.includes(' · ') ? '_' + photo.name.split(' · ')[1] : '';
    const parts = { '{name}': base, '{copy}': copy, '{seq}': String(index + 1).padStart(3, '0'), '{date}': photo.date,
      '{rating}': String(photo.rating), '{version}': v.name, '{preset}': preset().name.replace(/\s+/g, '-') };
    let out = v.pattern;
    for (const [token, value] of Object.entries(parts)) out = out.split(token).join(value);
    return out.replace(/[\\/:*?"<>|]/g, '_') + '.' + FORMATS[v.format].ext;
  }
  const skipped = (photo, v) => problems() && photo.sdrOnly && FORMATS[v.format].hdr;

  function modified() { return JSON.stringify(presets[state.preset]) !== JSON.stringify(saved[state.preset]); }

  function renderPresets() {
    const list = $('preset-list'); list.replaceChildren();
    presets.forEach((p, i) => {
      const li = document.createElement('li'); li.className = 'ex-preset'; li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === state.preset));
      const dirty = JSON.stringify(p) !== JSON.stringify(saved[i]);
      li.innerHTML = `<span class="ex-preset-title">${p.name}${dirty ? '<i title="Modified"></i>' : ''}</span>
        <span class="ex-preset-versions">${p.versions.map(v => FORMATS[v.format].label).join(' + ')}</span>`;
      li.addEventListener('click', () => { state.preset = i; state.version = 0; render(); });
      li.addEventListener('contextmenu', e => { e.preventDefault(); state.preset = i; render(); const m = $('preset-menu'); m.hidden = false; m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; });
      list.append(li);
    });
  }

  function renderControl() {
    const p = preset(), v = version();
    $('preset-name').value = p.name;
    const dirty = modified();
    $('preset-mod').hidden = !dirty; $('preset-save').disabled = !dirty; $('preset-revert').disabled = !dirty;
    const tabs = $('version-tabs'); tabs.replaceChildren();
    p.versions.forEach((ver, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ex-version-tab'; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === state.version)); b.textContent = `${i + 1} · ${FORMATS[ver.format].label}`;
      b.addEventListener('click', () => { state.version = i; render(); }); tabs.append(b);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'ex-version-tab add'; add.textContent = '+ Add version';
    add.addEventListener('click', () => { p.versions.push({ ...v, name: 'version-' + (p.versions.length + 1), sub: '' }); state.version = p.versions.length - 1; render(); });
    tabs.append(add);
    $('version-name').value = v.name;
    $('version-remove').hidden = p.versions.length < 2;
    $('format').value = v.format; $('quality-preset').value = v.quality; $('quality').value = v.q; $('quality-value').value = v.q; const qs = $('quality-shell'); qs.style.setProperty('--pos', `${v.q - 1 ? (v.q - 1) / 99 * 100 : 0}%`); qs.style.setProperty('--fill-start', '0%'); qs.style.setProperty('--fill-w', `${(v.q - 1) / 99 * 100}%`);
    $('resize').value = v.resize; $('long-edge-row').hidden = v.resize !== 'long_edge'; $('long-edge').value = v.edge || 2560;
    $('pattern').value = v.pattern; $('subfolder').value = v.sub;
    const first = batchPhotos()[0];
    $('example').innerHTML = `Example: <code>${v.sub ? v.sub + '\\' : ''}${fileName(first, v, 0)}</code>`;
  }

  function renderGrid() {
    const grid = $('grid'); grid.replaceChildren();
    const list = batchPhotos(), p = preset();
    list.forEach((photo, i) => {
      const cell = document.createElement('div'); cell.className = 'ex-cell'; cell.setAttribute('role', 'option');
      cell.setAttribute('aria-selected', String(state.selected.has(i)));
      const files = p.versions.filter(v => !skipped(photo, v)).length;
      let flags = '';
      if (problems() && photo.unsaved) flags += '<span class="ex-flag" title="This photo is open in Grade with unsaved changes. Its last saved grade will be exported.">Unsaved changes in Grade · last saved grade used</span>';
      if (problems() && photo.sdrOnly && p.versions.some(v => FORMATS[v.format].hdr)) flags += '<span class="ex-flag" title="This photo has no HDR grade, so HDR versions are skipped.">SDR only · HDR version skipped</span>';
      let badge = '';
      if (state.run === 'running') badge = i < 4 ? '<span class="ex-cell-state done">Done</span>' : i === 4 ? '<span class="ex-cell-state">Exporting…</span>' : '';
      if (state.run === 'done') badge = skipped(photo, p.versions[0]) || (problems() && photo.sdrOnly) ? '<span class="ex-cell-state skip">1 skipped</span>' : '<span class="ex-cell-state done">Done</span>';
      cell.innerHTML = `<div class="ex-cell-frame"><img src="${photo.img}" alt=""></div>${badge}
        <div class="ex-cell-info"><span class="ex-cell-name">${photo.graded ? '<span class="ex-graded" title="Saved grade"></span>' : ''}${photo.name}</span>
        <span class="ex-cell-files">${files} ${files === 1 ? 'file' : 'files'}</span>${flags}</div>`;
      cell.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) { state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i); }
        else state.selected = new Set([i]);
        render();
      });
      cell.addEventListener('dblclick', () => { state.selected = new Set([i]); state.view = 'preview'; render(); });
      grid.append(cell);
    });
  }

  function renderPreview() {
    const list = batchPhotos(), i = [...state.selected][0] ?? 0, photo = list[Math.min(i, list.length - 1)];
    $('preview-name').textContent = photo.name;
    $('preview-img').src = photo.img;
    const sel = $('preview-version'); sel.replaceChildren();
    preset().versions.forEach((v, n) => { const o = document.createElement('option'); o.value = n; o.textContent = `${n + 1} · ${v.name} · ${FORMATS[v.format].label}`; sel.append(o); });
    sel.value = state.version;
  }

  function counts() {
    const list = batchPhotos(), p = preset();
    let files = 0, skips = 0;
    for (const photo of list) for (const v of p.versions) skipped(photo, v) ? skips++ : files++;
    return { photos: list.length, versions: p.versions.length, files, skips };
  }

  function renderSummary() {
    const c = counts(), p = preset();
    $('batch-count').textContent = `${c.photos} ${c.photos === 1 ? 'photo' : 'photos'} · ${c.versions} ${c.versions === 1 ? 'version' : 'versions'} · ${c.files} files`;
    const subs = p.versions.filter(v => v.sub).map(v => v.sub + '\\');
    $('summary').innerHTML = `${c.files} ${c.files === 1 ? 'file' : 'files'} into <b>${$('folder').value}</b>${subs.length ? ` (${subs.join(', ')})` : ''}.` +
      (c.skips ? ` ${c.skips} skipped, shown in the grid.` : '') + ' Each photo uses its last saved grade.';
    $('export-go').textContent = `Export ${c.files} ${c.files === 1 ? 'file' : 'files'}`;
    $('export-go').disabled = state.run === 'running';
    const notice = $('batch-notice');
    const flagged = problems() ? batchPhotos().filter(ph => ph.unsaved || ph.sdrOnly).length : 0;
    notice.hidden = !flagged;
    notice.textContent = flagged ? `${flagged} ${flagged === 1 ? 'photo needs' : 'photos need'} a look before exporting. Details are on each photo below.` : '';
  }

  function renderRun() {
    app.dataset.run = state.run;
    $('run').hidden = state.run !== 'running';
    $('results').hidden = state.run !== 'done';
    $('activity').textContent = state.run === 'running' ? 'Activity · Exporting 7 of ' + counts().files : 'Activity';
    $('run-title').textContent = `Exporting 7 of ${counts().files} files`;
    if (state.run === 'done') {
      const list = $('results-list'); list.replaceChildren();
      const c = counts();
      $('results-title').textContent = `${c.files - 1} files exported · 1 renamed · ${c.skips} skipped`;
      batchPhotos().forEach((photo, i) => preset().versions.forEach((v, n) => {
        const row = document.createElement('div'); row.className = 'ex-result'; row.setAttribute('role', 'row');
        let status = '<span class="ok">Exported</span>', file = (v.sub ? v.sub + '\\' : '') + fileName(photo, v, i);
        if (skipped(photo, v)) { status = '<span class="warn">Skipped · this photo has no HDR grade</span>'; file = '—'; }
        else if (i === 0 && n === 0) { status = '<span class="warn">Renamed · a file with this name was already there</span>'; file = file.replace(/(\.[a-z]+)$/, ' (2)$1'); }
        row.innerHTML = `<span>${file}</span><span>${photo.name} · ${v.name}</span>${status}`;
        list.append(row);
      }));
    }
  }

  function render() {
    app.dataset.batch = state.batch;
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    $('grid').hidden = state.view !== 'grid'; $('preview').hidden = state.view !== 'preview';
    $('remove-selected').disabled = state.selected.size === 0;
    renderPresets(); renderControl(); renderGrid(); renderPreview(); renderSummary(); renderRun();
    $('status-text').textContent = state.batch === 'one'
      ? 'Opened from Grade with the photo you are working on. Photos and grades are not changed by exporting.'
      : 'Sent from the Library with 12 selected photos. Photos and grades are not changed by exporting.';
  }

  // Control panel edits change the selected preset.
  const edit = (id, key, transform = x => x) => $(id).addEventListener('input', e => { version()[key] = transform(e.target.value); if (key === 'q') $('quality-value').value = e.target.value; render(); });
  edit('version-name', 'name'); edit('format', 'format'); edit('quality-preset', 'quality'); edit('quality', 'q', Number);
  edit('resize', 'resize'); edit('long-edge', 'edge', Number); edit('pattern', 'pattern'); edit('subfolder', 'sub');
  $('preset-name').addEventListener('input', e => { preset().name = e.target.value; renderPresets(); renderControl(); });
  $('folder').addEventListener('input', renderSummary);
  $('version-remove').addEventListener('click', () => { preset().versions.splice(state.version, 1); state.version = 0; render(); });
  $('preset-save').addEventListener('click', () => { saved[state.preset] = JSON.parse(JSON.stringify(preset())); render(); });
  $('preset-revert').addEventListener('click', () => { presets[state.preset] = JSON.parse(JSON.stringify(saved[state.preset])); state.version = 0; render(); });
  $('preset-save-new').addEventListener('click', () => { const copy = JSON.parse(JSON.stringify(preset())); copy.name += ' copy'; presets.push(copy); saved.push(JSON.parse(JSON.stringify(copy))); presets[state.preset] = JSON.parse(JSON.stringify(saved[state.preset])); state.preset = presets.length - 1; state.version = 0; render(); });
  $('preset-new').addEventListener('click', () => { const p = { name: 'New preset', versions: [{ name: 'main', format: 'jpeg_ultrahdr', quality: 'web_default', q: 85, resize: 'original', edge: 0, pattern: '{name}', sub: '' }] }; presets.push(p); saved.push(JSON.parse(JSON.stringify(p))); state.preset = presets.length - 1; state.version = 0; render(); });

  const tokens = $('tokens');
  for (const [token, label] of TOKENS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ex-token'; b.textContent = label; b.title = `Insert ${token}`;
    b.addEventListener('click', () => { const input = $('pattern'), at = input.selectionStart ?? input.value.length; input.value = input.value.slice(0, at) + token + input.value.slice(input.selectionEnd ?? at); version().pattern = input.value; render(); input.focus(); input.selectionStart = input.selectionEnd = at + token.length; });
    tokens.append(b);
  }

  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
  $('preview-version').addEventListener('change', e => { state.version = Number(e.target.value); render(); });
  $('remove-selected').addEventListener('click', () => { state.selected.clear(); render(); });
  $('clear-batch').addEventListener('click', () => { state.selected.clear(); render(); });
  $('export-go').addEventListener('click', () => setRun('running'));
  $('run-cancel').addEventListener('click', () => setRun('done'));
  $('run-pause').addEventListener('click', e => { e.target.textContent = e.target.textContent === 'Pause' ? 'Resume' : 'Pause'; $('run-eta').textContent = e.target.textContent === 'Resume' ? 'Paused' : 'about 2 min left · Grade stays usable'; });
  $('results-close').addEventListener('click', () => setRun('idle'));
  document.addEventListener('pointerdown', e => { if (!$('preset-menu').contains(e.target)) $('preset-menu').hidden = true; });

  // Mock strip
  function setRun(run) { state.run = run; document.querySelectorAll('[data-run]').forEach(b => b.classList.toggle('on', b.dataset.run === run)); render(); }
  document.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => setRun(b.dataset.run)));
  document.querySelectorAll('[data-batch]').forEach(b => b.addEventListener('click', () => {
    state.batch = b.dataset.batch; state.view = state.batch === 'one' ? 'preview' : 'grid'; state.selected = new Set([0]);
    document.querySelectorAll('[data-batch]').forEach(x => x.classList.toggle('on', x === b)); render();
  }));
  $('opt-problems').addEventListener('change', render);
  $('notes-button').addEventListener('click', () => { $('notes').hidden = !$('notes').hidden; });

  // Quick export dialog
  function renderQuick() {
    const sel = $('quick-preset'), p = presets[Number(sel.value) || 0];
    const list = $('quick-versions'); list.replaceChildren();
    for (const v of p.versions) { const li = document.createElement('li'); li.innerHTML = `${FORMATS[v.format].label}${v.sub ? ` into ${v.sub}\\` : ''} · <code>${fileName(photos[0], v, 0)}</code>`; list.append(li); }
    let files = 0, skips = 0; for (const ph of photos) for (const v of p.versions) (problems() && ph.sdrOnly && FORMATS[v.format].hdr) ? skips++ : files++;
    $('quick-go').textContent = `Export ${files} files`;
    $('quick-notes').textContent = [problems() ? 'DSCF6510.RAF has unsaved changes in Grade; its last saved grade is used.' : '', skips ? `${skips} skipped: DSCF6560.JPG has no HDR grade.` : '', 'Existing files are never replaced.'].filter(Boolean).join(' ');
  }
  $('mock-quick').addEventListener('click', () => {
    const sel = $('quick-preset'); sel.replaceChildren();
    presets.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${p.name} (${p.versions.length} ${p.versions.length === 1 ? 'version' : 'versions'})`; sel.append(o); });
    renderQuick(); $('quick').showModal();
  });
  $('quick-preset').addEventListener('change', renderQuick);
  $('quick-cancel').addEventListener('click', () => $('quick').close());
  $('quick-go').addEventListener('click', () => { $('quick').close(); state.batch = 'many'; setRun('running'); });
  $('quick-open-page').addEventListener('click', () => { $('quick').close(); state.batch = 'many'; state.view = 'grid'; render(); });

  render();
})();
