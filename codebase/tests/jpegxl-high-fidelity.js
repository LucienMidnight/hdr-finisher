// Opt-in profile: real UI/preset roundtrip, both delivery renderers and Proof bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { resolveInterpretation } = require('./helpers/resolve-interpretation.js');
const python = require('../tools/lib/platform.cjs').pythonExecutable();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-jxl-fidelity-'));
const report = path.resolve('output/review/jpegxl-high-fidelity');
fs.mkdirSync(report, { recursive: true });
// --native-photo NAME is the same production export/Proof path at original
// dimensions, with an independent census of the complete Electron tree.
async function nativePhoto(page, post, root, name) {
  const { photosRoot } = require('./helpers/photos-root.cjs');
  const crypto = require('node:crypto');
  const source = path.join(photosRoot(), 'HDR Test Images', name);
  const manifest = require('./test-photos.manifest.json').files.find(item => item.name === name);
  assert(manifest, 'Native qualification requires an approved original');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), manifest.sha256);
  const photo = path.join(root, name);
  fs.linkSync(source, photo);
  const samples = [], errors = [], stages = [];
  let phase = 'import', pending = '';
  const sampler = spawn(python, [path.resolve('tools/measure-library-processes.py'), process.env.HDR_FINISHER_ELECTRON_MAIN_PID, '.2']);
  sampler.stderr.on('data', chunk => errors.push(String(chunk)));
  sampler.stdout.on('data', chunk => {
    pending += chunk;
    for (;;) {
      const end = pending.indexOf('\n'); if (end < 0) break;
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line) samples.push({ ...JSON.parse(line), phase });
    }
  });
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.setInputFiles('#file-input', photo);
    await resolveInterpretation(page);
    await page.waitForFunction(() => state.session && !state.importInProgress, null, { timeout: 180000 });
    const session = await page.evaluate(async () => {
      state.adjustments.hdr.highlight_section_enabled = true;
      state.adjustments.hdr.highlight_compression_mode = 'fixed_cap';
      state.adjustments.hdr.highlight_compression_target_nits = 1000;
      markGlobalEditDirty();
      await syncGlobalEditState();
      return state.session;
    });
    for (const forceCpu of [true, false]) {
      await post('/api/delivery/preferences', { force_cpu: forceCpu });
      for (const format of ['jpegxl_hdr', 'sdr_jpegxl']) {
        const output = path.join(root, `${forceCpu}-${format}.jxl`);
        await global.HDRFinisherElectronTestHarness.selectExportPath(output);
        const grant = await page.evaluate(() => desktop.chooseExportPath({ extension: 'jxl', suggestedName: 'native.jxl' }));
        const settings = { format, jpegxl_high_fidelity: true, metadata_policy: 'none', edit_revision: null };
        phase = `${forceCpu ? 'cpu' : 'gpu-request'}-${format}`;
        const started = Date.now();
        const result = await post(`/api/session/${session.session_id}/export`, { ...settings, output_path: output, path_grant: grant.grant });
        stages.push({ phase, seconds: (Date.now() - started) / 1000, ...result, bytes: fs.existsSync(output) ? fs.statSync(output).size : null });
        assert(result.accepted, JSON.stringify(result));
        if (format === 'jpegxl_hdr') {
          phase += '-proof-full';
          const began = Date.now();
          const proof = await post(`/api/session/${session.session_id}/proof/artifact`, { ...settings, full_size: true, force: true });
          const response = await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jxl`, page.url()).href);
          assert(response.ok());
          assert(fs.readFileSync(output).equals(await response.body()), 'Native full-size Proof/export byte identity');
          stages.push({ phase, seconds: (Date.now() - began) / 1000, ...proof });
        }
      }
    }
  } finally {
    sampler.kill();
    await new Promise(resolve => sampler.once('close', resolve));
    const summary = { photo: name, stages, observerErrors: errors,
      peakBytes: Math.max(0, ...samples.map(s => s.totalBytes)),
      minimumAvailableBytes: Math.min(...samples.map(s => s.availableBytes)),
      stagePeaks: Object.fromEntries([...new Set(samples.map(s => s.phase))].map(p => [p, Math.max(...samples.filter(s => s.phase === p).map(s => s.totalBytes))])),
      samples: samples.length };
    fs.writeFileSync(path.join(report, `app-native-${name}.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert(summary.peakBytes <= 2500000000, `Default whole-app ceiling exceeded: ${summary.peakBytes}`);
    assert(samples.every(s => s.availableBytes >= s.systemReserveBytes), 'Existing system reserve was breached');
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const post = async (route, data) => {
    const response = await page.request.post(new URL(route, page.url()).href, { data, timeout: 180000 });
    const value = await response.json();
    assert(response.ok(), JSON.stringify(value));
    return value;
  };
  try {
    const native = process.argv.indexOf('--native-photo');
    if (native >= 0) {
      await nativePhoto(page, post, root, process.argv[native + 1]);
      return;
    }
    const photo = path.join(root, 'fixture.tiff');
    execFileSync(python, ['-c', 'import numpy as np,tifffile,sys; y,x=np.mgrid[:320,:480].astype(np.float32); v=.015+1.2*(x/479)**2+.04*np.sin(y/5)**2; a=np.stack([v,v*.87,v*.65],axis=-1); a[80:90,200:202]=[3,.2,.03]; tifffile.imwrite(sys.argv[1],a,photometric="rgb")', photo]);
    await page.goto(process.env.HDR_FINISHER_URL);
    await page.setInputFiles('#file-input', photo);
    await resolveInterpretation(page, { primaries: 'linear_acescg' });
    await page.waitForFunction(() => viewerState().status === 'ready', null, { timeout: 120000 });
    await page.evaluate(async () => {
      state.adjustments.hdr.highlight_section_enabled = true;
      state.adjustments.hdr.highlight_compression_mode = 'fixed_cap';
      state.adjustments.hdr.highlight_compression_target_nits = 1000;
      markGlobalEditDirty();
      if (!await syncGlobalEditState()) throw Error('Grade did not settle');
    });
    await page.locator('[data-workflow-tab="export"]').click();
    await page.selectOption('#export-format', 'jpegxl_hdr');
    assert.equal(await page.isChecked('#jpegxl-high-fidelity'), false);
    assert.equal(await page.inputValue('#export-quality'), '90');
    await page.selectOption('#export-preset', 'high_fidelity');
    assert(await page.isChecked('#jpegxl-high-fidelity'));
    assert(await page.isDisabled('#export-quality'));
    assert.match(await page.textContent('#export-resolved-encoding'), /Lossless 12-bit/);
    for (const width of [1408, 1100]) {
      await page.setViewportSize({ width, height: 794 });
      await page.locator('#jpegxl-high-fidelity').scrollIntoViewIfNeeded();
      const box = await page.locator('#jpegxl-fidelity-settings').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1);
      await page.screenshot({ path: path.join(report, `export-${width}.png`) });
    }
    await page.setViewportSize({ width: 1408, height: 794 });
    // A saved preset is the same object used by Export, Quick export and batch.
    const presetDirectory = await page.evaluate(async () => state.appPreferences?.folders?.presetSave || await desktop.getDefaultPresetDirectory());
    const preset = await post('/api/export-presets?directory=' + encodeURIComponent(presetDirectory), {
      id: 'jxl-fidelity-test', name: 'High fidelity test', versions: [
        { name: 'HDR', quality_preset: 'high_fidelity', settings: await page.evaluate(() => currentExportSettings()) },
        { name: 'SDR', settings: { format: 'sdr_jpegxl', quality: 10, dithering: 'auto', jpegxl_high_fidelity: true } },
      ],
    });
    assert(preset.versions.every(v => v.settings.jpegxl_high_fidelity && v.settings.quality === 100 && v.settings.dithering === 'off'));
    const deliveries = [];
    const id = await page.evaluate(() => state.session.session_id);
    for (const forceCpu of [false, true]) {
      await post('/api/delivery/preferences', { force_cpu: forceCpu });
      for (const version of preset.versions) {
        const output = path.join(root, `${version.name}-${forceCpu ? 'cpu' : 'gpu'}.jxl`);
        await global.HDRFinisherElectronTestHarness.selectExportPath(output);
        const grant = await page.evaluate(() => desktop.chooseExportPath({ extension: 'jxl', suggestedName: 'fidelity.jxl' }));
        const settings = { ...version.settings, metadata_policy: 'none', edit_revision: null };
        const started = Date.now();
        const result = await post(`/api/session/${id}/export`, { ...settings, output_path: output, path_grant: grant.grant });
        assert(result.accepted, JSON.stringify(result));
        assert.equal(result.renderer, forceCpu ? 'cpu' : 'gpu');
        deliveries.push({ file: path.basename(output), renderer: result.renderer, bytes: fs.statSync(output).size, exportMs: Date.now() - started });
        if (version.name === 'HDR') {
          for (const fullSize of [true, false]) {
            const proof = await post(`/api/session/${id}/proof/artifact`, { ...settings, full_size: fullSize, long_edge: 256 });
            const payload = await page.request.get(new URL(`/api/proof/artifact/${proof.artifact_id}.jxl`, page.url()).href);
            assert(payload.ok());
            const proofPath = path.join(root, `proof-${forceCpu}-${fullSize}.jxl`);
            fs.writeFileSync(proofPath, await payload.body());
            if (fullSize) assert(fs.readFileSync(output).equals(fs.readFileSync(proofPath)), 'Full-size Proof/export byte identity');
            else assert.equal(Math.max(proof.width, proof.height), 256);
          }
        }
      }
    }
    const metrics = JSON.parse(execFileSync(python, [path.join(__dirname, 'helpers/jpegxl_fidelity_check.py'), root], {
      env: { ...process.env, PYTHONPATH: path.resolve('backend') }, encoding: 'utf8', timeout: 180000,
    }));
    fs.writeFileSync(path.join(report, 'delivery.json'), JSON.stringify({ deliveries, metrics }, null, 2));
    await page.selectOption('#export-preset', 'web_default');
    assert.equal(await page.isChecked('#jpegxl-high-fidelity'), false);
    assert.equal(await page.isDisabled('#export-quality'), false);
    await page.selectOption('#export-preset', 'high_fidelity');
    await page.selectOption('#export-format', 'sdr_png');
    assert.equal(await page.inputValue('#export-preset'), 'web_default');
    assert.equal(await page.isChecked('#jpegxl-high-fidelity'), false);
    // Reopen the saved preset in the actual Export UI, then deliver it from
    // Quick export through the normal batch worker and desktop folder grant.
    const document = await page.evaluate(() => state.editDocument);
    fs.writeFileSync(photo + '.hdrf', JSON.stringify({ format: 'HDR Finisher Photo', schema_version: 1,
      photo_id: 'jxl-native-fixture', grade: document, marks: {}, albums: [] }));
    await page.reload();
    await page.waitForFunction(() => window.batchExport);
    await page.evaluate(photo => batchExport.open([photo], { fromLibrary: true }), photo);
    await page.locator('#batch-preset-list .batch-preset').filter({ hasText: 'High fidelity test' }).click();
    await page.waitForFunction(() => document.getElementById('batch-version-select').options.length === 2);
    assert(await page.isChecked('#jpegxl-high-fidelity'));
    await page.selectOption('#batch-version-select', '1');
    assert(await page.isChecked('#jpegxl-high-fidelity'));
    assert.equal(await page.inputValue('#export-format'), 'sdr_jpegxl');
    await page.evaluate(photo => batchExport.quick([photo]), photo);
    const dialog = page.getByRole('dialog', { name: 'Quick export…', exact: true });
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await page.waitForFunction(() => batchExport.activity()?.state === 'finished', null, { timeout: 120000 });
    const batch = await page.evaluate(() => batchExport.activity());
    assert.equal(batch.results.length, 2, JSON.stringify(batch));
    assert(batch.results.every(result => ['exported', 'renamed'].includes(result.outcome)), JSON.stringify(batch));
    const batchMetrics = JSON.parse(execFileSync(python, [path.join(__dirname, 'helpers/jpegxl_fidelity_check.py'), root], {
      env: { ...process.env, PYTHONPATH: path.resolve('backend') }, encoding: 'utf8', timeout: 180000,
    }));
    fs.writeFileSync(path.join(report, 'delivery.json'), JSON.stringify({ deliveries, metrics, batch, batchMetrics }, null, 2));
    console.log('High fidelity JPEG XL UI, Export/Quick preset roundtrip, batch, CPU/GPU HDR/SDR fidelity, ceilings and reduced/full Proof passed.');
  } finally {
    await post('/api/delivery/preferences', { force_cpu: false }).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
