// Phase 0 item 6 fixture: one deterministic HDR source that carries all six
// content classes the Fit filtering A/B names, each in its own horizontal band
// so the comparator can report a number per class.
//
//   band 0  smooth midtones          grain has something quiet to sit on
//   band 1  textured midtones        Detail (texture/clarity/sharpen) has edges
//   band 2  noisy midtones           Denoise has real noise to reconstruct
//   band 3  bright sources on dark   halation/bloom have highlights to bleed
//   band 4  fine repeating detail    zone plate and 1-2 px gratings, where a
//                                    wrong processing scale aliases first
//   band 5  saturated highlights     over-range and saturated patches
//
// The values are ACEScg scene-linear (0.18 diffuse white). The source is an
// unmarked float TIFF, and the loader passes unknown float data through
// unchanged, so both branches of the A/B see identical source pixels.
//
// 4096 x 2304 x 3 x 4 bytes is 113 MB, too large to commit, so it is written
// once per machine into the temp directory -- the same approach
// large-noisy-tiff.js already uses for its 42.4 MP source.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WIDTH = 4096;
const HEIGHT = 2304;
const BAND_HEIGHT = Math.floor(HEIGHT / 6);
const TAU = Math.PI * 2;

const BANDS = [
  { id: "smooth", y: 0 * BAND_HEIGHT, label: "smooth midtones (grain)" },
  { id: "texture", y: 1 * BAND_HEIGHT, label: "textured midtones (Detail)" },
  { id: "noise", y: 2 * BAND_HEIGHT, label: "noisy midtones (Denoise)" },
  { id: "halation", y: 3 * BAND_HEIGHT, label: "bright sources on dark (halation)" },
  { id: "fine", y: 4 * BAND_HEIGHT, label: "fine repeating detail" },
  { id: "highlights", y: 5 * BAND_HEIGHT, label: "saturated highlights" },
];

function writeUint16(buffer, offset, value) { buffer.writeUInt16LE(value, offset); return offset + 2; }
function writeUint32(buffer, offset, value) { buffer.writeUInt32LE(value, offset); return offset + 4; }

/** One baseline uncompressed float32 RGB TIFF, single strip, little endian. */
function encodeFloatTiff(pixels, width, height) {
  const entries = [
    [0x0100, 3, 1, width],             // ImageWidth
    [0x0101, 3, 1, height],            // ImageLength
    [0x0102, 3, 3, 0],                 // BitsPerSample -> offset, filled below
    [0x0103, 3, 1, 1],                 // Compression: none
    [0x0106, 3, 1, 2],                 // PhotometricInterpretation: RGB
    [0x0111, 4, 1, 0],                 // StripOffsets -> filled below
    [0x0115, 3, 1, 3],                 // SamplesPerPixel
    [0x0116, 4, 1, height],            // RowsPerStrip
    [0x0117, 4, 1, pixels.byteLength], // StripByteCounts
    [0x011c, 3, 1, 1],                 // PlanarConfiguration: chunky
    [0x0153, 3, 3, 0],                 // SampleFormat -> offset, filled below
  ];
  const headerSize = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const bitsOffset = headerSize + ifdSize;
  const sampleFormatOffset = bitsOffset + 6;
  const stripOffset = Math.ceil((sampleFormatOffset + 6) / 4) * 4;
  const header = Buffer.alloc(stripOffset);

  let offset = 0;
  header.write("II", offset, "ascii"); offset += 2;
  offset = writeUint16(header, offset, 42);
  offset = writeUint32(header, offset, headerSize);
  offset = writeUint16(header, offset, entries.length);
  for (const [tag, type, count, rawValue] of entries) {
    let value = rawValue;
    if (tag === 0x0102) value = bitsOffset;
    if (tag === 0x0153) value = sampleFormatOffset;
    if (tag === 0x0111) value = stripOffset;
    offset = writeUint16(header, offset, tag);
    offset = writeUint16(header, offset, type);
    offset = writeUint32(header, offset, count);
    // A SHORT that fits in the four value bytes is stored left-aligned.
    if (type === 3 && count === 1) {
      offset = writeUint16(header, offset, value);
      offset = writeUint16(header, offset, 0);
    } else {
      offset = writeUint32(header, offset, value);
    }
  }
  offset = writeUint32(header, offset, 0); // no next IFD
  for (let index = 0; index < 3; index += 1) offset = writeUint16(header, offset, 32);
  for (let index = 0; index < 3; index += 1) offset = writeUint16(header, offset, 3);
  return Buffer.concat([header, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)]);
}

