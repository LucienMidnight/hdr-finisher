const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const python = require('../tools/lib/platform.cjs').pythonExecutable();
const helper = path.join(__dirname, process.argv.includes('--pixel-cleanup')
  ? 'helpers/raw_pixel_cleanup_fixture.py' : 'helpers/signed_raw_fixture.py');

(async () => {
  const cases = JSON.parse(execFileSync(python, [helper], {encoding: 'utf8', maxBuffer: 12 << 20}));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-signed-raw-'));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL);
    const frame = page.frame({url: /\/library(?:\?|$)/}) || page.mainFrame();
    await frame.waitForFunction(() => window.HDRLibraryGpuRaw);
    const results = [];
    for (const test of cases) {
      const result = await frame.evaluate(async ({meta, mosaic}) => {
        const bytes = Uint8Array.from(atob(mosaic), value => value.charCodeAt(0));
        const output = await HDRLibraryGpuRaw.developRaw({meta, mosaic: bytes, edges: [100000]});
        return {errors: output.errors, planes: output.reduced[100000].planes.map(plane => {
          const values = new Uint8Array(plane);
          let binary = '';
          for (let offset = 0; offset < values.length; offset += 8192)
            binary += String.fromCharCode(...values.subarray(offset, offset + 8192));
          return btoa(binary);
        })};
      }, test);
      assert.deepEqual(result.errors, []);
      if (test.identical_to !== undefined)
        assert.deepEqual(result.planes, results[test.identical_to].planes,
          'Off must keep identical GPU pixels for old and explicitly disabled saved recipes');
      results.push(result);
    }
    const receipt = path.join(folder, 'parity.json');
    fs.writeFileSync(receipt, JSON.stringify({cases, results}));
    console.log(execFileSync(python, [helper, receipt], {encoding: 'utf8'}));
  } finally {
    if (browser) await browser.close();
    fs.rmSync(folder, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
