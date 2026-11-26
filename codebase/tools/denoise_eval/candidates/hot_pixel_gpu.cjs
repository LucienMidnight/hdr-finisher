const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const shader = `
struct Parameters {
  dimensions: vec4<u32>,
  colours: vec4<u32>,
  shot: vec4<f32>,
  read: vec4<f32>,
  step: vec4<f32>,
};
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> destination: array<f32>;
fn sample(row: i32, column: i32) -> f32 {
  return source[u32(row) * parameters.dimensions.x + u32(column)];
}
fn phase(row: i32, column: i32) -> u32 {
  return u32((row & 1) * 2 + (column & 1));
}
const offsets = array<vec2<i32>, 8>(
  vec2(-2,-2), vec2(-2,0), vec2(-2,2), vec2(0,-2),
  vec2(0,2), vec2(2,-2), vec2(2,0), vec2(2,2));
const directions = array<vec2<i32>, 4>(vec2(0,2),vec2(2,0),vec2(2,2),vec2(2,-2));
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) position: vec3<u32>) {
  if position.x >= parameters.dimensions.x || position.y >= parameters.dimensions.y { return; }
  let row = i32(position.y);
  let column = i32(position.x);
  let index = position.y * parameters.dimensions.x + position.x;
  let centre = source[index];
  destination[index] = centre;
  if row < 4 || column < 4 || row >= i32(parameters.dimensions.y)-4 || column >= i32(parameters.dimensions.x)-4 { return; }
  let channel = phase(row,column);
  var largest = -3.402823e38;
  for (var neighbour=0u; neighbour<8u; neighbour++) {
    largest = max(largest, sample(row+offsets[neighbour].x,column+offsets[neighbour].y));
  }
  let variance = parameters.shot[channel] * max(centre,0.) + parameters.read[channel] + parameters.step[channel]*parameters.step[channel]/12.;
  if centre-largest <= max(8.*sqrt(variance),.02) { return; }
  for (var delta_row=-2; delta_row<=2; delta_row++) {
    for (var delta_column=-2; delta_column<=2; delta_column++) {
      if sample(row+delta_row,column+delta_column) >= .98 { return; }
    }
  }
  for (var delta_row=-1; delta_row<=1; delta_row++) {
    for (var delta_column=-1; delta_column<=1; delta_column++) {
      let support_row = row+delta_row;
      let support_column = column+delta_column;
      let support_phase = phase(support_row,support_column);
      if parameters.colours[support_phase] == parameters.colours[channel] { continue; }
      var values: array<f32,8>;
      for (var neighbour=0u; neighbour<8u; neighbour++) {
        values[neighbour] = sample(support_row+offsets[neighbour].x,support_column+offsets[neighbour].y);
      }
      for (var first=0u; first<8u; first++) {
        for (var second=first+1u; second<8u; second++) {
          if values[second] < values[first] {
            let saved = values[first];
            values[first] = values[second];
            values[second] = saved;
          }
        }
      }
      let background = .5*(values[3]+values[4]);
      let support = sample(support_row,support_column);
      let sigma = sqrt(parameters.shot[support_phase]*max(max(support,background),0.) + parameters.read[support_phase] + parameters.step[support_phase]*parameters.step[support_phase]/12.);
      if support-background > max(2.5*sigma,2.*parameters.step[support_phase]) { return; }
    }
  }
  var smallest_difference = 3.402823e38;
  var replacement = centre;
  for (var direction=0u; direction<4u; direction++) {
    let offset = directions[direction];
    let first = sample(row-offset.x,column-offset.y);
    let second = sample(row+offset.x,column+offset.y);
    if abs(first-second) < smallest_difference {
      smallest_difference = abs(first-second);
      replacement = .5*(first+second);
    }
  }
  destination[index] = replacement;
}
`;

(async () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw Error('Expected input and output JSON paths');
  const cases = JSON.parse(fs.readFileSync(inputPath, 'utf8')).cases;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000');
    const result = await page.evaluate(async ({ cases, shader }) => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No WebGPU adapter');
      const device = await adapter.requestDevice();
      device.pushErrorScope('validation');
      const module = device.createShaderModule({ code: shader });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw Error(JSON.stringify(errors.map(error => error.message)));
      const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const output = [];
      for (const fixture of cases) {
        const [height, width] = fixture.shape;
        const pixels = new Float32Array(fixture.samples);
        const uniformBytes = new ArrayBuffer(80);
        new Uint32Array(uniformBytes, 0, 4).set([width, height, 0, 0]);
        new Uint32Array(uniformBytes, 16, 4).set(fixture.colours);
        new Float32Array(uniformBytes, 32, 4).set(fixture.noise.map(item => item.a));
        new Float32Array(uniformBytes, 48, 4).set(fixture.noise.map(item => item.b));
        new Float32Array(uniformBytes, 64, 4).set(fixture.steps);
        const uniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const source = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const destination = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const readback = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        try {
          device.queue.writeBuffer(uniform, 0, uniformBytes);
          device.queue.writeBuffer(source, 0, pixels);
          const bindings = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: source } },
            { binding: 2, resource: { buffer: destination } },
          ] });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindings);
          pass.dispatchWorkgroups(Math.ceil(width/16), Math.ceil(height/16));
          pass.end();
          encoder.copyBufferToBuffer(destination, 0, readback, 0, pixels.byteLength);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          output.push({ name: fixture.name, samples: Array.from(new Float32Array(readback.getMappedRange())) });
          readback.unmap();
        } finally {
          for (const buffer of [uniform, source, destination, readback]) buffer.destroy();
        }
      }
      const validation = await device.popErrorScope();
      if (validation) throw Error(validation.message);
      device.destroy();
      return { adapter: adapter.info?.description || adapter.info?.device, cases: output };
    }, { cases, shader });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result));
    console.log(`${result.cases.length} research GPU fixtures written`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
