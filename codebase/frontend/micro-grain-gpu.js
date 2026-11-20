(function () {
  const pipelinesByDevice = new WeakMap();
  const labTablesByDevice = new WeakMap();

  function ahdLabTable(device) {
    if (!labTablesByDevice.has(device)) {
      const floats = new Float32Array(65536);
      const round = Math.fround;
      for (let index = 0; index < floats.length; index++) {
        const code = round(index / 65535);
        floats[index] = code > round(.008856) ? Math.pow(code, round(1/3)) : round(round(round(7.787)*code)+round(16/116));
      }
      const table = device.createBuffer({ size: floats.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(table, 0, floats);
      labTablesByDevice.set(device, table);
    }
    return labTablesByDevice.get(device);
  }

  function ahdPipelines(device) {
    if (!pipelinesByDevice.has(device)) {
      pipelinesByDevice.set(device, Promise.all(window.HDRMicroGrainAhdSources().map(async code => {
        const module = device.createShaderModule({ code });
        const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === "error");
        if (errors.length) throw new Error(errors.map(message => message.message).join("; "));
        return device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      })));
    }
    return pipelinesByDevice.get(device);
  }

  async function readBayer(grain, region, controls, revision, current, retain) {
    const { x, y, width, height } = region;
    const request = new URLSearchParams({ x, y, width, height, revision, retain });
    const response = await fetch(`${grain.url}/region?${request}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "micro_grain", micro_luminance: controls.microLuminance,
        micro_color: controls.microColor, micro_detail: controls.microDetail }),
    });
    if (!current() || response.status === 409) throw new DOMException("Micro Grain was replaced.", "AbortError");
    if (!response.ok) throw new Error(`Micro Grain could not read Bayer samples (${response.status}).`);
    return response.arrayBuffer();
  }

  async function develop(device, grain, region, body, current) {
    const { width, height } = region;
    const headerSize = new DataView(body).getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, headerSize)));
    const pixels = meta.width * meta.height;
    const padded = Math.ceil(meta.mosaic_bytes / 4) * 4;
    if (!Number.isSafeInteger(pixels) || pixels < 4 || meta.mosaic_bytes !== pixels * 2
      || 4 + headerSize + padded >= body.byteLength) throw new Error("Invalid Micro Grain Bayer samples.");
    const pipelines = await ahdPipelines(device);
    if (!current()) throw new DOMException("Micro Grain was replaced.", "AbortError");
    const owned = [];
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const make = (size, usage = storage) => {
      const buffer = device.createBuffer({ size, usage });
      owned.push(buffer);
      return buffer;
    };
    let texture;
    try {
      const mosaic = make(padded);
      const gateAt = 4 + headerSize + padded;
      const gate = make(body.byteLength - gateAt);
      const [ints, horizontal, vertical, votes] = Array.from({ length: 4 }, () => make(pixels * 4));
      const labTable = ahdLabTable(device);
      const params = new ArrayBuffer(22 * 16);
      const uint = new Uint32Array(params), float = new Float32Array(params);
      uint.set([meta.width, meta.height, meta.flip, meta.phase_width, ...meta.offset, ...meta.crop], 0);
      uint.set(meta.cfa, 8);
      uint.set([0, 1, 2, 3], 12);
      float.set(meta.black, 16);
      float.set(meta.wb, 24);
      float.set(meta.inv_range, 36);
      meta.aces.forEach((row, index) => float.set(row, 40 + 4 * index));
      meta.lab.forEach((row, index) => float.set(row, 52 + 4 * index));
      const uniform = make(params.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      texture = device.createTexture({ label: "micro-grain-demosaic", size: [width, height], format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
      device.queue.writeBuffer(uniform, 0, params);
      device.queue.writeBuffer(mosaic, 0, body, 4 + headerSize, padded);
      device.queue.writeBuffer(gate, 0, body, gateAt);
      const bindings = [
        [uniform, mosaic, ints], [uniform, ints, horizontal, vertical],
        [uniform, ints, horizontal, votes, labTable, , , , , , vertical],
        [uniform, ints, horizontal, votes, texture.createView(), gate, , , , , vertical],
      ];
      device.pushErrorScope("validation");
      const encoder = device.createCommandEncoder();
      for (const [index, pipeline] of pipelines.entries()) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
          entries: bindings[index].flatMap((resource, binding) => [{ binding, resource: index === 3 && binding === 4
            ? resource : { buffer: resource } }]) }));
        pass.dispatchWorkgroups(Math.ceil(meta.width / 16), Math.ceil(meta.height / 16));
        pass.end();
      }
      device.queue.submit([encoder.finish()]);
      const fault = await device.popErrorScope();
      if (fault) throw new Error(fault.message);
      if (!current()) throw new DOMException("Micro Grain was replaced.", "AbortError");
      return { texture, width: grain.width, height: grain.height, region };
    } catch (error) {
      texture?.destroy();
      throw error;
    } finally {
      owned.forEach(buffer => buffer.destroy());
    }
  }

  window.HDRMicroGrainGpu = Object.freeze({ readBayer, develop, ahdPipelines });
})();
