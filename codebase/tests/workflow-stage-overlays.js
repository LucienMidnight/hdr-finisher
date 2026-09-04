const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The mask editor canvas sits over the shared preview element, so a gizmo left
// drawn on it follows the image into Proof and Export.
async function overlayState(page) {
  return page.locator("#local-mask-overlay").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 8) inked += 1;
    return { inked, editing: canvas.classList.contains("editing") };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#grade-mode-local").click();

    const editResponse = page.waitForResponse((response) => response.url().includes("/edit-commands")
      && response.request().method() === "POST");
    await page.locator('[data-local-tool="linear_gradient"]').click();
    await page.locator("#local-add-adjustment").click();
    assert((await editResponse).ok(), "Creating the gradient failed.");
    await page.waitForFunction(() => {
      const local = selectedLocal();
      return local && localAuthoritativeMaskCache.get(local.id)?.signature === JSON.stringify(local.mask);
    });

    const grading = await overlayState(page);
    assert(grading.inked > 0 && grading.editing, "The gradient gizmo is not drawn on the Grade stage.");

    for (const stage of ["proof", "export"]) {
      await page.locator(`[data-workflow-tab="${stage}"]`).click();
      await page.waitForTimeout(400);
      const parked = await overlayState(page);
      assert(parked.inked === 0, `The gradient gizmo is still drawn on the ${stage} stage.`);
      assert(!parked.editing, `The mask editor still captures pointer input on the ${stage} stage.`);
    }

    await page.locator('[data-workflow-tab="grade"]').click();
    await page.waitForTimeout(600);
    const restored = await overlayState(page);
    assert(restored.inked > 0 && restored.editing, "The gradient gizmo did not come back on the Grade stage.");

    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
    console.log(JSON.stringify({ grading, restored }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
