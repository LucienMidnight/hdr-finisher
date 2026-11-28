async function installFilmParityCapture(page, { dump = false } = {}) {
  await page.evaluate((dump) => {
    const canvas = els.previewCanvas;
    const preview = state.gpuPreview;
    const context = canvas.getContext("webgpu");
    const device = preview.device;
    const frames = new Map();
    let nextId = 0;

    async function readFrame(texture, id) {
      const { width, height, format } = texture;
      const pixelBytes = format === "rgba16float" ? 8 : 4;
      const rowBytes = Math.ceil(width * pixelBytes / 256) * 256;
      const buffer = device.createBuffer({
        size: rowBytes * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowBytes }, { width, height });
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const padded = new Uint8Array(buffer.getMappedRange());
        const data = new Uint8Array(width * height * pixelBytes);
        for (let y = 0; y < height; y += 1) {
          data.set(padded.subarray(y * rowBytes, y * rowBytes + width * pixelBytes), y * width * pixelBytes);
        }
        if (!data.some(byte => byte !== 0)) throw new Error("Submitted surface was blank");
        frames.set(id, { width, height, format, pixelBytes, data });
        return { id, width, height, format };
      } finally {
        buffer.destroy();
      }
    }

    // Copy while this particular render still owns the canvas, before a later
    // app render can replace its swapchain texture or resize the backing.
    async function capture(render) {
      let pending = null;
      let shot = null;
      const staged = await render(() => {
        if (pending) throw new Error("Parity render submitted more than one frame");
        const texture = context.getCurrentTexture();
        const id = nextId++;
        pending = readFrame(texture, id).then(frame => ({ frame }), error => ({ error: String(error) }));
        if (dump) shot = canvas.toDataURL("image/png").split(",")[1];
      });
      if (staged.error) throw new Error(JSON.stringify(staged));
      if (!pending) throw new Error("Parity render did not submit a frame");
      const readback = await pending;
      if (readback.error) throw new Error(readback.error);
      return { ...staged, ...readback.frame, shot };
    }

    // Keep the real Grade route and its acceptance metadata. Match the
    // renderer's call by this diagnostic request's unique action, never by
    // whichever submit or presentation event happens to arrive next.
    function direct(longEdge, tier = "settled") {
      return capture(async (onFrameSubmitted) => {
        const action = {};
        const renderTo = preview.renderTo;
        preview.renderTo = function (target, ...args) {
          const options = args.at(-1);
          if (target === canvas && options?.action === action) {
            args[args.length - 1] = {
              ...options,
              onFrameSubmitted(region, hdr) {
                onFrameSubmitted();
                options.onFrameSubmitted?.(region, hdr);
              },
            };
          }
          return renderTo.call(this, target, ...args);
        };
        try {
          const rendered = await renderGpuDraft(state.currentView, { longEdge, tier, action });
          if (!rendered) return { error: "Direct render failed", lastRefusal: state.lastGpuDraftRefusal || null };
          const { execution, schedulerTier, lane, approximate, exact, processedLongEdge } = state.acceptedPresentation || {};
          if (schedulerTier !== tier) return { error: `Expected ${tier} presentation, got ${schedulerTier}` };
          if (execution !== "direct") return { error: `Planner selected ${execution || "unknown"}, not Direct` };
          return { schedulerTier, lane, approximate, exact, processedLongEdge };
        } finally {
          preview.renderTo = renderTo;
        }
      });
    }

    function compare(left, right) {
      const first = frames.get(left);
      const second = frames.get(right);
      if (!first || !second) throw new Error("Missing captured frame");
      if (first.width !== second.width || first.height !== second.height || first.format !== second.format) {
        const describe = ({ width, height, format }) => `${width}x${height} ${format}`;
        throw new Error(`Captured sizes or formats differ: ${describe(first)} vs ${describe(second)}`);
      }
      let differing = 0;
      let maxDelta = 0;
      for (let index = 0; index < first.data.length; index += first.pixelBytes) {
        let delta = 0;
        // Compare every RGB byte, including both bytes of each half-float.
        for (let channel = 0; channel < first.pixelBytes * 3 / 4; channel += 1) {
          delta = Math.max(delta, Math.abs(first.data[index + channel] - second.data[index + channel]));
        }
        if (delta > maxDelta) maxDelta = delta;
        if (delta > 0) differing += 1;
      }
      return { width: first.width, height: first.height, samples: first.width * first.height, differing, maxDelta };
    }

    window.__filmParity = {
      capture,
      direct,
      compare,
      clear: () => frames.clear(),
      drop: id => frames.delete(id),
    };
  }, dump);
}

// Before starting a probe, let the live app finish recipe-driven work. A
// deferred redraw can otherwise supersede the probe or evict its Mist cache.
async function waitForFilmParityIdle(page) {
  await page.waitForFunction(() => {
    const scheduler = state.previewScheduler;
    return viewerState().status === "ready" && !state.gpuDraftInFlight
      && !scheduler?.frameInFlight && !scheduler?.framePending && !scheduler?.settleInFlight
      && pendingHighlightAnchors.size === 0 && exactHighlightAnchorInflight.size === 0;
  }, null, { timeout: 180000 });
  await page.evaluate(() => {
    state.previewScheduler?.cancel();
    state.renderCoordinator?.cancelFollowUps(state.currentView);
  });
}

module.exports = { installFilmParityCapture, waitForFilmParityIdle };
