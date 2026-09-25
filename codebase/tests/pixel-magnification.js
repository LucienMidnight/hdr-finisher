/**
 * Above 100% each source pixel is a sharp square; at and below 100% the view
 * stays smoothly filtered.
 *
 *   node tests/run-in-electron.js tests/pixel-magnification.js
 *
 * Preview Responsiveness Tuning Sprint P4. Magnification past 100% is done by
 * the compositor scaling the preview canvas, so the check has to read what the
 * compositor shows: a screenshot of the viewer, not a readback of the canvas.
 *
 * The source is a 1-pixel checkerboard of two mid-range greys. At 800% every
 * source pixel covers an 8x8 block of device pixels; nearest-neighbour
 * magnification makes each block flat, bilinear smoothing makes it a ramp.
 * The inner 6x6 of each block is compared so a fractional block origin cannot
 * decide the result. At 50% two source pixels meet in each device pixel and
 * the view must read as the mean grey, not as a checkerboard.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { encodeTiff } = require("./large-noisy-tiff.js");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const SIZE = 1024;
const DARK = 4;
const LIGHT = 14;

function checkerboardSource() {
  const target = path.join(os.tmpdir(), `hdr-finisher-checker-${SIZE}-${DARK}-${LIGHT}.tiff`);
  if (fs.existsSync(target)) return target;
  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const value = (x + y) % 2 === 0 ? DARK : LIGHT;
      pixels.fill(value, (y * SIZE + x) * 3, (y * SIZE + x) * 3 + 3);
    }
  }
  fs.writeFileSync(target, encodeTiff(pixels, SIZE, SIZE));
  return target;
}

async function viewAt(page, percent) {
  await page.evaluate((next) => setCustomZoom(next), percent);
  await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const element = activePreviewElement();
    const box = element.getBoundingClientRect();
    const frame = els.dropzone.getBoundingClientRect();
    const left = Math.max(box.left, frame.left);
    const top = Math.max(box.top, frame.top);
    const right = Math.min(box.right, frame.right);
    const bottom = Math.min(box.bottom, frame.bottom);
    const size = Math.floor(Math.min(256, right - left - 16, bottom - top - 16));
    const x = Math.round((left + right) / 2 - size / 2);
    const y = Math.round((top + bottom) / 2 - size / 2);
    return {
      element: element.id,
      rendering: getComputedStyle(element).imageRendering,
      dpr: window.devicePixelRatio,
      zoom: state.zoomPercent,
      clip: { x, y, width: size, height: size },
      originX: box.left,
      originY: box.top,
    };
  });
}

async function greys(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const values = new Array(bitmap.width * bitmap.height);
    for (let index = 0; index < values.length; index += 1) values[index] = data[index * 4 + 1];
    return { width: bitmap.width, height: bitmap.height, values };
  }, png.toString("base64"));
}

function blockUniformity(image, view, block) {
  const dpr = view.dpr;
  const startX = ((view.originX - view.clip.x) * dpr) % block;
  const startY = ((view.originY - view.clip.y) * dpr) % block;
  const firstX = startX < 0 ? startX + block : startX;
  const firstY = startY < 0 ? startY + block : startY;
  let blocks = 0;
  let worstSpread = 0;
  const means = [];
  for (let by = firstY; by + block <= image.height; by += block) {
    for (let bx = firstX; bx + block <= image.width; bx += block) {
      let low = 255;
      let high = 0;
      let sum = 0;
      let count = 0;
      for (let y = Math.ceil(by) + 1; y < Math.floor(by + block) - 1; y += 1) {
        for (let x = Math.ceil(bx) + 1; x < Math.floor(bx + block) - 1; x += 1) {
          const value = image.values[y * image.width + x];
          low = Math.min(low, value);
          high = Math.max(high, value);
          sum += value;
          count += 1;
        }
      }
      if (!count) continue;
      blocks += 1;
      worstSpread = Math.max(worstSpread, high - low);
      means.push(sum / count);
    }
  }
  const sorted = means.sort((a, b) => a - b);
  const contrast = sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0;
  return { blocks, worstSpread, contrast };
}

function spread(image) {
  let low = 255;
  let high = 0;
  let sum = 0;
  for (const value of image.values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
    sum += value;
  }
  return { low, high, mean: sum / image.values.length };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", checkerboardSource());
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 120000 });

    const lanes = {};
    for (const lane of ["hdr", "sdr"]) {
      await page.evaluate(async (name) => { if (state.activeLane !== name) await switchLane(name); }, lane);
      const magnifiedView = await viewAt(page, 800);
      // Zoom percent is device pixels per source pixel, and the screenshot is
      // in device pixels, so one source pixel is an 8x8 block at any DPR.
      const block = 8;
      const magnified = blockUniformity(await greys(page, magnifiedView.clip), magnifiedView, block);
      const reducedView = await viewAt(page, 50);
      const reduced = spread(await greys(page, reducedView.clip));
      lanes[lane] = {
        magnified: { ...magnified, element: magnifiedView.element, rendering: magnifiedView.rendering, zoom: magnifiedView.zoom },
        reduced: { ...reduced, element: reducedView.element, rendering: reducedView.rendering, zoom: reducedView.zoom },
        pass: {
          sharpAt800: magnified.blocks >= 100 && magnified.worstSpread <= 3 && magnified.contrast >= 40,
          filteredAt50: reduced.high - reduced.low <= 24,
        },
      };
    }
    await page.evaluate(() => setZoomMode("fit"));
    console.log(JSON.stringify(lanes, null, 2));
    if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join("; ")}`);
    const failed = Object.entries(lanes).flatMap(([lane, row]) => Object.entries(row.pass)
      .filter(([, ok]) => !ok).map(([name]) => `${lane}:${name}`));
    if (failed.length) throw new Error(`Pixel magnification failed: ${failed.join(", ")}`);
    console.log("Pixel magnification test passed.");
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
