#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');

const MODULES = Object.freeze([
  'baseline', 'raw.cleanup', 'raw.lens', 'raw.highlights', 'denoise', 'tone',
  'bands', 'curves', 'highlight_compression', 'color', 'wheels', 'hsl', 'bw',
  'vignette', 'detail', 'film', 'local', 'retouch', 'geometry', 'sdr_match',
]);
const PROBES = Object.freeze(['probe.tone.exposure.drag', 'probe.tone.contrast.drag',
  'probe.denoise.toggle_on', 'probe.denoise.toggle_off']);
const FLAGS = ['noise', 'impact', 'slow', 'memory', 'regression', 'no_op'];
const CLOCKS = ['first_feedback_ms', 'settle_ms', 'drained_ms'];
const MEMORY = ['footprint_baseline', 'footprint_peak', 'renderer_peak', 'backend_peak',
  'gpu_process_peak', 'webgpu_allocator_peak'];
const PHOTO_ROLES = ['typical', 'large', 'noisy', 'path'];
const actualPhoto = (m, run) => m.photo ?? run.photo;
const MACHINE_KEYS = ['name', 'platform', 'chip', 'ramGiB', 'window', 'dpr',
  'powerSource', 'powerMode', 'gpuAdapter'];
const MACHINE_ID_KEYS = MACHINE_KEYS.slice(0, 4);

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const recipeHash = value => createHash('sha256').update(canonical(value)).digest('hex');

function quantile(values, q) {
  const index = (values.length - 1) * q;
  const lower = Math.floor(index);
  return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples, min: sorted[0] ?? null, median: sorted.length ? quantile(sorted, .5) : null,
    max: sorted.at(-1) ?? null, iqr: sorted.length ? quantile(sorted, .75) - quantile(sorted, .25) : null };
}

const string = x => typeof x === 'string' && x.trim().length > 0;
const num = x => typeof x === 'number' && Number.isFinite(x);
const nonnegative = x => num(x) && x >= 0;
const integer = x => Number.isInteger(x) && x >= 0;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const boolean = x => typeof x === 'boolean';
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const oneOf = (...xs) => x => xs.includes(x);
const nullable = check => x => x === null || check(x);
const array = check => x => Array.isArray(x) && x.every(check);
const moduleId = oneOf(...MODULES);
const date = x => string(x) && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x));

function need(value, test, where) {
  if (!test(value)) throw Error(`${where}: invalid or missing value`);
}

function fields(row, spec, where) {
  need(row, object, where);
  for (const [key, test] of Object.entries(spec)) need(row[key], test, `${where}.${key}`);
}

function unique(items, key, where) {
  const seen = new Set();
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) throw Error(`${where}: duplicate ${id}`);
    seen.add(id);
  }
}

function validateFinding(row, where) {
  fields(row, {
    schema: oneOf('findings-v1'), id: x => string(x) && /^[A-Z][A-Z0-9]*-[1-9]\d*$/.test(x),
    audit: string, commit: string, area: oneOf('desktop', 'library', 'grade-frontend', 'backend', 'repo', ...MODULES),
    module: nullable(moduleId),
    file: x => string(x) && !/^(?:[A-Za-z]:|[\\/])/.test(x) && !x.split(/[\\/]/).includes('..'),
    line: nullable(x => integer(x) && x > 0), symbol: nullable(string),
    category: oneOf('bug', 'perf', 'tidy', 'hardening', 'docs', 'test'),
    severity: oneOf('high', 'medium', 'low'), confidence: oneOf('confirmed', 'likely', 'suspected'),
    summary: string, evidence: string, felt_impact: nullable(string), output_change: boolean,
    strict_area: boolean, proposed_fix: string, check: string,
    status: oneOf('open', 'fixed', 'deferred', 'needs-steve', 'wontfix', 'duplicate'),
    patch: nullable(string), fix_commit: nullable(string), notes: nullable(string),
  }, where);
}

function validateStats(row, where, count) {
  fields(row, { samples: array(nonnegative), min: nullable(nonnegative), median: nullable(nonnegative),
    max: nullable(nonnegative), iqr: nullable(nonnegative) }, where);
  need(row.samples.length, x => x <= count, `${where}.samples.length`);
  const expected = stats(row.samples);
  for (const key of ['min', 'median', 'max', 'iqr']) need(row[key], x => x === expected[key]
    || (x !== null && expected[key] !== null && Math.abs(x - expected[key]) < 1e-6), `${where}.${key}`);
  if ('p95' in row) need(row.p95, x => row.samples.length >= 10 && nonnegative(x), `${where}.p95`);
}

