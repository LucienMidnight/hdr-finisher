/**
 * A feathered luma mask is a smooth blur of what it selects, in the preview
 * and in the export, whatever the feather amount.
 *
 *   node tests/run-in-electron.js tests/luma-feather-quality.js
 *
 * Owner report (P7, 2026-09-25): selecting thin, very bright strips with a
 * luma range and raising Feather past about 25% makes a strip break up into a
 * repeating ("tiling") pattern. The source is a float TIFF with 2, 4, 8 and
 * 16 px strips at about 2000 nit on a reference-white ground: vertical strips in the
 * upper part, horizontal strips on the right, so no measured profile crosses
 * another strip. A luma range selects the strips, and Feather is set to 0, 25,
 * 50 and 100%. The mask the preview renders with is read back from the GPU;
 * the export's mask comes from the backend at the same size.
 *
 * Checked for every feathered case, on both paths:
 *   - one band per strip: across a strip, the mask rises to one peak and falls
 *     away, with no second peak (the tiling the owner saw is a row of copies);
 *   - round, not stretched: a vertical and a horizontal strip of the same width
 *     spread the same number of pixels (the feather is a distance, so it may
 *     not depend on which way the strip runs or on the image's aspect ratio);
 *   - preview matches export: the two masks agree within 0.06 on the profiles.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const WIDTH = 2400;
const HEIGHT = 1600;
const STRIPS = [2, 4, 8, 16];
const VERTICAL_X = [300, 700, 1100, 1500];
const HORIZONTAL_Y = [900, 1100, 1300, 1500];
const MEASURE_ROW = 300;      // crosses only the vertical strips
const MEASURE_COLUMN = 2100;  // crosses only the horizontal strips
const FEATHERS = [0, 25, 50, 100];
// Scene luma 0.18 is reference white (203 nit), so this is about 2000 nit; the
// ground (0.18) is 203 nit.
const STRIP_LINEAR = (0.18 * 2000) / 203;

function writeFloatTiff(file) {
  const pixels = new Float32Array(WIDTH * HEIGHT * 3).fill(0.18);
  const paint = (x, y) => { const index = (y * WIDTH + x) * 3; pixels[index] = pixels[index + 1] = pixels[index + 2] = STRIP_LINEAR; };
  STRIPS.forEach((width, index) => {
    for (let y = 0; y < Math.round(HEIGHT * 0.45); y += 1) for (let x = VERTICAL_X[index]; x < VERTICAL_X[index] + width; x += 1) paint(x, y);
    for (let y = HORIZONTAL_Y[index]; y < HORIZONTAL_Y[index] + width; y += 1) for (let x = Math.round(WIDTH * 0.55); x < WIDTH; x += 1) paint(x, y);
  });
  const data = Buffer.from(pixels.buffer);
  const entries = [
    [0x0100, 3, 1, WIDTH], [0x0101, 3, 1, HEIGHT], [0x0102, 3, 3, 0], [0x0103, 3, 1, 1],
    [0x0106, 3, 1, 2], [0x0111, 4, 1, 0], [0x0115, 3, 1, 3], [0x0116, 4, 1, HEIGHT],
    [0x0117, 4, 1, data.length], [0x011c, 3, 1, 1], [0x0153, 3, 3, 0],
  ];
  const ifdSize = 2 + entries.length * 12 + 4;
  const bitsOffset = 8 + ifdSize;
  const formatOffset = bitsOffset + 6;
  const stripOffset = formatOffset + 6;
  const header = Buffer.alloc(stripOffset);
  let offset = 0;
  header.write("II", 0, "ascii"); offset = 2;
  header.writeUInt16LE(42, offset); offset += 2;
  header.writeUInt32LE(8, offset); offset += 4;
  header.writeUInt16LE(entries.length, offset); offset += 2;
  for (const [tag, type, count, raw] of entries) {
    const value = tag === 0x0102 ? bitsOffset : tag === 0x0153 ? formatOffset : tag === 0x0111 ? stripOffset : raw;
    header.writeUInt16LE(tag, offset); header.writeUInt16LE(type, offset + 2); header.writeUInt32LE(count, offset + 4);
    if (type === 3 && count === 1) { header.writeUInt16LE(value, offset + 8); header.writeUInt16LE(0, offset + 10); } else header.writeUInt32LE(value, offset + 8);
    offset += 12;
  }
  header.writeUInt32LE(0, offset); offset += 4;
  for (let index = 0; index < 3; index += 1) { header.writeUInt16LE(32, bitsOffset + index * 2); header.writeUInt16LE(3, formatOffset + index * 2); }
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function halfFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Peaks of a profile, treating flat tops as one peak and ignoring noise under `floor`. */
function peaks(values, floor) {
  let count = 0;
  let rising = false;
  let previous = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - previous;
    if (Math.abs(delta) < 0.004) continue;
    if (delta > 0) rising = true;
    else if (rising) { if (previous > floor) count += 1; rising = false; }
    previous = values[index];
  }
  return count;
}

