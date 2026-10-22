// Prototype front end. Global = DxO-style channels (All, eight bands, Custom);
// Local grade = one multi-colour selection inside a demo ellipse mask.
import { newRecipe, validateRecipe, addSample, sampleNeighborhood, processCPU, applyPixel, describe, selection, rangeWeight, decode, encode, fromLab, wrap, delta, clamp } from './engine.mjs';
import { createGPU } from './gpu.mjs';

const $ = id => document.getElementById(id), canvas = $('photo'), ctx = canvas.getContext('2d');
const NS = 'http://www.w3.org/2000/svg', C = 160;
const MAX_CUSTOM = 4;

// ---- Bands: centres measured in Oklab hue from representative colours. ----
const BAND_DEFS = [['red','Red','#ff2a2a'],['orange','Orange','#ff8a1f'],['yellow','Yellow','#f2e330'],['green','Green','#2fbf4a'],
  ['aqua','Aqua','#22c6cf'],['blue','Blue','#2f6bff'],['purple','Purple','#8a4dff'],['magenta','Magenta','#ff3dc4']];
const hexRGB = hex => [1,3,5].map(k => decode(parseInt(hex.slice(k,k+2),16)/255));
const rgbHex = rgb => '#'+rgb.map(v => Math.round(clamp(encode(v))*255).toString(16).padStart(2,'0')).join('');
const BANDS = BAND_DEFS.map(([id,name,hex]) => ({ id, name, hex, center: describe(hexRGB(hex)).hue }));
BANDS.forEach((b,i) => {
  const prev = BANDS[(i+7)%8].center, next = BANDS[(i+1)%8].center;
  const gap = Math.min(Math.abs(delta(b.center,prev)), Math.abs(delta(next,b.center)));
  // Core covers a third of the gap; feathers cross-fade into the neighbour.
  b.width = Math.max(1, Math.round(gap*.35)); b.feather = Math.max(1, Math.round(gap*.5));
});
const bandRange = b => ({ center: b.center, width: b.width, feather: b.feather, subtract: false });
const FULL = { center: 0, width: 180, feather: 1, subtract: false };

function globalModule() {
  const all = { id:'all', name:'All', kind:'all', hex:'#cccccc', recipe: { ...newRecipe(), ranges:[{...FULL}] } };
  const bands = BANDS.map(b => ({ id:b.id, name:b.name, kind:'band', hex:b.hex, recipe: { ...newRecipe(), ranges:[bandRange(b)] } }));
  return { channels:[all, ...bands], current:'red', active:{} };
}
function localModule() {
  return { channels:[{ id:'selection', name:'Selection', kind:'custom', hex:'#888888', recipe:newRecipe() }], current:'selection', active:{} };
}

let state = { scope:'global', global:globalModule(), local:localModule(), center:[.5,.5] };
let original, stageInput, gpu, gpuFailure = '', mode = 'pick', history = [], future = [], gesture = null;
let revision = 0, drawing = false, dirty = false, customCount = 0;

const mod = () => state[state.scope];
const chan = () => mod().channels.find(c => c.id === mod().current);
const activeIndex = () => { const c = chan(), i = mod().active[c.id] ?? 0; return c.recipe.ranges.length ? Math.min(i, c.recipe.ranges.length-1) : -1; };
const setActive = i => { mod().active[chan().id] = i; };
const hasEffect = r => r.opacity > 0 && r.ranges.length && (r.hue || r.saturation || r.luminance || r.uniformity);
function isEdited(c) {
  if (hasEffect(c.recipe)) return true;
  if (c.kind !== 'band') return false;
  const b = BANDS.find(x => x.id === c.id), r = c.recipe.ranges;
  return r.length !== 1 || JSON.stringify(r[0]) !== JSON.stringify(bandRange(b));
}

