const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 4200);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 2800);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://127.0.0.1:8798', { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#file-input', ensureLargeNoisySource(width, height));
    await page.waitForFunction(() => state.session?.session_id && viewerState().status === 'ready', null,
      { timeout: 600000 });
    await page.waitForFunction(() => !state.gpuDraftInFlight && state.gpuPreview?.available, null,
      { timeout: 600000 });
    const steps = [];
    for (const [name, tier, zoom] of [['fit-1k', '1024', null], ['zoom50-1k', '1024', 50],
      ['zoom100-1k', '1024', 100], ['fit-2k', '2048', null], ['zoom50-2k', '2048', 50],
      ['zoom100-2k', '2048', 100], ['fit-4k', '4096', null], ['zoom100-4k', '4096', 100],
      ['fit-full', 'full', null], ['zoom100-full', 'full', 100]]) {
      const started = Date.now();
      await page.evaluate(({ tier, zoom }) => {
        applyPreviewResolution(tier);
        if (zoom === null) setZoomMode('fit'); else setCustomZoom(zoom);
      }, { tier, zoom });
      await page.waitForFunction(() => viewerState().status === 'ready', null, { timeout: 600000 });
      const data = await page.evaluate(async () => {
        const id = state.session.session_id;
        return { edge: state.acceptedPresentation?.processedLongEdge, status: viewerStatusLabel(),
          generation: state.acceptedPresentation?.generation, transport: state.acceptedPresentation?.transport,
          sourceMip: (await (await fetch(`/api/session/${id}/diagnostics`)).json()).render_cache.source_mip,
          gpu: state.gpuPreview?.diagnosticsSnapshot?.() };
      });
      steps.push({ name, tier, zoom, ms: Date.now() - started, edge: data.edge,
        status: data.status, generation: data.generation, transport: data.transport,
        sourceMip: data.sourceMip, stages: data.gpu?.stages?.slice(-8) || [] });
      console.log(`${name}: ${steps.at(-1).ms}ms ${data.edge}px ${data.transport}`);
      if (name === 'zoom100-2k' || name === 'zoom100-full') {
        const beforeGeneration = await page.evaluate(() => state.previewGeneration.hdr);
        const editStarted = Date.now();
        await page.evaluate((value) => {
          const control = document.querySelector('#hdr-exposure');
          control.value = value;
          control.dispatchEvent(new Event('input', { bubbles: true }));
        }, name === 'zoom100-2k' ? '0.25' : '0.5');
        await page.waitForFunction((oldGeneration) => state.previewGeneration.hdr > oldGeneration
          && viewerState().status === 'ready'
          && state.acceptedPresentation?.generation === state.previewGeneration.hdr,
        beforeGeneration, { timeout: 600000 });
        const edit = await page.evaluate(() => ({ edge: state.acceptedPresentation?.processedLongEdge,
          transport: state.acceptedPresentation?.transport }));
        steps.push({ name: `${name}-exposure`, tier, zoom, ms: Date.now() - editStarted, ...edit });
        console.log(`${name}-exposure: ${steps.at(-1).ms}ms ${edit.edge}px ${edit.transport}`);
      }
    }
    const output = process.argv.includes('--output')
      ? process.argv[process.argv.indexOf('--output') + 1]
      : path.join(__dirname, '../../output/performance/phase3-manual-baseline.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ fixture: `${width}x${height} deterministic noisy TIFF`, steps }, null, 2));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