function validateImpact(row, where) {
  fields(row, {
    probe: oneOf(...PROBES), first_feedback_delta_ms: nullable(num), first_feedback_delta_pct: nullable(num),
    settle_delta_ms: nullable(num), settle_delta_pct: nullable(num), footprint_delta_mb: nullable(num),
    flags: array(oneOf(...FLAGS)),
  }, where);
  unique(row.flags, x => x, `${where}.flags`);
  if (row.flags.includes('no_op')) {
    for (const key of Object.keys(row).filter(key => /_delta_/.test(key))) need(row[key], x => x === null, `${where}.${key}`);
  }
}

function validateRun(run, where = 'module-impact-v1') {
  fields(run, {
    schema: oneOf('module-impact-v1'), audit: string, driver: object, machine: object, app: object,
    photo: object, zoom: oneOf('fit', '100'), previewResolution: x => string(x) || (integer(x) && x > 0),
    samples: x => integer(x) && x > 0, warmups: integer, denoiseProbeMethod: oneOf('clean_grain'),
    startedAt: date, durationSec: nonnegative, modules: array(object), noise: object,
  }, where);
  fields(run.driver, { path: oneOf('tests/performance/grade-module-impact.js'), sha256: hex }, `${where}.driver`);
  fields(run.machine, {
    name: string, platform: string, chip: string, ramGiB: x => num(x) && x > 0, window: x => string(x) && /^\d+x\d+$/.test(x),
    dpr: x => num(x) && x > 0, powerSource: string, powerMode: string, gpuAdapter: string,
  }, `${where}.machine`);
  fields(run.app, { version: string, commit: string, dirty: boolean }, `${where}.app`);
  const photoFields = { file: string, sha256: hex, megapixels: x => num(x) && x > 0 };
  fields(run.photo, { role: oneOf(...PHOTO_ROLES), ...photoFields }, `${where}.photo`);
  fields(run.noise, { baseline_start: object, baseline_middle: object, baseline_end: object, spread_pct: nonnegative }, `${where}.noise`);
  // The README leaves the baseline dictionaries open. Validate probe metrics
  // when present, and allow an empty (not captured) checkpoint.
  for (const phase of ['start', 'middle', 'end']) {
    const checkpoint = run.noise[`baseline_${phase}`];
    for (const probe of PROBES.filter(p => p in checkpoint)) {
      const at = `${where}.noise.baseline_${phase}.${probe}`;
      fields(checkpoint[probe], { first_feedback_ms: nullable(nonnegative), settle_ms: nullable(nonnegative) }, at);
    }
  }
  unique(run.modules, m => m.module, `${where}.modules`);
  run.modules.forEach((m, i) => {
    const at = `${where}.modules[${i}]`;
    fields(m, { module: moduleId, lane: oneOf('hdr', 'sdr'), recipe: object, recipeHash: hex,
      offMethod: oneOf('eye', 'neutral', 'setting'), alternation: oneOf('interleaved', 'blocked'),
      pixelsChanged: boolean, loadAverage: x => array(nonnegative)(x) && x.length === 3,
      denoiseRebuilds: integer, status: string, errors: array(string), steps: array(object), impact: array(object) }, at);
    // Older v1 runs recorded only the run-level photo.
    if ('photo' in m) {
      fields(m.photo, { role: oneOf(...PHOTO_ROLES, 'override'), ...photoFields }, `${at}.photo`);
      if (m.photo.role !== 'override')
        need(m.photo, p => p.role === run.photo.role && p.file === run.photo.file && p.sha256 === run.photo.sha256, `${at}.photo`);
    }
    need(m.recipeHash, x => x === recipeHash(m.recipe), `${at}.recipeHash`);
    unique(m.steps, s => `${s.step}/${s.state}`, `${at}.steps`);
    unique(m.impact, x => x.probe, `${at}.impact`);
    for (const [j, s] of m.steps.entries()) {
      const stepAt = `${at}.steps[${j}]`;
      fields(s, { step: string, kind: oneOf('own', 'probe', 'cold'), state: oneOf('on', 'off'),
        processedLongEdge: integer, route: nullable(string), fallbacks: array(string), signature: nullable(string),
        memory_mb: object, skipped: nullable(string), errors: array(string) }, stepAt);
      const count = s.kind === 'cold' ? 1 : m.alternation === 'blocked' ? 3 : run.samples;
      const reduced = 'reducedSamples' in s ? s.reducedSamples : [];
      need(reduced, x => array(object)(x) && x.length <= count, `${stepAt}.reducedSamples`);
      for (const [k, sample] of reduced.entries()) {
        const sampleAt = `${stepAt}.reducedSamples[${k}]`;
        fields(sample, { route: oneOf('cpu-reduced'), reason: string, requestedLongEdge: integer,
          actualLongEdge: x => integer(x) && x > 0 && x < sample.requestedLongEdge,
          first_feedback_ms: nullable(nonnegative), settle_ms: nonnegative, drained_ms: nonnegative,
          whole_wait_ms: nonnegative, signature: string, memory_mb: object }, sampleAt);
        if ('first_frame_ms' in sample) need(sample.first_frame_ms, nullable(nonnegative), `${sampleAt}.first_frame_ms`);
      }
      const exactCount = count - reduced.length;
      for (const key of CLOCKS) validateStats(s[key], `${stepAt}.${key}`, exactCount);
      for (const key of ['first_frame_ms', 'whole_wait_ms']) {
        if (key in s) validateStats(s[key], `${stepAt}.${key}`, exactCount);
      }
      fields(s.memory_mb, Object.fromEntries(MEMORY.map(key => [key, nullable(nonnegative)])), `${stepAt}.memory_mb`);
      if (s.kind === 'probe') need(s.step, oneOf(...PROBES), `${stepAt}.step`);
      if (m.status === 'complete' && !s.skipped) {
        need(s.processedLongEdge, x => exactCount ? x > 0 : x === 0, `${stepAt}.processedLongEdge`);
        need(s.signature, string, `${stepAt}.signature`);
        for (const key of ['settle_ms', 'drained_ms']) need(s[key].samples.length, x => x === exactCount, `${stepAt}.${key}.samples.length`);
      }
    }
    for (const [j, entry] of m.impact.entries()) {
      validateImpact(entry, `${at}.impact[${j}]`);
      const pair = m.steps.filter(s => s.kind === 'probe' && s.step === entry.probe && !s.skipped);
      need(pair.length, x => x === 2, `${at}.impact[${j}].paired steps`);
    }
  });
  return run;
}