// ---- Undo: one snapshot per gesture. ----
const snapshot = () => JSON.stringify({ state, customCount });
function restore(s) { const v = JSON.parse(s); state = v.state; customCount = v.customCount; sync(); render(); }
function record(before) { if (before !== snapshot()) { history.push(before); if (history.length > 100) history.shift(); future = []; } buttons(); }
function buttons() { $('undo').disabled = !history.length; $('redo').disabled = !future.length; }
function notice(s = '') { $('notice').textContent = s; }
function commit(fn) { const before = snapshot(); fn(); record(before); sync(); render(); }

// ---- Channel strip ----
function sync() {
  const m = mod(), c = chan(), r = c.recipe, global = state.scope === 'global';
  document.querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope)));
  $('palette-title').textContent = global ? 'HSL · Global' : 'HSL · Local grade';
  $('channel-label').textContent = global ? 'Channel' : 'Quick start';
  $('channels').hidden = $('customs').hidden = !global; $('quick').hidden = global;
  const chanButton = ch => {
    const b = document.createElement('button'), custom = ch.kind === 'custom';
    b.className = `${custom ? 'pill' : 'chan ' + ch.kind}${isEdited(ch) ? ' edited' : ''}`; b.style.setProperty('--swatch', ch.hex);
    if (custom) { b.append(document.createElement('i'), ch.name); } else b.title = ch.name;
    b.setAttribute('aria-label', `${ch.name} channel`); b.setAttribute('aria-pressed', String(ch.id === m.current));
    b.onclick = () => { m.current = ch.id; notice(); sync(); render(); };
    return b;
  };
  $('channels').replaceChildren(...m.channels.filter(c => c.kind !== 'custom').map(chanButton));
  $('customs').replaceChildren(...m.channels.filter(c => c.kind === 'custom').map(chanButton));
  if (global) {
    const add = document.createElement('button'); add.id = 'add-custom'; add.textContent = '+ Custom';
    add.title = 'New custom channel: pick any mix of colours'; add.setAttribute('aria-label', 'New custom channel');
    add.disabled = m.channels.filter(x => x.kind === 'custom').length >= MAX_CUSTOM;
    add.onclick = () => commit(() => { newCustom(); notice('Click or drag on the photo to choose its colours.'); });
    $('customs').append(add);
  }
  $('chan-name').textContent = c.name;
  $('chan-hint').textContent = c.kind === 'all' ? 'every colour; pick to start a custom channel' :
    c.kind === 'custom' && !r.ranges.length ? 'click colours in the photo' :
    `${r.ranges.filter(x=>!x.subtract).length} in · ${r.ranges.filter(x=>x.subtract).length} out`;
  $('delete-custom').hidden = !(global && c.kind === 'custom');
  // Sliders
  const ai = activeIndex(), range = r.ranges[ai], rangeLocked = c.kind === 'all' || ai < 0;
  const values = { hue:r.hue, saturation:r.saturation, luminance:r.luminance, uniformity:r.uniformity, opacity:r.opacity, width:range?.width ?? 16, feather:range?.feather ?? 12 };
  for (const [id, v] of Object.entries(values)) {
    $(id).value = v; $(id+'-out').textContent = format(id, v);
    $(id).disabled = (id === 'width' || id === 'feather') && rangeLocked;
    fill($(id));
  }
  $('uniformity').disabled = c.kind === 'all';
  ranges(); wheel(); buttons();
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}
const format = (id, v) => id === 'luminance' ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)} EV` : id === 'opacity' ? `${Math.round(v*100)}%`
  : id === 'saturation' ? `${v > 0 ? '+' : ''}${Math.round(v)}%` : id === 'uniformity' ? `${Math.round(v)}%`
  : id === 'hue' ? `${v > 0 ? '+' : ''}${Math.round(v)}°` : `${Math.round(v)}°`;
// Track fill from zero (bipolar sliders) or from the minimum.
function fill(input) {
  const lo = Number(input.min), hi = Number(input.max), v = Number(input.value), zero = lo < 0 ? 0 : lo;
  const p = x => ((x-lo)/(hi-lo)*100).toFixed(2)+'%', a = Math.min(v, zero), b = Math.max(v, zero);
  input.style.setProperty('--track', `linear-gradient(90deg,#3a4046 ${p(a)},var(--accent) ${p(a)},var(--accent) ${p(b)},#3a4046 ${p(b)})`);
}
function ranges() {
  const c = chan(), ai = activeIndex();
  if (c.kind === 'all') { $('ranges').replaceChildren(); return; }
  $('ranges').replaceChildren(...c.recipe.ranges.map((r, i) => {
    const chip = document.createElement('span'); chip.className = 'chip' + (r.subtract ? ' sub' : ''); chip.setAttribute('aria-current', String(i === ai));
    const choose = document.createElement('button'); choose.innerHTML = `<span class="dot" style="background:${hueHex(r.center)}"></span>`;
    choose.append(`${r.subtract ? '−' : '+'} ${Math.round(r.center)}°`); choose.style.display = 'inline-flex'; choose.style.gap = '4px'; choose.style.alignItems = 'center';
    choose.setAttribute('aria-label', `Edit ${r.subtract ? 'excluded' : 'included'} range at ${Math.round(r.center)} degrees`);
    choose.onclick = () => { setActive(i); sync(); };
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', `Remove range ${i+1}`);
    x.onclick = () => commit(() => { c.recipe.ranges.splice(i, 1); setActive(Math.max(0, Math.min(ai, c.recipe.ranges.length-1))); });
    chip.append(choose, x); return chip;
  }));
}
function newCustom(fromAll = false) {
  const m = state.global; customCount++;
  const ch = { id:`custom-${customCount}`, name:`Custom ${customCount}`, kind:'custom', hex:'#777777', recipe:newRecipe() };
  m.channels.push(ch); m.current = ch.id; return ch;
}
function quickStart() {
  $('quick').replaceChildren(...BANDS.map(b => {
    const btn = document.createElement('button'); btn.style.setProperty('--swatch', b.hex); btn.title = b.name;
    btn.setAttribute('aria-label', `Select ${b.name} band`);
    btn.onclick = () => commit(() => {
      const r = chan().recipe, range = { ...bandRange(b), subtract: mode === 'subtract' };
      if (mode === 'pick') r.ranges = [range]; else r.ranges.push(range);
      setActive(r.ranges.length-1); notice();
    });
    return btn;
  }));
}

