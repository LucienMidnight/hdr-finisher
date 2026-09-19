// Phase 5 exit gate 4: global and local Detail match the CPU reference across
// tile boundaries.
//
// The naive form of this test — "tiled GPU output is within N of the CPU
// output" — mostly measures how far the GPU and CPU implementations differ in
// general, which is not what the gate asks about and which existing suites
// already cover. What this gate is really about is whether *tiling* introduces
// error at a tile edge that is not there in the middle of a tile.
//
// So the measurement is differential. For each render the mean absolute
// difference against the CPU reference is computed per column and per row, then
// split into lines that sit on a tile boundary and lines that do not. The
// elevation is (boundary mean - interior mean). Direct is the control: it runs
// the same graph with no tiles at all, so whatever elevation it shows is the
// image's own structure, not a seam. A seam introduced by tiling is exactly
//
//     elevation(tiled) - elevation(direct)
//
// and that number should be zero. Because it is a difference of differences,
// it stays valid however far the CPU and GPU happen to be from each other.
//
//   node tests/tiled-cpu-detail-parity.js --url http://127.0.0.1:8000
//     [--input local-test-media/inputs/<file>] [--tile-sizes 256,512]

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

// In 8-bit levels of per-line mean absolute error. A real seam at maximum
// Detail radii moves an edge line by whole levels; measured values are ~0.01.
const MAX_SEAM_ELEVATION = 0.5;

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const input = argument("--input", null);
  const tileSizes = (argument("--tile-sizes", "256,512") || "").split(",").map(Number).filter(Boolean);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  // deviceScaleFactor 1 keeps the capture at the canvas's own pixel pitch, which
  // a per-line analysis depends on.
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    if (input) {
      const resolved = path.resolve(input);
      if (!fs.existsSync(resolved)) throw new Error(`Input does not exist: ${resolved}`);
      await page.setInputFiles("#file-input", resolved);
    } else {
      await page.getByRole("button", { name: "Load test pattern" }).click();
    }
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    const settle = async () => {
      await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });
      await page.evaluate(async () => {
        if (state.gpuDraftInFlight) await state.gpuDraftInFlight.catch(() => false);
        state.previewScheduler?.cancel();
      });
    };

    // A Brush local and a Path local, each carrying its own Detail, so the
    // comparison covers local Detail and mask transport as well as global.
    await page.evaluate(async () => {
      const brush = newLocalAdjustment("brush");
      brush.name = "CPU parity brush";
      brush.mask.leaf.strokes = [{
        points: [{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.7 }],
        radius: 0.14, hardness: 0.5, flow: 1, opacity: 1, erase: false,
      }];
      brush.mask.leaf.mask_feather = 0.02;
      brush.hdr_grade.exposure = 0.3;
      Object.assign(brush.hdr_grade.detail, {
        texture_amount: 40, clarity_amount: 30, clarity_radius_percent: 1.1,
        sharpen_amount: 50, sharpen_radius_px: 1.2, sharpen_threshold: 10,
      });
      const pathLocal = newLocalAdjustment("path");
      pathLocal.name = "CPU parity path";
      const node = (x, y) => ({ x, y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" });
      pathLocal.mask.leaf.nodes = [node(0.4, 0.15), node(0.9, 0.25), node(0.82, 0.85), node(0.35, 0.75)];
      pathLocal.mask.leaf.feather = 0.03;
      pathLocal.hdr_grade.exposure = -0.25;
      Object.assign(pathLocal.hdr_grade.detail, {
        texture_amount: -30, clarity_amount: 45, clarity_radius_percent: 1.4,
        sharpen_amount: 35, sharpen_radius_px: 1.5, sharpen_threshold: 12,
      });
      if (!await queueEditCommand("create_local", { local: brush })) throw new Error("Could not create the Brush local");
      if (!await queueEditCommand("create_local", { local: pathLocal })) throw new Error("Could not create the Path local");
      await syncGlobalEditState();
    });
    await settle();

    // Unlike the Direct/Tiled harness, every value here has to be one the
    // document model accepts, because the CPU reference renders the committed
    // document rather than client-side state. `globalEditDirty` is what makes
    // syncGlobalEditState actually persist it.
    await page.evaluate(async () => {
      state.adjustments.hdr.exposure = 0.6;
      state.adjustments.hdr.contrast = 0.6;
      state.adjustments.hdr.saturation = 0.4;
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 45, clarity_amount: -20, clarity_radius_percent: 1.3,
        sharpen_amount: 60, sharpen_radius_px: 1.2, sharpen_threshold: 15,
      });
      state.globalEditDirty = true;
      await syncGlobalEditState();
    });
    await settle();

    const committed = await page.evaluate(() => {
      const document = state.editDocument;
      const detail = document.global_adjustments.hdr.detail;
      return {
        locals: document.local_adjustments.length,
        localDetail: document.local_adjustments.map((local) => local.hdr_grade.detail.sharpen_amount),
        globalSharpen: detail.sharpen_amount,
        revision: state.editRevision,
      };
    });
    if (committed.locals !== 2 || !committed.globalSharpen) {
      throw new Error(`The document the CPU will render is not the one under test: ${JSON.stringify(committed)}`);
    }

    // The CPU reference, rendered by the ordinary CPU grading route.
    const reference = await page.evaluate(async () => {
      const longEdge = previewTargetLongEdge();
      const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/hdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_revision: state.editRevision, long_edge: longEdge }),
      });
      if (!response.ok) return { error: `${response.status}: ${(await response.text()).slice(0, 300)}` };
      window.__cpuReference = new Uint8Array(await response.arrayBuffer());
      return {
        width: Number(response.headers.get("X-Image-Width")),
        height: Number(response.headers.get("X-Image-Height")),
        longEdge,
      };
    });
    if (reference.error) throw new Error(`CPU reference render failed: ${reference.error}`);

    const captureAgainstReference = async (mode, tileSize) => {
      const info = await page.evaluate(async ({ mode, tileSize }) => {
        const longEdge = previewTargetLongEdge();
        const result = mode === "tiled"
          ? await window.HDRFinisherPerformance.renderTiledTier(longEdge, { tileSize })
          : await window.HDRFinisherPerformance.renderGpuTier(longEdge);
        if (!result || (mode === "tiled" && !result.rendered)) {
          return {
            error: `${mode} render failed`,
            refusals: result?.refusals || null,
            lastRenderRefusal: state.gpuPreview?.lastRenderRefusal || null,
          };
        }
        await state.gpuPreview.device.queue.onSubmittedWorkDone();
        const canvas = els.previewCanvas;
        return { width: canvas.width, height: canvas.height, metrics: result.metrics || null };
      }, { mode, tileSize });
      if (info.error) throw new Error(JSON.stringify(info));

      // Force the canvas to its own backing size so the screenshot is 1:1.
      await page.locator("#preview-canvas").evaluate((canvas) => {
        canvas.style.setProperty("width", `${canvas.width}px`, "important");
        canvas.style.setProperty("height", `${canvas.height}px`, "important");
        canvas.style.setProperty("max-width", "none", "important");
        canvas.style.setProperty("max-height", "none", "important");
        canvas.style.setProperty("object-fit", "fill", "important");
      });
      await page.waitForTimeout(200);
      const shot = (await page.locator("#preview-canvas").screenshot()).toString("base64");

      const analysis = await page.evaluate(async ({ base64, tileSize }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const surface = document.createElement("canvas");
        surface.width = bitmap.width;
        surface.height = bitmap.height;
        surface.getContext("2d").drawImage(bitmap, 0, 0);
        const cpu = window.__cpuReference;
        const width = bitmap.width;
        // CSS layout rounding can add a row to the capture. The width is exact,
        // so cropping to the reference height keeps the comparison aligned.
        const height = cpu.length / 4 / width;
        if (!Number.isInteger(height) || bitmap.height < height) {
          return { error: `capture ${bitmap.width}x${bitmap.height} cannot align to reference ${cpu.length / 4} px` };
        }
        const pixels = surface.getContext("2d").getImageData(0, 0, width, height).data;

        const columnSum = new Float64Array(width);
        const rowSum = new Float64Array(height);
        // How the GPU/CPU difference is distributed matters for reading the
        // numbers honestly: a large maximum over a handful of high-contrast
        // edge pixels is a different fact from a large typical difference.
        const histogram = new Float64Array(256);
        let total = 0;
        let maxDelta = 0;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            let delta = 0;
            for (let channel = 0; channel < 3; channel += 1) {
              const d = Math.abs(pixels[i + channel] - cpu[i + channel]);
              if (d > delta) delta = d;
            }
            columnSum[x] += delta;
            rowSum[y] += delta;
            histogram[delta] += 1;
            total += delta;
            if (delta > maxDelta) maxDelta = delta;
          }
        }

        // A boundary line, plus one line either side, because a seam from a
        // short halo lands on the edge pixels rather than exactly on the cut.
        const split = (sums, span, extent, size) => {
          const means = [...sums].map((sum) => sum / span);
          const boundary = new Set();
          if (size) {
            for (let edge = size; edge < extent; edge += size) {
              for (let offset = -1; offset <= 1; offset += 1) {
                if (edge + offset >= 0 && edge + offset < extent) boundary.add(edge + offset);
              }
            }
          }
          const mean = (values) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
          return {
            boundaryLines: boundary.size,
            boundaryMean: mean([...boundary].map((line) => means[line])),
            interiorMean: mean(means.filter((_, line) => !boundary.has(line))),
          };
        };
        const columns = split(columnSum, height, width, tileSize);
        const rows = split(rowSum, width, height, tileSize);
        const samples = width * height;
        const quantile = (fraction) => {
          let seen = 0;
          const target = samples * fraction;
          for (let value = 0; value < 256; value += 1) {
            seen += histogram[value];
            if (seen >= target) return value;
          }
          return 255;
        };
        let above16 = 0;
        for (let value = 17; value < 256; value += 1) above16 += histogram[value];
        return {
          width,
          height,
          maxDelta,
          meanDelta: total / samples,
          p50: quantile(0.5),
          p99: quantile(0.99),
          p999: quantile(0.999),
          fractionAbove16: above16 / samples,
          columns: { ...columns, elevation: columns.boundaryMean - columns.interiorMean },
          rows: { ...rows, elevation: rows.boundaryMean - rows.interiorMean },
        };
      }, { base64: shot, tileSize: tileSize || 0 });
      if (analysis.error) throw new Error(`${mode}: ${analysis.error}`);
      return { ...analysis, metrics: info.metrics };
    };

    console.log(
      `CPU reference ${reference.width}x${reference.height}; `
      + `document: ${committed.locals} locals with Detail, global sharpen ${committed.globalSharpen}, revision ${committed.revision}`,
    );

    // The control. Direct draws the whole frame at once, so any elevation it
    // reports at these line positions belongs to the image, not to tiling.
    const control = {};
    for (const tileSize of tileSizes) {
      control[tileSize] = await captureAgainstReference("direct", tileSize);
      console.log(
        `direct   (lines of ${String(tileSize).padStart(4)})  meanDelta ${control[tileSize].meanDelta.toFixed(4)}  `
        + `maxDelta ${String(control[tileSize].maxDelta).padStart(3)}  `
        + `column elevation ${control[tileSize].columns.elevation.toFixed(4)}  `
        + `row elevation ${control[tileSize].rows.elevation.toFixed(4)}`,
      );
    }
    const shape = control[tileSizes[0]];
    console.log(
      `GPU/CPU difference distribution (identical for Direct and Tiled): `
      + `p50 ${shape.p50}, p99 ${shape.p99}, p99.9 ${shape.p999}, max ${shape.maxDelta}; `
      + `${(shape.fractionAbove16 * 100).toFixed(3)}% of pixels above 16 levels`,
    );

    const failures = [];
    for (const tileSize of tileSizes) {
      const tiled = await captureAgainstReference("tiled", tileSize);
      const columnSeam = tiled.columns.elevation - control[tileSize].columns.elevation;
      const rowSeam = tiled.rows.elevation - control[tileSize].rows.elevation;
      const passed = Math.abs(columnSeam) <= MAX_SEAM_ELEVATION && Math.abs(rowSeam) <= MAX_SEAM_ELEVATION;
      if (!passed) failures.push({ tileSize, columnSeam, rowSeam, tiled, control: control[tileSize] });
      console.log(
        `tiled    (tiles of ${String(tileSize).padStart(4)})  meanDelta ${tiled.meanDelta.toFixed(4)}  `
        + `maxDelta ${String(tiled.maxDelta).padStart(3)}  `
        + `column elevation ${tiled.columns.elevation.toFixed(4)}  `
        + `row elevation ${tiled.rows.elevation.toFixed(4)}`,
      );
      console.log(
        `  seam introduced by tiling: columns ${columnSeam.toFixed(4)}, rows ${rowSeam.toFixed(4)} `
        + `(limit ${MAX_SEAM_ELEVATION})  ${passed ? "PASS" : "FAIL"}`,
      );
    }


    // How much of that difference is Detail's? Re-measure with global Detail
    // neutral and nothing else changed. Without this the distribution above
    // reads as though Detail disagrees badly with the CPU, when almost all of
    // it is a baseline difference that is already present on a neutral grade.
    await page.evaluate(async () => {
      Object.assign(state.adjustments.hdr.detail, {
        texture_amount: 0, clarity_amount: 0, sharpen_amount: 0,
      });
      state.globalEditDirty = true;
      await syncGlobalEditState();
    });
    await settle();
    const neutralReference = await page.evaluate(async () => {
      const longEdge = previewTargetLongEdge();
      const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/hdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_revision: state.editRevision, long_edge: longEdge }),
      });
      if (!response.ok) return { error: `${response.status}` };
      window.__cpuReference = new Uint8Array(await response.arrayBuffer());
      return { ok: true };
    });
    if (neutralReference.error) throw new Error(`Neutral CPU reference failed: ${neutralReference.error}`);
    const neutral = await captureAgainstReference("direct", tileSizes[0]);
    console.log(
      `attribution: with global Detail neutral the same comparison is `
      + `meanDelta ${neutral.meanDelta.toFixed(4)}, ${(neutral.fractionAbove16 * 100).toFixed(3)}% above 16. `
      + `Global Detail's marginal contribution is `
      + `${(shape.meanDelta - neutral.meanDelta).toFixed(4)} levels of mean difference and `
      + `${((shape.fractionAbove16 - neutral.fractionAbove16) * 100).toFixed(3)} percentage points.`,
    );
    if (shape.meanDelta - neutral.meanDelta > 1) {
      throw new Error(
        `Detail is responsible for more than one level of mean GPU/CPU difference: `
        + `${JSON.stringify({ withDetail: shape.meanDelta, neutral: neutral.meanDelta })}`,
      );
    }

    if (failures.length) {
      throw new Error(`Tiling introduced Detail error at tile boundaries: ${JSON.stringify(failures, null, 2)}`);
    }
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Global and local Detail match the CPU reference across tile boundaries.");
  } finally {
    await browser.close();
  }
})();
