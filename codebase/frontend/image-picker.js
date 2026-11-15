/* Source-mode adapter; the same view/controller serves Library folder pinning. */
(() => {
  let session = null, confirm = null, onClose = null, busy = false;
  const $ = id => document.getElementById(id), dialog = $('folder-picker');
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException('Cancelled','AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort',stop); resolve(); }, ms);
    if(signal?.aborted) stop(); else signal?.addEventListener('abort',stop,{once:true});
  });
  async function open(entry = session?.selectedImage()) {
    if (!entry || busy) return;
    busy = true; $('picker-pin').disabled = true;
    try { await confirm(entry.path); }
    catch(error) { $('picker-status').textContent = error.message || 'Could not open that image.'; }
    finally { busy = false; $('picker-pin').disabled = !session?.selectedImage(); }
  }
  $('picker-pin').addEventListener('click', () => void open());
  $('picker-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { session?.stop(); session=null; onClose?.(); });
  for(const view of ['list','grid']) $(`picker-view-${view}`).addEventListener('click', () => session?.setView(view));
  $('picker-go').addEventListener('click', () => session?.browse($('picker-path').value));
  $('picker-path').addEventListener('keydown', event => { if(event.key==='Enter') void session?.browse(event.target.value); });
  $('picker-up').addEventListener('click', () => session?.browse(session.parent,session.current));
  window.HDRImagePicker = Object.freeze({
    async show({path='', onSelect, onCancel}) {
      session?.stop(); confirm = onSelect; onClose = onCancel;
      const api = async (url, body, signal) => {
        const response = await fetch(url, {signal, ...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
        const result = await response.json(); if(!response.ok) throw Error(typeof result.detail==='string' ? result.detail : result.detail?.message || 'Could not read this folder.');
        return result;
      };
      session=HDRLibraryFolderPicker.create({api,sleep,mode:'source',onOpen:entry=>void open(entry)});
      if(!dialog.open) dialog.showModal();
      await session.browse(path);
    },
    close() { if(dialog.open) dialog.close(); },
  });
})();
