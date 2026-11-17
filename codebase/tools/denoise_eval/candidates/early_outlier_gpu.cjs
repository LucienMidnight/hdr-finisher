const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const shader = `
struct Parameters {
  dimensions: vec4<u32>,
  shot: vec4<f32>,
  read: vec4<f32>,
  controls: vec4<f32>,
};
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> centres: array<f32>;
@group(0) @binding(3) var<storage, read_write> fields: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> destination: array<f32>;
fn index_at(position: vec2<i32>) -> u32 {
  let phase = position & vec2<i32>(1);
  let bounded = clamp(position, phase, vec2<i32>(parameters.dimensions.xy)-vec2<i32>(2)+phase);
  return u32(bounded.y)*parameters.dimensions.x+u32(bounded.x);
}
fn median25(position: vec2<i32>, residual: bool) -> f32 {
  var values: array<f32,25>;
  var count = 0u;
  for (var vertical=-2; vertical<=2; vertical++) {
    for (var horizontal=-2; horizontal<=2; horizontal++) {
      let index = index_at(position+2*vec2<i32>(horizontal,vertical));
      var value = source[index];
      if residual { value = abs(value-centres[index]); }
      var insertion = count;
      loop {
        if insertion == 0u { break; }
        if values[insertion-1u] <= value { break; }
        values[insertion] = values[insertion-1u];
        insertion--;
      }
      values[insertion] = value;
      count++;
    }
  }
  return values[12];
}
@compute @workgroup_size(8,8)
fn centre_pass(@builtin(global_invocation_id) position: vec3<u32>) {
  if any(position.xy >= parameters.dimensions.xy) { return; }
  centres[position.y*parameters.dimensions.x+position.x] = median25(vec2<i32>(position.xy),false);
}
@compute @workgroup_size(8,8)
fn field_pass(@builtin(global_invocation_id) position: vec3<u32>) {
  if any(position.xy >= parameters.dimensions.xy) { return; }
  let index = position.y*parameters.dimensions.x+position.x;
  let location = vec2<i32>(position.xy);
  let phase = (position.y & 1u)*2u+(position.x & 1u);
  let sigma = max(max(sqrt(parameters.shot[phase]*max(centres[index],0.)+parameters.read[phase]),
                      1.4826*median25(location,true)),1e-12);
  let residual = source[index]-centres[index];
  let distance = abs(residual)/sigma;
  var candidate = distance > parameters.controls.x;
  if any(position.xy < vec2<u32>(8)) || any(position.xy >= parameters.dimensions.xy-vec2<u32>(8)) { candidate = false; }
  for (var vertical=-2; vertical<=2; vertical++) {
    for (var horizontal=-2; horizontal<=2; horizontal++) {
      if source[index_at(location+2*vec2<i32>(horizontal,vertical))] >= 1. { candidate = false; }
    }
  }
  fields[index] = vec4<f32>(sigma,distance,residual,select(0.,sign(residual),candidate));
}
@compute @workgroup_size(8,8)
fn clamp_pass(@builtin(global_invocation_id) position: vec3<u32>) {
  if any(position.xy >= parameters.dimensions.xy) { return; }
  let index = position.y*parameters.dimensions.x+position.x;
  destination[index] = source[index];
  let field = fields[index];
  if field.w == 0. { return; }
  let location = vec2<i32>(position.xy);
  if parameters.dimensions.w != 0u {
    var similar = 0u;
    for (var vertical=-2; vertical<=2; vertical++) {
      for (var horizontal=-2; horizontal<=2; horizontal++) {
        if vertical == 0 && horizontal == 0 { continue; }
        if abs(source[index_at(location+2*vec2<i32>(horizontal,vertical))]-source[index]) <= field.x { similar++; }
      }
    }
    if similar >= 2u { return; }
  }
  var queue: array<vec2<i32>,6>;
  queue[0] = location;
  var count = 1u;
  var cursor = 0u;
  loop {
    if cursor >= count { break; }
    let current = queue[cursor];
    cursor++;
    for (var vertical=-1; vertical<=1; vertical++) {
      for (var horizontal=-1; horizontal<=1; horizontal++) {
        let neighbour = current+2*vec2<i32>(horizontal,vertical);
        if fields[index_at(neighbour)].w != field.w { continue; }
        var present = false;
        for (var previous=0u; previous<count; previous++) { present = present || all(queue[previous] == neighbour); }
        if present { continue; }
        if count >= parameters.dimensions.z { return; }
        queue[count] = neighbour;
        count++;
      }
    }
  }
  let ramp = clamp((field.y-parameters.controls.x)/(parameters.controls.x-parameters.controls.y),0.,1.);
  let correction = sign(field.z)*max(abs(field.z)-parameters.controls.y*field.x,0.);
  destination[index] = source[index]-parameters.controls.z*ramp*ramp*(3.-2.*ramp)*correction;
}
`;