// ---- Wheel: hue 0 at the right, counter-clockwise, like an Oklab a/b plot. ----
const pt = (h, r) => [C + r*Math.cos(h*Math.PI/180), C - r*Math.sin(h*Math.PI/180)];
const hueAt = (x, y) => wrap(Math.atan2(-(y-C), x-C)*180/Math.PI);
const sampleColor = (h, L = .72, Cc = .12) => fromLab([L, Cc*Math.cos(h*Math.PI/180), Cc*Math.sin(h*Math.PI/180)]);
const hueHex = h => rgbHex(sampleColor(h));
function arcPath(a, b, r) {
  // a -> b counter-clockwise in hue; polyline keeps it simple and exact enough.
  const span = b - a, steps = Math.max(2, Math.ceil(Math.abs(span)/2));
  let d = '';
  for (let k = 0; k <= steps; k++) { const p = pt(a + span*k/steps, r); d += (k ? ' L ' : 'M ') + p[0].toFixed(2) + ' ' + p[1].toFixed(2); }
  return d;
}
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.append(e); return e; };
// Combined effect of the visible module on a test colour (same sum used by the preview).
function effectOn(rgb) {
  const active = mod().channels.filter(c => hasEffect(c.recipe));
  const out = [...rgb];
  for (const c of active) { const o = applyPixel(rgb, c.recipe); for (let i = 0; i < 3; i++) out[i] += o[i] - rgb[i]; }
  return out;
}
function wheel() {
  const c = chan(), r = c.recipe, ring = $('ring'), result = $('result'), arcs = $('arcs'), handles = $('handles');
  ring.replaceChildren(); result.replaceChildren(); arcs.replaceChildren(); handles.replaceChildren();
  const showWeight = c.kind !== 'all' && r.ranges.length;
  for (let h = 0; h < 360; h += 3) {
    // Unselected hues are dimmed by mixing toward the panel colour (opacity would stripe the overlaps).
    const rgb = sampleColor(h + 1.5), w = showWeight ? selection(rgb, r.ranges).weight : 1, k = .25 + .75*w;
    const dim = rgb.map((v, j) => decode(clamp(encode(v))*k + [32,35,38][j]/255*(1-k)));
    el('path', { d: arcPath(h, h+3.6, 118), stroke: rgbHex(dim), 'stroke-width': 26, fill: 'none' }, ring);
    el('path', { d: arcPath(h, h+3.6, 88), stroke: rgbHex(effectOn(rgb)), 'stroke-width': 16, fill: 'none' }, result);
  }
  el('circle', { cx: C, cy: C, r: 131.5, fill: 'none', stroke: '#0007', 'stroke-width': 1 }, ring);
  el('circle', { cx: C, cy: C, r: 104.5, fill: 'none', stroke: '#0007', 'stroke-width': 1 }, ring);
  const ai = activeIndex();
  $('wheel-name').textContent = c.name;
  $('wheel-sub').textContent = c.kind === 'all' ? 'all colours' : ai >= 0 ? `${r.ranges[ai].subtract ? 'excluding' : 'centre'} ${Math.round(r.ranges[ai].center)}°` : 'no colours yet';
  $('wheel-sub2').textContent = hasEffect(r) ? `H ${format('hue', r.hue)} · S ${format('saturation', r.saturation)} · L ${format('luminance', r.luminance).replace(' EV', '')}` : 'outer: source · inner: result';
  if (c.kind === 'all') return;
  r.ranges.forEach((g, i) => {
    const R = g.subtract ? 96 : 142, colour = g.subtract ? 'var(--exclude)' : i === ai ? '#ffffff' : '#b9c0c7';
    const soft = el('path', { d: arcPath(g.center-g.width-g.feather, g.center+g.width+g.feather, R), stroke: colour, 'stroke-width': 6, fill: 'none', opacity: .3, 'stroke-linecap': 'round', class: 'arc' }, arcs);
    const core = el('path', { d: arcPath(g.center-g.width, g.center+g.width, R), stroke: colour, 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round', class: 'arc' }, arcs);
    if (g.subtract) core.setAttribute('stroke-dasharray', '4 3');
    for (const p of [soft, core]) { p.dataset.handle = 'move'; p.dataset.range = i; }
  });
  if (ai < 0) return;
  const g = r.ranges[ai], R = g.subtract ? 96 : 142;
  const handle = (kind, h, label, draw) => {
    const grp = el('g', { class: 'handle', tabindex: 0, role: 'slider', 'aria-label': label, 'aria-valuenow': Math.round(h), 'data-handle': kind, 'data-range': ai }, handles);
    draw(grp, pt(h, kind === 'target' ? 88 : R)); return grp;
  };
  const dot = (fillc, rad) => (grp, [x, y]) => {
    el('circle', { cx: x, cy: y, r: rad+5, fill: 'transparent' }, grp);
    el('circle', { cx: x, cy: y, r: rad, fill: fillc, stroke: '#111', 'stroke-width': 1.5, class: 'ring' }, grp);
  };
  const bar = h => (grp, [x, y]) => {
    const [x0, y0] = pt(h, R-9), [x1, y1] = pt(h, R+9);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: 'transparent', 'stroke-width': 14 }, grp);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#111', 'stroke-width': 5.5, 'stroke-linecap': 'round' }, grp);
    el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round', class: 'ring' }, grp);
  };
  handle('feather-', g.center-g.width-g.feather, 'Softness, start side', dot('#20232680', 4.5));
  handle('feather+', g.center+g.width+g.feather, 'Softness, end side', dot('#20232680', 4.5));
  handle('edge-', g.center-g.width, 'Range start', bar(g.center-g.width));
  handle('edge+', g.center+g.width, 'Range end', bar(g.center+g.width));
  handle('move', g.center, 'Range centre', dot(hueHex(g.center), 7));
  if (!g.subtract) {
    const t = g.center + r.hue;
    if (r.hue) el('path', { d: arcPath(g.center, t, 88), stroke: '#fff', 'stroke-width': 2, fill: 'none', opacity: .7 }, handles);
    handle('target', t, 'Hue shift target', dot(rgbHex(effectOn(sampleColor(g.center))), 6.5));
  }
}
// Apply a handle to hue h. Edges move one side only (centre follows), feathers stay symmetric.
function dragHandle(kind, i, h) {
  const r = chan().recipe, g = r.ranges[i];
  if (kind === 'move') g.center = wrap(h);
  else if (kind === 'edge+' || kind === 'edge-') {
    const sign = kind === 'edge+' ? 1 : -1, fixed = g.center - sign*g.width;
    const span = clamp(sign*delta(h, fixed), 2, 360) / 2;
    g.width = Math.max(1, Math.min(180, span)); g.center = wrap(fixed + sign*g.width);
  } else if (kind === 'feather+' || kind === 'feather-') {
    const sign = kind === 'feather+' ? 1 : -1;
    g.feather = Math.round(clamp(sign*delta(h, g.center + sign*g.width), 1, 90));
  } else if (kind === 'target') r.hue = Math.round(clamp(delta(h, g.center), -180, 180));
  for (const k of ['center','width']) g[k] = Math.round(g[k]*10)/10;
}
function handleHue(kind, g, r) {
  return { move: g.center, 'edge+': g.center+g.width, 'edge-': g.center-g.width, 'feather+': g.center+g.width+g.feather, 'feather-': g.center-g.width-g.feather, target: g.center+r.hue }[kind];
}
let wheelDrag = null;
$('wheel').addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-handle]'); if (!t || e.button !== 0) return;
  const i = Number(t.dataset.range); setActive(i);
  const b = $('wheel').getBoundingClientRect(), s = 320/b.width;
  const h0 = hueAt((e.clientX-b.left)*s, (e.clientY-b.top)*s), g = chan().recipe.ranges[i];
  wheelDrag = { kind: t.dataset.handle, i, before: snapshot(), offset: t.dataset.handle === 'move' ? delta(g.center, h0) : 0 };
  $('wheel').setPointerCapture(e.pointerId); e.preventDefault(); sync();
});
$('wheel').addEventListener('pointermove', e => {
  if (!wheelDrag) return;
  const b = $('wheel').getBoundingClientRect(), s = 320/b.width;
  dragHandle(wheelDrag.kind, wheelDrag.i, hueAt((e.clientX-b.left)*s, (e.clientY-b.top)*s) + wheelDrag.offset);
  sync(); render();
});
const endWheel = () => { if (wheelDrag) { const b = wheelDrag.before; wheelDrag = null; record(b); sync(); } };
$('wheel').addEventListener('pointerup', endWheel); $('wheel').addEventListener('lostpointercapture', endWheel);
$('wheel').addEventListener('pointercancel', () => { if (wheelDrag) { const b = wheelDrag.before; wheelDrag = null; restore(b); } });
$('wheel').addEventListener('keydown', e => {
  const t = e.target.closest?.('[data-handle]'); if (!t) return;
  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!step) return;
  e.preventDefault();
  const kind = t.dataset.handle, i = Number(t.dataset.range), r = chan().recipe, g = r.ranges[i];
  commit(() => dragHandle(kind, i, handleHue(kind, g, r) + step*(e.shiftKey ? 5 : 1)));
  $('handles').querySelector(`[data-handle="${kind}"]`)?.focus();
});

