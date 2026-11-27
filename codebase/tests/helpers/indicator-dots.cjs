const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkIndicatorDots(page) {
  // Isolated DOM/CSS fixture in the running app's Chromium, on either machine.
  const frameElement = await page.evaluateHandle(() => { const el=document.createElement('iframe'); document.body.append(el); return el; });
  const frame = await frameElement.asElement().contentFrame();
  try {
    const frontend = path.join(__dirname, '../../frontend');
    const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    await frame.setContent(html);
    for (const file of ['styles.css','hsl.css','control-panel.css','visual-tokens.css','visual-controls.css'])
      await frame.addStyleTag({content:fs.readFileSync(path.join(frontend,file),'utf8')});
    for (const file of ['film-character-data.js','film-character.js','adjustment-controls.js'])
      await frame.addScriptTag({url:new URL(`/static/${file}`,page.url()).href});
    await frame.evaluate(() => {
      const film = HDRFilmCharacter.expand({film_stock:'kodak_portra_400'});
      for (const key of HDRFilmCharacter.tracked) HDRFilmCharacter.set(film,key,film[key]);
      window.state = {currentView:'hdr', session:{}, adjustments:{hdr:{film_look:film}}};
      renderFilmStockDots();
      document.querySelectorAll('.control-row, .control-group').forEach(el=>el.classList.add('modified'));
      document.querySelectorAll('[hidden]').forEach(el=>{ if(!el.matches('.film-stock-reset')) el.removeAttribute('hidden'); });
    });
    for (const theme of ['modern-dark','default-light','studio-gray']) {
      const failures = await frame.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        const pseudoDot = (el, pseudo) => {
          const s = getComputedStyle(el,pseudo);
          return !['none','normal'].includes(s.content) && s.display !== 'none'
            && parseFloat(s.width)>0 && parseFloat(s.width)<=6
            && parseFloat(s.height)>0 && parseFloat(s.height)<=6;
        };
        const failures=[];
        for (const row of document.querySelectorAll('.control-heading, .film-control-label, .control-group-header, .film-stage-heading')) {
          let count=0;
          for(const el of [row,...row.querySelectorAll('*')]) {
            if(el.hidden || getComputedStyle(el).display==='none') continue;
            count += Number(pseudoDot(el,'::before')) + Number(pseudoDot(el,'::after'));
            if(el.matches('.film-stock-reset, .film-stage-mod') && /[●•]/.test(el.textContent)) count++;
          }
          if(count>1) failures.push({row:row.textContent.trim().slice(0,80),count});
        }
        const lens = document.querySelector('#film-lens-strength').closest('.control-row');
        if (!lens.querySelector('.film-stock-reset:not([hidden])')) failures.push('missing deliberate reset marker');
        return failures;
      }, theme);
      assert.deepEqual(failures,[],theme);
    }
  } finally { await frameElement.evaluate(el=>el.remove()); await frameElement.dispose(); }
  console.log('Indicator rows: single marker in all panels / three themes PASS');
};
