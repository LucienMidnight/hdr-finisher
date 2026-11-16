const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {extract,render}=require('../tools/tooltip-catalogue.cjs');

test('tooltip catalogue matches source (preserve pending edits before regenerating)',()=>{
  const actual=fs.readFileSync(path.resolve(__dirname,'../../docs/product/tooltips.md'),'utf8').replace(/\r\n/g,'\n');
  assert.equal(actual,render(),'Apply pending edits to source, then run node tools/tooltip-catalogue.cjs > ../docs/product/tooltips.md');
});

test('inventory reads windows, templates, fallback names and helper text without executing source',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hdr-tooltip-catalogue-'));
  try {
    fs.mkdirSync(path.join(root,'codebase/frontend'),{recursive:true});
    fs.mkdirSync(path.join(root,'codebase/desktop'));
    const html='<div data-workflow-panel="grade"><section data-group="hdr-tone"><label for="blacks" data-tooltip="Black &amp; white">Blacks</label><button aria-label="Reset">↻</button><select><option>Full size</option></select><span id="help" class="title-tooltip">Extra help</span></section></div>';
    fs.writeFileSync(path.join(root,'codebase/frontend/index.html'),html);
    fs.writeFileSync(path.join(root,'codebase/desktop/dialog.html'),'<button id="close" title="Close dialog">Close</button>');
    fs.writeFileSync(path.join(root,'codebase/frontend/dynamic.js'),[
      'throw new Error("must not execute source");',
      'const gesture = special ? " Extra gesture." : "";',
      'label.dataset.tooltip = `${label.dataset.tooltip || ""} Hover.${gesture}`.trim();',
      'button.title = on ? `Show ${count ? `${count} photos` : "photo"}` : "Hidden";',
      'node.setAttribute("data-tooltip", "A; comma, and ) in text");',
      'els.sessionNameTooltip.textContent = filename;',
      'note.textContent = ready ? "Ready to export" : "Unavailable";',
      'control.title = note.textContent;',
      'const markup = `<button title="Embedded help">Embedded</button>`;',
      'const exportOptionTooltips = { precision: { full: "All detail" } };',
      'help(node, "Export version explanation");',
      '// fake.title = "Not a tooltip";',
    ].join('\n'));
    const entries=extract(root);
    for(const text of ['Black & white','Reset','Full size','Extra help','Close dialog','A; comma, and ) in text','Embedded help','All detail','Export version explanation','filename'])assert.ok(entries.some(e=>e.text===text),text);
    assert.ok(entries.some(e=>e.text.includes('Ready to export')&&e.name==='note.textContent'));
    assert.ok(entries.some(e=>e.text.includes('Hover.${gesture}')&&e.kind.includes('dynamic')));
    assert.ok(entries.some(e=>e.name.startsWith('gesture')&&e.text.includes('Extra gesture.')));
    assert.ok(entries.some(e=>e.text.includes('`${count} photos`')));
    assert.ok(entries.some(e=>e.anchor==='for=blacks'&&e.workflow==='Grade → Global'));
    assert.ok(!entries.some(e=>e.text.includes('Not a tooltip')));
    assert.equal(new Set(entries.map(e=>e.id)).size,entries.length);
    const before=render(entries);
    assert.equal(before,render(extract(root)));
    fs.writeFileSync(path.join(root,'codebase/frontend/index.html'),html.replace('Black &amp; white','Updated copy'));
    const after=extract(root);
    assert.notEqual(render(after),before);
    assert.equal(after.find(e=>e.anchor==='for=blacks').id,entries.find(e=>e.anchor==='for=blacks').id,'element target ID survives a copy edit');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