// ---- Picker on the photo ----
function pick(e, continuing = false) {
  const box = canvas.getBoundingClientRect();
  const x = Math.min(canvas.width-1, Math.max(0, Math.floor((e.clientX-box.left)/box.width*canvas.width)));
  const y = Math.min(canvas.height-1, Math.max(0, Math.floor((e.clientY-box.top)/box.height*canvas.height)));
  if (e.altKey && state.scope === 'local') { state.center = [x/canvas.width, y/canvas.height]; render(); return; }
  try {
    // Local grade samples its own stage input (after the global HSL), global samples the photo.
    const rgb = sampleNeighborhood(state.scope === 'local' ? stageInput : original, canvas.width, canvas.height, x, y);
    if (describe(rgb).relativeChroma < .02) { if (!continuing) notice('That sample is too neutral. Pick a more colourful area.'); return; }
    let c = chan();
    if (c.kind === 'all') { if (mode === 'subtract') { notice('All has no colours to subtract. Pick a band or a custom channel.'); return; } c = newCustom(); }
    const def = c.kind === 'band' ? BANDS.find(b => b.id === c.id) : { width: 16, feather: 12 };
    const m = continuing && mode === 'pick' ? 'add' : mode;
    if (addSample(c.recipe, rgb, m, def.width, def.feather)) {
      if (c.kind === 'custom' && c.recipe.ranges.length === 1) c.hex = hueHex(c.recipe.ranges[0].center);
      setActive(c.recipe.ranges.length-1); notice(); sync(); render();
    }
  } catch (err) { notice(err.message); }
}
canvas.onpointerdown = e => { if (e.button !== 0 || !original) return; gesture = snapshot(); canvas.setPointerCapture(e.pointerId); pick(e); };
canvas.onpointermove = e => { canvas.classList.toggle('alt', e.altKey && state.scope === 'local'); if (gesture) pick(e, true); };
const finish = () => { if (gesture) { record(gesture); gesture = null; } };
canvas.onpointerup = finish; canvas.onlostpointercapture = finish;
canvas.onpointercancel = () => { if (gesture) { const g = gesture; gesture = null; restore(g); } };

