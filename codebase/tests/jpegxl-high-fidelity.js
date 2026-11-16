// Opt-in profile: real UI/preset roundtrip, both delivery renderers and Proof bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { resolveInterpretation } = require('./helpers/resolve-interpretation.js');
const python = require('../tools/lib/platform.cjs').pythonExecutable();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-jxl-fidelity-'));
const report = path.resolve('output/review/jpegxl-high-fidelity');
fs.mkdirSync(report, { recursive: true });
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
    const preset = await post('/api/export-presets?directory=' + encodeURIComponent(path.join(root, 'presets')), {
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
    console.log('High fidelity JPEG XL UI, saved preset, CPU/GPU HDR/SDR own-source fidelity, exact finished/encoded ceilings and reduced/full Proof passed.');
  } finally {
    await post('/api/delivery/preferences', { force_cpu: false }).catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