/** Distance to half the strip's value, on whichever side a neighbour disturbs less. */
function halfWidth(values, centre) {
  const peak = values[centre];
  const walk = (direction) => {
    let distance = 0;
    while (centre + direction * distance >= 0 && centre + direction * distance < values.length
      && values[centre + direction * distance] > peak * 0.5) distance += 1;
    return distance;
  };
  return Math.min(walk(1), walk(-1));
}

function analyse(mask, width, height, pathName, feather) {
  const scaleX = width / WIDTH;
  const scaleY = height / HEIGHT;
  const row = Math.round(MEASURE_ROW * scaleY);
  const column = Math.round(MEASURE_COLUMN * scaleX);
  const rowProfile = Array.from({ length: width }, (_, x) => mask[row * width + x]);
  const columnProfile = Array.from({ length: height }, (_, y) => mask[y * width + column]);
  const window = Math.round(0.09 * (feather / 100) * Math.max(width, height) * 2.5) + 6;
  const strips = STRIPS.map((stripWidth, index) => {
    const cx = Math.round((VERTICAL_X[index] + stripWidth / 2) * scaleX);
    const cy = Math.round((HORIZONTAL_Y[index] + stripWidth / 2) * scaleY);
    const across = rowProfile.slice(Math.max(0, cx - window), cx + window);
    const down = columnProfile.slice(Math.max(0, cy - window), cy + window);
    const floor = Math.max(0.02, rowProfile[cx] * 0.1);
    return {
      stripWidth,
      verticalStripPeaks: peaks(across, floor),
      horizontalStripPeaks: peaks(down, Math.max(0.02, columnProfile[cy] * 0.1)),
      verticalValue: Number(rowProfile[cx].toFixed(3)),
      horizontalValue: Number(columnProfile[cy].toFixed(3)),
      spreadAcrossVertical: halfWidth(rowProfile, cx),
      spreadAcrossHorizontal: halfWidth(columnProfile, cy),
    };
  });
  return { path: pathName, feather, width, height, strips, rowProfile, columnProfile, row, column };
}

// A crop, and a straighten with a crop inside the rotated frame.
const GEOMETRY_SCENARIOS = [
  { name: "50% crop", slug: "crop50", geometry: { crop: { x: 0.25, y: 0.2, width: 0.5, height: 0.5 } } },
  { name: "straighten 4 deg + crop", slug: "straighten", geometry: { straighten_angle: 4, crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } } },
];

async function setFeather(page, feather) {
  await page.evaluate(async (value) => {
    const leaf = firstMaskLeaf(selectedLocal().mask, "luminance_range");
    // 1000 nit and up, to the 10,000 nit ceiling of the luma controls (EV is
    // relative to reference white, 203 nit). The refined range must sit inside
    // the reference bounds, as the sliders keep it, or the backend rejects it.
    const top = Math.log2(10000 / 203);
    Object.assign(leaf, { fade_in_start_ev: 1.8, reference_start_ev: 2.3, full_start_ev: 2.3, full_end_ev: top,
      reference_end_ev: top, fade_out_end_ev: top + 0.75, mask_feather: value / 2000, mask_opacity: 1 });
    const accepted = await commitSelectedLocal({ refreshPreview: true });
    if (!accepted) throw new Error("The backend rejected the luma mask update.");
  }, feather);
  await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 120000 });
  await page.waitForTimeout(300);
}

