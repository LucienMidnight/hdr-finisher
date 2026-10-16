/* Disposable Electron check for folder navigation and Library window handoff. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'library-navigation');
fs.mkdirSync(output, { recursive: true });
const folder = fs.mkdtempSync(path.join(output, 'photos-'));
for (let i = 0; i < 100; i++) fs.mkdirSync(path.join(folder, `folder-${String(i).padStart(3, '0')}`));
const child = path.join(folder, 'folder-080');
const fixture = path.join(root, 'tests', 'fixtures', 'sdr_gradient.png');
for (let i = 0; i < 120; i++) fs.copyFileSync(fixture, path.join(folder, `photo-${String(i).padStart(3, '0')}.png`));
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const env = { ...process.env, HDR_FINISHER_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
async function eventually(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Window condition timed out');
}
(async () => {
  console.log('[library] launching disposable navigation check');
  const app = await electron.launch({ executablePath: require(require.resolve('electron', { paths: [path.join(root, 'desktop')] })), args: [path.join(root, 'desktop')], cwd: path.join(root, 'desktop'), env, timeout: 90000 });
  console.log('[library] launched');
  try {
    // Select the loaded app page; firstWindow's initial-load waiter can miss
    // the load event when the native runner has already awaited main-process setup.
    await eventually(() => app.windows().some(page => /^https?:/.test(page.url()) && new URL(page.url()).pathname === '/'));
    const main = app.windows().find(page => /^https?:/.test(page.url()) && new URL(page.url()).pathname === '/');
    console.log('[library] main window ready');
    const errors = [];
    main.on('pageerror', error => errors.push(error.message));
    await main.waitForSelector('#library-frame');
    await main.waitForFunction(() => !!document.querySelector('#library-frame').contentWindow.HDRLibrary);
    const library = main.frame({ url: /\/library(?:\?|$)/ });
    await library.waitForFunction(() => !!window.HDRLibrary);
    main.on('console', message => { if (message.type() === 'error') console.log('[renderer]', message.text()); });
    await library.locator('#add-folder').click();
    await library.locator('#picker-view-list').click();
    await library.waitForFunction(() => !document.querySelector('#picker-pin').disabled);
    await library.locator('#picker-path').fill(folder);
    await library.locator('#picker-go').click();
    await library.waitForFunction(() => document.querySelector('#picker-status').textContent !== 'Reading folder…');
    console.log('Picker:', await library.locator('#picker-status').textContent(), await library.locator('#picker-list .directory').count());
    await library.waitForFunction(() => document.querySelectorAll('#picker-list .directory').length === 100);
    const target = library.locator('#picker-list .directory').filter({ hasText: 'folder-080' });
    await target.scrollIntoViewIfNeeded();
    const scroll = await library.locator('#picker-list').evaluate(element => element.scrollTop);
    assert.ok(scroll > 0);
    await target.dblclick();
    await library.waitForFunction(child => document.querySelector('#picker-path').value === child && !document.querySelector('#picker-pin').disabled, child);
    await library.locator('#picker-up').click();
    await library.waitForFunction(() => document.querySelectorAll('#picker-list .directory').length === 100);
    assert.equal(await library.locator('#picker-list').evaluate(element => element.scrollTop), scroll);
    assert.equal(await target.getAttribute('aria-selected'), 'true');
    await library.waitForFunction(() => document.querySelector('#picker-preview-name').textContent === 'folder-080'
      && document.querySelector('#picker-preview-note').textContent === 'No photos in this folder.');
    await library.locator('#picker-view-grid').click();
    assert.equal(await library.locator('#folder-picker').getAttribute('data-view'), 'grid');
    assert.equal(await target.getAttribute('aria-selected'), 'true');
    await library.locator('#picker-list .directory').filter({ hasText: 'folder-081' }).click({ modifiers: ['Control'] });
    assert.equal(await library.locator('#picker-list .directory[aria-selected="true"]').count(), 2);
    await library.locator('#picker-list .directory').filter({ hasText: 'folder-083' }).click({ modifiers: ['Shift'] });
    assert.equal(await library.locator('#picker-list .directory[aria-selected="true"]').count(), 3);
    await target.click();
    // Slow mocked thumbnails expose request ownership without decoding source pixels.
    const requested = [], abortedRequests = [];
    let hold = true;
    main.on('requestfailed', request => { if (request.url().includes('/api/media-browser/thumbnail')) abortedRequests.push(request.url()); });
    await main.route('**/api/media-browser/thumbnail?*', async route => {
      requested.push(route.request().url());
      if (hold) await new Promise(resolve => setTimeout(resolve, 1000));
      try { await route.fulfill({ contentType: 'image/png', body: fs.readFileSync(fixture) }); } catch {}
    });
    const firstPhoto = library.locator('#picker-list .file').filter({ hasText: 'photo-000.png' });
    await firstPhoto.scrollIntoViewIfNeeded();
    await eventually(async () => requested.length > 0);
    await library.locator('#picker-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await eventually(async () => abortedRequests.length > 0);
    assert.ok(requested.length < 35, `Offscreen pictures requested: ${requested.length}`);
    hold = false;
    const lastPhoto = library.locator('#picker-list .file').filter({ hasText: 'photo-119.png' });
    await lastPhoto.click();
    await library.waitForFunction(() => !document.querySelector('#picker-preview').hidden && document.querySelector('#picker-preview').naturalWidth > 0);
    await main.route('**/api/media-browser/folder-peek?*', route => route.fulfill({ json: {
      count: 1204, formats: ['ARW', 'JPG'], samples: Array.from({ length: 4 }, (_, i) => ({ name: `camera-${i}.arw`, path: `/peek/camera-${i}.arw` }))
    } }));
    await target.click();
    await library.waitForFunction(() => document.querySelectorAll('#picker-peek img[src]').length === 4);
    assert.equal(await library.locator('#picker-preview-note').textContent(), '1,204 photos · ARW, JPG');
    assert.ok(requested.filter(url => url.includes('%2Fpeek%2F')).every(url => new URL(url).searchParams.get('embedded_only') === 'true'));
    await main.screenshot({ path: path.join(output, 'add-folder-grid-peek.png') });
    await main.unroute('**/api/media-browser/folder-peek?*');
    await main.unroute('**/api/media-browser/thumbnail?*');
    await target.dblclick();
    await library.waitForFunction(child => document.querySelector('#picker-path').value === child && !document.querySelector('#picker-pin').disabled, child);
    await library.locator('#picker-up').click();
    await library.waitForFunction(() => document.querySelector('#picker-list .directory[aria-selected="true"]')?.textContent.includes('folder-080'));

    await target.click({ button: 'right' });
    await library.locator('#library-folder-menu button').click();
    await library.waitForFunction(child => [...document.querySelectorAll('#folders .library-folder-row')].some(row => row.dataset.path === child), child);
    await library.locator('#picker-cancel').click();
    await library.locator('#add-folder').click();
    await library.waitForFunction(() => document.querySelector('#folder-picker').dataset.view === 'grid' && !document.querySelector('#picker-pin').disabled);
    await library.locator('#picker-cancel').click();
    console.log('PASS: picker list/grid, selections, visible-only thumbnails/cancellation, folder peek, Up, remembered view and modal Pin.');
    const pinned = library.locator('#folders .folder-name').filter({ hasText: 'folder-080' });
    await pinned.click({ button: 'right' });
    assert.equal(await library.getByRole('menuitem', { name: 'Unpin folder', exact: true }).textContent(), 'Unpin folder');
    await main.keyboard.press('Escape');
    await pinned.click({ button: 'right' });
    await library.getByRole('menuitem', { name: 'Unpin folder', exact: true }).click();
    // Unpin now asks for confirmation before removing Library membership.
    await library.locator('dialog.library-ask[open] button.button-primary').click();
    await library.waitForFunction(() => !document.querySelector('#folders .library-folder-row'));
    console.log('PASS: confirmed Unpin leaves the folder tree empty.');
    assert.ok(fs.existsSync(child));
    await library.evaluate(async folder => {
      await fetch('/api/library/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [folder] }) });
      await HDRLibrary.browse(folder);
    }, folder);
    await library.waitForSelector('#grid-space canvas[data-picture-key]', { timeout: 60000 });
    await library.locator("#sort-button").click(); await library.locator('#sort-menu [data-sort="name"]').click();
    await library.locator('#sort-dir').click();
    await library.locator('#library-grid').evaluate(element => element.scrollTop = 800);
    const before = await library.evaluate(() => ({ ...HDRLibrary.getSnapshot(), scroll: document.querySelector('#library-grid').scrollTop }));
    await library.locator('#popout-library').click();
    console.log('Opening separate Library window…');
    await eventually(() => app.windows().length === 2);
    const popped = app.windows().find(page => new URL(page.url()).pathname === '/library');
    assert.ok(popped);
    popped.on('pageerror', error => errors.push(error.message));
    await popped.waitForSelector('#grid-space canvas[data-picture-key]', { timeout: 60000 });
    const after = await popped.evaluate(() => ({ ...HDRLibrary.getSnapshot(), scroll: document.querySelector('#library-grid').scrollTop }));
    for (const key of ['path', 'selected', 'sort', 'descending', 'scroll']) assert.equal(after[key], before[key], key);
    assert.deepEqual(after.selection, before.selection);
    assert.equal(await library.evaluate(() => HDRLibrary.getSnapshot().active), false);
    assert.equal(await main.locator('#library-frame').isVisible(), false);
    assert.equal(await popped.evaluate(() => hdrFinisherDesktop.getPreferences().then(() => false, () => true)), true);
    await popped.locator('#single-view').click();
    await popped.waitForSelector('#single-picture[data-picture-key]', { timeout: 60000 });
    await popped.locator('#popout-library').click().catch(() => {});
    await eventually(() => app.windows().length === 1);
    await library.waitForFunction(() => HDRLibrary.getSnapshot().view === 'single' && HDRLibrary.getSnapshot().active);
    await library.waitForSelector('#single-picture[data-picture-key]', { timeout: 60000 });
    await library.locator('#popout-library').click();
    await eventually(() => app.windows().length === 2);
    const second = app.windows().find(page => new URL(page.url()).pathname === '/library');
    await second.waitForSelector('#single-picture[data-picture-key]', { timeout: 60000 });
    await second.evaluate(() => hdrFinisherDesktop.performWindowAction('close')).catch(() => {});
    await eventually(() => app.windows().length === 1);
    await library.waitForFunction(() => HDRLibrary.getSnapshot().active);
    assert.ok(fs.existsSync(path.join(profile, 'window-state-library.json')));
    assert.deepEqual(fs.readFileSync(path.join(folder, 'photo-000.png')), fs.readFileSync(fixture));
    assert.equal(fs.readdirSync(folder).some(name => name.endsWith('.hdrf')), false);
    assert.deepEqual(errors, []);
    console.log('PASS: picker scroll restored; modal pin, nav unpin, Escape; separate window preserves state, pauses docked page, docks via button/native close, persists bounds; source files untouched.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
