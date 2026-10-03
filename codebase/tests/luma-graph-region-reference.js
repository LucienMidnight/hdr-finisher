/** Regional expression masks versus CPU export and whole-source GPU masks.
 * Small synthetic source only; run through tests/run-in-electron.js.
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..'), index = process.argv.indexOf('--output');
const output = path.resolve(index < 0 ? 'output/performance/luma-graph-region-reference.json' : process.argv[index + 1]);
const sdrBase = process.argv.includes('--sdr-base');
const cases = JSON.parse(execFileSync(path.join(root, '.venv/Scripts/python.exe'), ['-c', `
import json, numpy as np
from backend.hdr_finisher.models import MaskExpression, GeometryAdjustments
from backend.hdr_finisher.local_adjustments import compile_spatial_preview_mask
w,h=768,512
x,y=np.meshgrid(np.arange(w,dtype=np.float64),np.arange(h,dtype=np.float64))
v=.18*2**(5*np.sin(x*.071)+2*np.cos(y*.13))
source=np.stack((v,v*.7,v*.4),axis=-1).astype(np.float32)
cases=[]
for feather in [0,.004,.03]:
    luma=dict(operator='leaf',leaf=dict(type='luminance_range',mask_feather=feather,mask_opacity=.7,fade_in_start_ev=-6,full_start_ev=-3,full_end_ev=2,fade_out_end_ev=5))
    path=dict(operator='leaf',leaf=dict(type='path',mask_opacity=.55,nodes=[dict(x=.48,y=.2),dict(x=.9,y=.2),dict(x=.9,y=.9),dict(x=.48,y=.9)]))
    gradient=dict(operator='leaf',leaf=dict(type='linear_gradient',start=dict(x=.1,y=.2),end=dict(x=.8,y=.9),gradient_midpoint_1=.3,gradient_midpoint_2=.7,gradient_fan=-1))
    for operator in ['union','intersect','subtract','nested']:
        graph=dict(operator=operator if operator!='nested' else 'subtract',inverted=operator=='union',children=[luma,path])
        if operator=='nested':graph['children']=[dict(operator='union',children=[luma,path]),gradient]
        expression=MaskExpression.model_validate(graph)
        expected=compile_spatial_preview_mask(source,expression,GeometryAdjustments())
        cases.append(dict(name=operator,feather=feather,expression=expression.model_dump(),expected=expected[240:272,352:384].reshape(-1).tolist()))
print(json.dumps(cases))
`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }));

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799');
    await page.waitForFunction(() => state.gpuPreview?.available);
    const results = await page.evaluate(async ({cases,sdrBase}) => {
      const renderer = state.gpuPreview, d = renderer.device, width = 768, height = 512, results = [];
      renderer.ensureStorageBuffers(196 * 4, 4);
      const makeSource = (region,authored = false) => {
        const data = new Float32Array(region.width * region.height * 4);
        for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
          const value = authored ? .003 : .18 * 2 ** (5 * Math.sin((x + region.x) * .071) + 2 * Math.cos((y + region.y) * .13));
          data.set([value, value * .7, value * .4, 1], (y * region.width + x) * 4);
        }
        const texture = d.createTexture({ size: [region.width, region.height], format: 'rgba32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        d.queue.writeTexture({ texture }, data, { bytesPerRow: region.width * 16 }, [region.width, region.height]);
        return { texture, width, height, textureWidth: region.width, textureHeight: region.height, region,
          lane: 'hdr', sourceIdentity: 'source', workingSpace: 'acescg' };
      };
      for (const fixture of cases) {
        const sigma = .09 * Math.min(1, fixture.feather / .05) * width;
        const factor = sigma < 8 ? 1 : Math.floor(sigma / 4), halo = Math.ceil(4.5 * sigma) + 2 * factor;
        const x = Math.floor((352 - halo) / factor) * factor, y = Math.floor((240 - halo) / factor) * factor;
        const region = { x, y, width: Math.ceil((384 + halo) / factor) * factor - x,
          height: Math.ceil((272 + halo) / factor) * factor - y };
        const local = { id: `graph-${results.length}`, mask: fixture.expression }, session = local.id;
        const regional = makeSource(region), whole = makeSource({ x: 0, y: 0, width, height });
        const sceneTextures = [], requests = [], originalLoadProxy = renderer.loadProxy;
        try {
          const read = async proxy => {
            const tile = { key: 'sample', rect: { x: 352, y: 240, width: 32, height: 32 },
              haloRect: { x: 352, y: 240, width: 32, height: 32 }, halo: 0 };
            let scene = null, picture = proxy;
            if (sdrBase && proxy === regional) {
              picture = {...makeSource(proxy.region,true),lane:'sdr',sourceIdentity:'authored-base',workingSpace:'linear-srgb'};
              sceneTextures.push(picture.texture);
              renderer.loadProxy = async (...args) => {
                if(args[1]!=='hdr'||args[5]!=='source'||!args[6].regionOnly)throw Error('Invalid scene request');
                requests.push(args[6].region);
                const source=makeSource(args[6].region);sceneTextures.push(source.texture);return source;
              };
              scene = await renderer.loadSceneMaskRegion(session,picture,[tile],[local],width,0,'{}',()=>true);
              if (!scene) throw Error('Independent scene region refused');
            }
            const loaded = await renderer.loadLocalMaskTiles(session, { localIndex: 0, local, tiles: [tile] },
              width, 0, '{}', () => true, undefined, picture, scene);
            const entry = loaded.entries.get('sample');
            if (!entry?.wholeFrame || entry.kind !== 'gpu-mask-graph') throw Error('Graph left the regional GPU route');
            renderer.recordFrameMasks({ execution: 'tiled', sessionId: session, lane: 'hdr', width, height, locals: [local],
              pieces: [{ rect: tile.rect, origin: tile.haloRect, entries: [entry] }] });
            const result = await renderer.readLocalMaskRegion(local.id, 352, 240, 32, 32);
            if (result.error || result.coveredPixels !== 1024) throw Error(result.error || 'Incomplete capture');
            return result.values;
          };
          const a = await read(regional), b = await read(whole);
          results.push({ name: fixture.name, feather: fixture.feather, pixels: a.length, region,
            independentSceneRegions: requests,
            cpuMaxLevels: Math.max(...a.map((value, i) => Math.abs(value * 255 - fixture.expected[i]))),
            wholeGpuMaxLevels: Math.max(...a.map((value, i) => Math.abs(value - b[i]) * 255)) });
        } finally { renderer.loadProxy=originalLoadProxy;
          sceneTextures.forEach(texture=>texture.destroy());regional.texture.destroy(); whole.texture.destroy(); }
      }
      return results;
    }, {cases,sdrBase});
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ results }, null, 2) + '\n');
    for (const result of results) {
      assert.ok(result.cpuMaxLevels <= 3, JSON.stringify(result));
      assert.ok(result.wholeGpuMaxLevels <= .25, JSON.stringify(result));
      if(sdrBase) assert.equal(result.independentSceneRegions.length,1,JSON.stringify(result));
    }
    console.log(`Regional GPU graphs: ${results.length} CPU/whole-GPU reference cases pass.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
