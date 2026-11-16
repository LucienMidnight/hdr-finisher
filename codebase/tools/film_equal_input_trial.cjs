const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require("playwright");

const output = path.resolve(process.argv[2] || "output/review/film-equal-input-trial-2026-11-16");
const inputs = JSON.parse(fs.readFileSync(path.join(output, "gpu-cases.json"), "utf8"));
const sourceBase64 = fs.readFileSync(path.join(output, "gpu-source.rgba32f")).toString("base64");

(async () => {
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  try {
    await page.goto(process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765");
    await page.addScriptTag({url: "/static/gpu-delivery-curves.js"});
    await page.addScriptTag({url: "/static/gpu-delivery-finishing.js"});
    const result = await page.evaluate(async ({inputs, sourceBase64}) => {
      const canvas = document.createElement("canvas");
      canvas.width = inputs.width;
      canvas.height = inputs.height;
      const gpu = new HDRWebGPUPreview(canvas);
      if (!await gpu.initialize()) throw Error(`WebGPU unavailable: ${gpu.detail}`);
      if (gpu.adapterInfo?.fallback) throw Error("Native GPU required");
      gpu.setMemoryBudget(.5);
      gpu.resetSession("film-equal-input-research");
      const device = gpu.device;
      const source = device.createTexture({size: [inputs.width, inputs.height], format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
      const encoded = atob(sourceBase64);
      const bytes = Uint8Array.from(encoded, value => value.charCodeAt(0));
      device.queue.writeTexture({texture: source}, bytes, {bytesPerRow: inputs.width * 16}, [inputs.width, inputs.height]);
      const held = new Map();
      gpu.loadProxy = async (sessionId, lane, longEdge, geometrySignature) => {
        if (!held.has(lane)) {
          const proxy = {texture: source, width: inputs.width, height: inputs.height,
            sessionId, lane, longEdge, geometrySignature, sourceIdentity: "source", identity: `${sessionId}:${lane}:trial`,
            workingSpace: "acescg", pixelFormat: "rgba32float", byteSize: inputs.width * inputs.height * 16,
            bindGroups: new Map()};
          held.set(lane, proxy);
          gpu.proxies.set(proxy.identity, proxy);
        }
        return held.get(lane);
      };
      const finishing = new HDRGpuDeliveryFinishing(gpu, async () => {});
      await finishing.initialize();
      const appended = HDRWebGPUShaders.SHADER_SOURCE + `
        @fragment fn equalFilmOutputTrial(input: VertexOut) -> @location(0) vec4f {
          let sceneFilm = finishedAt(vec2i(input.position.xy));
          return vec4f(applyOutputHighlights(acescgToSrgb(sceneFilm) * 2.7367268), 1.0);
        }`;
      const module = device.createShaderModule({code: appended});
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(message => message.type === "error");
      if (errors.length) throw Error(errors.map(message => message.message).join("; "));
      const pipelines = {};
      for (const variant of ["incumbent", "trial"]) {
        pipelines[variant] = await device.createRenderPipelineAsync({layout: gpu.pipelineLayout,
          vertex: {module: variant === "trial" ? module : gpu.module, entryPoint: "vertexMain"},
          fragment: {module: variant === "trial" ? module : gpu.module,
            entryPoint: variant === "trial" ? "equalFilmOutputTrial" : "outputPictureFragmentMain",
            targets: [{format: "rgba32float"}]}, primitive: {topology: "triangle-list"}});
      }
      const P = HDRGpuParamLayout.indices;
      async function render(variant, item, readback) {
        const state = variant === "trial" ? item.state : item.incumbent;
        const lane = variant === "trial" ? "hdr" : "sdr";
        const capture = finishing.texture(inputs.width, inputs.height, "rgba16float");
        const delivery = {texture: capture};
        const started = performance.now();
        const rendered = await gpu.renderTo(canvas, "film-equal-input-research", lane, state, sampleCurvePoints,
          512, [], 0, null, 203, {width: inputs.width, height: inputs.height},
          {delivery, measureOnly: true, keepProxies: true, originalSource: true, forceSdrSurface: true});
        if (!rendered?.rendered && rendered?.execution !== "direct") throw Error(`Render refused: ${JSON.stringify(rendered)} ${JSON.stringify(gpu.lastRenderRefusal)}`);
        const params = variant === "trial" ? buildParams("sdr", item.output, "acescg", false, 203, 1) : delivery.params;
        for (const [key, value] of [["TILE_VALID_WIDTH", inputs.width], ["TILE_VALID_HEIGHT", inputs.height],
          ["FRAME_WIDTH", inputs.width], ["FRAME_HEIGHT", inputs.height], ["TILE_ORIGIN_X", 0], ["TILE_ORIGIN_Y", 0]]) params[P[key]] = value;
        const paramBuffer = gpu.createStorageBuffer(params);
        device.queue.writeBuffer(paramBuffer, 0, params);
        const dummy = finishing.texture(1, 1, "rgba16float");
        const destination = finishing.texture(inputs.width, inputs.height);
        const binding = gpu.bindGraphResources(capture.createView(), dummy.createView(), {buffer: paramBuffer}, dummy.createView());
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({colorAttachments: [{view: destination.createView(), loadOp: "clear", storeOp: "store"}]});
        pass.setPipeline(pipelines[variant]);
        pass.setBindGroup(0, binding);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        const milliseconds = performance.now() - started;
        paramBuffer.destroy();
        finishing.release(capture);
        finishing.release(dummy);
        let pixels = null;
        if (readback) {
          const floats = await finishing.read(destination);
          const array = new Uint8Array(floats.buffer);
          let text = "";
          for (let offset = 0; offset < array.length; offset += 32768) text += String.fromCharCode(...array.subarray(offset, offset + 32768));
          pixels = btoa(text);
        } else finishing.release(destination);
        return {milliseconds, pixels};
      }
      const rows = [];
      for (const item of inputs.cases) {
        await render("incumbent", item, false);
        await render("trial", item, false);
        const samples = {incumbent: [], trial: []};
        let pixels;
        for (let repeat = 0; repeat < 3; repeat++) {
          for (const variant of repeat % 2 ? ["trial", "incumbent"] : ["incumbent", "trial"]) {
            const measured = await render(variant, item, variant === "trial" && repeat === 2);
            samples[variant].push(measured.milliseconds);
            if (measured.pixels) pixels = measured.pixels;
          }
        }
        rows.push({stock: item.stock, strength: item.strength, samples, pixels});
      }
      finishing.destroy();
      return {adapter: gpu.adapterInfo, width: inputs.width, height: inputs.height, rows};
    }, {inputs, sourceBase64});
    for (const row of result.rows) {
      fs.writeFileSync(path.join(output, `gpu-trial-${row.stock}-${row.strength}.rgba32f`), Buffer.from(row.pixels, "base64"));
      delete row.pixels;
    }
    fs.writeFileSync(path.join(output, "gpu-timing.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
