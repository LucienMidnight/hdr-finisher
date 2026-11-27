#!/usr/bin/env node
/* Read-only source inventory. No frontend execution, dependencies, or source writes.
 * CLI prints Markdown to stdout; redirect explicitly to regenerate the catalogue.
 * Deliberately retains unresolved expressions rather than guessing runtime values.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const catalogue = path.join(root, 'docs/product/tooltips.md');
const clean = s => s.replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&(quot|apos|amp|lt|gt|nbsp);/g, (_, n) => ({quot:'"',apos:"'",amp:'&',lt:'<',gt:'>',nbsp:' '})[n]);
const plain = s => clean(decode(s.replace(/<[^>]*>/g, '')));
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name < b.name ? -1 : 1).flatMap(d => d.isDirectory() && !['node_modules','assets','vendor'].includes(d.name) ? files(path.join(dir,d.name)) : d.isFile() && /\.(?:html|js|cjs)$/.test(d.name) ? [path.join(dir,d.name)] : []);
}
// Tokenizer balances nested templates, strings and comments without evaluating code.
function tokens(source) {
  const out=[]; let i=0;
  function quoted(q) {
    i++;
    while(i<source.length) {
      if(source[i]==='\\') {i+=2;continue;}
      if(source[i]===q) {i++;return;}
      if(q==='`' && source.slice(i,i+2)==='${') {i+=2; balanced();continue;}
      i++;
    }
  }
  function balanced() {
    let depth=1;
    while(i<source.length && depth) {
      if(/["'`]/.test(source[i])) quoted(source[i]);
      else if(source[i]==='{') {depth++;i++;}
      else if(source[i]==='}') {depth--;i++;}
      else i++;
    }
  }
  while(i<source.length) {
    if(/\s/.test(source[i])) {i++;continue;}
    if(source.slice(i,i+2)==='//') {while(i<source.length&&source[i]!=='\n')i++;continue;}
    if(source.slice(i,i+2)==='/*') {const end=source.indexOf('*/',i+2);i=end<0?source.length:end+2;continue;}
    const start=i;
    if(/["'`]/.test(source[i])) quoted(source[i]);
    else if(/[\w$]/.test(source[i])) {while(i<source.length&&/[\w$]/.test(source[i]))i++;}
    else i++;
    out.push({value:source.slice(start,i),start,end:i});
  }
  return out;
}
function expression(ts, start) {
  let i=start; const stack=[];
  for(;i<ts.length;i++) {
    const v=ts[i].value;
    if(!stack.length && [';',',',')','}',']'].includes(v)) break;
    if(['(','[','{'].includes(v))stack.push(v);
    if([')',']','}'].includes(v))stack.pop();
  }
  return ts.slice(start,i);
}
function literal(v) {
  if(!/^(["'`])[\s\S]*\1$/.test(v) || (v[0]==='`'&&v.includes('${'))) return null;
  return v.slice(1,-1).replace(/\\(u[\da-f]{4}|n|r|t|[\\"'`])/gi, (_,s)=>s[0]==='u'?String.fromCharCode(parseInt(s.slice(1),16)):({n:'\n',r:'\r',t:'\t'})[s]??s);
}
function workflow(file, context='') {
  const s=(file+' '+context).toLowerCase();
  if(/dialog|settings-panel|preferences|media-browser|folder-picker|directory-browser| general$| performance$| appearance$| shortcuts$| diagnostics$/.test(s))return 'Dialogs and settings';
  if(/library|album/.test(s))return 'Library';
  if(/retouch/.test(s))return 'Grade → Retouch';
  if(/local-|mask-/.test(s))return 'Grade → Local';
  if(/proof/.test(s))return 'Proof';
  if(/export/.test(s))return 'Export';
  if(/menu|desktop-chrome|application-shell/.test(s))return 'Menus and window controls';
  if(/grade|hdr-|sdr-|tone|highlight|film|denoise|geometry|perspective|color|hsl|curve|detail|vignette|raw-/.test(s))return 'Grade → Global';
  return 'Viewer, scopes and shared controls';
}
function extract(sourceRoot=root) {
  const entries=[];
  for(const file of ['frontend','desktop'].flatMap(d=>files(path.join(sourceRoot,'codebase',d)))) {
    const source=fs.readFileSync(file,'utf8'); const rel=path.relative(sourceRoot,file).split(path.sep).join('/');
    const add=(offset,name,text,kind,context='',anchor='')=> {
      if(!text.trim() || text==='""' || text==="''")return;
      const line=source.slice(0,offset).split('\n').length;
      entries.push({file:rel,line,name:clean(name),text:clean(text),kind,workflow:workflow(rel,context),section:context||path.basename(file).replace(/\.(?:html|js|cjs)$/, '').replace(/-/g,' '),anchor:anchor||`${rel}:${line}`,offset});
    };
    // HTML, including markup embedded in JS template strings. Track enclosing panel/group.
    const stack=[]; const tagRe=/<\/?([a-z][\w-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi; let m;
    while((m=tagRe.exec(source))) {
      const closing=m[0][1]==='/'; const tag=m[1].toLowerCase();
      if(closing) {const at=stack.map(n=>n.tag).lastIndexOf(tag);if(at>=0)stack.splice(at);continue;}
      const attrs={};for(const a of m[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[a[1]]=decode(a[2]??a[3]);
      const ancestors=stack.map(n=>n.attrs); const all=[...ancestors,attrs];
      let context=all.flatMap(a=>['data-workflow-panel','data-settings-panel','data-lane-panel','data-group','data-local-grade-section','data-film-section'].filter(k=>a[k]).map(k=>a[k])).join(' / ');
      if (!context) context=all.map(a=>a.id||'').filter(id=>/raw-settings|analysis-dock|settings-dialog|directory-browser/.test(id)).join(' / ');
      if (all.some(a=>a['aria-label']==='Retouch')) context='Retouch';
      const tail=source.slice(tagRe.lastIndex); const end=tail.indexOf(`</${tag}>`);
      const label=plain(tail.slice(0,end>=0?end:0)).slice(0,600);
      const anchor=attrs.id?`#${attrs.id}`:attrs['data-path']?`data-path=${attrs['data-path']}`:attrs.for?`for=${attrs.for}`:'';
      const name=(label && /[a-z0-9]/i.test(label) ? label : '') || attrs['aria-label'] || attrs.id || attrs['data-path'] || tag;
      let authored=false;
      for(const key of ['data-tooltip','data-tip','data-native-tooltip','title'])if(attrs[key]) {add(m.index,name,attrs[key],attrs[key].includes('${')?'dynamic template':clean(attrs[key])===name?'fixed; name only':'fixed',context,anchor);authored=true;}
      if(/\btitle-tooltip\b/.test(attrs.class||'') && label) {add(m.index,name,label,'fixed',context,anchor);authored=true;}
      if(!authored && attrs['aria-label'] && (tag==='button'||attrs.role==='separator'))add(m.index,label||attrs['aria-label'],attrs['aria-label'],'name only (fallback)',context,anchor);
      if(tag==='option' && ancestors.some(a=>a.__tag==='select') && label)add(m.index,label,label,'name only (selected option, when clipped)',context,anchor);
      attrs.__tag=tag;
      if(!['input','img','br','hr','meta','link','source','wbr'].includes(tag)&&!m[0].endsWith('/>'))stack.push({tag,attrs});
    }
    if(!/\.[cm]?js$/.test(file))continue;
    const ts=tokens(source);
    const definitions=new Map();
    for(let i=0;i<ts.length-2;i++)if(['const','let','var'].includes(ts[i].value)&&ts[i+2].value==='=')definitions.set(ts[i+1].value,expression(ts,i+3));
    // Notes copied into title fields are also editable tooltip sources.
    const textSources=new Set();
    for(let i=0;i<ts.length;i++)if(ts[i].value==='=' && /\.(?:title|dataset\.(?:tooltip|tip|nativeTooltip))$/.test(ts.slice(Math.max(0,i-8),i).map(t=>t.value).join(''))) {
      const expr=expression(ts,i+1).map(t=>t.value).join('');
      for(const match of expr.matchAll(/(?:[a-zA-Z_$][\w$]*\.)+textContent/g))textSources.add(match[0]);
    }
    const dependent=new Set();
    function dependencies(expr,depth=0) {
      if(depth>2)return;
      // Templates are one token: also inspect interpolation identifiers.
      for(const word of expr.flatMap(t=> t.value[0]==='`' ? [...t.value.matchAll(/\$\{([^}]+)\}/g)].flatMap(m=>m[1].match(/[a-zA-Z_$][\w$]*/g)||[]) : /^[a-zA-Z_$][\w$]*$/.test(t.value) ? [t.value] : [])) {
        const def=definitions.get(word);
        if(!def||dependent.has(word)||def.some(t=>['createElement','querySelector','fetch','getElementById'].includes(t.value))||!def.some(t=>/["'`]/.test(t.value[0])))continue;
        dependent.add(word);
        const raw=source.slice(def[0]?.start,def.at(-1)?.end);
        add(def[0].start,`${word} — text used by dynamic tooltips`,raw,'dynamic supporting definition');
        dependencies(def,depth+1);
      }
    }
    for (const key of ['exportOptionTooltips','exportFormatNotes','branchCopy','scopeStatTooltips']) {
      const def=definitions.get(key); if(!def)continue;
      const keys=[];
      for(let j=0;j<def.length;j++) {
        if(def[j].value==='}' )keys.pop();
        if(def[j+1]?.value===':' && def[j+2]?.value==='{')keys.push(literal(def[j].value)??def[j].value);
        if(def[j-1]?.value===':' && literal(def[j].value)!==null) {
          add(def[j].start,[key,...keys,literal(def[j-2].value)??def[j-2].value].join(' / '),literal(def[j].value),'fixed (dynamic lookup)');
        }
      }
      dependent.add(key);
    }
    for(let i=0;i<ts.length;i++) {
      let start=-1;let name='';let kind='dynamic expression';
      if(ts[i].value==='=' && i>1) {
        const lhs=ts.slice(Math.max(0,i-8),i).map(t=>t.value).join('');
        if(/\.(?:title|dataset\.(?:tooltip|tip|nativeTooltip))$/.test(lhs) || /(?:Tooltip|viewerBranchNote)\.textContent$/.test(lhs) || [...textSources].some(ref=>lhs.endsWith(ref)) || (path.basename(file)==='tone-preview-ui.js' && lhs.endsWith('caption.textContent'))) {
          start=i+1;
          let j=i-1;while(j>0&&/^[\w$.]+$/.test(ts[j-1].value))j--;
          name=ts.slice(j,i).map(t=>t.value).join('');
        }
      }
      if(ts[i].value==='setAttribute'&&ts[i+1]?.value==='('&&['title','data-tooltip','data-tip','data-native-tooltip','aria-label'].includes(literal(ts[i+2]?.value||''))&&ts[i+3]?.value===',') {start=i+4;name=`${ts[i-2]?.value || 'control'} ${literal(ts[i+2].value)}`;}
      if(start<0)continue;
      const expr=expression(ts,start);if(!expr.length)continue;
      const raw=source.slice(expr[0].start,expr.at(-1).end);const text=expr.length===1?literal(raw):null;
      if(text!==null)kind=name.endsWith('aria-label')?'name only (fallback candidate)':'fixed';
      else if(/^(?:label|labelText|filename|title|[\w$.]+\.(?:name|path|value|label|textContent))$/.test(raw))kind+='; name/status supplied at runtime';
      if(path.basename(file)==='tone-preview-ui.js' && name.endsWith('caption.textContent'))kind+='; related hover status (screen reader)';
      add(ts[start].start,name,text??raw,kind);
      dependencies(expr);
    }
    // Helpers whose text is passed as arguments, and scope tooltip builder returns.
    for(let i=0;i<ts.length;i++) {
      if(['help','createControlFoldout'].includes(ts[i].value)&&ts[i+1]?.value==='(') {
        let j=i+2;const args=[];
        while(j<ts.length&&ts[j].value!==')'){const arg=expression(ts,j);if(!arg.length)break;args.push(arg);j+=arg.length;if(ts[j]?.value===',')j++;else break;}
        if(args.length>=2) {
          const arg=args[ts[i].value==='help'?1:2];if(!arg?.length)continue;
          const text=source.slice(arg[0].start,arg.at(-1).end);
          add(arg[0].start,ts[i].value==='help'?'Export help':`Foldout ${args[1]?.map(t=>t.value).join('')}`,literal(text)??text,literal(text)!==null?'fixed':'dynamic expression');dependencies(arg);
        }
      }
    }
    if(path.basename(file)==='tone-preview-ui.js') {
      const begin=source.indexOf('async function paintClipping('),end=source.indexOf('function requestBaseline(',begin);
      for(let i=0;i<ts.length;i++)if(ts[i].value==='return' && ts[i].start>begin && ts[i].start<end) {
        const expr=expression(ts,i+1);if(!expr.length)continue;
        const raw=source.slice(expr[0].start,expr.at(-1).end);
        if(!expr.some(t=>/^['"`]/.test(t.value)))continue;
        add(expr[0].start,'Tone clipping preview status',literal(raw)??raw,'dynamic; related hover status (screen reader)');
      }
    }
    if(path.basename(file)==='scope-ui.js') {
      const begin=source.indexOf('function guideTooltip('),end=source.indexOf('\n  function ',begin+1);
      if(begin>=0)add(begin,'Scope guide tooltip builder',source.slice(begin,end<0?source.length:end),'dynamic template');
    }
  }
  // Stable identifiers prefer element/path; repeated sites get a deterministic ordinal.
  const seen=new Map();
  for(const e of entries) {const base=e.anchor.startsWith(e.file+':') ? e.anchor : `${e.file}::${e.anchor}`;const n=(seen.get(base)||0)+1;seen.set(base,n);e.id=base+(n>1?`::${n}`:'');}
  const lanes=new Map();
  for(const e of entries)if(/\b(hdr|sdr)\b/i.test(e.section)) {const group=lanes.get(e.text)||new Set();group.add(/\bhdr\b/i.test(e.section)?'HDR':'SDR');lanes.set(e.text,group);}
  for(const e of entries)if(lanes.get(e.text)?.size===2)e.kind+='; duplicated HDR/SDR';
  return entries;
}
const order=['Library','Grade → Global','Grade → Local','Grade → Retouch','Proof','Export','Dialogs and settings','Menus and window controls','Viewer, scopes and shared controls'];
function render(entries=extract()) {
  const lines=['# Tooltip editing catalogue','','## How to edit','','Steve: edit the **Text** cells in place. Keep IDs and source references intact. Edit one workflow or section at a time; save your edited copy before asking an agent to apply it. An agent compares your edited copy with a freshly generated catalogue, locates each ID in the source, applies only your wording changes, checks dynamic branches and shared uses, then regenerates this document. **Do not regenerate over unapplied edits.** The sync test will fail while edits are waiting to be applied; that is expected.','','Agent: run `node tools/tooltip-catalogue.cjs > ../docs/product/tooltips.md` from `codebase` after applying edits. Use `--check` to check without writing. The extractor only reads source; it never applies edits or changes the app. IDs prefer element IDs, label targets or data paths; unnamed/generated sites fall back to file and line, so use the saved baseline when code moves.','','Dynamic entries show the JavaScript expression/template, with supporting definitions listed nearby. Keep `${…}` placeholders and code intact; edit the words inside quotes. Name-only entries repeat a control, selected option or photo name; changing those may also rename the control itself. Fallback candidates can be overridden by a longer tooltip at runtime.','','## Coverage and limits','',`This inventory contains **${entries.length} source entries**, not ${entries.length} distinct hover messages. Shared helpers can produce many messages; multiple sources can feed one control. It scans HTML and JavaScript in frontend and the desktop shell (including embedded markup), title/data-tooltip/data-tip/data-native-tooltip attributes and assignments, authored title-tooltip spans, accessible-label fallbacks, and selected-option names. No app or photo is opened.`,'','Runtime names, paths, errors, backend capability messages, custom album/label meanings and selected values have no finite list of text: their expression is recorded. Arbitrary computed property names, new helper APIs, external content and native operating-system menus are not discoverable by this static scanner. Supporting expressions are conservative and may include strings that are not shown as tooltips. When adding a new tooltip mechanism, extend the extractor and its fixture test.','','Clipped lane, scope, preview and filename labels use their visible text; dynamic selected options use the selected option text. See `frontend/tooltips.js` for clipping and precedence rules. The catalogue lists authored sources even if hidden or currently overridden. Platform shortcut labels may be translated at runtime by shortcut-labels.js. The historical `docs/design/HDR_Finisher_Tooltip_Copy.md` registry is reference material; this catalogue reflects current source.','','## Notes for the editing pass','','- Long explanations occur in RAW development, Highlight Compression, Film Look and Export. Consider whether each hover needs every sentence.','- Technical phrases include “endpoint-protected”, demosaic, signal-domain and gamut; related Tone screen-reader hover status also says “neutral-ray” and “limiter”. Check whether a photographer can act on them.','- Tone adds a range-preview explanation and an extra Blacks/Whites gesture note at runtime, making an already long tooltip longer. Edit the base and suffix together.','- HDR and SDR share much wording, but their highlight limits and delivery differ. Compare the HDR and SDR sections before changing either; duplicated entries are flagged.','- Some copy says color and some colour; nit/nits and capitalization also vary.','- Name-only tooltips help with clipped names but offer no explanation. Decide where a short explanation would help.','- Repeated Library/main-window entries and shared helpers need consistent edits; do not accidentally change only one copy.',''];
  const cell=s=>s.replace(/\|/g,'&#124;').replace(/`/g,'&#96;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  entries=[...entries].sort((a,b)=>(/\.html$/.test(a.file)?0:1)-(/\.html$/.test(b.file)?0:1));
  for(const group of order) {
    lines.push(`## ${group}`,'');
    const sections=new Map();for(const e of entries.filter(e=>e.workflow===group)){if(!sections.has(e.section))sections.set(e.section,[]);sections.get(e.section).push(e);}
    for(const [section,items] of sections) {
      lines.push(`### ${section}`,'','| Control / visible name | Text | Flags | ID and source |','| --- | --- | --- | --- |');
      for(const e of items)lines.push(`| ${cell(e.name)} | ${cell(e.text)} | ${cell(e.kind)} | ${cell(e.id)} · [source](../../${e.file}#L${e.line}) |`);
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd()+'\n';
}
if(require.main===module) {
  const output=render();
  if(process.argv.includes('--check')) {
    if(!fs.existsSync(catalogue)||fs.readFileSync(catalogue,'utf8').replace(/\r\n/g,'\n')!==output){console.error('Tooltip catalogue differs from source. Preserve Steve’s edits, apply them to source, then regenerate with node tools/tooltip-catalogue.cjs > ../docs/product/tooltips.md');process.exitCode=1;}
  } else process.stdout.write(output);
}
module.exports={extract,render,tokens};