/** The mask the preview renders with, read back from the GPU. */
function readGpuMask(page) {
  return page.evaluate(async () => {
    const preview = state.gpuPreview;
    const leaf = firstMaskLeaf(selectedLocal().mask, "luminance_range");
    const geometry = geometrySignature();
    // The entry for this range and geometry (older ones may still be cached).
    const entry = [...preview.localMasks.entries()].reverse()
      .find(([key, candidate]) => candidate.kind === "gpu-luma" && key.includes(geometry)
        && key.includes(`"full_start_ev":${leaf.full_start_ev},`)
        && key.includes(`"fade_out_end_ev":${leaf.fade_out_end_ev}`))?.[1];
    if (!entry) return null;
    const { device } = preview;
    const target = device.createTexture({ size: { width: entry.width, height: entry.height }, format: "r16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const params = preview.createStorageBuffer(new Float32Array([0, 1, 1, 0]));
    device.queue.writeBuffer(params, 0, new Float32Array([0, 1, 1, 0]));
    const encoder = device.createCommandEncoder();
    preview.encodeMaskPass(encoder, preview.maskPipelines.combine, preview.createMaskBindGroup(entry.texture, params, entry.texture), target);
    const bytesPerRow = Math.ceil((entry.width * 2) / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * entry.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, { width: entry.width, height: entry.height });
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint16Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy(); target.destroy(); params.destroy();
    const packed = [];
    for (let y = 0; y < entry.height; y += 1) for (let x = 0; x < entry.width; x += 1) packed.push(bytes[y * (bytesPerRow / 2) + x]);
    return { width: entry.width, height: entry.height, bits: packed };
  });
}

/** The export's mask for the same local, from the backend. */
function readBackendMask(page, longEdge) {
  return page.evaluate(async (edge) => {
    const local = selectedLocal();
    const response = await fetch(`/api/session/${state.session.session_id}/local-mask/${encodeURIComponent(local.id)}?long_edge=${edge}&edit_revision=${state.editRevision}&spatial_only=true`);
    if (!response.ok) return { error: response.status };
    return { width: Number(response.headers.get("X-Image-Width")), height: Number(response.headers.get("X-Image-Height")),
      bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, longEdge);
}

/** Bilinear resample, so masks of different sizes can be compared pixel for pixel. */
function resample(mask, width, height, targetWidth, targetHeight) {
  if (width === targetWidth && height === targetHeight) return mask;
  const out = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(height - 1, Math.max(0, ((y + 0.5) * height) / targetHeight - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, ((x + 0.5) * width) / targetWidth - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const top = mask[y0 * width + x0] * (1 - (sx - x0)) + mask[y0 * width + x1] * (sx - x0);
      const bottom = mask[y1 * width + x0] * (1 - (sx - x0)) + mask[y1 * width + x1] * (sx - x0);
      out[y * targetWidth + x] = top * (1 - (sy - y0)) + bottom * (sy - y0);
    }
  }
  return out;
}

/** Greyscale PGM of a mask, for looking at it (HDR_FINISHER_DUMP_MASKS=<folder>). */
function dumpMask(name, mask, width, height) {
  fs.mkdirSync(process.env.HDR_FINISHER_DUMP_MASKS, { recursive: true });
  fs.writeFileSync(path.join(process.env.HDR_FINISHER_DUMP_MASKS, name),
    Buffer.concat([Buffer.from(`P5 ${width} ${height} 255\n`), Buffer.from(Array.from(mask, (value) => Math.round(Math.min(1, Math.max(0, value)) * 255)))]));
}

(async () => {
  const fixture = path.join(os.tmpdir(), "hdr-finisher-luma-strips.tiff");
  writeFloatTiff(fixture);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const failures = [];
  const report = [];
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", fixture);
    await page.waitForFunction(() => state.session?.session_id && state.gpuPreview?.available === true
      && viewerState().status === "ready", null, { timeout: 300000 });
    await page.locator("#grade-mode-local").click();
    const created = page.waitForResponse((response) => response.url().includes("/edit-commands") && response.request().method() === "POST");
    await page.locator("#local-add-adjustment").click();
    await page.locator('[data-local-tool="luminance_range"]').click();
    await created;
    for (const feather of FEATHERS) {
      await setFeather(page, feather);
      const gpu = await readGpuMask(page);
      if (!gpu) { failures.push(`${feather}%: no GPU luma mask was rendered`); continue; }
      const gpuMask = Float32Array.from(gpu.bits, halfFloat);
      const backend = await readBackendMask(page, Math.max(gpu.width, gpu.height));
      if (backend.error) { failures.push(`${feather}%: backend mask request failed (${backend.error})`); continue; }
      const backendMask = Float32Array.from(backend.bytes, (value) => value / 255);
      if (process.env.HDR_FINISHER_DUMP_MASKS) {
        dumpMask(`feather-${feather}-preview.pgm`, gpuMask, gpu.width, gpu.height);
        dumpMask(`feather-${feather}-export.pgm`, backendMask, backend.width, backend.height);
      }
      const results = [analyse(gpuMask, gpu.width, gpu.height, "preview (GPU)", feather),
        analyse(backendMask, backend.width, backend.height, "export (backend)", feather)];
      for (const result of results) {
        const { rowProfile, columnProfile, ...summary } = result;
        report.push(summary);
        if (feather === 0) continue;
        for (const strip of result.strips) {
          if (strip.verticalStripPeaks > 1 || strip.horizontalStripPeaks > 1) {
            failures.push(`${feather}% ${result.path}: ${strip.stripWidth} px strip breaks into ${Math.max(strip.verticalStripPeaks, strip.horizontalStripPeaks)} bands`);
          }
          const spreads = [strip.spreadAcrossVertical, strip.spreadAcrossHorizontal];
          // Only while the strips are more than three sigma apart (the closest
          // pair is 200 source px); beyond that neighbours overlap and the
          // backend unit test checks roundness on a single strip instead.
          const isolated = 3 * 0.09 * (feather / 100) * Math.max(WIDTH, HEIGHT) < 200;
          if (isolated && Math.max(...spreads) > 1.2 * Math.min(...spreads) + 2) {
            failures.push(`${feather}% ${result.path}: ${strip.stripWidth} px strip spreads ${spreads[0]} px sideways but ${spreads[1]} px up/down`);
          }
        }
      }
      if (gpu.width === backend.width && gpu.height === backend.height) {
        const [preview, exported] = results;
        let worst = 0;
        for (let x = 0; x < gpu.width; x += 1) worst = Math.max(worst, Math.abs(preview.rowProfile[x] - exported.rowProfile[x]));
        for (let y = 0; y < gpu.height; y += 1) worst = Math.max(worst, Math.abs(preview.columnProfile[y] - exported.columnProfile[y]));
        report.push({ feather, previewVsExportMaxDifference: Number(worst.toFixed(3)) });
        if (feather > 0 && worst > 0.06) failures.push(`${feather}%: preview and export masks differ by up to ${worst.toFixed(3)}`);
      } else {
        failures.push(`${feather}%: preview ${gpu.width}x${gpu.height} and export ${backend.width}x${backend.height} masks differ in size`);
      }
    }
    // Cropped and straightened: the feather is a fraction of the uncropped
    // source's long edge in the export, so the preview has to measure it the
    // same way or the two differ in proportion to the crop.
    for (const scenario of GEOMETRY_SCENARIOS) {
      await page.evaluate(async (geometry) => {
        openCropMode();
        Object.assign(state.cropDraftGeometry, geometry);
        closeCropMode(true);
        await syncGlobalEditState();
      }, scenario.geometry);
      await page.waitForFunction(() => viewerState().status === "ready" && !state.gpuDraftInFlight, null, { timeout: 120000 });
      for (const feather of [25, 100]) {
        await setFeather(page, feather);
        const gpu = await readGpuMask(page);
        if (!gpu) { failures.push(`${scenario.name} ${feather}%: no GPU luma mask was rendered`); continue; }
        const backend = await readBackendMask(page, Math.max(gpu.width, gpu.height));
        if (backend.error) { failures.push(`${scenario.name} ${feather}%: backend mask request failed (${backend.error})`); continue; }
        const preview = Float32Array.from(gpu.bits, halfFloat);
        const exported = resample(Float32Array.from(backend.bytes, (value) => value / 255), backend.width, backend.height, gpu.width, gpu.height);
        let worst = 0;
        let total = 0;
        for (let index = 0; index < preview.length; index += 1) {
          const difference = Math.abs(preview[index] - exported[index]);
          worst = Math.max(worst, difference);
          total += difference;
        }
        const entry = { scenario: scenario.name, feather, preview: `${gpu.width}x${gpu.height}`, export: `${backend.width}x${backend.height}`,
          maxDifference: Number(worst.toFixed(3)), meanDifference: Number((total / preview.length).toFixed(4)) };
        report.push(entry);
        if (worst > 0.06) failures.push(`${scenario.name} ${feather}%: preview and export masks differ by up to ${worst.toFixed(3)} (mean ${entry.meanDifference})`);
        if (process.env.HDR_FINISHER_DUMP_MASKS) {
          dumpMask(`${scenario.slug}-${feather}-preview.pgm`, preview, gpu.width, gpu.height);
          dumpMask(`${scenario.slug}-${feather}-export.pgm`, exported, gpu.width, gpu.height);
        }
      }
    }
    if (pageErrors.length) failures.push(`Page errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ report, failures }, null, 2));
    if (failures.length) throw new Error(`${failures.length} failure(s):\n${failures.join("\n")}`);
    console.log("Luma feather quality test passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
