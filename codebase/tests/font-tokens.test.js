// Every font in the app comes from the type tokens in visual-tokens.css, and
// no size token is below the agreed minimum (11px, Steve, November 7, 2026).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../frontend');
const MIN_PX=11;
const tokens=fs.readFileSync(path.join(dir,'visual-tokens.css'),'utf8');
const sources=fs.readdirSync(dir).filter(f=>/\.(css|html|js)$/.test(f)&&!/^(webgpu-shaders|gpu-)/.test(f));
const withoutFontFaces=text=>text.replace(/@font-face\s*\{[^}]*\}/g,'');

test('size tokens never go below the minimum',()=>{
 const sizes=[...tokens.matchAll(/--font-size-([\w-]+):\s*([^;]+);/g)];
 assert.ok(sizes.length>=8);
 assert.ok(tokens.includes(`--font-size-min: ${MIN_PX}px;`));
 for(const [,name,value] of sizes)for(const px of value.matchAll(/(\d+(?:\.\d+)?)px/g))assert.ok(Number(px[1])>=MIN_PX,`--font-size-${name} is ${value}`);
});

test('font sizes, weights and families are written with tokens',()=>{
 const bad=[];
 for(const file of sources){
  const text=withoutFontFaces(fs.readFileSync(path.join(dir,file),'utf8'));
  text.split(/\r?\n/).forEach((line,i)=>{
   if(file==='visual-tokens.css'&&/^\s*--/.test(line))return;
   for(const m of line.matchAll(/(?<![-\w])(font-size|font-weight|font-family|font)\s*:\s*([^;}"']+)/g)){
    const [,prop,value]=m;
    if(/^(inherit|initial|0)\s*$/.test(value.trim()))continue;
    if(prop==='font-size'&&/^var\(--font-size-[\w-]+\)\s*$/.test(value.trim()))continue;
    if(prop==='font-weight'&&/^var\(--(font-weight-|panel-title-|group-title-)[\w-]+\)\s*$/.test(value.trim()))continue;
    if(prop==='font-family'&&/^var\(--(font-(title|body|mono)|panel-title-font-family|group-title-font-family)\)\s*$/.test(value.trim()))continue;
    if(prop==='font'&&!/\d(px|em|rem|pt)|\b[1-9]00\b|sans-serif|monospace|system-ui|Afacad|Segoe/.test(value))continue;
    if(prop==='font-size'&&/var\(--((page|panel|group)-title|tab)-font-size\)/.test(value))continue;
    bad.push(`${file}:${i+1} ${m[0].trim()}`);
   }
   if(/\.font\s*=\s*["'`]/.test(line)||/['"]font-size['"]\s*:/.test(line))bad.push(`${file}:${i+1} ${line.trim().slice(0,120)}`);
  });
 }
 assert.deepEqual(bad,[]);
});

test('old font aliases are gone',()=>{
 for(const file of sources){
  const text=fs.readFileSync(path.join(dir,file),'utf8');
  assert.doesNotMatch(text,/var\(--(sans|mono|display|font-sans|font-display|font-technical)\b/,file);
 }
});
