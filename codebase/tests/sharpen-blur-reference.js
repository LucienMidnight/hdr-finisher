/** GPU Sharpen blur versus the CPU export kernel, including image edges.
 * --texture checks the shared Texture kernel with float32 intermediates;
 * native picture comparisons check the production half-float packing.
 * Run through tests/run-in-electron.js. No project is opened or saved.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const textureProbe = process.argv.includes('--texture');
const outputIndex = process.argv.indexOf('--output');
const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1]
  : path.join(root, 'output/performance/sharpen-blur-reference.json'));
const python = process.env.HDR_FINISHER_PYTHON || path.join(root, '.venv/Scripts/python.exe');
const fixtures = JSON.parse(execFileSync(python, ['-c', `
import json
import numpy as np
from backend.hdr_finisher.detail import _gaussian_blur
cases = []
for width, height in [(64, 40), (3, 2)]:
    y, x = np.mgrid[:height, :width].astype(np.float32)
    log = -6 + 2*np.sin(x*1.13) + np.cos(y*.67)
    log[:, 0] = -12
    log[-1, :] = 2
    rgb = np.repeat(np.exp2(log)[..., None], 3, axis=2).astype(np.float32)
    rgba = np.concatenate((rgb, np.ones((height, width, 1), dtype=np.float32)), axis=2)
    for hdr, weights in [(False, [.2126, .7152, .0722]), (True, [.2722287, .6740818, .0536895])]:
        log_y = np.log2(np.maximum(np.einsum('...c,c->...', rgb, np.array(weights, dtype=np.float32), optimize=True), np.float32(1e-4)))
        for sigma in [.3, .349, .35, .8, 1.2, 1.7, 3.0, 2.875, 11.5]:
            cases.append(dict(width=width, height=height, hdr=hdr, sigma=sigma,
                source=rgba.reshape(-1).tolist(), expected=_gaussian_blur(log_y, sigma).reshape(-1).tolist()))
print(json.dumps(cases))
`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799');
    await page.waitForFunction(() => state.gpuPreview?.available || state.gpuPreview?.detail?.includes('Error'), null, { timeout: 30000 }).catch(async error => {
      throw new Error(`${error.message}: ${await page.evaluate(() => state.gpuPreview?.detail)}`);
    });
    assert.ok(await page.evaluate(() => state.gpuPreview?.available), await page.evaluate(() => state.gpuPreview?.detail));
    const measured = await page.evaluate(async ({ cases, textureProbe }) => {
      const device = state.gpuPreview.device;
      const module = device.createShaderModule({ code: HDRWebGPUShaders.SHADER_SOURCE + `
        @fragment fn textureProbeH(input: VertexOut) -> @location(0) vec4f {
          return vec4f(detailBoxBlur(vec2i(input.position.xy), p[153], false, 0u), 0.0, 0.0, 1.0);
        }
        @fragment fn textureProbeV(input: VertexOut) -> @location(0) vec4f {
          return vec4f(detailBoxBlur(vec2i(input.position.xy), p[153], true, 0u), 0.0, 0.0, 1.0);
        }
        @fragment fn sharpenProbeH(input: VertexOut) -> @location(0) vec4f {
          return packSharpenBand(0.0, 0.0, sharpenBlur(vec2i(input.position.xy), p[153], false));
        }
        @fragment fn sharpenProbeV(input: VertexOut) -> @location(0) vec4f {
          return packSharpenBand(0.0, 0.0, sharpenBlur(vec2i(input.position.xy), p[153], true));
        }
      ` });
      const errors = (await module.getCompilationInfo()).messages.filter(m => m.type === 'error');
      if (errors.length) throw new Error(JSON.stringify(errors.map(m => m.message)));
      const bindings = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      ] });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bindings] });
      const pipeline = entryPoint => device.createRenderPipeline({ layout,
        vertex: { module, entryPoint: 'vertexMain' },
        fragment: { module, entryPoint, targets: [{ format: textureProbe ? 'rgba32float' : 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      });
      const horizontal = pipeline(textureProbe ? 'textureProbeH' : 'sharpenProbeH'), vertical = pipeline(textureProbe ? 'textureProbeV' : 'sharpenProbeV');
      const half = value => {
        const sign = value & 0x8000 ? -1 : 1, exponent = (value >> 10) & 31, mantissa = value & 1023;
        return sign * (exponent ? (1 + mantissa / 1024) * 2 ** (exponent - 15) : mantissa * 2 ** -24);
      };
      const results = [];
      for (const fixture of cases) {
        const { width, height, sigma, hdr } = fixture;
        const texture = format => device.createTexture({ size: [width, height], format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        const source = texture('rgba32float'), a = texture(textureProbe ? 'rgba32float' : 'rgba16float'), b = texture(textureProbe ? 'rgba32float' : 'rgba16float');
        const params = new Float32Array(196);
        params[0] = hdr ? 1 : 0; params[153] = sigma;
        params[162] = width; params[163] = height;
        const storage = device.createBuffer({ size: params.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const bytesPerPixel = textureProbe ? 16 : 8;
        const stride = Math.ceil(width * bytesPerPixel / 256) * 256;
        const read = device.createBuffer({ size: stride * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          device.queue.writeTexture({ texture: source }, new Float32Array(fixture.source),
            { bytesPerRow: width * 16 }, [width, height]);
          device.queue.writeBuffer(storage, 0, params);
          const encoder = device.createCommandEncoder();
          const pass = (pipeline, input, target) => {
            const group = device.createBindGroup({ layout: bindings, entries: [
              { binding: 0, resource: source.createView() },
              { binding: 1, resource: { buffer: storage } },
              { binding: 3, resource: input.createView() },
            ] });
            const render = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
              loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
            render.setPipeline(pipeline); render.setBindGroup(0, group); render.draw(3); render.end();
          };
          pass(horizontal, source, a); pass(vertical, a, b);
          encoder.copyTextureToBuffer({ texture: b }, { buffer: read, bytesPerRow: stride }, [width, height]);
          device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          const values = textureProbe ? new Float32Array(read.getMappedRange()) : new Uint16Array(read.getMappedRange());
          let maxError = 0, worst = null;
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const i = y * stride / (textureProbe ? 4 : 2) + x * 4;
            const actual = textureProbe ? values[i] : half(values[i + 3]) + half(values[i + 2]);
            const error = Math.abs(actual - fixture.expected[y * width + x]);
            if (error > maxError) { maxError = error; worst = { x, y, actual, expected: fixture.expected[y * width + x] }; }
          }
          read.unmap();
          results.push({ width, height, sigma, lane: hdr ? 'hdr' : 'sdr', pixels: width * height, maxLogError: maxError, worst });
        } finally { [source, a, b, storage, read].forEach(resource => resource.destroy()); }
      }
      return { textureProbe, adapter: state.gpuPreview.adapterInfo, results };
    }, { cases: fixtures, textureProbe });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(measured, null, 2) + '\n');
    for (const result of measured.results) assert.ok(result.maxLogError <= 0.00002,
      `${result.lane} ${result.width}x${result.height} sigma ${result.sigma}: ${result.maxLogError}`);
    console.log(`${textureProbe ? "Texture" : "Sharpen"} CPU/GPU blur: ${measured.results.length} cases pass, including boundaries and sub-0.35 neutrality.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