const med = (step, clock) => step?.[clock]?.median ?? null;
const difference = (a, b) => a === null || b === null ? null : a - b;
const percent = (delta, reference) => delta === null || !reference ? null : 100 * delta / reference;
const spread = xs => xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs);

function probeSpread(noise, probe, clock) {
  return spread(['start', 'middle', 'end'].map(phase => noise[`baseline_${phase}`]?.[probe]?.[clock]).filter(num));
}

function updateNoiseSpread(noise) {
  const values = PROBES.flatMap(probe => CLOCKS.slice(0, 2).map(clock => {
    const medians = ['start', 'middle', 'end'].map(phase => noise[`baseline_${phase}`]?.[probe]?.[clock]).filter(num);
    return percent(spread(medians), stats(medians).median) ?? 0;
  }));
  noise.spread_pct = Math.max(0, ...values);
}

function tolerance(reference, noise, probe, clock) {
  // Older peers can supply the documented single spread percentage without
  // detailed checkpoints. Use the specific probe/clock when available.
  const detailed = ['start', 'middle', 'end'].some(phase => num(noise[`baseline_${phase}`]?.[probe]?.[clock]));
  return Math.max(15, reference * .1, detailed ? probeSpread(noise, probe, clock) : reference * noise.spread_pct / 100);
}

function isSlow(step, zoom) {
  return (zoom === 'fit' && med(step, 'settle_ms') > 1000)
    || ['whole_wait_ms', ...CLOCKS.slice(0, 2)].some(clock => med(step, clock) > 10_000);
}

