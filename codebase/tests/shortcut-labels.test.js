const test=require('node:test'),assert=require('node:assert/strict');
const shortcuts=require('../frontend/shortcut-labels.js');
const {fit}=require('../frontend/floating-surfaces.js');
test('Mac explicit bindings use Apple modifier order and distinguish Control from Command',()=>{
 assert.equal(shortcuts.format('Mod+Ctrl+Shift+Alt+V',true),'⌃⌥⇧⌘V');
 assert.equal(shortcuts.format('Mod+Shift+V',true),'⇧⌘V');
 assert.equal(shortcuts.format('Ctrl+Up',true),'⌃Up');
 assert.equal(shortcuts.format('Meta+C',true),'⌘C');
 assert.equal(shortcuts.format('Mod+Shift+V',false),'Ctrl+Shift+V');
 assert.equal(shortcuts.format('Ctrl+Alt+C',false),'Ctrl+Alt+C');
});
test('fixed command help uses Command while fine adjustment remains physical Control',()=>{
 assert.equal(shortcuts.text('Ctrl+Shift+E quick export · Ctrl fine · Shift snap · Alt source',true),'⇧⌘E quick export · ⌃ fine · ⇧ snap · ⌥ source');
 assert.equal(shortcuts.text('Ctrl+C / Ctrl+V / Ctrl+Shift+V / Ctrl+Z',true),'⌘C / ⌘V / ⇧⌘V / ⌘Z');
 assert.equal(shortcuts.text('Ctrl+Up fine; Ctrl-click or Shift-click',true),'⌃Up fine; ⌘-click or ⇧-click');
 assert.equal(shortcuts.text('Ctrl+Shift+E quick export · Ctrl fine',false),'Ctrl+Shift+E quick export · Ctrl fine');
});
test('menus shift into default and minimum windows and bound oversized contents',()=>{
 for(const viewport of [{width:1408,height:794},{width:1100,height:720}]){
  for(const rect of [{left:1090,top:690,width:280,height:650},{left:-5,top:-20,width:1600,height:1100}]){
   const p=fit(rect,viewport);assert.ok(p.left>=8&&p.top>=8);
   assert.ok(p.left+Math.min(rect.width,p.maxWidth)<=viewport.width-8);
   assert.ok(p.top+Math.min(rect.height,p.maxHeight)<=viewport.height-8);
  }
 }
});
test('both renderer entry pages load the shared presentation helpers before consumers',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const page of ['index.html','photo-library.html']){
  const html=fs.readFileSync(path.join(__dirname,'../frontend',page),'utf8');
  for(const helper of ['shortcut-labels.js','floating-surfaces.js','floating-surfaces.css'])assert.ok(html.includes('/static/'+helper));
  const consumers=page==='index.html'?['application-shell.js','key-hints.js','app-dialog.js']:['library-dialogs.js','photo-library.js'];
  for(const consumer of consumers)assert.ok(html.indexOf('shortcut-labels.js')<html.indexOf(consumer));
 }
});
test('Library shared element factory preserves user photo names containing shortcut-like text',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const context={window:{HDRShortcuts:shortcuts,addEventListener(){}},document:{createElement:()=>({setAttribute(){}}),addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-dialogs.js'),'utf8'),context);
 assert.equal(context.window.HDRLibraryDialogs.make('div','library-menu-header','Ctrl+Z.png').textContent,'Ctrl+Z.png');
 assert.equal(shortcuts.text('Ctrl/Command+Left/Right',true),'⌘Left/Right');
});