// ---- Sliders ----
const SLIDERS = ['hue','saturation','luminance','uniformity','opacity','width','feather'];
const DEFAULTS = { hue: 0, saturation: 0, luminance: 0, uniformity: 0, opacity: 1 };
SLIDERS.forEach(id => {
  let before = null;
  const start = () => { before ??= snapshot(); }, end = () => { if (before) { record(before); before = null; sync(); } };
  const set = v => {
    const c = chan();
    if (id === 'width' || id === 'feather') { const i = activeIndex(); if (i >= 0 && c.kind !== 'all') c.recipe.ranges[i][id] = v; }
    else c.recipe[id] = v;
  };
  $(id).onpointerdown = start; $(id).onkeydown = start; $(id).onchange = end; $(id).onblur = end;
  $(id).oninput = () => { start(); set(Number($(id).value)); sync(); render(); };
  if (id in DEFAULTS) $(id).ondblclick = () => commit(() => set(DEFAULTS[id]));
});

// ---- Rendering: each channel is measured from the same input; effects add. ----
function ellipse() {
  const result = new Float32Array(canvas.width*canvas.height);
  const [cx, cy] = state.center;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const d = Math.hypot((x/canvas.width-cx)/.35, (y/canvas.height-cy)/.4), t = clamp((1-d)/.25);
    result[y*canvas.width+x] = t*t*(3-2*t);
  }
  return result;
}
let engineName = '';
async function processOne(src, recipe, mask) {
  if (gpu && !$('cpu').checked) {
    try { const out = await gpu.process(src, recipe, mask); engineName = 'WebGPU'; return out; }
    catch (e) { gpu.destroy(); gpu = null; gpuFailure = e.message; }
  }
  engineName = 'CPU fallback'; return processCPU(src, recipe, mask);
}
async function applyModule(src, channels, mask = null) {
  const active = channels.filter(c => hasEffect(c.recipe));
  if (!active.length) return src;
  if (active.length === 1) return processOne(src, active[0].recipe, mask);
  const out = Float32Array.from(src);
  for (const c of active) { const o = await processOne(src, c.recipe, mask); for (let i = 0; i < out.length; i++) out[i] += o[i] - src[i]; }
  return out;
}
async function render() {
  revision++; dirty = true; if (drawing || !original) return;
  drawing = true;
  try {
    while (dirty) {
      dirty = false;
      const rev = revision, src = original, snap = JSON.parse(JSON.stringify(state)), width = canvas.width, height = canvas.height;
      engineName = $('cpu').checked || !gpu ? 'CPU fallback' : 'WebGPU';
      const globalOut = await applyModule(src, snap.global.channels);
      const mask = ellipse();
      const localOut = await applyModule(globalOut, snap.local.channels, mask);
      if (rev !== revision) continue;
      stageInput = globalOut;
      const output = $('before').checked ? src : localOut;
      const view = snap[snap.scope], current = view.channels.find(c => c.id === view.current);
      const overlay = $('overlay').checked && !$('before').checked && current.recipe.ranges.length;
      const selSrc = snap.scope === 'local' ? globalOut : src;
      const image = new ImageData(width, height);
      for (let i = 0; i < output.length; i += 4) {
        let w = 0;
        if (overlay) w = selection(selSrc.subarray(i, i+3), current.recipe.ranges).weight * (snap.scope === 'local' ? mask[i/4] : 1);
        for (let k = 0; k < 3; k++) {
          const v = clamp(encode(output[i+k]));
          image.data[i+k] = Math.round(255*(overlay ? v*.25*(1-w) + v*w : v));
        }
        image.data[i+3] = Math.round(clamp(output[i+3])*255);
      }
      if (snap.scope === 'local') drawEllipseOutline(image, snap.center);
      ctx.putImageData(image, 0, 0);
      const count = m => m.channels.filter(c => hasEffect(c.recipe)).length;
      $('status').textContent = `${$('before').checked ? 'Original' : engineName} · ${width} × ${height} · global ${count(snap.global)} channel${count(snap.global) === 1 ? '' : 's'} · local ${count(snap.local) ? 'on' : 'off'}${gpuFailure ? ' · ' + gpuFailure : ''}`;
      window.hslPrototype.lastOutput = output;
    }
  } catch (e) { notice(e.message); } finally { drawing = false; }
}
function drawEllipseOutline(image, [cx, cy]) {
  const W = image.width, H = image.height;
  for (let a = 0; a < 720; a++) {
    if (a % 12 > 6) continue;
    const t = a/720*Math.PI*2, x = Math.round((cx + .35*.875*Math.cos(t))*W), y = Math.round((cy + .4*.875*Math.sin(t))*H);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = (y*W+x)*4; image.data[i] = image.data[i+1] = image.data[i+2] = 240;
  }
}

