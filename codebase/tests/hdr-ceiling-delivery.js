// All three HDR codecs, real RAW, CPU/GPU, export and reduced/full Proof.
// Source and its sidecar are restored; no saved project is written.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {promisify} = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const {chromium} = require('playwright');
const python = require('../tools/lib/platform.cjs').pythonExecutable();
const benchmark = process.argv.includes('--benchmark');
const source = path.resolve(process.env.HDR_CEILING_SOURCE || 'output/test-photos/DSC00264.ARW');
const sidecar = source + '.hdrf';
const originalSidecar = fs.existsSync(sidecar) ? fs.readFileSync(sidecar) : null;
const output = path.resolve(process.env.HDR_CEILING_RESULT || 'output/ceiling-followup/delivery.json');
const env = {...process.env, PYTHONPATH: path.resolve('backend')};
const harness = global.HDRFinisherElectronTestHarness;
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-ceiling-delivery-'));
  const browser = await chromium.launch(), page = await browser.newPage();
  const results = [];
  const api = async (route, data, method = 'POST') => {
    const response = await harness.fetch(route, {method, headers: {'Content-Type':'application/json'},
      ...(data === undefined ? {} : {body: JSON.stringify(data)})});
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  try {
    await page.goto(process.env.HDR_FINISHER_URL);
    const grant = await page.evaluate(file => window.hdrFinisherDesktop.grantSourcePath(file), source);
    const opened = await api('/api/desktop/session', {grant:grant.grant});
    const id = opened.session.session_id;
    const edit = await api(`/api/session/${id}/edit-state`, undefined, 'GET');
    Object.assign(edit.document.global_adjustments.hdr, {
      exposure:Number(process.env.HDR_CEILING_EXPOSURE || 3), highlight_section_enabled:true, highlight_compression_target_nits:1000,
    });
    await api(`/api/session/${id}/edit-state?expected_revision=${edit.revision}`, edit.document, 'PUT');
    if (benchmark) {
      await api('/api/delivery/preferences', {force_cpu:false});
      for (let run=0; run<3; run++) {
        const file = path.join(root, `timing-${run}.jpg`);
        await harness.selectExportPath(file);
        const destination = await page.evaluate(() => window.hdrFinisherDesktop.chooseExportPath({extension:'jpg',suggestedName:'timing.jpg'}));
        const start = Date.now();
        const exported = await api(`/api/session/${id}/export`, {format:'jpeg_ultrahdr',quality:90,
          output_path:file,path_grant:destination.grant,
          output_finishing:{resize_mode:'long_edge',long_edge:1600,sharpening:'off'}});
        assert.ok(exported.accepted, JSON.stringify(exported));
        assert.equal(exported.renderer, 'gpu', JSON.stringify(exported));
        results.push({source, warmup:run===0, seconds:(Date.now()-start)/1000});
        console.log(JSON.stringify(results.at(-1)));
      }
      return;
    }
    for (const force_cpu of [false, true]) {
      await api('/api/delivery/preferences', {force_cpu});
      for (const [format, ext] of [['jpeg_ultrahdr','jpg'], ['avif_gain_map','avif'], ['jpegxl_hdr','jxl']]) {
        const renderer = force_cpu ? 'cpu' : 'gpu';
        const file = path.join(root, `${renderer}.${ext}`);
        await harness.selectExportPath(file);
        const destination = await page.evaluate(extension => window.hdrFinisherDesktop.chooseExportPath({extension, suggestedName:'ceiling.'+extension}), ext);
        const settings = {format, quality:90, guarantee_hdr_peak:false,
          output_finishing:{resize_mode:'long_edge', long_edge:1600, sharpening:'off'}};
        const start = Date.now();
        const exported = await api(`/api/session/${id}/export`, {...settings, output_path:file, path_grant:destination.grant});
        assert.ok(exported.accepted, JSON.stringify(exported));
        assert.equal(exported.renderer, renderer, JSON.stringify(exported));
        const row = {format, renderer, target:1000, export_seconds:(Date.now()-start)/1000, proofs:[]};
        const files = [file];
        for (const full_size of [false,true]) {
          const proof = await api(`/api/session/${id}/proof/artifact`, {...settings, full_size, long_edge:800});
          assert.equal(proof.renderer, renderer);
          const response = await harness.fetch(`/api/proof/artifact/${proof.artifact_id}.${ext}`);
          assert.ok(response.ok);
          const proofFile = path.join(root, `${renderer}-${full_size}.${ext}`);
          fs.writeFileSync(proofFile, Buffer.from(await response.arrayBuffer()));
          const identical = fs.readFileSync(file).equals(fs.readFileSync(proofFile));
          if (full_size) assert.ok(identical, 'Full-size Proof equals export');
          row.proofs.push({full_size, identical, width:proof.width, height:proof.height});
          files.push(proofFile);
        }
        const decoded = await execute(python, ['-c',
          'import sys,json;from pathlib import Path;from hdr_finisher.hdr_ceiling import decoded_channel_nits,ENCODING_ALLOWANCE;peaks=[float(decoded_channel_nits(Path(p),sys.argv[1]).max()) for p in sys.argv[2:]];assert all(p<=1000*(1+ENCODING_ALLOWANCE) for p in peaks),peaks;print(json.dumps(peaks))',
          format, ...files], {env});
        row.peaks = JSON.parse(decoded.stdout);
        results.push(row);
        console.log(JSON.stringify(row));
      }
    }
    console.log('PASS: every codec, renderer and Proof size; no files refused.');
  } finally {
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
    await api('/api/delivery/preferences', {force_cpu:false}).catch(()=>{});
    await browser.close();
    fs.rmSync(root, {recursive:true, force:true});
    if (originalSidecar === null) fs.rmSync(sidecar, {force:true});
    else fs.writeFileSync(sidecar, originalSidecar);
  }
})().catch(error => {console.error(error); process.exitCode=1;});