function impacts(m, run) {
  return PROBES.flatMap(probe => {
    const on = m.steps.find(s => s.step === probe && s.state === 'on');
    const off = m.steps.find(s => s.step === probe && s.state === 'off');
    if (!on || !off || on.skipped || off.skipped || on.errors.length || off.errors.length
      || !on.settle_ms.samples.length || !off.settle_ms.samples.length) return [];
    const f = med(off, 'first_feedback_ms');
    const s = med(off, 'settle_ms');
    const noOp = !m.pixelsChanged;
    const fd = noOp ? null : difference(med(on, 'first_feedback_ms'), f);
    const sd = noOp ? null : difference(med(on, 'settle_ms'), s);
    const md = noOp ? null : difference(on.memory_mb.footprint_peak, off.memory_mb.footprint_peak);
    const noise = actualPhoto(m, run).sha256 === run.photo.sha256 ? run.noise : { spread_pct: 0 };
    const qualified = [[fd, f, 'first_feedback_ms', 30], [sd, s, 'settle_ms', 100]]
      .filter(([delta]) => delta !== null)
      .map(([delta, before, clock, floor]) => ({ noise: Math.abs(delta) <= tolerance(before, noise, probe, clock),
        impact: delta > floor && delta > before * .25 }));
    const flags = noOp ? ['no_op'] : [];
    if (!noOp && qualified.length && qualified.every(x => x.noise)) flags.push('noise');
    if (!noOp && qualified.some(x => !x.noise && x.impact)) flags.push('impact');
    if (isSlow(on, run.zoom) || isSlow(off, run.zoom)) flags.push('slow');
    if (md > 300) flags.push('memory');
    return [{ probe, first_feedback_delta_ms: fd, first_feedback_delta_pct: percent(fd, f),
      settle_delta_ms: sd, settle_delta_pct: percent(sd, s), footprint_delta_mb: md, flags }];
  });
}

const IMPACT_FILE = /^module-impact-.+-(?:100|fit)\.json$/;
const PACKAGE_FILE = /^findings-([A-Z][A-Z0-9]*)\.jsonl$/;
function entries(dir) { return fs.readdirSync(dir).sort(); }
function parse(file, read) {
  try { return read(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw Error(`${file}: ${error.message}`); }
}
function loadRuns(dir) {
  return entries(dir).filter(name => IMPACT_FILE.test(name)).map(name => ({
    name, run: parse(path.join(dir, name), body => validateRun(JSON.parse(body))),
  }));
}
function loadFindings(...dirs) {
  let sources = new Map();
  for (const dir of new Set(dirs)) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of entries(dir).filter(x => PACKAGE_FILE.test(x) || x === 'findings.jsonl')) {
      // The merged file is an output, not an additional package source.
      const file = path.join(dir, name);
      if (sources.has(name) && fs.readFileSync(sources.get(name), 'utf8') !== fs.readFileSync(file, 'utf8')) {
        if (name !== 'findings.jsonl') throw Error(`Conflicting copies of ${name}`);
      }
      sources.set(name, file);
    }
  }
  if (sources.size > 1) sources.delete('findings.jsonl');
  const findings = [...sources].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, file]) => parse(file, body =>
    body.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      const where = `line ${index + 1}`;
      let row;
      try { row = JSON.parse(line); } catch (error) { throw Error(`${where}: ${error.message}`); }
      validateFinding(row, where);
      const pkg = PACKAGE_FILE.exec(name)?.[1];
      if (pkg) need(row.id, id => id.startsWith(pkg + '-'), `${where}.id (package ${pkg})`);
      return [row];
    }),
  ));
  unique(findings, r => r.id, 'findings');
  return findings.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function compatible(current, previous) {
  return MACHINE_KEYS.every(key => current.machine[key] === previous.machine[key])
    && current.photo.sha256 === previous.photo.sha256 && current.zoom === previous.zoom
    && current.previewResolution === previous.previewResolution && current.denoiseProbeMethod === previous.denoiseProbeMethod;
}
function machineId(run) {
  return JSON.stringify(MACHINE_ID_KEYS.map(key => run.machine[key]));
}

