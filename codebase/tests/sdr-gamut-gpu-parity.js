const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const path = require("path");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

const values = [];
const push = (red, green, blue) => values.push(red, green, blue, 1);
[
  [0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [-0.25, 0.3, 0.8], [1.001, 0.5, 0.3], [3.947, 1.087, 1.346],
  [0.05, 0.2, 3], [2, 2, 2], [-0.5, -0.5, -0.5],
].forEach((entry) => push(...entry));
for (let index = 0; index < 720; index += 1) {
  const angle = (index / 720) * Math.PI * 2;
  push(0.55 + 1.15 * Math.cos(angle), 0.45 + 1.05 * Math.cos(angle - 2.094395102), 0.5 + 1.2 * Math.cos(angle + 2.094395102));
}
for (let index = 0; index <= 256; index += 1) {
  const offset = -0.002 + (0.004 * index / 256);
  push(offset, 0, 1);
  push(1 + offset, 0.2, 0.1);
}

function cpuReference(input) {
  const python = path.join(__dirname, "..", ".venv", "Scripts", "python.exe");
  const script = [
    "import json, sys, numpy as np",
    "from hdr_finisher.sdr_gamut import compress_to_srgb_gamut",
    "x=np.asarray(json.load(sys.stdin),dtype=np.float32).reshape(-1,4)",
    "y=compress_to_srgb_gamut(x[:,:3])",
    "print(json.dumps(y.reshape(-1).tolist()))",
  ].join("\n");
  const process = spawnSync(python, ["-c", script], {
    cwd: path.join(__dirname, ".."),
    env: { ...processEnv(), PYTHONPATH: path.join(__dirname, "..", "backend") },
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  if (process.status !== 0) throw new Error(process.stderr || process.stdout);
  return JSON.parse(process.stdout);
}

function processEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => state.gpuPreview?.available === true);
    const gpu = await page.evaluate(async (rawValues) => {
      const renderer = state.gpuPreview;
      const input = new Float32Array(rawValues);
      const byteLength = input.byteLength;
      const inputBuffer = renderer.device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const outputBuffer = renderer.device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = renderer.device.createBuffer({
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      renderer.device.queue.writeBuffer(inputBuffer, 0, input);
      const pipeline = renderer.device.createComputePipeline({
        layout: "auto",
        compute: { module: renderer.module, entryPoint: "gamutParityMain" },
      });
      const bindGroup = renderer.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 10, resource: { buffer: inputBuffer } },
          { binding: 11, resource: { buffer: outputBuffer } },
        ],
      });
      const encoder = renderer.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(input.length / 4 / 64));
      pass.end();
      encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, byteLength);
      renderer.device.queue.submit([encoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);
      const result = [...new Float32Array(readBuffer.getMappedRange())];
      readBuffer.unmap();
      inputBuffer.destroy();
      outputBuffer.destroy();
      readBuffer.destroy();
      return result;
    }, values);
    const cpu = cpuReference(values);
    let maximum = 0;
    let worst = null;
    for (let pixel = 0; pixel < cpu.length / 3; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(cpu[pixel * 3 + channel] - gpu[pixel * 4 + channel]);
        if (difference > maximum) {
          maximum = difference;
          worst = { pixel, channel, cpu: cpu[pixel * 3 + channel], gpu: gpu[pixel * 4 + channel] };
        }
      }
    }
    if (!Number.isFinite(maximum) || maximum > 2e-4) {
      throw new Error(`SDR gamut CPU/WebGPU parity exceeded 2e-4: ${JSON.stringify({ maximum, worst })}`);
    }
    console.log(JSON.stringify({ vectors: values.length / 4, maximumAbsoluteError: maximum, worst }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