/** Deterministic xorshift so every machine generates the same fixture. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

function smoothBand(pixels, y0) {
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const u = x / (WIDTH - 1);
      const v = y / (BAND_HEIGHT - 1);
      const radial = Math.exp(-((u - 0.28) ** 2 / 0.02 + (v - 0.5) ** 2 / 0.05));
      const base = (0.03 + 0.42 * u) * (0.8 + 0.35 * v) + 0.12 * radial;
      const index = ((y0 + y) * WIDTH + x) * 3;
      pixels[index] = base;
      pixels[index + 1] = base * 0.94;
      pixels[index + 2] = base * 0.88;
    }
  }
}

function textureBand(pixels, y0) {
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let value = 0.22
        + 0.035 * Math.sin(TAU * x / 37) * Math.sin(TAU * y / 53)
        + 0.030 * Math.sin(TAU * (x + y) / 17)
        + 0.020 * Math.sin(TAU * (x - y) / 29)
        + 0.015 * Math.sin(TAU * x / 5);
      if (x >= 300 && x < 620 && y >= 60 && y < 200) value = 0.55;
      if (x >= 800 && x < 1100 && y >= 120 && y < 300) value = 0.06;
      if (x + y >= 1500 && x + y < 1700) value = 0.70;
      const index = ((y0 + y) * WIDTH + x) * 3;
      pixels[index] = value * 1.02;
      pixels[index + 1] = value;
      pixels[index + 2] = value * 0.96;
    }
  }
}

function noiseBand(pixels, y0) {
  const random = makeRandom(0x5eed1234);
  const raw = new Float32Array(BAND_HEIGHT * WIDTH);
  for (let index = 0; index < raw.length; index += 1) raw[index] = random() - 0.5;
  const clumped = new Float32Array(raw.length);
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let total = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = Math.min(BAND_HEIGHT - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = Math.min(WIDTH - 1, Math.max(0, x + dx));
          total += raw[sy * WIDTH + sx];
        }
      }
      clumped[y * WIDTH + x] = total / 9;
    }
  }
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const base = 0.10 + 0.22 * (x / (WIDTH - 1)) + 0.06 * (y / (BAND_HEIGHT - 1));
      const index = (y * WIDTH + x);
      const value = base + 0.05 * raw[index] * 2 + 0.09 * clumped[index] * 2;
      const out = ((y0 + y) * WIDTH + x) * 3;
      pixels[out] = value;
      pixels[out + 1] = value;
      pixels[out + 2] = value;
    }
  }
}

const HALATION_DISCS = [];
for (let column = 0; column < 8; column += 1) {
  for (let row = 0; row < 2; row += 1) {
    HALATION_DISCS.push({
      cx: 256 + column * 512,
      cy: Math.round(BAND_HEIGHT * (row === 0 ? 0.3 : 0.7)),
      radius: 8 + ((column + row) % 3) * 5,
      peak: [6, 18, 48][(column + row) % 3],
      tint: [(column + row) % 2 === 0 ? 1 : 0.85, 0.92, (column + row) % 3 === 0 ? 0.75 : 1],
    });
  }
}

function halationBand(pixels, y0) {
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let value = 0.008 + 0.004 * (y / BAND_HEIGHT);
      let r = value; let g = value; let b = value;
      if (Math.abs(y - BAND_HEIGHT / 2) <= 2) { r = 16; g = 16; b = 16; }
      if (Math.abs(x - 512) <= 1) { r = 8; g = 8; b = 8; }
      for (const disc of HALATION_DISCS) {
        const dx = x - disc.cx; const dy = y - disc.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > disc.radius * 3) continue;
        const sigma = disc.radius / 2;
        const glow = disc.peak * Math.exp(-(distance * distance) / (2 * sigma * sigma));
        if (glow > r) { r = glow * disc.tint[0]; g = glow * disc.tint[1]; b = glow * disc.tint[2]; }
        if (distance < disc.radius * 0.4) { r = disc.peak * disc.tint[0]; g = disc.peak * disc.tint[1]; b = disc.peak * disc.tint[2]; }
      }
      const index = ((y0 + y) * WIDTH + x) * 3;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
    }
  }
}

function fineBand(pixels, y0) {
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let value;
      if (x < 2048) {
        const dx = x - 1024;
        const dy = y - BAND_HEIGHT / 2;
        value = 0.5 + 0.42 * Math.sin((dx * dx + dy * dy) / 560);
      } else {
        const patch = Math.floor((x - 2048) / 512);
        if (patch === 0) value = x % 2 === 0 ? 0.85 : 0.12;
        else if (patch === 1) value = Math.floor(y / 2) % 2 === 0 ? 0.85 : 0.12;
        else if (patch === 2) value = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0 ? 0.85 : 0.12;
        else value = (x + y) % 2 === 0 ? 0.85 : 0.12;
      }
      const index = ((y0 + y) * WIDTH + x) * 3;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    }
  }
}

const HIGHLIGHT_PATCHES = [
  [1.0, 1.0, 1.0], [2.0, 2.0, 2.0], [4.0, 4.0, 4.0], [16.0, 16.0, 16.0], [64.0, 64.0, 64.0],
  [64.0, 6.0, 6.0], [6.0, 64.0, 6.0], [6.0, 6.0, 64.0], [64.0, 10.0, 48.0], [10.0, 64.0, 48.0],
];

function highlightsBand(pixels, y0) {
  const random = makeRandom(0xbeefcafe);
  const specks = [];
  for (let index = 0; index < 40; index += 1) {
    specks.push({ cx: 64 + random() * (WIDTH - 128), cy: 24 + random() * (BAND_HEIGHT - 48), radius: 3 + random() * 5, peak: 80 + random() * 120 });
  }
  for (let y = 0; y < BAND_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let r = 0.01; let g = 0.01; let b = 0.01;
      for (let patch = 0; patch < HIGHLIGHT_PATCHES.length; patch += 1) {
        const x0 = 120 + patch * 380;
        if (x >= x0 && x < x0 + 256 && y >= 40 && y < 200) {
          [r, g, b] = HIGHLIGHT_PATCHES[patch];
        }
      }
      const blobDx = x - 3400; const blobDy = y - 220;
      const blob = 32 * Math.exp(-(blobDx * blobDx + blobDy * blobDy) / (2 * 40 * 40));
      if (blob > r) { r = blob; g = blob; b = blob; }
      for (const speck of specks) {
        const dx = x - speck.cx; const dy = y - speck.cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > speck.radius * 3) continue;
        const glow = speck.peak * Math.exp(-(distance * distance) / (2 * (speck.radius / 2) ** 2));
        if (glow > r) { r = glow; g = glow * 0.96; b = glow * 0.9; }
      }
      const index = ((y0 + y) * WIDTH + x) * 3;
      pixels[index] = Math.min(200, r);
      pixels[index + 1] = Math.min(200, g);
      pixels[index + 2] = Math.min(200, b);
    }
  }
}

function buildPixels(width, height) {
  if (width !== WIDTH || height !== HEIGHT) {
    throw new Error(`fit-filtering fixture is fixed at ${WIDTH}x${HEIGHT}; got ${width}x${height}`);
  }
  const pixels = new Float32Array(width * height * 3);
  smoothBand(pixels, BANDS[0].y);
  textureBand(pixels, BANDS[1].y);
  noiseBand(pixels, BANDS[2].y);
  halationBand(pixels, BANDS[3].y);
  fineBand(pixels, BANDS[4].y);
  highlightsBand(pixels, BANDS[5].y);
  return pixels;
}

/** Write the fixture once per machine and reuse it. */
function ensureFitFilteringFixture(width = WIDTH, height = HEIGHT) {
  const target = path.join(os.tmpdir(), `hdr-finisher-fit-filtering-${width}x${height}.tiff`);
  const expected = width * height * 3 * 4;
  if (fs.existsSync(target) && fs.statSync(target).size > expected) return target;
  fs.writeFileSync(target, encodeFloatTiff(buildPixels(width, height), width, height));
  return target;
}

module.exports = { ensureFitFilteringFixture, BANDS, BAND_HEIGHT, WIDTH, HEIGHT };
