// A source larger than the 4K tier, written without any image dependency.
//
// The Full tier is only distinguishable from 4K when the source is bigger than
// 4096, and a denoise test needs real noise in it. Playwright will not transfer
// a file over 50 MB to a browser it does not share a host with, so this is
// 8-bit: 4200 x 2800 x 3 is 35 MB, which travels and still carries enough
// noise for shrinkage to have something to remove.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WIDTH = 4200;
const HEIGHT = 2800;

function writeUint16(buffer, offset, value) { buffer.writeUInt16LE(value, offset); return offset + 2; }
function writeUint32(buffer, offset, value) { buffer.writeUInt32LE(value, offset); return offset + 4; }

/** One baseline uncompressed RGB TIFF, single strip, little endian. */
function encodeTiff(pixels, width, height) {
  const entries = [
    [0x0100, 3, 1, width],           // ImageWidth
    [0x0101, 3, 1, height],          // ImageLength
    [0x0102, 3, 3, 0],               // BitsPerSample -> offset, filled below
    [0x0103, 3, 1, 1],               // Compression: none
    [0x0106, 3, 1, 2],               // PhotometricInterpretation: RGB
    [0x0111, 4, 1, 0],               // StripOffsets -> filled below
    [0x0115, 3, 1, 3],               // SamplesPerPixel
    [0x0116, 4, 1, height],          // RowsPerStrip
    [0x0117, 4, 1, pixels.length],   // StripByteCounts
    [0x011c, 3, 1, 1],               // PlanarConfiguration: chunky
  ];
  const headerSize = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const bitsOffset = headerSize + ifdSize;      // three shorts live outside the entry
  const stripOffset = bitsOffset + 6;
  const header = Buffer.alloc(stripOffset);

  let offset = 0;
  header.write("II", offset, "ascii"); offset += 2;
  offset = writeUint16(header, offset, 42);
  offset = writeUint32(header, offset, headerSize);
  offset = writeUint16(header, offset, entries.length);
  for (const [tag, type, count, rawValue] of entries) {
    let value = rawValue;
    if (tag === 0x0102) value = bitsOffset;
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
  for (const bits of [8, 8, 8]) offset = writeUint16(header, offset, bits);
  return Buffer.concat([header, pixels]);
}

/**
 * A smooth gradient carrying fine pseudo-random noise, so denoise has real
 * work to do and the result is deterministic across runs.
 */
function noisyPixels(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0xffffffff;
  };
  for (let y = 0; y < height; y += 1) {
    const vertical = y / height;
    for (let x = 0; x < width; x += 1) {
      const base = 40 + 150 * (0.6 * vertical + 0.4 * (x / width));
      const index = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const noise = (random() - 0.5) * 34;
        const value = Math.round(base * (1 - channel * 0.08) + noise);
        pixels[index + channel] = Math.min(255, Math.max(0, value));
      }
    }
  }
  return pixels;
}

/** Write the fixture once per machine and reuse it. */
function ensureLargeNoisySource(width = WIDTH, height = HEIGHT) {
  const target = path.join(os.tmpdir(), `hdr-finisher-noisy-${width}x${height}.tiff`);
  const expected = width * height * 3;
  if (fs.existsSync(target) && fs.statSync(target).size > expected) return target;
  fs.writeFileSync(target, encodeTiff(noisyPixels(width, height), width, height));
  return target;
}

module.exports = { ensureLargeNoisySource, encodeTiff, WIDTH, HEIGHT };
