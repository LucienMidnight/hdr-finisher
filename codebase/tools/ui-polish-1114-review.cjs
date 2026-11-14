const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const phase = process.argv.includes('--after') ? 'after' : 'before';
const output = path.resolve('output/ui-polish-1114', phase);
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1408, height: 794 } });
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
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [1408, 794]);
    const shot = async name => {
      await page.evaluate(() => document.fonts.ready);
      await library.locator('body').evaluate(element => element.ownerDocument.fonts.ready);
      await page.screenshot({ path: path.join(output, `${name}.png`) });
    };
    const checkTabs = async () => {
      const tabs = await page.locator('.workflow-tabs').evaluate(element => {
        const header = document.querySelector('.top-bar').getBoundingClientRect();
        return [...element.children].map(tab => {
          const style = getComputedStyle(tab);
          return { gap: Math.abs(tab.getBoundingClientRect().bottom - header.bottom), shadow: style.boxShadow, face: style.backgroundImage, edge: parseFloat(style.borderBottomWidth), active: tab.classList.contains('active'), accent: style.borderBottomColor === style.color };
        });
      });
      assert(tabs.every(tab => tab.gap <= 1 && tab.shadow === 'none' && tab.face === 'none' && tab.edge === 2), JSON.stringify(tabs));
      assert.equal(tabs.filter(tab => tab.active && tab.accent).length, 1, JSON.stringify(tabs));
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
      if (phase === 'after' && value === 'default-dark') {
        const ratios = await page.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          const token = name => style.getPropertyValue(name).trim();
          const luminance = hex => {
            const channels = hex.match(/[0-9a-f]{2}/gi).map(channel => parseInt(channel, 16) / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const surfaces = ['--app', '--panel', '--raised', '--input', '--tooltip'];
          const pairs = [...surfaces.flatMap(surface => ['--text', '--body', '--muted'].map(role => [role, surface])), ['--body', '--plate-up'], ['--text', '--plate-up'], ['--text', '--plate-up-hover'], ['--text', '--plate-down'], ['--body', '--plate-down']];
          return pairs.flatMap(([role, surface]) => token(surface).match(/#[0-9a-f]{6}/gi).map(background => {
            const foregroundLight = luminance(token(role)), backgroundLight = luminance(background);
            return { role, surface, ratio: (Math.max(foregroundLight, backgroundLight) + 0.05) / (Math.min(foregroundLight, backgroundLight) + 0.05) };
          }));
        });
        assert(ratios.every(pair => pair.ratio >= 7), JSON.stringify(ratios.filter(pair => pair.ratio < 7)));
        checks.push(`Default Dark minimum neutral contrast ${Math.min(...ratios.map(pair => pair.ratio)).toFixed(2)}:1 (required 7:1)`);
      }
    };
    for (const value of ['default-dark', 'default-light']) {
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
    await page.evaluate(async () => {
      const response = await fetch('/api/proof/test-pattern');
      await importByteFile(new File([await response.blob()], 'ui-polish.tiff', { type: 'image/tiff' }));
    });
    await page.waitForFunction(() => state.session && !state.importInProgress && document.body.dataset.workflow === 'grade');
    for (const value of ['default-dark', 'default-light']) {
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
