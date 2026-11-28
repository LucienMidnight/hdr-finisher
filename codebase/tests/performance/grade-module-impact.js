/* Grade module audit. Run through run-in-electron.js under the shared GPU lock.
 * Opens a fresh, disposable Grade session; never saves a photo/project.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { parseArgs } = require('node:util');
const { MODULES, PROBES, CLOCKS, MEMORY, recipeHash, stats, impacts,
  updateNoiseSpread, validateRun } = require('../../tools/audit-summary.cjs');
const { photosRoot } = require('../helpers/photos-root.cjs');

const PHOTOS = { typical: 'IMG_7723.CR3', large: 'DSC00636.ARW', noisy: 'IMG_0790.CR2' };
const RAW_PHOTOS = { 'raw.lens': '_DSC7970.ARW', 'raw.highlights': 'IMG_3129.CR2' };
const SIMPLE = { amount: .90, luminance: .85, color_noise: .90, detail_recovery: .35,
  finest_noise: .75, fine_noise: .70, medium_noise: .65, coarse_noise: .60 };
const DENOISE = {
  clean_grain: { method: 'clean_grain', ...SIMPLE, grain_evenness: 1, color_splotches: 1,
    clean_splotches: true, clean_fringes: true, protect_color_edges: false, splotch_size: 'small' },
  standard: { method: 'standard', ...SIMPLE },
  micro_grain: { method: 'micro_grain', micro_luminance: .85, micro_color: .85, micro_detail: .35 },
};
const DRIVE = 'tests/performance/grade-module-impact.js';
const LIMIT = 120_000;
const eye = key => `[data-section-path="${key}"]`;

// Seed values live here so the module reviewers can replace them in one place.
// “$lane” follows the lane flag, except for the HDR source of SDR Match.
const RECIPES = {
  baseline: {},
  'raw.cleanup': { on: { remove_hot_pixels: true, even_out_specks: true, speck_threshold: 2.3 },
    off: { remove_hot_pixels: false, even_out_specks: false, speck_threshold: 2.3 } },
  'raw.lens': { on: { mode: 'auto', distortion: true, chromatic_aberration: true, vignetting: true },
    off: { mode: 'off', distortion: true, chromatic_aberration: true, vignetting: true } },
  'raw.highlights': { on: { enabled: true, method: 'opposed_color_v1', clipping_threshold: .96, edge_colour_expand_percent: .5 },
    off: { enabled: false, method: 'opposed_color_v1', clipping_threshold: .96, edge_colour_expand_percent: .5 } },
  denoise: { methods: DENOISE },
  tone: { changes: { '$lane.exposure': .55, '$lane.contrast': .18 } },
  bands: { nodes: [[-6, 0], [-3, 0], [0, .8], [3, 0], [6, 0]], smoothing: .5 },
  curves: { changes: { '$lane.luma_curve': [[0, 0], [.25, .19], [.5, .58], [.75, .83], [1, 1]] } },
  highlight_compression: { changes: { '$lane.exposure': 3, '$lane.highlight_compression_mode': 'peak_fit',
    '$lane.highlight_compression_peak_measurement': 'maximum' }, hdr: { 'hdr.highlight_compression_target_nits': 600,
    'hdr.highlight_compression_start_nits': 200 }, sdr: { 'sdr.highlight_compression_start_percent': 55 } },
  color: { changes: { '$lane.saturation': .45, '$lane.tint': .40, '$lane.white_balance_kelvin': 4500 } },
  wheels: { changes: { '$lane.color_grading.shadows.hue': 220, '$lane.color_grading.shadows.saturation': 28,
    '$lane.color_grading.shadows.luminance_ev': .40, '$lane.color_grading.highlights.hue': 38,
    '$lane.color_grading.highlights.saturation': 18, '$lane.color_grading.highlights.luminance_ev': .35 } },
  hsl: { channel: 'red', ranges: [{ center: 110, width: 155, feather: 24, subtract: false }],
    hue: 12, saturation: 48, luminance: .75 },
  bw: { changes: { '$lane.black_and_white_section_enabled': true, '$lane.black_and_white.reds': 40 } },
  vignette: { changes: { '$lane.vignette.amount': -45, '$lane.vignette.midpoint': 30,
    '$lane.vignette.midpoint_scale_version': 2 } },
  detail: { changes: { '$lane.detail.texture_amount': 25, '$lane.detail.clarity_amount': 50,
    '$lane.detail.clarity_radius_percent': .75, '$lane.detail.sharpen_amount': 50,
    '$lane.detail.sharpen_radius_px': .8, '$lane.detail.sharpen_threshold': 0,
    '$lane.detail.softness': 0, '$lane.detail.microcontrast': 0 } },
  film: { changes: { '$lane.film_look.film_stock': 'kodak_portra_400', '$lane.film_look.look_strength': 80,
    '$lane.film_look.lens_filter': 'black_pro_mist', '$lane.film_look.lens_strength': .3, '$lane.film_look.lens_size': 1,
    '$lane.film_look.halation_enabled': true, '$lane.film_look.halation_amount': 25, '$lane.film_look.halation_radius': .20,
    '$lane.film_look.grain_enabled': true, '$lane.film_look.grain_amount': 28, '$lane.film_look.film_resolution': 90,
    '$lane.film_look.print_contrast': 20, '$lane.film_look.scan_sharpening': 25 } },
  local: { stroke: { from: [.30, .40], to: [.70, .60], samples: 7, pressure: 1 },
    locals: [{ type: 'brush', exposure: .8, saturation: .25,
      brush: { brush_radius: .025, brush_hardness: .75, brush_flow: 1, brush_opacity: 1, brush_smoothing: .35 } },
    { type: 'linear_gradient', exposure: -.55, saturation: -.20 }] },
  retouch: { repairs: [{ source: [.38, .44], destination: [.5, .5] },
    { source: [.57, .5], destination: [.66, .56] }], size: 128, feather: 25, texture: 100, opacity: 100 },
  geometry: { changes: { 'shared.geometry.crop': { x: .08, y: .08, width: .84, height: .84 },
    'shared.geometry.straighten_angle': 2, 'shared.geometry.perspective_horizontal': 12,
    'shared.geometry.perspective_vertical': 0, 'shared.geometry.perspective_rotate': 0, 'shared.geometry.rotation': 0,
    'shared.geometry.flip_horizontal': false, 'shared.geometry.flip_vertical': false } },
  sdr_match: { changes: { 'hdr.exposure': .35, 'hdr.contrast': .12, 'hdr.saturation': .12 }, action: 'whole' },
};

const EYES = {
  tone: '$lane.tone_section_enabled', bands: '$lane.tone_equalizer_section_enabled',
  curves: 'current.curves_section_enabled', highlight_compression: '$lane.highlight_section_enabled',
  color: '$lane.color_section_enabled', wheels: 'current.color_grading_section_enabled',
  hsl: 'current.hsl_section_enabled', bw: 'current.black_and_white_section_enabled',
  vignette: 'current.vignette_section_enabled', detail: 'current.detail_section_enabled',
  film: 'current.film_look_section_enabled', local: 'shared.local_adjustments_enabled',
};
const RANGE = {
  tone: ['#$lane-exposure', '#$lane-contrast'], bands: ['#tone-equalizer-band-value'],
  highlight_compression: ['#$lane-compression-start', '#$lane-compression-detail'],
  color: ['#$lane-saturation', '#$lane-tint'],
  hsl: ['#hsl-global-panel [data-hsl-key="saturation"]'], bw: ['#bw-reds'],
  vignette: ['[data-path="current.vignette.amount"]'], detail: ['#detail-clarity', '#detail-sharpen', '#detail-clarity-radius'],
  film: ['#film-print_contrast', '#film-look-strength', '#film-lens-strength', '#film-halation-amount', '#film-grain-amount'],
  local: ['[data-local-grade="exposure"]'],
};

const isRaw = id => id.startsWith('raw.');
const renameLane = (selector, rendition) => selector.replaceAll('$lane', rendition);
const max = xs => xs.length ? Math.max(...xs) : null;
const mb = bytes => bytes == null ? null : bytes / 1e6;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const shaBuffer = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function shaFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function saveFile(file, value) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function options(args) {
  const { values: v } = parseArgs({ args: args.slice(2), options: {
    all: { type: 'boolean' }, module: { type: 'string' }, photo: { type: 'string', default: 'typical' },
    zoom: { type: 'string', default: 'fit' }, lane: { type: 'string' },
    samples: { type: 'string', default: '5' }, warmup: { type: 'string', default: '2' },
    out: { type: 'string', default: 'output/audits/module-impact' }, resume: { type: 'boolean' },
    help: { type: 'boolean' },
  }});
  if (v.help) return null;
  if (v.all && v.module) throw Error('Use --module <id>[,<id>...] or --all');
  const ids = v.all ? [...MODULES] : (v.module || 'baseline').split(',');
  if (ids.some(id => !MODULES.includes(id)) || new Set(ids).size !== ids.length) throw Error('Unknown or repeated module');
  if (!['fit', '100'].includes(v.zoom) || (v.lane && !['hdr', 'sdr'].includes(v.lane))) throw Error('Invalid zoom or lane');
  if (v.lane === 'hdr' && ids.includes('sdr_match')) throw Error('sdr_match must run on the SDR lane');
  if (!/^\d+$/.test(v.samples) || +v.samples < 1 || !/^\d+$/.test(v.warmup)
    || ![v.samples, v.warmup].every(x => Number.isSafeInteger(+x))) throw Error('Samples must be positive and warm-ups nonnegative');
  const over = ids.filter(id => id !== 'baseline');
  const plan = !ids.includes('baseline') ? ids : [
    'baseline:start', ...over.slice(0, v.all ? over.indexOf('color') : Math.ceil(over.length / 2)),
    ...(over.length > 1 ? ['baseline:middle'] : []),
    ...over.slice(v.all ? over.indexOf('color') : Math.ceil(over.length / 2)),
    ...(over.length ? ['baseline:end'] : []),
  ];
  return { ...v, out: path.resolve(v.out), samples: +v.samples, warmups: +v.warmup, plan };
}

async function findPhoto(arg, override = null) {
  const role = override ? 'override' : Object.hasOwn(PHOTOS, arg) ? arg : 'path';
  const listed = override || PHOTOS[role] || null;
  if (!listed && /\.hdrf(?:-triage)?$/i.test(arg)) throw Error('Use a photo, not a project file.');
  const original = listed ? path.join(photosRoot(), 'HDR Test Images', listed) : path.resolve(arg);
  if (!listed) {
    if (!fs.statSync(original).isFile()) throw Error(`Photo is not a file: ${original}`);
    return { role, file: path.basename(original), sha256: await shaFile(original), input: original };
  }
  const input = path.resolve(require('../../tools/lib/platform.cjs').machineSettings().sharedTestPhotos, listed);
  fs.mkdirSync(path.dirname(input), { recursive: true });
  if (!fs.existsSync(input)) {
    try { fs.copyFileSync(original, input, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const manifest = require('../test-photos.manifest.json');
  const expected = manifest.files.find(x => x.name === listed)?.sha256;
  const digest = await shaFile(input);
  if (expected && expected !== digest) throw Error(`Reusable test copy does not match the photo manifest: ${input}`);
  return { role, file: listed, sha256: digest, input };
}

function sampler() {
  const child = spawn(require('../../tools/lib/platform.cjs').pythonExecutable(),
    [path.resolve('tools/measure-library-processes.py'), process.env.HDR_FINISHER_ELECTRON_MAIN_PID, '0.2'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  const rows = [], errors = [];
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try { rows.push(JSON.parse(line)); } catch { errors.push(`Bad memory census: ${line}`); }
      if (rows.length > 1500) rows.shift();
    }
  });
  child.stderr.on('data', bytes => errors.push(String(bytes).trim()));
  child.on('error', error => errors.push(error.message));
  const closed = once(child, 'close').catch(() => {});
  return {
    async baseline() {
      const started = Date.now();
      while (!rows.some(r => r.at >= started) && Date.now() - started < 3500 && child.exitCode === null) await delay(30);
      return rows.find(r => r.at >= started) || null;
    },
    summarize(before, until, roles, allocator) {
      const start = before?.at ?? -Infinity;
      const samples = before ? rows.filter(r => r.at >= start && r.at <= until) : [];
      const electrons = new Map(roles.map(p => [p.pid, p.type]));
      const charge = (row, role) => {
        const matches = row.processes.filter(p => {
          const type = electrons.get(p.pid);
          if (role === 'renderer') return type === 'Tab' || type === 'Renderer' || /helper \(renderer\)/i.test(p.name);
          if (role === 'gpu') return type === 'GPU' || /helper \(gpu\)/i.test(p.name);
          return !type && /(?:python|hdr.finisher.backend)/i.test(p.name);
        });
        return matches.length ? matches.reduce((n, p) => n + p.chargedBytes, 0) : null;
      };
      const peak = role => mb(max(samples.map(r => charge(r, role)).filter(Number.isFinite)));
      return { footprint_baseline: mb(before?.totalBytes), footprint_peak: mb(max(samples.map(r => r.totalBytes))),
        renderer_peak: peak('renderer'), backend_peak: peak('backend'), gpu_process_peak: peak('gpu'),
        webgpu_allocator_peak: mb(allocator) };
    },
    errors,
    async stop() { child.kill(); await closed; },
  };
}

// This runs in the disposable renderer. A queue fence is paired with both
// the accepted frame and its generation, so a superseded frame cannot win.
function installObserve() {
  const audit = window.__moduleAudit = { overlayNotBefore: 0, background: 0, rawPhases: [], denoiseEvents: [] };
  const openStage = gradeOpenStage;
  gradeOpenStage = function (stage, fields) {
    if (stage === 'grade_open_backend_stage') audit.rawPhases.push({ generation: state.importGeneration, ...fields });
    return openStage.apply(this, arguments);
  };
  const renderer = state.gpuPreview;
  const recordStage = renderer.recordStage;
  renderer.recordStage = function (stage, detail) {
    if (['fine-grain-fit', 'fine-grain-reduced-miss'].includes(stage))
      audit.denoiseEvents.push(stage);
    if (stage === 'denoise-analysis' && ['started', 'ready'].includes(detail?.state))
      audit.denoiseEvents.push(detail.state === 'started' ? 'selector-setup' : 'selector-miss');
    return recordStage.apply(this, arguments);
  };
  const grainEvent = renderer.grainEvent;
  renderer.grainEvent = function (event) {
    if (event === 'grain_cpu_prepare_started') audit.denoiseEvents.push(event);
    return grainEvent.apply(this, arguments);
  };
  audit.preparation = () => {
    const lane = state.currentView, selector = renderer.denoiseSourceSelector;
    const method = state.denoise[lane].controls.method;
    const runtime = state.denoiseRuntime[lane];
    const expected = `${state.session?.session_id}:${lane}:${refinementProxyLongEdge()}:${geometrySignature()}:${gradeSourceIdentity(lane)}`;
    const ready = renderer.diagnosticsSnapshot().denoise?.cacheReady;
    return { expected, identity: selector?.identity ?? null, method,
      prepared: Boolean(!runtime?.dirty && ((ready && selector?.controls?.method === method)
        || (method === 'micro_grain' && runtime?.microBackup))) };
  };
  audit.reduced = a => a?.transport !== 'WebGPU' && a?.reducedNotice && a.processedLongEdge > 0
    && a.processedLongEdge < requiredProcessingLongEdge() ? a.reducedNotice : null;
  const debounce = debounceOverlayAndScopes;
  debounceOverlayAndScopes = function (...args) {
    audit.overlayNotBefore = performance.now() + 120;
    return debounce.apply(this, args);
  };
  const scopes = refreshScopes;
  refreshScopes = async function (...args) {
    audit.background++;
    try { return await scopes.apply(this, args); } finally { audit.background--; }
  };
  const overlay = refreshOverlay;
  refreshOverlay = async function (...args) {
    audit.background++;
    try { return await overlay.apply(this, args); } finally { audit.background--; }
  };
  audit.stable = drain => {
    const lane = state.currentView, a = state.acceptedPresentation, c = state.renderCoordinator?.state(lane);
    const scheduler = state.previewScheduler;
    return !state.importInProgress && !state.gradeOpen && !state.rawRedevelopGeneration
      && (a?.exact && a.processedLongEdge === requiredProcessingLongEdge() && viewerState().status === 'ready' || audit.reduced(a))
      && scopePresentationMatches(a, lane)
      && !state.gpuDraftInFlight && !state.globalEditSyncPending && !state.denoiseInputQueue?.running
      && !['preparing', 'recalculating'].includes(state.denoiseRuntime[lane]?.status) && !retouchUI.busy
      && !state.zoomRefinementTimer && !state.zoomRefinementInFlight
      && !scheduler?.frameInFlight && !scheduler?.framePending && scheduler?.frame == null
      && c?.inFlight?.priority !== 'foreground' && c?.pending?.priority !== 'foreground'
      && (!drain || (!c?.inFlight && !c?.pending && !c?.panTimerPending && !c?.catchUpTimerPending
        && !state.zoomScopeTimer && !state.scopeRegionRefreshTimer && !state.gpuScopeRequestInFlight
        && !state.pendingGpuScopeRequest && !state.scopeRequestInFlight && !state.pendingScopeRequest
        && !state.gpuPreview?.activeScopeCount && !state.gpuPreview?.activeRenderCount && !geometryUnderlayerTask
        && !pendingHighlightAnchors.size && !exactHighlightAnchorInflight.size
        && !audit.background && !hslUI.selectionWork && !hslUI.pendingSelection
        && performance.now() >= audit.overlayNotBefore));
  };
  audit.allocator = () => window.HDRFinisherPerformance.gpuSnapshot()?.resources?.memory?.allocator?.usedBytes ?? null;
  audit.bump = record => {
    const now = audit.allocator();
    if (now !== null) record.allocator = Math.max(record.allocator ?? 0, now);
  };
  function frame(accepted, fenced) {
    const record = audit.step;
    if (!record || record.firstAt === null || !accepted) return;
    const row = { accepted, fenced, completedAt: null, currentAtCompletion: false };
    record.frames.push(row);
    const done = () => requestAnimationFrame(() => {
      row.completedAt = performance.now();
      row.currentAtCompletion = state.acceptedPresentation === accepted && scopePresentationMatches(accepted, state.currentView);
      if (audit.step === record) audit.bump(record);
    });
    if (fenced) void state.gpuPreview.device.queue.onSubmittedWorkDone().then(done, error => record.errors.push(String(error)));
    else done(); // CPU exact timing is still observable, but not GPU first feedback.
  }
  addEventListener('hdrfinisher:preview-presented', event => {
    const a = state.acceptedPresentation, e = event.detail;
    if (a?.transport === 'WebGPU' && a.sourceSerial === e.sourceSerial && a.generation === e.generation
      && a.sessionId === e.sessionId && a.lane === e.lane) frame(a, true);
  });
  const accept = acceptPresentation;
  acceptPresentation = function (...args) {
    const result = accept.apply(this, args);
    if (state.acceptedPresentation?.transport !== 'WebGPU') frame(state.acceptedPresentation, false);
    return result;
  };
  const relevant = (event, record) => event.target instanceof Element && event.target.closest(record.selector);
  document.addEventListener('input', event => {
    const r = audit.step;
    if (r && relevant(event, r) && r.firstAt === null) r.firstAt = performance.now();
  }, true);
  document.addEventListener('pointerup', event => {
    const r = audit.step;
    if (!r || !event.isTrusted || r.releaseAt !== null) return;
    if (r.type !== 'click' || relevant(event, r)) r.releaseAt = performance.now();
    // Canvas controls (Curves) have no DOM input. Use their first real
    // pointer change, not pointerdown, as the equivalent input event.
  }, true);
  document.addEventListener('pointermove', event => {
    const r = audit.step;
    if (r?.type === 'canvas' && r.firstAt === null && event.isTrusted && event.buttons === 1 && relevant(event, r)) {
      r.firstAt = performance.now();
    }
  }, true);
  document.addEventListener('click', event => {
    const r = audit.step;
    if (r?.type === 'click' && event.isTrusted && relevant(event, r) && r.firstAt === null) {
      // Buttons fire click rather than input. Their click is the edit ingress.
      r.firstAt = performance.now();
      r.releaseAt ??= r.firstAt;
    }
  }, true);
  audit.finished = drain => {
    const r = audit.step, accepted = state.acceptedPresentation;
    if (!r || r.firstAt === null || r.releaseAt === null || !audit.stable(drain)) return false;
    if (r.raw && state.importGeneration === r.importGeneration) return false;
    const last = r.frames.findLast(f => f.accepted === accepted && f.currentAtCompletion);
    if (!last) return false;
    if (drain) return { drainedAt: performance.now() };
    return true;
  };
}

function bounded(work, label, timeout = LIMIT) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out after ${timeout} ms`)), timeout); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function stable(page) {
  await page.waitForFunction(() => __moduleAudit.stable(true), null, { timeout: LIMIT });
  await bounded(page.evaluate(async () => {
    await state.gpuPreview.device.queue.onSubmittedWorkDone();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }), 'Idle GPU fence');
}

async function reveal(page, selector) {
  await page.evaluate(selector => {
    const control = document.querySelector(selector);
    if (!control) throw Error(`Missing control ${selector}`);
    const parents = [];
    for (let el = control.parentElement; el; el = el.parentElement) parents.unshift(el);
    for (const el of parents) {
      if (el.classList.contains('collapsed')) el.querySelector(':scope > .control-group-header .group-toggle')?.click();
      if (el.tagName === 'DETAILS') el.open = true;
      if (el.matches('.film-stage')) {
        el.querySelector(':scope > .film-stage-heading[aria-expanded="false"]')?.click();
      }
    }
  }, selector);
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  return locator;
}

async function pointerDrag(page, locator, target) {
  const box = await locator.boundingBox();
  if (!box) throw Error('Slider is not visible');
  const [fraction, targetFraction] = await locator.evaluate((c, target) => {
    const fractionOf = n => (Number(n) - Number(c.min)) / (Number(c.max) - Number(c.min));
    return [fractionOf(c.value), target == null ? null : fractionOf(target)];
  }, target);
  if (!Number.isFinite(fraction)) throw Error('Slider lacks a finite range');
  const start = Math.max(.02, Math.min(.98, fraction));
  const end = targetFraction ?? (start > .73 ? start - .18 : start + .18);
  const x = box.x + box.width * start, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    for (let i = 1; i <= 9; i++) {
      await page.mouse.move(x + box.width * (end - start) * i / 9, y);
      await delay(20);
    }
  } finally { await page.mouse.up(); }
}

// Use one compositor method for the actual ON/OFF comparison, even if the
// two states use different rendering routes. For step evidence use the tiled
// presentation texture when available, using the sweep's nine patches.
async function signature(page, screen = false) {
  if (!screen) {
    const texture = await bounded(page.evaluate(async () => {
      const gpu = state.gpuPreview, target = gpu.presentationTarget;
      if (!target?.valid || state.acceptedPresentation?.execution !== 'tiled') return null;
      const visible = visibleOutputRect(target.width, target.height) ?? { x: 0, y: 0, width: target.width, height: target.height };
      let hash = 2166136261;
      for (const fy of [.1, .5, .9]) for (const fx of [.1, .5, .9]) {
        const x = Math.max(0, Math.min(target.width - 32, Math.floor(visible.x + visible.width * fx)));
        const y = Math.max(0, Math.min(target.height - 32, Math.floor(visible.y + visible.height * fy)));
        const patch = await gpu.readPresentationRegion(32, 32, x, y);
        for (const byte of new Uint8Array(new Float32Array(patch.values).buffer)) hash = Math.imul(hash ^ byte, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    }), 'Tiled signature readback', 15_000);
    if (texture !== null) return `texture:${texture}`;
  }
  const clip = await page.evaluate(() => {
    const image = activePreviewElement().getBoundingClientRect(), viewer = els.dropzone.getBoundingClientRect();
    const x = Math.ceil(Math.max(0, image.left, viewer.left)), y = Math.ceil(Math.max(0, image.top, viewer.top));
    return { x, y, width: Math.floor(Math.min(innerWidth, image.right, viewer.right)) - x,
      height: Math.floor(Math.min(innerHeight, image.bottom, viewer.bottom)) - y };
  });
  if (clip.width < 1 || clip.height < 1) throw Error('No visible image to sign');
  return `compositor:${shaBuffer(await page.screenshot({ clip, timeout: 15_000 }))}`;
}

function measureWith(page, memory) {
  const requests = [];
  let measuring = false;
  page.on('request', request => {
    if (measuring && request.method() === 'POST' && /\/denoise(?:[-/][^?]+)?(?:\?|$)/.test(request.url())) {
      requests.push(new URL(request.url()).pathname);
    }
  });
  return async (descriptor, action) => {
    const locator = await reveal(page, descriptor.selector);
    if (!await locator.isEnabled()) throw Error(`Disabled control: ${descriptor.selector}`);
    if (!descriptor.draft) await stable(page);
    const roles = (await global.HDRFinisherElectronTestHarness.memory()).roles;
    const baseline = await memory.baseline(), errorAt = memory.errors.length;
    let visible, outcome;
    requests.length = 0;
    measuring = true;
    try {
      await page.evaluate(d => {
        const r = __moduleAudit.step = { ...d, firstAt: null, releaseAt: null, frames: [], errors: [],
          importGeneration: state.importGeneration, allocator: __moduleAudit.allocator(),
          denoiseEventIndex: __moduleAudit.denoiseEvents.length,
          rawPhaseIndex: __moduleAudit.rawPhases.length, preparationBefore: __moduleAudit.preparation() };
        r.timer = setInterval(() => __moduleAudit.bump(r), 200);
      }, descriptor);
      await bounded(action(locator), descriptor.step);
      // Diagnostic failures include a missing input or absent new frame, not
      // a duration fabricated from the boot or preceding step's frame.
      const input = await page.evaluate(() => __moduleAudit.step.firstAt);
      if (input === null) throw Error('Native action did not produce a timing input');
      visible = await page.waitForFunction(() => __moduleAudit.finished(false), null, { timeout: LIMIT });
      await visible.dispose();
      const drained = await page.waitForFunction(() => __moduleAudit.finished(true), null, { timeout: LIMIT });
      const { drainedAt } = await drained.jsonValue();
      await drained.dispose();
      outcome = await page.evaluate(drainedAt => {
        const r = __moduleAudit.step, a = state.acceptedPresentation;
        const last = r.frames.findLast(f => f.accepted === a && f.currentAtCompletion);
        const first = r.frames.filter(f => f.fenced && f.currentAtCompletion)
          .sort((a, b) => a.completedAt - b.completedAt)[0];
        const fallbacks = new Set(r.frames.flatMap(f => f.accepted.fallbackReason ? [f.accepted.fallbackReason] : []));
        if (a.grainRoute?.fallback) fallbacks.add(String(a.grainRoute.fallback));
        const reduced = __moduleAudit.reduced(a);
        if (reduced) fallbacks.add(reduced);
        const grain = a.grainRoute;
        if (grain?.route === 'cpu' && grain.reason) fallbacks.add(grain.reason);
        const route = reduced ? 'cpu-reduced' : grain?.route === 'cpu' ? 'cpu-grain'
          : a.transport === 'WebGPU' ? `gpu-${a.execution || 'unknown'}` : `cpu-${a.transport || 'unknown'}`;
        const events = __moduleAudit.denoiseEvents.slice(r.denoiseEventIndex);
        const countEvent = event => events.filter(name => name === event).length;
        return {
          first_feedback_ms: first ? first.completedAt - r.firstAt : null,
          settle_ms: Math.max(0, last.completedAt - r.releaseAt),
          drained_ms: Math.max(0, drainedAt - r.releaseAt),
          whole_wait_ms: last.completedAt - r.firstAt, route, fallbacks: [...fallbacks],
          processedLongEdge: a.processedLongEdge, allocator: r.allocator, errors: r.errors,
          reduced: reduced ? { requestedLongEdge: requiredProcessingLongEdge(), actualLongEdge: a.processedLongEdge, reason: reduced } : null,
          rawPhases: __moduleAudit.rawPhases.slice(r.rawPhaseIndex),
          preparationBefore: r.preparationBefore, preparationAfter: __moduleAudit.preparation(),
          denoisePreparation: { selectorSetups: countEvent('selector-setup'), selectorMisses: countEvent('selector-miss'),
            fitMisses: countEvent('fine-grain-fit'), exactReducedMisses: countEvent('fine-grain-reduced-miss'),
            cpuPreparationMisses: countEvent('grain_cpu_prepare_started') },
          ended: performance.timeOrigin + drainedAt,
        };
      }, drainedAt);
    } finally {
      measuring = false;
      await bounded(page.evaluate(() => {
        clearInterval(__moduleAudit.step?.timer);
        __moduleAudit.step = null;
      }).catch(() => {}), 'Stop renderer observation', 1500).catch(() => {});
    }
    outcome.denoisePreparation.cpuPreparationMisses = Math.max(outcome.denoisePreparation.cpuPreparationMisses,
      requests.filter(url => /denoise-(?:grain|micro|prepare)(?:\/|$)/i.test(url)).length);
    outcome.errors.push(...memory.errors.slice(errorAt).filter(Boolean));
    if (!baseline) outcome.errors.push('No idle process memory sample');
    if (outcome.first_feedback_ms === null) {
      if (outcome.route.startsWith('gpu-')) outcome.errors.push('No current GPU-fenced feedback frame');
      else outcome.fallbacks.push('No current GPU-fenced feedback frame on this route');
    }
    outcome.memory_mb = memory.summarize(baseline, outcome.ended, roles, outcome.allocator);
    outcome.signature = await signature(page);
    return outcome;
  };
}

function step(name, kind, state, reason = null) {
  return { step: name, kind, state, processedLongEdge: 0, ...Object.fromEntries(TIMINGS.map(k => [k, stats([])])),
    route: null, fallbacks: [], signature: null, memory_mb: Object.fromEntries(MEMORY.map(k => [k, null])),
    skipped: reason, errors: [] };
}

function addSample(target, sample) {
  if (sample.reduced) {
    (target.reducedSamples ||= []).push({ ...sample.reduced, route: sample.route,
      ...Object.fromEntries(TIMINGS.map(key => [key, sample[key]])), signature: sample.signature, memory_mb: sample.memory_mb });
  } else {
    for (const key of TIMINGS) if (sample[key] !== null) target[key].samples.push(sample[key]);
    target.processedLongEdge = sample.processedLongEdge;
  }
  (target.samplesDetail ||= []).push({ route: sample.route, processedLongEdge: sample.processedLongEdge,
    preparationBefore: sample.preparationBefore, preparationAfter: sample.preparationAfter,
    denoisePreparation: sample.denoisePreparation, ...(sample.rawPhases.length ? { rawPhases: sample.rawPhases } : {}) });
  for (const key of MEMORY) {
    const n = sample.memory_mb[key];
    if (n !== null) target.memory_mb[key] = Math.max(target.memory_mb[key] ?? 0, n);
  }
  const routes = new Set([...(target.route?.split(' / ') ?? []), sample.route]);
  target.route = [...routes].join(' / ');
  target.signature = sample.signature;
  target.fallbacks = [...new Set([...target.fallbacks, ...sample.fallbacks])];
  target.errors = [...new Set([...target.errors, ...sample.errors])];
}
function finalizeSteps(row) {
  for (const step of row.steps) for (const key of TIMINGS) step[key] = stats(step[key].samples);
}

async function setZoom(page, zoom) {
  await page.evaluate(zoom => setZoomMode(zoom === '100' ? 'actual' : 'fit'), zoom);
  await stable(page);
}
async function openPhoto(page, photo, rendition, zoom) {
  const id = await page.evaluate(() => state.session?.session_id ?? null);
  await bounded(page.evaluate(async file => {
    state.appPreferences.gradeAutosave = false;
    const selection = await desktop.grantSourcePath(file);
    if (!selection) throw Error('Could not grant the audit source');
    await openStagedDesktopSource(selection);
    activateWorkflowTab('grade');
  }, photo.input), 'Open disposable audit source');
  await page.waitForFunction(previous => state.session?.session_id && state.session.session_id !== previous, id, { timeout: 8000 });
  await bounded(page.evaluate(async view => {
    if (state.currentView !== view) await switchLane(view);
  }, rendition), 'Switch Grade lane');
  await setZoom(page, zoom);
}

async function setDenoise(page, enabled, method) {
  if (method) await bounded(page.evaluate(method => commitDenoiseControl('method', method), method), 'Set Denoise method');
  if (await page.evaluate(() => state.denoise[state.currentView].enabled) !== enabled) {
    await bounded(page.evaluate(enabled => setDenoiseEnabled(enabled), enabled), 'Set Denoise eye');
    await stable(page);
  }
}
async function prime(page) {
  await setDenoise(page, true, 'clean_grain');
  await setDenoise(page, false);
}

async function seedDenoise(page, controls) {
  await setDenoise(page, false);
  await setDenoise(page, false, controls.method);
  await bounded(page.evaluate(async controls => {
    const lane = state.currentView;
    Object.assign(state.denoise[lane].controls, controls);
    invalidateDenoisePreparation(lane, { dirty: true });
    if (!await persistDenoiseSettings()) throw Error('Denoise recipe was rejected.');
    const accepted = state.editDocument.denoise[lane].controls;
    if (!Object.entries(controls).every(([k, v]) => accepted[k] === v)) throw Error('Denoise recipe was not acknowledged.');
    renderDenoiseControls();
  }, controls), 'Seed Denoise recipe');
  await stable(page);
}

async function setRaw(page, update, zoom) {
  const reloaded = await bounded(page.evaluate(async ({ key, values }) => {
    const source = sourcePathForClipboard();
    const id = state.session.session_id, previous = state.importGeneration;
    const existing = state.editDocument.source.raw_import_settings;
    const rawImportSettings = key ? structuredClone(existing) : values;
    if (key) Object.assign(rawImportSettings[key], values);
    const changed = stablePreviewJson(rawImportSettings) !== stablePreviewJson(existing);
    if (changed) {
      await openStagedDesktopSource({ ...await desktop.grantSourcePath(source), rawImportSettings, replaceSessionId: id });
      if (state.importGeneration <= previous || !state.session?.session_id
        || (key && !Object.entries(values).every(([k, v]) => state.editDocument.source.raw_import_settings[key]?.[k] === v))) {
        throw Error(`RAW ${key || 'default'} settings did not persist`);
      }
    }
    delete els.rawSettingsPanel.dataset.initialized;
    delete els.rawHighlightGroup.dataset.sessionId;
    renderRawImportControls(state.session);
    return changed;
  }, update), 'Re-develop RAW for the next settled block');
  if (reloaded) await setZoom(page, zoom);
}

async function seedRaw(page, id, recipe, on, zoom) {
  const key = { 'raw.cleanup': 'pixel_cleanup', 'raw.lens': 'lens', 'raw.highlights': 'highlight_reconstruction' }[id];
  await setRaw(page, { key, values: on ? recipe.on : recipe.off }, zoom);
}

async function gradeSnapshot(page) {
  return bounded(page.evaluate(async () => {
    if (await syncGlobalEditState() === false) throw Error('Could not synchronise audit grade');
    return structuredClone(state.editDocument);
  }), 'Snapshot audit grade');
}

async function restoreGrade(page, snapshot, rendition, zoom) {
  const raw = snapshot.source.raw_import_settings;
  if (raw) await setRaw(page, { values: raw }, zoom);
  await bounded(page.evaluate(async ({ snapshot, rendition }) => {
    if (state.currentView !== rendition) await switchLane(rendition);
    // The backend keeps the current source and disallows source replacement
    // through edit commands. This restores the grade, including local/repair
    // edits, without starting a second source import or saving a project.
    if (await syncGlobalEditState() === false) throw Error('Could not synchronise audit grade');
    const document = { ...snapshot, source: state.editDocument.source };
    if (stablePreviewJson(document) !== stablePreviewJson(state.editDocument)) {
      if (!await queueEditCommand('replace_document', { document })) throw Error('Could not restore the audit grade');
      renderLaneChrome();
      syncControlsFromState();
      renderControlState();
      syncCurveControlsFromState();
      drawCurveEditor();
    }
  }, { snapshot, rendition }), 'Restore in-session Grade state');
  await stable(page);
}

async function applyChanges(page, rendition, changes) {
  if (!changes || !Object.keys(changes).length) return;
  await bounded(page.evaluate(async ({ rendition, changes }) => {
    const adjustments = structuredClone(state.adjustments);
    for (const [key, value] of Object.entries(changes)) setValueByPath(adjustments, key.replaceAll('$lane', rendition), value);
    if (!await queueEditCommand('set_global_adjustments', { adjustments })) throw Error('Audit grade setup was rejected');
    syncControlsFromState();
    renderControlState();
    syncCurveControlsFromState();
    drawCurveEditor();
  }, { rendition, changes }), 'Seed audit grade');
  await stable(page);
}

async function selectTab(page, tab = 'global') {
  const control = page.locator(tab === 'global' ? '[data-control-mode="global"]' : `#grade-mode-${tab}`);
  if (await control.count() && await control.getAttribute('aria-selected') !== 'true') await control.click();
}

async function openMatch(page) {
  const response = page.waitForResponse(r => r.url().endsWith('/sdr-match') && r.request().method() === 'POST', { timeout: LIMIT });
  response.catch(() => {});
  await page.locator('#sdr-match-entire').click();
  const reply = await response;
  if (!reply.ok()) throw Error(`SDR Match failed with HTTP ${reply.status()}: ${(await reply.text()).slice(0, 400)}`);
  await page.waitForFunction(() => !els.sdrMatchEntire.disabled, null, { timeout: LIMIT });
}

async function seed(page, id, recipe, rendition, zoom) {
  if (isRaw(id)) {
    if (!await page.evaluate(() => isRawSession(state.session))) return 'This source is not camera RAW.';
    await seedRaw(page, id, recipe, true, zoom);
    return null;
  }
  await applyChanges(page, rendition, { ...recipe.changes, ...(id === 'highlight_compression' ? recipe[rendition] : {}) });
  if (EYES[id]) {
    await setModuleEye(page, id, rendition, true);
  }
  if (id === 'bands') {
    await applyChanges(page, rendition, {
      '$lane.tone_equalizer_nodes': recipe.nodes.map(([input_ev, adjustment_ev]) => ({ input_ev, adjustment_ev })),
      '$lane.tone_equalizer_smoothing': recipe.smoothing,
    });
  } else if (id === 'hsl') {
    const { channel, ...values } = recipe;
    const hsl = await page.evaluate(({ rendition, channel, values }) => {
      const hsl = structuredClone(state.adjustments[rendition].hsl);
      Object.assign(hsl.channels.find(c => c.id === channel).recipe, values);
      return hsl;
    }, { rendition, channel, values });
    await applyChanges(page, rendition, { '$lane.hsl': hsl });
    await page.evaluate(({ channel, values, rendition }) => {
      const ui = hslUI.panels[0];
      ui.channel = channel;
      ui.range = 0;
      hslSync(ui);
      const accepted = state.editDocument.global_adjustments[rendition].hsl.channels.find(c => c.id === channel)?.recipe;
      if (!Object.entries(values).every(([key, value]) => valuesEqual(accepted?.[key], value)))
        throw Error('HSL recipe was not acknowledged.');
    }, { rendition, channel, values });
  } else if (id === 'local') {
    const { selectLocalDraft } = require('../helpers/local-adjustments');
    await setZoom(page, 'fit');
    for (const local of recipe.locals) {
      const id = await selectLocalDraft(page, local.type);
      const { from, to, samples } = recipe.stroke;
      const points = await page.evaluate(async ({ from, to, brush }) => {
        if (brush) Object.assign(selectedMaskLeaf(), brush);
        await ensureGeometryCoordinateMap();
        const box = activePreviewElement().getBoundingClientRect();
        return [from, to].map(([x, y]) => [box.x + x * box.width, box.y + y * box.height]);
      }, { from, to, brush: local.brush });
      await page.mouse.move(...points[0]);
      await page.mouse.down();
      try { await page.mouse.move(...points[1], { steps: samples - 1 }); }
      finally { await page.mouse.up(); }
      await page.waitForFunction(id => !state.localMaskCommitDepth
        && state.editDocument.local_adjustments.some(local => local.id === id), id, { timeout: LIMIT });
      await page.evaluate(async ({ rendition, exposure, saturation }) => {
        const local = structuredClone(selectedLocal());
        Object.assign(local[`${rendition}_grade`], { exposure, saturation });
        if (!await queueEditCommand('update_local', { local }, local.id)) throw Error('Local grade setup was rejected');
      }, { rendition, exposure: local.exposure, saturation: local.saturation });
      await stable(page);
    }
    await setZoom(page, zoom);
  } else if (id === 'retouch') {
    await setZoom(page, 'fit');
    await selectTab(page, 'retouch');
    for (const [i, spot] of recipe.repairs.entries()) {
      if (!await page.evaluate(() => retouchUI.active && retouchUI.mode === 'heal')) await page.locator('#retouch-mode-heal').click();
      const points = await page.evaluate(async ({ spot, size, feather, texture, opacity }) => {
        await ensureGeometryCoordinateMap();
        for (const [key, value] of Object.entries({ size, feather, texture, opacity })) {
          const control = retouchInput(key);
          control.value = String(value);
          control.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const image = activePreviewElement().getBoundingClientRect();
        return [spot.source, spot.destination].map(([fx, fy]) => [image.left + image.width * fx, image.top + image.height * fy]);
      }, { ...recipe, spot });
      for (const point of points) await page.mouse.click(...point);
      await page.waitForFunction(count => state.editDocument.repairs.length > count && !retouchUI.busy, i, { timeout: LIMIT });
      await stable(page);
    }
    await setZoom(page, zoom);
  } else if (id === 'vignette' && await page.locator('#vignette-show-overlay').getAttribute('aria-pressed') === 'true') {
    await page.locator('#vignette-show-overlay').click();
  }
  await stable(page);
  return null;
}

function moduleLane(id, selected) {
  return selected || (id === 'sdr_match' ? 'sdr' : 'hdr');
}
const offMethod = id => isRaw(id) ? 'setting'
  : EYES[id] || ['denoise', 'retouch'].includes(id) ? 'eye' : 'neutral';

async function setModuleEye(page, id, rendition, on) {
  await selectTab(page, id === 'local' ? 'local' : 'global');
  const key = renameLane(EYES[id], rendition);
  const enabled = () => page.evaluate(path => getValueByPath(state.adjustments, resolveAdjustmentPath(path)) !== false, key);
  if (await enabled() !== on) await (await reveal(page, eye(key))).click();
  if (await enabled() !== on) throw Error(`Module eye did not reach the requested state: ${id}`);
}

async function moduleState(page, id, recipe, rendition, zoom, on, snapshots) {
  if (isRaw(id)) return seedRaw(page, id, recipe, on, zoom);
  if (id === 'denoise') return setDenoise(page, on, 'clean_grain');
  if (EYES[id]) {
    await setModuleEye(page, id, rendition, on);
  } else if (id === 'retouch') {
    await bounded(page.evaluate(async on => {
      await commitRetouch(state.editDocument.repairs.map(repair => ({ ...repair, enabled: on })));
    }, on), 'Set repair eyes');
  } else if (id === 'geometry' || id === 'sdr_match') {
    // These have no section eye. The OFF recipe is a genuinely fresh grade,
    // rather than pretending that the geometry or matched values were bypassed.
    await restoreGrade(page, on ? snapshots.seeded : snapshots.defaults, rendition, zoom);
  }
  await selectTab(page);
  await stable(page);
}

async function canvasDrag(page, locator, gesture) {
  const [x, y, dx, dy] = await locator.evaluate((control, gesture) => {
    const rect = control.getBoundingClientRect();
    if (gesture === 'curve') {
      const point = curvePointCanvasPosition([.5, .58]);
      const { width, height } = canvasLogicalSize(control);
      return [rect.left + point.x * rect.width / width, rect.top + point.y * rect.height / height, 0, -rect.height * .16];
    }
    if (gesture === 'wheel') {
      const puck = control.querySelector('.color-wheel-puck').getBoundingClientRect();
      return [puck.left + puck.width / 2, puck.top + puck.height / 2, 12, -8];
    }
    if (gesture === 'hsl-range') {
      const handle = control.querySelector('g[data-hsl-handle="move"][data-range="0"] circle').getBoundingClientRect();
      const x = handle.left + handle.width / 2, y = handle.top + handle.height / 2;
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const angle = Math.atan2(y - cy, x - cx) + Math.PI / 12, radius = Math.hypot(x - cx, y - cy);
      return [x, y, cx + Math.cos(angle) * radius - x, cy + Math.sin(angle) * radius - y];
    }
    throw Error(`Unknown canvas gesture: ${gesture}`);
  }, gesture);
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    for (let i = 1; i <= 9; i++) {
      await page.mouse.move(x + dx * i / 9, y + dy * i / 9);
      await delay(20);
    }
  }
  finally { await page.mouse.up(); }
}

const TIMINGS = [...CLOCKS, 'whole_wait_ms'];
const slider = selector => ({ selector, name: selector.replace(/^#/, ''), type: 'range' });
const button = (selector, name) => ({ selector, name, type: 'click' });

async function ownControls(page, id, rendition, zoom) {
  if (id === 'baseline' || id === 'denoise') return [];
  if (id === 'curves') return [
    { selector: '#curve-editor', name: 'luma.drag', type: 'canvas', gesture: 'curve' },
    button(eye(EYES[id]), 'eye'),
  ];
  if (id === 'geometry') return [{ ...slider('#crop-straighten'), name: 'straighten.drag', geometry: true, draft: true }];
  if (id === 'sdr_match') return [button('#sdr-match-entire', 'entire.click')];
  if (id === 'retouch') return [
    { ...slider('#retouch-size'), tab: 'retouch', repair: true },
    { ...button('#retouch-list button[aria-label^="Hide "]', 'eye'), tab: 'retouch' },
  ];
  if (id === 'raw.cleanup') return [
    { ...slider('#raw-speck-threshold'), raw: true, disclosure: true },
    { ...button('#raw-even-out-specks', 'specks.click'), raw: true, disclosure: true },
    { ...button('#raw-remove-hot-pixels', 'hot-pixels.click'), raw: true, disclosure: true },
  ];
  if (id === 'raw.lens') return [
    { ...button('#lens-distortion', 'distortion.click'), raw: true, disclosure: true, applyRaw: true },
    { ...button('#apply-raw-settings', 'mode-off.apply'), raw: true, disclosure: true, prepLensOff: true },
  ];
  if (id === 'raw.highlights') return [
    { ...slider('#raw-highlight-threshold'), raw: true },
    { ...button('#raw-highlight-bypass', 'eye'), raw: true },
  ];
  const selectors = [...(RANGE[id] || []), ...(id === 'film' && zoom === '100' ? ['#film-scan_sharpening'] : [])]
    .map(s => renameLane(s, rendition))
    .map(s => id === 'bands' && rendition === 'sdr' ? '#sdr-tone-equalizer-band-value' : s);
  const wheel = '[data-wheel="shadows"] .color-wheel-pad';
  const extra = id === 'hsl' ? [{ selector: '#hsl-global-panel .hsl-wheel', name: 'range-with-selection.drag',
    type: 'canvas', gesture: 'hsl-range' }] : id === 'wheels' ? [
    await page.locator(wheel).count() ? { selector: wheel, name: 'shadows-puck.drag', type: 'canvas', gesture: 'wheel' }
      : { ...slider('[data-path="current.color_grading.blending"]'), name: 'blending-fallback.drag' },
  ] : [];
  return [...selectors.map(s => ({ ...slider(s), tab: id === 'local' ? 'local' : 'global',
    selectBand: id === 'bands', target: s === '#hdr-compression-start' ? 300 : null })), ...extra,
    ...(EYES[id] ? [{ ...button(eye(renameLane(EYES[id], rendition)), 'eye'), tab: id === 'local' ? 'local' : 'global' }] : [])];
}

async function performControl(page, measure, row, descriptor) {
  await selectTab(page, descriptor.tab || 'global');
  if (descriptor.disclosure && await page.locator('#raw-settings-toggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#raw-settings-toggle').click();
  }
  if (descriptor.prepLensOff) await page.locator('#lens-mode').selectOption('off');
  if (descriptor.geometry && await page.locator('#rotate-tool-toggle').getAttribute('aria-pressed') !== 'true') {
    await page.locator('#rotate-tool-toggle').click();
  }
  if (descriptor.selectBand) await page.evaluate(() => {
    state.selectedToneEqualizerBand = 2;
    syncToneEqualizerControls();
    drawToneEqualizerEditor();
  });
  if (descriptor.gesture === 'curve') {
    const channel = '[data-curve-channel="luma"]';
    await (await reveal(page, channel)).click();
  }
  if (descriptor.gesture === 'wheel') await (await reveal(page, '#wheel-tab-shadows')).click();
  const showSelection = '#hsl-global-panel [data-hsl-selection]';
  if (descriptor.gesture === 'hsl-range') {
    await (await reveal(page, showSelection)).click();
    await page.waitForFunction(() => document.querySelector('#hsl-selection-overlay')?.complete, null, { timeout: LIMIT });
  }
  if (descriptor.repair) {
    await page.evaluate(() => {
      const repair = state.editDocument.repairs.at(-1);
      if (repair) selectRetouchRepair(repair.id);
    });
  }
  try { return await measure({ ...descriptor, step: row.step }, async locator => {
    if (descriptor.type === 'canvas') await canvasDrag(page, locator, descriptor.gesture);
    else if (descriptor.type === 'range') await pointerDrag(page, locator, descriptor.target);
    else if (descriptor.selector === '#sdr-match-entire') await openMatch(page);
    else await locator.click();
    if (descriptor.applyRaw) await page.locator('#apply-raw-settings').click();
    if (descriptor.geometry) await page.locator('#rotate-apply').click();
    if (descriptor.repair) await page.locator('#retouch-apply').click();
  }); } finally {
    if (descriptor.gesture === 'hsl-range' && await page.locator(showSelection).getAttribute('aria-pressed') === 'true')
      await page.locator(showSelection).click();
  }
}

function timedStep(row, name, kind, state, skipped = null) {
  let target = row.steps.find(s => s.step === name && s.state === state);
  if (!target) row.steps.push(target = step(name, kind, state, skipped));
  return target;
}

async function denoiseUnavailable(page, method) {
  if (method !== 'micro_grain') return null;
  return page.evaluate(() => microGrainUnavailable(state.currentView) || null);
}

async function highlightPeakNits(page) {
  // Read the same finished float pixels used by delivery, before display
  // headroom or compositor encoding can clip the bypassed peak.
  return bounded(page.evaluate(async () => {
    const gpu = state.gpuPreview, session = state.session, lane = state.currentView;
    const edge = requiredProcessingLongEdge(), source = session.source, white = projectReferenceWhiteNits();
    const P = HDRGpuParamLayout.indices, identity = gradeSourceIdentity(lane);
    const adjustments = structuredClone(state.adjustments);
    const proxy = await gpu.loadProxy(session.session_id, lane, edge, geometrySignature(), state.editRevision, identity);
    if (!proxy) throw Error('Highlight peak check could not load the Grade source.');
    const texture = (format, usage) => gpu.device.createTexture({ size: [proxy.width, proxy.height], format, usage });
    const film = texture('rgba16float', GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING);
    let finished, buffer;
    try {
      const delivery = { texture: film };
      const result = await gpu.renderTo(document.createElement('canvas'), session.session_id, lane, adjustments, sampleCurvePoints,
        edge, [], state.editRevision, null, white, source, { identity, delivery, measureOnly: true });
      if (!delivery.params || !(result?.rendered || result?.execution === 'direct')) throw Error('Highlight peak check could not capture the Grade.');
      const params = new Float32Array(delivery.params);
      params[P.TILE_VALID_WIDTH] = params[P.FRAME_WIDTH] = proxy.width;
      params[P.TILE_VALID_HEIGHT] = params[P.FRAME_HEIGHT] = proxy.height;
      params[P.TILE_ORIGIN_X] = params[P.TILE_ORIGIN_Y] = 0;
      const reduce = await gpu.ensurePeakReductionPipeline('finishedPeakReductionMain');
      const peak = (pixels, label) => gpu.runPeakReduction(reduce, pixels, proxy.width, proxy.height,
        params, 'maximum', `audit:${session.session_id}:${state.editRevision}:${label}`);
      if (!adjustments.hdr.highlight_section_enabled) {
        params[P.HIGHLIGHT_COLOR_HANDLING] = 2; // BT.2020 channel maximum, not luminance
        return await peak(film, 'bypass') * white / .18;
      }
      params[P.HIGHLIGHT_ANCHOR] = await peak(film, 'anchor');
      finished = texture('rgba32float', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
      buffer = gpu.createStorageBuffer(params);
      gpu.device.queue.writeBuffer(buffer, 0, params);
      const pipeline = await gpu.device.createRenderPipelineAsync({ layout: gpu.pipelineLayout,
        vertex: { module: gpu.module, entryPoint: 'vertexMain' },
        fragment: { module: gpu.module, entryPoint: 'outputPictureFragmentMain', targets: [{ format: 'rgba32float' }] },
        primitive: { topology: 'triangle-list' } });
      const view = film.createView();
      const group = gpu.bindGraphResources(view, view, { buffer }, view);
      const encoder = gpu.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: finished.createView(), loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      gpu.device.queue.submit([encoder.finish()]);
      params[P.HIGHLIGHT_COLOR_HANDLING] = 2;
      return await peak(finished, 'finished') * white / .18;
    } finally {
      film.destroy();
      finished?.destroy();
      buffer?.destroy();
    }
  }), 'Check Highlight Compression BT.2020 peak');
}

async function auditModule(page, measure, row, cfg, defaults) {
  const { module: id, lane: rendition, recipe } = row;
  const zoom = cfg.zoom;
  const count = isRaw(id) ? 3 : cfg.samples;
  const warmups = isRaw(id) ? 1 : cfg.warmups;
  const denoiseEye = button('#denoise-bypass', 'eye');
  const sample = async (target, descriptor, warm = false) => {
    let measured;
    try { measured = await performControl(page, measure, target, descriptor); }
    catch (error) {
      const reason = `${target.step}/${target.state}: ${error.message || error}`;
      target.errors.push(reason);
      throw Error(reason, { cause: error });
    }
    if (!warm) {
      addSample(target, measured);
      const { selectorMisses, fitMisses, exactReducedMisses, cpuPreparationMisses } = measured.denoisePreparation;
      if (selectorMisses || fitMisses || exactReducedMisses || cpuPreparationMisses) row.denoiseRebuilds++;
    }
    return measured;
  };
  const check = async target => {
    await selectTab(page);
    await stable(page);
    row[target] = await signature(page, true);
    if (id === 'highlight_compression' && rendition === 'hdr') {
      const state = target === 'onSignature' ? 'on' : 'off';
      const peak = (row.highlightPeakNits ||= {})[state] = await highlightPeakNits(page);
      const cap = recipe.hdr['hdr.highlight_compression_target_nits'];
      if (!Number.isFinite(peak) || (state === 'on' ? peak > cap : peak <= cap))
        throw Error(`Highlight Compression ${state}: BT.2020 channel peak ${peak} nits did not ${state === 'on' ? 'stay within' : 'exceed'} ${cap} nits.`);
    }
  };
  const coldEnable = async (name, state, reason = null) => {
    const previous = row.steps.find(s => s.step === name && s.state === state);
    if (previous) { await setDenoise(page, true); return; }
    if (!reason && (await page.evaluate(() => __moduleAudit.preparation())).prepared) reason = 'Preparation already resident before enable.';
    const target = timedStep(row, name, 'cold', state, reason);
    if (!reason) await sample(target, denoiseEye);
    else if (reason === 'Preparation already resident before enable.') await setDenoise(page, true);
  };
  const assertState = async on => {
    const evidence = await page.evaluate(({ id, rendition, on }) => {
      if (state.currentView !== rendition) throw Error(`Expected ${rendition} lane after changing ${id}, got ${state.currentView}`);
      if (id === 'bw' && on && !state.editDocument.global_adjustments[rendition].black_and_white.reds)
        throw Error('B&W ON probe did not retain the authored Reds mix.');
      if (!id.startsWith('raw.')) return null;
      const extra = state.session.metadata.extra;
      return { phases: __moduleAudit.rawPhases.filter(p => p.generation === state.importGeneration),
        lane: state.currentView, lens: extra.lens_correction ?? null, highlight: extra.raw_development?.highlight_reconstruction ?? null,
        preparation: __moduleAudit.preparation() };
    }, { id, rendition, on });
    if (evidence) (row.rawStates ||= {})[on ? 'on' : 'off'] = evidence;
  };
  const coldThenPrime = async on => {
    await assertState(on);
    await setDenoise(page, false, 'clean_grain');
    await coldEnable('cold.denoise.toggle_on', on ? 'on' : 'off');
    await setDenoise(page, false);
  };
  const changeState = async on => {
    await moduleState(page, id, recipe, rendition, zoom, on, { defaults: bypassed, seeded });
    if (id !== 'denoise') await coldThenPrime(on);
    else {
      await prime(page);
      await setDenoise(page, on, 'clean_grain');
    }
  };
  await selectTab(page);
  await restoreGrade(page, defaults, rendition, zoom);
  const skipped = await seed(page, id, recipe, rendition, zoom);
  if (skipped) {
    row.status = 'skipped';
    row.errors.push(skipped);
    return;
  }
  const bypassed = id === 'sdr_match' ? await gradeSnapshot(page) : defaults;
  if (id === 'sdr_match') await openMatch(page);
  if (id === 'retouch') row.microGrainSkipped = await denoiseUnavailable(page, 'micro_grain');
  const seeded = await gradeSnapshot(page);

  if (id === 'denoise') {
    row.methods = {};
    for (const [method, controls] of Object.entries(recipe.methods)) {
      const reason = await denoiseUnavailable(page, method);
      const evidence = row.methods[method] = { recipeHash: recipeHash(controls), skipped: reason };
      const warmOn = timedStep(row, `own.denoise.${method}.toggle_on`, 'own', 'on', reason);
      const warmOff = timedStep(row, `own.denoise.${method}.toggle_off`, 'own', 'on', reason);
      const dial = slider(method === 'micro_grain' ? '#denoise-micro-luminance' : '#denoise-amount');
      const range = timedStep(row, `own.denoise.${method}.amount.drag`, 'own', 'on', reason);
      if (reason) { await coldEnable(`cold.denoise.${method}.toggle_on`, 'on', reason); continue; }
      await restoreGrade(page, defaults, rendition, zoom);
      await seedDenoise(page, controls);
      await selectTab(page);
      evidence.offSignature = await signature(page, true);
      await coldEnable(`cold.denoise.${method}.toggle_on`, 'on');
      evidence.onSignature = await signature(page, true);
      evidence.pixelsChanged = evidence.onSignature !== evidence.offSignature;
      evidence.flags = evidence.pixelsChanged ? [] : ['no_op'];
      if (method === 'clean_grain') {
        row.onSignature = evidence.onSignature;
        row.offSignature = evidence.offSignature;
      }
      await setDenoise(page, false);
      for (let i = -warmups; i < count; i++) {
        await sample(warmOn, denoiseEye, i < 0);
        await sample(warmOff, denoiseEye, i < 0);
      }
      for (let i = -warmups; i < count; i++) {
        await setDenoise(page, true);
        await sample(range, dial, i < 0);
        await seedDenoise(page, controls);
      }
    }
    await restoreGrade(page, defaults, rendition, zoom);
    await seedDenoise(page, recipe.methods.clean_grain);
  } else {
    for (const d of await ownControls(page, id, rendition, zoom)) {
      const label = d.type === 'range' && !d.name.endsWith('.drag') ? d.name + '.drag' : d.name;
      const target = timedStep(row, `own.${id}.${label}`, 'own', 'on');
      for (let i = -warmups; i < count; i++) {
        if (id === 'sdr_match') await restoreGrade(page, bypassed, rendition, zoom);
        await sample(target, d, i < 0);
        await restoreGrade(page, seeded, rendition, zoom);
      }
    }
  }

  if (id === 'baseline') await coldThenPrime(true);
  else if (id !== 'denoise') {
    await changeState(true);
    await check('onSignature');
    // RAW is measured as two blocks. Defer the OFF signature until the
    // OFF block has actually been re-developed.
    if (!isRaw(id)) { await changeState(false); await check('offSignature'); }
  }
  const probePass = async (on, index) => {
    const stateName = on ? 'on' : 'off';
    for (const probe of PROBES) {
      const isDenoise = probe.startsWith('probe.denoise');
      const self = !on && (id === 'tone' && !isDenoise || id === 'denoise' && isDenoise);
      const target = timedStep(row, probe, 'probe', stateName, self ? 'Self-reference: probe belongs to the bypassed module.' : null);
      if (self) continue;
      if (isDenoise) {
        const enable = probe.endsWith('_on');
        await setDenoise(page, !enable, 'clean_grain');
        await sample(target, { ...denoiseEye, denoise: true }, index < 0);
        if (id === 'denoise') await setDenoise(page, on, 'clean_grain');
      } else {
        const key = probe.split('.')[2];
        const selector = '#' + rendition + '-' + key;
        const before = await page.locator(selector).inputValue();
        await sample(target, slider(selector), index < 0);
        // Restore the exact seeded slider value outside the timing window.
        await page.locator(selector).evaluate((el, value) => {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, before);
        await stable(page);
      }
      if (id === 'sdr_match') await changeState(on);
    }
  };
  if (isRaw(id)) {
    for (const on of [true, false]) {
      if (!on) { await changeState(false); await check('offSignature'); }
      for (let i = -warmups; i < count; i++) await probePass(on, i);
    }
  } else if (id === 'baseline') {
    for (let i = -warmups; i < count; i++) await probePass(true, i);
  } else {
    for (let i = -warmups; i < count; i++) {
      for (const on of (i + warmups) % 2 ? [false, true] : [true, false]) {
        await changeState(on);
        await probePass(on, i);
      }
    }
  }
  row.pixelsChanged = id === 'denoise' ? Object.values(row.methods).every(m => m.skipped || m.pixelsChanged)
    : id !== 'baseline' && row.onSignature !== row.offSignature;
  row.status = 'complete';
}

function newModule(id, rendition) {
  const recipe = RECIPES[id];
  return { module: id, lane: rendition, recipe, recipeHash: recipeHash(recipe), offMethod: offMethod(id),
    alternation: isRaw(id) ? 'blocked' : 'interleaved', pixelsChanged: false, loadAverage: os.loadavg(),
    denoiseRebuilds: 0, status: 'pending', errors: [], steps: [], impact: [] };
}

async function runMetadata(page, cfg, photo, file) {
  const details = await page.evaluate(() => {
    const gpu = window.HDRFinisherPerformance.gpuSnapshot();
    const { width, height } = state.session.source;
    return { width, height, dpr: devicePixelRatio, window: `${outerWidth}x${outerHeight}`,
      adapter: [gpu.adapter?.description, gpu.adapter?.vendor, gpu.adapter?.architecture, gpu.adapter?.device]
        .filter(x => x && x !== 'unknown').join(' '),
      previewResolution: state.previewResolutionOverride ? normalizedPreviewResolution() : 'auto' };
  });
  const power = process.env.HDR_FINISHER_POWER_MODE || 'unknown';
  const response = await global.HDRFinisherElectronTestHarness.fetch('/api/library/memory-setting', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw Error(`Could not read the app memory ceiling (HTTP ${response.status})`);
  const { ceilingBytes } = await response.json();
  if (!Number.isFinite(ceilingBytes) || ceilingBytes <= 0) throw Error('The app did not report a valid memory ceiling.');
  return { schema: 'module-impact-v1', audit: path.basename(path.dirname(file)),
    driver: { path: DRIVE, sha256: await shaFile(__filename) },
    machine: { name: os.hostname(), platform: process.platform, chip: os.cpus()[0]?.model.trim() || os.arch(),
      ramGiB: Math.round(os.totalmem() / 1024 ** 3 * 100) / 100, window: process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE || details.window,
      dpr: details.dpr, powerSource: power, powerMode: power, gpuAdapter: details.adapter || 'unreported' },
    observedWindow: details.window,
    app: { version: require('../../desktop/package.json').version, commit: git('rev-parse', 'HEAD'),
      dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')) },
    photo: { role: photo.role, file: photo.file, sha256: photo.sha256, megapixels: details.width * details.height / 1e6 },
    zoom: cfg.zoom, previewResolution: details.previewResolution, appMemoryCeilingMb: mb(ceilingBytes), samples: cfg.samples, warmups: cfg.warmups,
    denoiseProbeMethod: 'clean_grain', startedAt: new Date().toISOString(), durationSec: 0, modules: [],
    noise: { baseline_start: {}, baseline_middle: {}, baseline_end: {}, spread_pct: 0 } };
}

async function photoEvidence(page, { role, file, sha256 }) {
  const megapixels = await page.evaluate(() => state.session.source.width * state.session.source.height / 1e6);
  return { role, file, sha256, megapixels };
}

function saveBaseline(run, row, phase) {
  const key = 'baseline_' + phase;
  run.noise[key] = {};
  if (row.status === 'complete') {
    for (const s of row.steps) run.noise[key][s.step] = Object.fromEntries(CLOCKS.map(clock => [clock, s[clock].median]));
  }
  updateNoiseSpread(run.noise);
}

async function audit() {
  const cfg = options(process.argv);
  if (!cfg) {
    console.log('Usage: grade-module-impact.js [--module <id>[,<id>...] | --all] [--photo typical|large|noisy|<path>] [--zoom fit|100] [--lane hdr|sdr] [--samples N] [--warmup N] [--out <folder>] [--resume]');
    return null;
  }
  const photo = await findPhoto(cfg.photo);
  const token = photo.role === 'path' ? photo.file.replace(/[^\w.-]/g, '_') + '-' + photo.sha256.slice(0, 12) : photo.role;
  fs.mkdirSync(cfg.out, { recursive: true });
  const file = path.join(cfg.out, `module-impact-${token}-${cfg.zoom}.json`);
  const continuation = process.env.HDR_FINISHER_MODULE_AUDIT_CURSOR;
  const cursor = Number(continuation || '0');
  const old = (cfg.resume || continuation !== undefined) && fs.existsSync(file)
    ? validateRun(JSON.parse(fs.readFileSync(file, 'utf8')), file) : null;
  const selectedPhotos = new Map();
  for (const item of cfg.plan) {
    const id = item.split(':')[0];
    const override = cfg.zoom === 'fit' && ['typical', 'large'].includes(photo.role) && RAW_PHOTOS[id];
    if (override) selectedPhotos.set(id, await findPhoto(cfg.photo, override));
  }
  const isComplete = (run, item) => {
    if (!run) return false;
    const [id, phase] = item.split(':');
    return phase ? Boolean(Object.keys(run.noise['baseline_' + phase]).length)
      : run.modules.some(row => row.module === id && row.status === 'complete');
  };
  const power = process.env.HDR_FINISHER_POWER_MODE || 'unknown';
  if (old && (old.driver.sha256 !== await shaFile(__filename) || old.photo.sha256 !== photo.sha256
    || old.zoom !== cfg.zoom || old.samples !== cfg.samples || old.warmups !== cfg.warmups
    || old.machine.platform !== process.platform || old.machine.name !== os.hostname()
    || old.machine.powerMode !== power
    || (process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE && old.machine.window !== process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE)
    || old.modules.some(row => cfg.plan.some(item => item.split(':')[0] === row.module)
      && (row.lane !== moduleLane(row.module, cfg.lane)
        || (row.photo ?? old.photo).sha256 !== (selectedPhotos.get(row.module) || photo).sha256)))) {
    throw Error('Cannot resume: driver, input, lane or measurement conditions changed. Use a fresh --out folder.');
  }
  const first = cfg.plan.findIndex((item, i) => i >= cursor && !isComplete(old, item));
  let failed = process.env.HDR_FINISHER_MODULE_AUDIT_FAILED === '1';
  if (first < 0) {
    console.log('[module audit] All requested modules already complete; nothing to run.');
    if (failed) process.exitCode = 1;
    return null;
  }
  const restart = (index, preserveFailedProfile = false) => {
    if (preserveFailedProfile) process.exitCode = 1;
    return async () => {
      const env = { ...process.env, HDR_FINISHER_MODULE_AUDIT_CURSOR: String(index),
        HDR_FINISHER_MODULE_AUDIT_FAILED: failed ? '1' : '0' };
      delete env.HDR_FINISHER_ELECTRON_TEST_USER_DATA;
      const child = spawn(process.execPath, ['tests/run-in-electron.js', DRIVE, ...process.argv.slice(2)], { stdio: 'inherit', env });
      const [code] = await once(child, 'exit');
      process.exitCode = code || (failed ? 1 : 0);
    };
  };
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const memory = sampler();
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.waitForFunction(() => window.HDRFinisherPerformance?.gpuSnapshot()?.available, null, { timeout: LIMIT });
    await page.evaluate(() => window.HDRFinisherPerformance.enableGpuInstrumentation(true));
    await page.evaluate(installObserve);
    const firstId = cfg.plan[first].split(':')[0];
    const selected = selectedPhotos.get(firstId) || photo;
    const source = old ? selected : photo;
    await openPhoto(page, source, moduleLane(firstId, cfg.lane), cfg.zoom);
    const defaults = await gradeSnapshot(page);
    const fresh = await runMetadata(page, cfg, source, file);
    const changedConditions = old ? Object.keys(fresh.machine).filter(k => old.machine[k] !== fresh.machine[k]) : [];
    if (old && (old.previewResolution !== fresh.previewResolution || old.appMemoryCeilingMb !== fresh.appMemoryCeilingMb
      || changedConditions.length)) {
      throw Error(`Cannot resume: driver, input, lane or measurement conditions changed${changedConditions.length ? ' (' + changedConditions.join(', ') + ')' : ''}. Use a fresh --out folder.`);
    }
    const run = old || fresh;
    if (source.input !== selected.input) {
      saveFile(file, validateRun(run, file));
      return restart(first);
    }
    const start = Date.now(), priorDuration = run.durationSec;
    const measure = measureWith(page, memory);
    const persist = () => {
      run.durationSec = priorDuration + (Date.now() - start) / 1000;
      for (const row of run.modules) {
        row.impact = row.status === 'complete' && row.module !== 'baseline' ? impacts(row, run) : [];
      }
      saveFile(file, validateRun(run, file));
    };
    for (let index = first; index < cfg.plan.length; index++) {
      const [id, phase] = cfg.plan[index].split(':');
      if (isComplete(old, cfg.plan[index])) continue;
      if ((selectedPhotos.get(id) || photo).input !== source.input) return restart(index);
      const row = newModule(id, moduleLane(id, cfg.lane));
      row.photo = await photoEvidence(page, source);
      const moduleStart = performance.now();
      console.log(`[module audit] ${cfg.plan[index]} (${row.lane}, ${row.photo.file})`);
      let interrupted = false;
      try { await auditModule(page, measure, row, cfg, defaults); }
      catch (error) {
        failed = interrupted = true;
        row.status = 'error';
        row.errors.push(error.message || String(error));
        console.error(`[module audit] ${id}: ${row.errors.at(-1)}`);
      }
      finalizeSteps(row);
      const overCeiling = row.steps.filter(s => s.memory_mb.footprint_peak > run.appMemoryCeilingMb);
      if (overCeiling.length) row.errors.push(`App memory ceiling exceeded (${run.appMemoryCeilingMb} MB) in ${overCeiling.map(s => s.step + '/' + s.state).join(', ')}.`);
      if (row.steps.some(s => s.errors.length)) {
        row.status = 'error';
        failed = interrupted = true;
      }
      row.durationSec = (performance.now() - moduleStart) / 1000;
      if (!phase || phase === 'start' || !run.modules.some(item => item.module === id)) {
        run.modules = [...run.modules.filter(item => item.module !== id), row];
      } else if (row.errors.length) {
        run.modules.find(item => item.module === id).errors.push(...row.errors.map(error => `${phase}: ${error}`));
      }
      if (phase) saveBaseline(run, row, phase);
      persist();
      console.log(`[module audit] ${row.status}, ${row.steps.length} steps, ${row.durationSec.toFixed(1)} s → ${file}`);
      if (interrupted && index + 1 < cfg.plan.length) {
        return restart(index + 1, true);
      }
    }
    if (failed) process.exitCode = 1;
    return null;
  } finally {
    await memory.stop();
  }
}

if (require.main === module) {
  const harness = global.HDRFinisherElectronTestHarness;
  if (!harness) {
    console.error('Launch via tests/run-in-electron.js under tools/gpu-run-lock.py.');
    process.exitCode = 2;
  } else {
    audit().catch(error => { console.error(error); process.exitCode = 1; })
      .then(afterShutdown => harness.close({ afterShutdown }))
      .catch(error => { console.error(error); process.exitCode = 1; });
  }
}