(async () => {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw Error('Expected research input/output JSON paths');
  const cases = JSON.parse(fs.readFileSync(inputPath, 'utf8')).cases;
  if (cases.some(fixture => fixture.controls.max_area > 5)) throw Error('Research GPU queue supports area limits up to five');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000');
    const result = await page.evaluate(async ({ cases, shader }) => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No WebGPU adapter; use CPU');
      const device = await adapter.requestDevice();
      device.pushErrorScope('validation');
      const module = device.createShaderModule({ code: shader });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw Error(JSON.stringify(errors.map(error => error.message)));
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ...[2,3,4].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }))
      ] });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const pipelines = [];
      for (const entryPoint of ['centre_pass', 'field_pass', 'clamp_pass']) {
        pipelines.push(await device.createComputePipelineAsync({ layout: pipelineLayout, compute: { module, entryPoint } }));
      }
      const outputs = [];
      for (const fixture of cases) {
        const [height,width] = fixture.shape;
        const pixels = new Float32Array(fixture.samples);
        const parameters = new ArrayBuffer(64);
        new Uint32Array(parameters,0,4).set([width,height,fixture.controls.max_area,Number(fixture.controls.support)]);
        new Float32Array(parameters,16,4).set(fixture.noise.map(row => row[0]));
        new Float32Array(parameters,32,4).set(fixture.noise.map(row => row[1]));
        new Float32Array(parameters,48,4).set([fixture.controls.threshold,fixture.controls.envelope,fixture.controls.strength,0]);
        const uniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const source = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const centres = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.STORAGE });
        const fields = device.createBuffer({ size: pixels.byteLength*4, usage: GPUBufferUsage.STORAGE });
        const destination = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const readback = device.createBuffer({ size: pixels.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        try {
          device.queue.writeBuffer(uniform,0,parameters);
          device.queue.writeBuffer(source,0,pixels);
          const bindings = device.createBindGroup({ layout, entries: [uniform,source,centres,fields,destination].map((buffer,binding) => ({ binding,resource:{ buffer } })) });
          const encoder = device.createCommandEncoder();
          for (const pipeline of pipelines) {
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0,bindings);
            pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));
            pass.end();
          }
          encoder.copyBufferToBuffer(destination,0,readback,0,pixels.byteLength);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          outputs.push({ name:fixture.name,samples:Array.from(new Float32Array(readback.getMappedRange())) });
          readback.unmap();
        } finally {
          for (const buffer of [uniform,source,centres,fields,destination,readback]) buffer.destroy();
        }
      }
      const validation = await device.popErrorScope();
      if (validation) throw Error(validation.message);
      device.destroy();
      return { adapter:adapter.info?.description || adapter.info?.device,cases:outputs };
    }, { cases,shader });
    fs.mkdirSync(path.dirname(outputPath),{ recursive:true });
    fs.writeFileSync(outputPath,JSON.stringify(result));
    console.log(`${result.cases.length} early-clamp GPU fixtures written`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode=1; });
