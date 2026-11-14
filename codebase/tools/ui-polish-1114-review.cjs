const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const phase = process.argv.includes('--after') ? 'after' : 'before';
const round2 = process.argv.includes('--round2');
const output = path.resolve('output/ui-polish-1114', round2 ? 'round2' : phase);
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1408, height: 794 } });
    if (round2) await page.addInitScript(() => localStorage.setItem('hdr-finisher:application-preferences:v1', JSON.stringify({theme:'default-dark'})));
    const baseline = process.argv.find(argument => argument.startsWith('--baseline-ref='))?.split('=')[1];
    if (phase === 'before' && baseline) {
      const assets = new Map(['batch-export.js', 'library-smart-albums.js', 'photo-library.js', 'photo-library.css', 'styles.css', 'visual-controls.css', 'visual-tokens.css'].map(name => [name, execFileSync('git', ['show', `${baseline}:codebase/frontend/${name}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })]));
      await page.route('**/static/*', route => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        return assets.has(name) ? route.fulfill({ body: assets.get(name), contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript' }) : route.continue();
      });
    }
    const errors = [];
    const checks = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.HDR_FINISHER_URL, { waitUntil: 'domcontentloaded' });
    const library = page.frameLocator('#library-frame');
    await library.locator('#single-view').waitFor();
    if (round2) {
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'modern-dark');
      assert.equal(await library.locator('html').getAttribute('data-theme'), 'modern-dark');
      await page.evaluate(() => HDRApplicationShell.openSettings('appearance'));
      assert.equal(await page.locator('[data-theme-option]').count(), 3);
      assert.equal(await page.locator('[data-theme-option="default-dark"]').count(), 0);
      await page.locator('#settings-close').click();
    }
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [1408, 794]);
    const shot = async name => {
      await page.evaluate(() => document.fonts.ready);
      await library.locator('body').evaluate(element => element.ownerDocument.fonts.ready);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
    };
    const checkTabs = async () => {
      const tabs = await page.locator('.workflow-tabs').evaluate(element => {
        const header = document.querySelector('.top-bar').getBoundingClientRect();
        const reference = document.createElement('span'); element.append(reference);
        const tokenColor = token => { reference.style.color = `var(${token})`; return getComputedStyle(reference).color; };
        const neutral = tokenColor('--text'), muted = tokenColor('--muted'), accent = tokenColor('--accent-strong'); reference.remove();
        return [...element.children].map(tab => {
          const style = getComputedStyle(tab);
          return { gap: Math.abs(tab.getBoundingClientRect().bottom - header.bottom), shadow: style.boxShadow, face: style.backgroundImage, edge: parseFloat(style.borderBottomWidth), active: tab.classList.contains('active'), neutral: style.color === neutral, muted: style.color === muted, accent: style.borderBottomColor === accent, color: style.color };
        });
      });
      assert(tabs.every(tab => tab.gap <= 1 && tab.shadow === 'none' && tab.face === 'none' && tab.edge === 2), JSON.stringify(tabs));
      assert.equal(tabs.filter(tab => tab.active && tab.neutral && tab.accent).length, 1, JSON.stringify(tabs));
      assert(tabs.filter(tab => !tab.active).every(tab => tab.muted && !tab.accent), JSON.stringify(tabs));
    };
    const theme = async value => {
      await page.evaluate(value => {
        HDRApplicationShell.openSettings('appearance');
        document.querySelector(`[data-theme-option="${value}"]`).click();
      }, value);
      await page.locator('#settings-close').click();
      await library.locator('html').evaluate((element, value) => new Promise(resolve => {
        const ready = () => element.dataset.theme === value ? resolve() : requestAnimationFrame(ready);
        ready();
      }), value);

    };
    for (const value of round2 ? [] : ['modern-dark', 'default-light']) {
      await theme(value);
      await shot(`${value}-library-empty`);
      if (phase === 'after') {
        assert.match(await library.locator('#smart-albums').innerText(), /No smart albums yet/);
        assert.match(await library.locator('#folders').innerText(), /No folders yet/);
      }
    }
    await page.evaluate(async folder => {
      const libraryWindow = document.querySelector('#library-frame').contentWindow;
      const response = await libraryWindow.fetch('/api/library/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: [folder] }) });
      if (!response.ok) throw new Error(await response.text());
      await libraryWindow.HDRLibrary.refreshPins();
      const key = 'hdr-finisher:library-show-all-files';
      libraryWindow.localStorage.setItem(key, 'true');
      libraryWindow.dispatchEvent(new libraryWindow.StorageEvent('storage', { key, newValue: 'true' }));
      await libraryWindow.HDRLibrary.browse(folder);
    }, fs.realpathSync(require('./lib/visual-test-photos.cjs')()));
    await library.locator('.library-cell').first().waitFor().catch(async error => {
      console.error(await library.locator('body').innerText());
      throw error;
    });
    await library.locator('.library-cell').first().click();
    await library.locator('.library-file-name').waitFor();
    await page.waitForFunction(() => !document.querySelector('#library-frame').contentDocument.querySelector('.library-cell.loading'), null, { timeout: 90000 });
    if (round2) await library.locator('.library-cell').filter({ hasText: 'IMG_0790_finished.jpg' }).dblclick();
    else await page.evaluate(async () => {
      const response = await fetch('/api/proof/test-pattern');
      await importByteFile(new File([await response.blob()], 'ui-polish.tiff', { type: 'image/tiff' }));
    });
    await page.waitForFunction(() => state.session && !state.importInProgress && document.body.dataset.workflow === 'grade');
    if (round2) {
      await page.waitForFunction(() => HDRGradeSaving.ready() && state.lastScope && els.scopeFreshness.textContent === 'Settled', null, { timeout: 90000 });
      const geometry = async () => page.evaluate(() => {
        const box = selector => { const bounds = document.querySelector(selector).getBoundingClientRect(); return {left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,width:bounds.width,height:bounds.height}; };
        const selectors = ['.workspace-main','.dock-panel-title','#scope-mode','#scope-channel-mode','#scope-detail','#scope-zoom','#dock-collapse','#histogram','#scope-view','#viewer-status-dock','.source-rail','#dropzone','#preview-stage'];
        return Object.fromEntries(selectors.map(selector => [selector,box(selector)]));
      });
      const checkDock = async collapsed => {
        const bounds = await geometry();
        const viewportHeight = await page.evaluate(() => innerHeight);
        const main = bounds['.workspace-main'], toggle = bounds['#dock-collapse'];
        const controls = ['.dock-panel-title','#scope-mode','#scope-channel-mode','#scope-detail','#scope-zoom','#dock-collapse'].map(selector => bounds[selector]);
        for (const control of controls) assert(control.left >= main.left - 1 && control.right <= main.right + 1 && control.bottom <= viewportHeight + 1, JSON.stringify(bounds));
        for (let index = 1; index < controls.length; index++) assert(controls[index].left >= controls[index - 1].right - 1, JSON.stringify(bounds));
        assert(await page.locator('#dock-collapse').isVisible());
        assert.equal(await page.locator('#dock-collapse').getAttribute('aria-expanded'), String(!collapsed));
        assert(await page.locator('#dock-collapse').evaluate(element => element.contains(document.elementFromPoint(element.getBoundingClientRect().left + element.clientWidth / 2, element.getBoundingClientRect().top + element.clientHeight / 2))));
        if (!collapsed) {
          const plot = bounds['#histogram'], scope = bounds['#scope-view'];
          assert(plot.top >= scope.top - 1 && plot.bottom <= scope.bottom + 1 && plot.height > 50, JSON.stringify(bounds));
          const footerTop = await page.evaluate(() => document.body.dataset.workflow === 'export' ? document.querySelector('#viewer-status-dock').getBoundingClientRect().top : innerHeight);
          assert(scope.bottom <= footerTop + 1, JSON.stringify(bounds));
        }
        assert(toggle.bottom <= main.bottom + 1, JSON.stringify(bounds));
        return bounds;
      };
      for (const value of ['modern-dark', 'default-light']) {
        await theme(value);
        await page.evaluate(() => activateWorkflowTab('import'));
        await checkTabs();
        await shot(`${value}-library`);
        await page.evaluate(() => { activateWorkflowTab('grade'); if (state.dockCollapsed) toggleAnalysisDock(); state.compactSourceOpen = true; state.wideSourceCollapsed = false; applyResponsiveWorkspaceState(); setZoomMode('fit'); });
        await page.waitForFunction(() => els.scopeFreshness.textContent === 'Settled');
        const fit = await checkDock(false);
        assert(fit['.workspace-main'].left >= fit['.source-rail'].right - 1, JSON.stringify(fit));
        const chevron = await page.locator('#source-rail-expand').evaluate(element => { const style = getComputedStyle(element,'::before'); return {transform:style.transform, transition:style.transitionProperty, mask:style.maskImage}; });
        assert.equal(chevron.transform, 'matrix(-1, 0, 0, -1, 0, 0)');
        assert.equal(chevron.transition, 'color');
        assert.match(chevron.mask, /chevron-right/);
        await shot(`${value}-grade-fit`);
        await page.evaluate(() => setCustomZoom(119));
        await page.waitForFunction(() => state.lastScope?.channels?.length && !els.scopeFreshness.classList.contains('updating'));
        await page.locator('#dropzone').evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
        const zoomed = await checkDock(false);
        for (const selector of ['.dock-panel-title','#scope-mode','#dock-collapse','#viewer-status-dock']) {
          for (const edge of ['left','right','top','bottom']) assert(Math.abs(fit[selector][edge] - zoomed[selector][edge]) <= 1, `${selector}: chrome moved with photo`);
        }
        assert(zoomed['#preview-stage'].width > zoomed['#dropzone'].width, '119% must really exceed Fit');
        await shot(`${value}-grade-119`);
        await page.locator('#source-rail-expand').click();
        await checkDock(false);
        await shot(`${value}-grade-collapsed`);
        await page.locator('#dock-collapse').click();
        await checkDock(true);
        await page.locator('#dock-collapse').click();
        await checkDock(false);
        for (const workflow of ['proof','export']) {
          await page.evaluate(workflow => activateWorkflowTab(workflow), workflow);
          if (workflow === 'export') {
            await page.waitForFunction(() => document.querySelector('#batch-count').textContent.startsWith('1 photo'));
            if (await page.locator('#batch-view-preview').isVisible()) await page.locator('#batch-view-preview').click();
          }
          await page.evaluate(() => setZoomMode('fit'));
          await page.waitForFunction(() => els.scopeFreshness.textContent === 'Settled');
          await checkDock(false);
          await shot(`${value}-${workflow}-scopes-open`);
          await page.locator('#dock-collapse').click();
          await checkDock(true);
          await shot(`${value}-${workflow}-scopes-collapsed`);
          await page.locator('#dock-collapse').click();
          await checkDock(false);
        }
        checks.push(`${value}: neutral tabs, fixed chrome at Fit/119%, source chevron, reachable scope toggle and contained chart labels`);
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setDeviceMetricsOverride',{width:2560,height:1440,deviceScaleFactor:1,mobile:false});
        await page.evaluate(() => setZoomMode('fit'));
        await checkDock(false);
        await shot(`${value}-export-2560`);
        await session.send('Emulation.clearDeviceMetricsOverride');
        await session.detach();
      }
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors,geometryToleranceCssPixels:1},null,2));
      console.log('PASS round 2: both themes, 1408x794 captures and 2560x1440 containment');
      return;
    }
    for (const value of ['modern-dark', 'default-light']) {
      await theme(value);
      await page.evaluate(() => activateWorkflowTab('import'));
      if (phase === 'after') {
        await checkTabs();
        const selection = await library.locator('.library-cell.lead.active').evaluate(element => {
          const tile = getComputedStyle(element), picture = getComputedStyle(element.querySelector('.picture-frame'));
          return { inner: picture.outlineStyle, shadow: tile.boxShadow, outer: parseFloat(tile.outlineWidth) };
        });
        assert.equal(selection.inner, 'none');
        assert.equal(selection.shadow, 'none');
        assert.equal(selection.outer, 2);
        const folder = await library.locator('#folders .library-folder-row.active').evaluate(element => {
          const row = element.getBoundingClientRect(), list = element.closest('#folders').getBoundingClientRect();
          const style = getComputedStyle(element);
          return { top: row.top - list.top, bottom: list.bottom - row.bottom, shadow: style.boxShadow, face: style.backgroundImage };
        });
        assert(Math.abs(folder.top) <= 1 && Math.abs(folder.bottom) <= 1, JSON.stringify(folder));
        assert.equal(folder.shadow, 'none');
        assert.equal(folder.face, 'none');
        const file = await library.locator('#details > .library-facts').first().evaluate(element => getComputedStyle(element).borderBottomWidth);
        assert.equal(file, '0px');
        await library.locator('#facts-toggle').click();
        const boundaries = await library.locator('#details .library-kicker').evaluateAll(elements => elements.filter(element => element.textContent !== 'File').map(element => {
          const section = element.parentElement.classList.contains('library-facts') && element === element.parentElement.firstElementChild ? element.parentElement : element;
          return { name: element.textContent, edge: getComputedStyle(section).borderTopWidth };
        }));
        assert(boundaries.every(boundary => boundary.edge === '1px'), JSON.stringify(boundaries));
        await library.locator('#facts-toggle').click();
      }
      await library.locator('#details').evaluate(element => { element.scrollTop = 0; });
      await shot(`${value}-library`);
      await page.evaluate(() => activateWorkflowTab('grade'));
      for (const collapsed of [false, true]) {
        await page.evaluate(collapsed => {
          state.wideSourceCollapsed = collapsed;
          state.compactSourceOpen = !collapsed;
          applyResponsiveWorkspaceState();
        }, collapsed);
        if (phase === 'after') {
          const geometry = await page.evaluate(() => {
            const rail = document.querySelector('.source-rail'), box = rail.getBoundingClientRect();
            const status = document.querySelector('.scope-reading-status').getBoundingClientRect();
            const readings = document.querySelector('.scope-readings').getBoundingClientRect();
            const scopes = document.querySelector('#scope-view').getBoundingClientRect();
            const headers = [...rail.querySelectorAll(':scope > .rail-title-row, :scope > .disclosure-panel')].filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect());
            return { border: getComputedStyle(rail).borderRightWidth, inset: headers.map(header => header.left - box.left), scopeTop: readings.top - scopes.top, join: status.left - readings.left };
          });
          assert.equal(geometry.border, '1px');
          assert(geometry.inset.every(inset => Math.abs(inset) <= 1), JSON.stringify(geometry));
          assert(Math.abs(geometry.scopeTop) <= 1 && Math.abs(geometry.join) <= 1, JSON.stringify(geometry));
        }
        await shot(`${value}-grade-${collapsed ? 'collapsed' : 'open'}`);
      }
      await page.evaluate(() => activateWorkflowTab('proof'));
      await shot(`${value}-proof`);
      await page.evaluate(() => activateWorkflowTab('export'));
      await page.locator('#batch-version-select').waitFor();
      await shot(`${value}-export`);
      if (phase === 'after') {
        const sections = page.locator('.batch-settings-scroll > details.batch-settings-section');
        assert.equal(await sections.count(), 6);
        const settings = () => [...document.querySelectorAll('#export-sheet input, #export-sheet select')].map(element => [element.id, element.value, element.checked]);
        const initial = await page.evaluate(settings);
        for (const section of await sections.all()) {
          const summary = section.locator(':scope > summary');
          const wasOpen = await section.evaluate(element => element.open);
          await summary.click();
          assert.equal(await section.evaluate(element => element.open), !wasOpen);
          if (wasOpen) assert.equal(await section.locator('input, select').first().isVisible(), false);
          await summary.click();
        }
        assert.deepEqual(await page.evaluate(settings), initial);
        const firstSummary = sections.first().locator(':scope > summary');
        await firstSummary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await sections.first().evaluate(element => element.open), false);
        await page.keyboard.press('Enter');
        assert.equal(await sections.first().evaluate(element => element.open), true);
        await sections.first().locator(':scope > summary').click();
        await shot(`${value}-export-folded`);
        await sections.first().locator(':scope > summary').click();
        checks.push(`${value}: empty states and six Export disclosures`);
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ phase, checks, errors }, null, 2));
    console.log(`PASS: ${phase} review captures at 1408x794, both themes`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
