const { chromium } = require("playwright");

const urlIndex = process.argv.indexOf("--url");
const baseUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const entries = [
    { name: "first.jpg", path: "/mock/first.jpg", kind: "file", supported: true, format: "jpg", kind_label: "JPEG image", size: 100, date_added_ms: 1, thumbnail_key: "first-v1" },
    { name: "target.avif", path: "/mock/target.avif", kind: "file", supported: true, format: "avif", kind_label: "AVIF image", size: 200, date_added_ms: 2, thumbnail_key: "target-v1" },
    { name: "broken.avif", path: "/mock/broken.avif", kind: "file", supported: true, format: "avif", kind_label: "AVIF image", size: 300, date_added_ms: 3, thumbnail_key: "broken-v1" },
    { name: "ambiguous.tif", path: "/mock/ambiguous.tif", kind: "file", supported: true, format: "tif", kind_label: "TIFF image", size: 400, date_added_ms: 4, thumbnail_key: "ambiguous-v1" },
  ];

  await page.route("**/api/media-browser?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ current: "/mock", parent: "/", entries, recents: [], pinned: [], locations: [], drives: [] }),
    });
  });
  await page.route("**/api/media-browser/thumbnail?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/mock/target.avif") await new Promise((resolve) => setTimeout(resolve, 250));
    if (path === "/mock/broken.avif") {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "preview decode failed" }) });
      return;
    }
    if (path === "/mock/ambiguous.tif") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: { code: "interpretation_required", message: "Color primaries are missing or not recognized.", reason: "unknown_color_primaries", profile_name: "Unknown Studio RGB" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "image/png", headers: { "Cache-Control": "no-store" }, body: tinyPng });
  });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => openMediaBrowser("source", "/mock"));
    await page.locator("#directory-browser").waitFor({ state: "visible" });

    await page.locator(".directory-browser-entry", { hasText: "first.jpg" }).click();
    await page.locator("#directory-browser-preview").waitFor({ state: "visible" });

    await page.locator(".directory-browser-entry", { hasText: "target.avif" }).click();
    assert(await page.locator("#directory-browser-preview").isHidden(), "The previous thumbnail remained visible while AVIF loaded.");
    assert((await page.locator("#directory-browser-selection").textContent()) === "target.avif", "The selected filename did not update immediately.");
    assert((await page.locator("#directory-browser-preview-note").textContent()).includes("Loading preview"), "The AVIF loading state was not shown.");
    await page.locator("#directory-browser-preview").waitFor({ state: "visible" });
    assert((await page.locator("#directory-browser-preview").getAttribute("alt")) === "Preview of target.avif", "The loaded AVIF thumbnail was not admitted.");

    await page.locator(".directory-browser-entry", { hasText: "target.avif" }).click();
    await page.locator(".directory-browser-entry", { hasText: "first.jpg" }).click();
    await page.locator("#directory-browser-preview").waitFor({ state: "visible" });
    await page.waitForTimeout(350);
    assert((await page.locator("#directory-browser-selection").textContent()) === "first.jpg", "A superseded AVIF selection replaced the current filename.");
    assert((await page.locator("#directory-browser-preview").getAttribute("alt")) === "Preview of first.jpg", "A superseded AVIF thumbnail replaced the current preview.");

    await page.locator(".directory-browser-entry", { hasText: "broken.avif" }).click();
    await page.waitForFunction(() => document.getElementById("directory-browser-preview-note")?.textContent?.includes("Preview unavailable"));
    assert(await page.locator("#directory-browser-preview").isHidden(), "A failed AVIF preview left stale pixels visible.");

    await page.locator(".directory-browser-entry", { hasText: "ambiguous.tif" }).click();
    await page.waitForFunction(() => document.querySelector(".media-browser-preview-image-frame")?.dataset.previewState === "interpretation-required");
    assert((await page.locator("#directory-browser-preview-note").textContent()).includes("Color interpretation required"), "The ambiguity message was not shown.");
    assert((await page.locator("#directory-browser-preview-note").textContent()).includes("Unknown Studio RGB"), "The detected ICC profile was not shown.");
    assert(await page.locator("#directory-browser-select").isEnabled(), "Open Image was disabled for an ambiguous source.");

    console.log(JSON.stringify({ loadingState: true, staleResponseRejected: true, failureVisible: true, interpretationRequired: true }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