// ---- Header and footer ----
$('scope').onclick = e => { const s = e.target.dataset.scope; if (s && s !== state.scope) { state.scope = s; notice(s === 'local' ? 'Local grade: one selection inside the ellipse. Alt-click the photo to move it.' : ''); sync(); render(); } };
$('modes').onclick = e => { if (e.target.dataset.mode) { mode = e.target.dataset.mode; sync(); } };
$('undo').onclick = () => { if (history.length) { future.push(snapshot()); restore(history.pop()); } };
$('redo').onclick = () => { if (future.length) { history.push(snapshot()); restore(future.pop()); } };
$('reset').onclick = () => commit(() => { state[state.scope] = state.scope === 'global' ? globalModule() : localModule(); notice(); });
$('reset-channel').onclick = () => commit(() => {
  const c = chan(), keep = c.recipe.ranges;
  c.recipe = newRecipe();
  c.recipe.ranges = c.kind === 'all' ? [{...FULL}] : c.kind === 'band' ? [bandRange(BANDS.find(b => b.id === c.id))] : keep;
  setActive(0);
});
$('delete-custom').onclick = () => commit(() => { const m = state.global; m.channels = m.channels.filter(c => c.id !== m.current); m.current = 'all'; });
for (const id of ['overlay','before','cpu']) $(id).onchange = render;
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); } });
$('save').onclick = () => {
  const file = { version: 2, kind: 'hsl-prototype', global: state.global.channels.map(({ id, name, kind, hex, recipe }) => ({ id, name, kind, hex, recipe })), local: state.local.channels[0].recipe };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'hsl-recipe.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('load').onchange = async () => {
  try {
    const v = JSON.parse(await $('load').files[0].text());
    if (v.kind === 'hsl-prototype') {
      const g = globalModule();
      g.channels = v.global.map(c => ({ id: String(c.id), name: String(c.name), kind: ['all','band','custom'].includes(c.kind) ? c.kind : 'custom', hex: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#777777', recipe: validateRecipe(c.recipe) }));
      if (!g.channels.length) throw Error('Recipe has no channels');
      g.current = g.channels[0].id;
      const l = localModule(); l.channels[0].recipe = validateRecipe(v.local);
      commit(() => { state.global = g; state.local = l; customCount = g.channels.filter(c => c.kind === 'custom').length; });
    } else {
      // A single correction (Codex's v1 recipe) loads into the current channel.
      const r = validateRecipe(v);
      commit(() => { chan().recipe = r; setActive(r.ranges.length-1); });
    }
    notice();
  } catch (e) { notice(e.message); } finally { $('load').value = ''; }
};
function setSource(image) {
  canvas.width = image.width; canvas.height = image.height; original = new Float32Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) { for (let c = 0; c < 3; c++) original[i+c] = decode(image.data[i+c]/255); original[i+3] = image.data[i+3]/255; }
  stageInput = original; notice(); sync(); render();
}
$('file').onchange = async () => {
  let bitmap;
  try {
    const file = $('file').files[0]; if (!file) return;
    bitmap = await createImageBitmap(file); const scale = Math.min(1, 1000/Math.max(bitmap.width, bitmap.height));
    const temp = document.createElement('canvas'); temp.width = Math.max(1, Math.round(bitmap.width*scale)); temp.height = Math.max(1, Math.round(bitmap.height*scale));
    const c = temp.getContext('2d', { colorSpace: 'srgb' }); c.drawImage(bitmap, 0, 0, temp.width, temp.height); setSource(c.getImageData(0, 0, temp.width, temp.height));
  } catch (e) { notice(`Photo could not be loaded: ${e.message}`); } finally { bitmap?.close(); $('file').value = ''; }
};
function demo() {
  const temp = document.createElement('canvas'); temp.width = 900; temp.height = 560; const c = temp.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, 560); sky.addColorStop(0, '#225eb8'); sky.addColorStop(.55, '#97c7db'); sky.addColorStop(.56, '#a0ad50'); sky.addColorStop(1, '#354c29'); c.fillStyle = sky; c.fillRect(0, 0, 900, 560);
  c.fillStyle = '#e5dfd2'; c.beginPath(); c.ellipse(665, 115, 125, 28, -.1, 0, Math.PI*2); c.fill();
  for (let i = 0; i < 65; i++) { const x = (i*137)%900, y = 300+(i*71)%240; c.fillStyle = `hsl(${65+(i*17)%80} 50% ${22+i%22}%)`; c.beginPath(); c.ellipse(x, y, 35+i%15, 14, Math.sin(i), 0, Math.PI*2); c.fill(); }
  c.fillStyle = '#d58a48'; c.fillRect(345, 290, 205, 165); c.fillStyle = '#ac483b'; c.beginPath(); c.moveTo(325, 300); c.lineTo(445, 205); c.lineTo(570, 300); c.fill(); c.fillStyle = '#386ba0'; c.fillRect(405, 345, 65, 110);
  // Continuous hue strip exposes selection gaps and feathering immediately.
  for (let x = 0; x < 900; x++) { c.fillStyle = `hsl(${x/900*360} 70% 55%)`; c.fillRect(x, 510, 1, 50); }
  setSource(c.getImageData(0, 0, 900, 560));
}
$('demo').onclick = demo;
window.hslPrototype = {
  get recipe() { return structuredClone(chan().recipe); },
  get state() { return structuredClone(state); },
  get original() { return original; }, get gpu() { return gpu; }, bands: BANDS, render, ready: false,
};
quickStart(); demo();
try { gpu = await createGPU(); } catch (e) { gpuFailure = e.message; }
window.hslPrototype.ready = true; await render();