function requireSameMachine(runs, prior) {
  if (!prior.length) throw Error('--compare folder has no module-impact runs');
  if (!runs.length) throw Error('--run folder has no module-impact runs to compare');
  if (new Set([...runs, ...prior].map(({ run }) => machineId(run))).size !== 1) {
    throw Error('Cross-machine comparison refused. Both folders must contain runs from the same machine.');
  }
}
function regressions(run, prior) {
  if (!prior) return [];
  const results = [];
  for (const m of run.modules) {
    const before = prior.modules.find(x => x.module === m.module && x.lane === m.lane
      && actualPhoto(x, prior).sha256 === actualPhoto(m, run).sha256
      && x.recipeHash === m.recipeHash && x.alternation === m.alternation && x.offMethod === m.offMethod
      && x.status === 'complete');
    if (!before || m.status !== 'complete' || (m.module !== 'baseline' && (!m.pixelsChanged || !before.pixelsChanged))) continue;
    for (const step of m.steps.filter(x => !x.skipped && !x.errors.length)) {
      const peer = before.steps.find(x => x.step === step.step && x.state === step.state
        && x.processedLongEdge === step.processedLongEdge && !x.skipped && !x.errors.length);
      for (const clock of CLOCKS.slice(0, 2)) {
        const old = med(peer, clock);
        const next = med(step, clock);
        if (old === null || next === null || next - old <= Math.max(
          tolerance(old, run.noise, step.step, clock), tolerance(old, prior.noise, step.step, clock))) continue;
        results.push({ module: m.module, step: step.step, state: step.state, clock, before: old, after: next });
        m.impact.find(x => x.probe === step.step && !x.flags.includes('regression'))?.flags.push('regression');
      }
    }
  }
  return results;
}

const cell = x => String(x ?? '—').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const row = (...xs) => '| ' + xs.map(cell).join(' | ') + ' |';
const rounded = n => n === null ? '—' : n.toFixed(1);
const delta = (ms, pct) => pct === null ? rounded(ms) : `${rounded(ms)} (${rounded(pct)}%)`;

function markdown(runs, findings, comparison, result) {
  const lines = ['# Grade module audit', '',
    'Times are medians in ms. Deltas are module ON minus OFF. Memory is the sampled app footprint peak in MB.',
    'Drain time is recorded in the JSON and does not trigger a flag.', ''];
  for (const {name, run} of runs) {
    lines.push(`## ${run.photo.file} at ${run.zoom === 'fit' ? 'Fit' : '100%'}`, '',
      `${run.machine.name}, ${run.machine.window} at ${run.machine.dpr}×, ${run.machine.powerSource}, app ${run.app.version} (${run.app.commit}${run.app.dirty ? ', dirty checkout' : ''}).`,
      `Baseline spread ${rounded(run.noise.spread_pct)}% (${['start', 'middle', 'end'].filter(k => Object.keys(run.noise['baseline_' + k]).length).join(', ') || 'not captured'}). [Run JSON](${name})`, '',
      row('Module / lane', 'Probe', 'First feedback Δ ms (%)', 'Settle Δ ms (%)', 'Peak Δ MB', 'Flags'),
      row('---', '---', '---:', '---:', '---:', '---'));
    for (const m of run.modules) {
      const photo = actualPhoto(m, run);
      const label = `${m.module} / ${m.lane}${photo.sha256 === run.photo.sha256 ? '' : ' / ' + photo.file}`;
      if (m.status !== 'complete' || !m.impact.length) {
        lines.push(row(label, m.status === 'complete' ? 'No paired probes' : m.status, '—', '—', '—',
          m.status === 'complete' && m.module !== 'baseline' && !m.pixelsChanged ? 'no_op' : null));
      }
      for (const p of m.impact) lines.push(row(label, p.probe, delta(p.first_feedback_delta_ms, p.first_feedback_delta_pct),
        delta(p.settle_delta_ms, p.settle_delta_pct), rounded(p.footprint_delta_mb), p.flags.join(', ') || '—'));
    }
    const frames = run.modules.flatMap(m => m.steps.filter(s => med(s, 'first_frame_ms') !== null)
      .map(s => row(`${m.module} / ${m.lane}`, s.step, s.state,
        rounded(med(s, 'first_frame_ms')), rounded(med(s, 'first_feedback_ms')))));
    if (frames.length) lines.push('', '### First presented frames', '',
      row('Module / lane', 'Step', 'State', 'First frame ms', 'First feedback ms'),
      row('---', '---', '---', '---:', '---:'), ...frames);
    lines.push('', '### Exceptions', '');
    const exceptions = run.modules.flatMap(m => [
      ...m.errors.map(e => `- ${m.module} — ${cell(e)}`),
      ...m.steps.flatMap(s => [s.skipped, ...s.errors,
        ...(s.reducedSamples || []).map(sample => `CPU fallback at ${sample.actualLongEdge} px — ${sample.reason}`),
        ...(isSlow(s, run.zoom) ? [`slow (settle ${rounded(med(s, 'settle_ms'))} ms)`] : [])]
        .filter(Boolean).map(e => `- ${m.module} / ${s.step} / ${s.state} — ${cell(e)}`)),
    ]);
    lines.push(...(exceptions.length ? exceptions : ['None.']), '');
    if (comparison) {
      const { matched, rows } = result.get(name);
      lines.push('### Same-machine regressions', '');
      if (!matched) lines.push('No prior run matched this photo, zoom and machine conditions.');
      else if (!rows.length) lines.push('None detected among comparable steps.');
      else for (const r of rows) lines.push(`- ${r.module} / ${r.step} / ${r.state} / ${r.clock} — ${rounded(r.before)} → ${rounded(r.after)} ms`);
      lines.push('');
    }
    lines.push('### Flags', '');
    const flags = run.modules.flatMap(m => {
      const items = m.impact.flatMap(p => p.flags.map(flag => `- ${flag} — ${m.module} / ${p.probe}`));
      if (m.status === 'complete' && m.module !== 'baseline' && !m.pixelsChanged && !m.impact.length) items.push(`- no_op — ${m.module}`);
      items.push(...m.steps.filter(s => isSlow(s, run.zoom) && !m.impact.some(p => p.probe === s.step))
        .map(s => `- slow — ${m.module} / ${s.step} / ${s.state}`));
      return items;
    });
    lines.push(...(flags.length ? flags : ['None.']), '');
  }
  lines.push('## Code findings', '');
  if (!findings.length) lines.push('No findings supplied.');
  else {
    lines.push(`${findings.length} findings. [Merged evidence](findings.jsonl)`, '',
      row('Group', 'Value', 'Count'), row('---', '---', '---:'));
    for (const group of ['package', 'category', 'severity', 'status']) {
      const counts = new Map();
      for (const f of findings) {
        const key = group === 'package' ? f.id.split('-')[0] : f[group];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const key of [...counts.keys()].sort()) lines.push(row(group, key, counts.get(key)));
    }
    lines.push('',
      row('ID', 'Status', 'Severity', 'Category', 'Area', 'Summary'), row('---', '---', '---', '---', '---', '---'));
    for (const f of findings) lines.push(row(f.id, f.status, f.severity, f.category, f.area, f.summary));
  }
  return lines.join('\n') + '\n';
}

