const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const directory = path.resolve(process.argv[2] || path.join("output", "avif-gainmap-chroma"));

async function main() {
  const files = fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".avif"))
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
  if (!files.length) throw new Error(`No AVIF files found in ${directory}`);
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage();
  try {
    const version = browser.version();
    const results = [];
    for (const name of files) {
      const payload = fs.readFileSync(path.join(directory, name)).toString("base64");
      const result = await page.evaluate(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight, complete: image.complete };
      }, `data:image/avif;base64,${payload}`);
      results.push({ name, ...result });
    }
    if (results.some((result) => !result.complete || result.width <= 0 || result.height <= 0)) {
      throw new Error(`Chromium failed to decode one or more files: ${JSON.stringify(results)}`);
    }
    console.log(JSON.stringify({ browser: `Microsoft Edge ${version}`, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
