(function () {
  "use strict";
  // Interactive geometry only: grade one uncropped base on the GPU, then
  // resample that finished picture. Apply still renders the authoritative
  // graph at the selected tier; this draft is never an exact presentation.
  const shader = `
    struct Parameters { a: vec4f, b: vec4f, c: vec4f };
    @group(0) @binding(0) var source: texture_2d<f32>;
    @group(0) @binding(1) var<uniform> p: Parameters;
    @vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let points = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(points[i], 0, 1);
    }
    fn pixel(at: vec2i) -> vec4f {
      return textureLoad(source, clamp(at, vec2i(0), vec2i(textureDimensions(source)) - 1), 0);
    }
    @fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
      let at = position.xy + p.c.yz;
      let divisor = dot(p.b.zw, at) + 1;
      let point = vec2f(dot(p.a.xy, at) + p.a.z, p.a.w * at.x + p.b.x * at.y + p.b.y) / divisor - .5;
      let base = vec2i(floor(point));
      let weight = fract(point);
      return mix(mix(pixel(base), pixel(base + vec2i(1, 0)), weight.x),
        mix(pixel(base + vec2i(0, 1)), pixel(base + vec2i(1, 1)), weight.x), weight.y);
    }`;

  async function prepare(renderer, sessionId, lane, adjustments, curveSampler, edge, locals, revision, white, sourceSize, isCurrent) {
    const base = JSON.parse(JSON.stringify(adjustments));
    Object.assign(base.shared.geometry, { perspective_horizontal: 0, perspective_vertical: 0,
      perspective_rotate: 0, straighten_angle: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
    const canvas = document.createElement("canvas");
    const result = await renderer.renderTo(canvas, sessionId, lane, base, curveSampler, edge,
      locals, revision, null, white, sourceSize,
      { isCurrent, identity: "perspective-draft", measureOnly: true, retainPresentation: true, tier: "interactive" });
    if (!result?.presentationTexture) return null;
    const texture = result.presentationTexture;
    if (!isCurrent()) { texture.destroy(); return null; }
    const device = renderer.device;
    let buffer = null;
    try {
      const module = device.createShaderModule({ label: "Perspective draft warp", code: shader });
      const pipeline = device.createRenderPipeline({ label: "Perspective draft warp", layout: "auto",
        vertex: { module, entryPoint: "vertex" },
        fragment: { module, entryPoint: "fragment", targets: [{ format: result.presentationFormat }] },
        primitive: { topology: "triangle-list" } });
      buffer = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer } },
      ] });
      let disposed = false;
      return {
        device,
        draw(geometry, destination) {
          if (disposed || device !== renderer.device || !renderer.available) return false;
          // The base already includes quarter turns and flips; the resampler
          // starts in that oriented frame and includes Crop & Rotate's roll.
          const oriented = { ...geometry, rotation: 0, flip_horizontal: false, flip_vertical: false };
          let plan = window.HDRGeometryResample.plan(result.width, result.height, oriented);
          if (!plan) {
            if (oriented.perspective_horizontal || oriented.perspective_vertical
              || oriented.straighten_angle + oriented.perspective_rotate) return false;
            const crop = window.HDRGeometryResample.cropBounds(result.width, result.height, oriented.crop);
            plan = { coefficients: [1, 0, 0, 0, 1, 0, 0, 0], offsetX: crop.left, offsetY: crop.top,
              width: crop.right - crop.left, height: crop.bottom - crop.top };
          }
          destination.width = plan.width;
          destination.height = plan.height;
          const context = destination.getContext("webgpu");
          const surface = renderer.configureSurface(destination, context, result.hdr);
          if (surface.format !== result.presentationFormat) return false;
          device.queue.writeBuffer(buffer, 0, new Float32Array([...plan.coefficients, 0, plan.offsetX, plan.offsetY, 0]));
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
            loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.draw(3);
          pass.end();
          device.queue.submit([encoder.finish()]);
          return { width: plan.width, height: plan.height, hdr: result.hdr };
        },
        destroy() {
          if (disposed) return;
          disposed = true;
          texture.destroy();
          buffer.destroy();
        },
      };
    } catch (error) {
      texture.destroy();
      buffer?.destroy();
      throw error;
    }
  }
  window.HDRPerspectiveDraft = Object.freeze({ prepare });
})();