function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    run: { type: 'string' }, compare: { type: 'string' }, write: { type: 'string' }, help: { type: 'boolean' },
  }});
  const usage = 'Usage: node tools/audit-summary.cjs --run <folder> [--compare <prior folder>] [--write <folder>]';
  if (values.help) return console.log(usage);
  if (!values.run) throw Error(usage);
  const runDir = path.resolve(values.run), writeDir = values.write && path.resolve(values.write);
  const runs = loadRuns(runDir);
  const findings = loadFindings(runDir, writeDir);
  if (!runs.length && !findings.length && ![runDir, writeDir].some(dir => dir && fs.existsSync(dir)
    && entries(dir).some(name => PACKAGE_FILE.test(name) || name === 'findings.jsonl'))) throw Error('No audit files found');
  const prior = values.compare ? loadRuns(path.resolve(values.compare)) : [];
  if (values.compare) requireSameMachine(runs, prior);
  const result = new Map();
  for (const { name, run } of runs) {
    for (const m of run.modules) if (m.status === 'complete' && m.module !== 'baseline') m.impact = impacts(m, run);
    const matched = prior.find(x => x.name === name && compatible(run, x.run))
      || prior.find(x => compatible(run, x.run));
    result.set(name, { matched, rows: regressions(run, matched?.run) });
  }
  const summary = markdown(runs, findings, values.compare, result);
  if (!writeDir) return console.log(summary.trimEnd());
  if (values.compare && writeDir === path.resolve(values.compare)) {
    throw Error('--write must be separate from the comparison folder');
  }
  fs.mkdirSync(writeDir, { recursive: true });
  fs.writeFileSync(path.join(writeDir, 'findings.jsonl'), findings.map(f => JSON.stringify(f) + '\n').join(''));
  for (const { name, run } of runs) fs.writeFileSync(path.join(writeDir, name), JSON.stringify(run, null, 2) + '\n');
  fs.writeFileSync(path.join(writeDir, 'summary.md'), summary);
  console.log(`Validated ${runs.length} run(s) and ${findings.length} finding(s). Wrote ${path.join(writeDir, 'summary.md')}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { MODULES, PROBES, MEMORY, CLOCKS, canonical, recipeHash, stats, impacts, updateNoiseSpread, validateRun, validateFinding, main };
