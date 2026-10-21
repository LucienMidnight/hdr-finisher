/* Independent Library disk allowances in one cache folder. */
(() => {
  const byId = id => document.getElementById(id), desktop = window.hdrFinisherDesktop;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hdr-library-cache') : null;
  let settings, portable;
  const allowances = ['thumbnail', 'full_size', 'saved_grade'];
  const size = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  async function api(route, body) {
    const response = await fetch('/api/library/' + route, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const value = await response.json(); if (!response.ok) throw new Error(value.detail || 'The cache could not be updated.'); return value;
  }
  function render(value) {
    settings = value;
    byId('library-cache-enabled').checked = value.enabled;
    byId('library-cache-state').textContent = value.enabled ? 'Enabled' : 'Disabled';
    for (const name of allowances) {
      byId(`library-cache-${name}-limit`).value = value[name + '_limit_gb'];
      byId(`library-cache-${name}-usage`).textContent = `${size(value[name + '_used_bytes'])} used`;
    }
    byId('library-cache-usage').textContent = `${size(value.used_bytes)} used in total`;
    byId('library-cache-location').textContent = value.location;
    byId('library-cache-portable').hidden = !portable || portable === value.location;
  }
  async function refresh() {
    try { portable = (await desktop?.libraryCacheOptions?.())?.portable; render(await api('cache-settings')); }
    catch (error) { byId('library-cache-usage').textContent = error.message; }
  }
  const changed = () => { if (channel) channel.postMessage('changed'); else document.getElementById('library-frame')?.contentWindow.postMessage({type:'hdr-library-cache-changed'},location.origin); };
  async function update(change) { render(await api('cache-settings',change)); changed(); }
  async function relocate(location) {
    if (!location || location === settings.location) return;
    const old = {...settings}; await update({location});
    if (old.used_bytes && await HDRDialogs.confirm(`The new folder is ready. Delete ${size(old.used_bytes)} of Library cache from the old folder? Your photos and grades are safe.`,{title:'Delete old cache?',confirmLabel:'Delete old cache',destructive:true})) render(await api('cache-clear',{location:old.location}));
  }
  function run(task) { return async () => { try { await task(); } catch(error) { await HDRDialogs.alert(error.message,{title:'Library cache'}); await refresh(); } }; }
  byId('library-cache-enabled').addEventListener('change',run(() => update({enabled:byId('library-cache-enabled').checked})));
  for (const name of allowances) byId(`library-cache-${name}-limit`).addEventListener('change',run(() => update({[name + '_limit_gb']:Number(byId(`library-cache-${name}-limit`).value)})));
  byId('library-cache-change').disabled = !desktop?.chooseLibraryCacheDirectory;
  byId('library-cache-reveal').disabled = !desktop?.revealLibraryCacheDirectory;
  byId('library-cache-change').addEventListener('click',run(async () => relocate(await desktop.chooseLibraryCacheDirectory())));
  byId('library-cache-portable').addEventListener('click',run(() => relocate(portable)));
  byId('library-cache-reveal').addEventListener('click',run(() => desktop.revealLibraryCacheDirectory(settings.location)));
  byId('library-cache-clear').addEventListener('click',run(async () => {
    await refresh();
    if (await HDRDialogs.confirm(`Delete ${size(settings.used_bytes)} of Library cache? Thumbnails and previews will be made again. Your photos and grades are safe.`,{title:'Clear Library cache?',confirmLabel:'Clear cache',destructive:true})) { render(await api('cache-clear',{})); changed(); }
  }));
  window.HDRLibraryCacheSettings = Object.freeze({refresh});
})();
