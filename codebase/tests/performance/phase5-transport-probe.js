const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ensureLargeNoisySource } = require('../large-noisy-tiff.js');

const base = process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8799';
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 7968);
const height = Number(process.argv.includes('--height') ? process.argv[process.argv.indexOf('--height') + 1] : 5320);
const repeats = Number(process.argv.includes('--repeats') ? process.argv[process.argv.indexOf('--repeats') + 1] : 3);
const chunkBytes = Number(process.argv.includes('--chunk-bytes') ? process.argv[process.argv.indexOf('--chunk-bytes') + 1] : 16 * 1024 * 1024);
const output = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timedJson(url, options) {
  const started = performance.now();
  const response = await fetch(url, options);
  const ttfbMs = performance.now() - started;
  const buffer = Buffer.from(await response.arrayBuffer());
  const bodyMs = performance.now() - started - ttfbMs;
  if (!response.ok) throw new Error(`${response.status} ${url}: ${buffer.toString('utf8').slice(0, 200)}`);
  return { ttfbMs, bodyMs, totalMs: ttfbMs + bodyMs, bytes: buffer.length, buffer };
}

(async () => {
  const fixture = ensureLargeNoisySource(width, height);
  const bytes = fs.readFileSync(fixture);
  const form = new FormData();
  form.append('file', new Blob([bytes]), path.basename(fixture));
  const created = await (await fetch(`${base}/api/session`, { method: 'POST', body: form })).json();
  const sessionId = created.session.session_id;
  const longEdge = Math.max(width, height);
  const rowBytes = width * 8;
  const rowsPerChunk = Math.max(1, Math.min(height, Math.floor(chunkBytes / rowBytes)));
  const chunkTotal = Math.ceil(height / rowsPerChunk);
  console.log(`session ${sessionId} ${width}x${height} rowsPerChunk ${rowsPerChunk} chunks ${chunkTotal}`);

  const stripUrl = (top, rows) => `${base}/api/session/${sessionId}/source-tile/hdr`
    + `?long_edge=${longEdge}&format=rgba16f&x=0&y=${top}&width=${width}&height=${rows}&halo=0`;
  const wholeUrl = `${base}/api/session/${sessionId}/proxy/hdr?long_edge=${longEdge}&format=rgba16f`;

  const warm = await timedJson(stripUrl(0, 4));
  console.log(`warm strip ${warm.totalMs.toFixed(0)}ms ${warm.bytes} bytes state ${warm.buffer.length}`);

  const variants = {
    sequential: async () => {
      const chunks = [];
      for (let top = 0; top < height; top += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, height - top);
        const result = await timedJson(stripUrl(top, rows));
        chunks.push(result);
      }
      return chunks;
    },
    parallel4: async () => {
      const chunks = [];
      const jobs = [];
      for (let top = 0; top < height; top += rowsPerChunk) {
        const rows = Math.min(rowsPerChunk, height - top);
        jobs.push([top, rows]);
      }
      for (let index = 0; index < jobs.length; index += 4) {
        const wave = await Promise.all(jobs.slice(index, index + 4).map(([top, rows]) => timedJson(stripUrl(top, rows))));
        chunks.push(...wave);
      }
      return chunks;
    },
    wholeFrame: async () => [await timedJson(wholeUrl)],
  };

  const runs = {};
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const name of Object.keys(variants)) {
      const chunks = await variants[name]();
      const totalMs = chunks.reduce((sum, chunk) => sum + chunk.totalMs, 0);
      const ttfbMs = chunks.reduce((sum, chunk) => sum + chunk.ttfbMs, 0);
      const bodyMs = chunks.reduce((sum, chunk) => sum + chunk.bodyMs, 0);
      const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
      runs[name] = runs[name] || [];
      runs[name].push({ totalMs, ttfbMs, bodyMs, totalBytes, requests: chunks.length, first: chunks[0].totalMs });
      console.log(`${name} run ${repeat + 1}: ${totalMs.toFixed(0)}ms wall, ttfb ${ttfbMs.toFixed(0)}ms body ${bodyMs.toFixed(0)}ms ${totalBytes} bytes ${chunks.length} requests`);
    }
  }

  const wholeBuffer = (await variants.wholeFrame())[0].buffer;
  const gzip = zlib.gzipSync(wholeBuffer, { level: 6 }).length;
  const brotli = zlib.brotliCompressSync(wholeBuffer).length;
  const summary = {};
  for (const [name, list] of Object.entries(runs)) {
    summary[name] = {
      totalMs: Math.round(median(list.map((run) => run.totalMs))),
      ttfbMs: Math.round(median(list.map((run) => run.ttfbMs))),
      bodyMs: Math.round(median(list.map((run) => run.bodyMs))),
      firstMs: Math.round(median(list.map((run) => run.first))),
      totalBytes: list[0].totalBytes,
      requests: list[0].requests,
      runs: list,
    };
  }
  summary.compression = {
    wholeFrameBytes: wholeBuffer.length,
    gzipBytes: gzip,
    brotliBytes: brotli,
    gzipRatio: wholeBuffer.length / gzip,
    brotliRatio: wholeBuffer.length / brotli,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
      fixture: `${width}x${height} deterministic noisy TIFF`,
      chunkBytes, rowsPerChunk, chunkTotal, summary,
    }, null, 2));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
