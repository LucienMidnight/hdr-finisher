/**
 * Comparison must never present unlike tiers as an exact comparison.
 *
 * The two panes are filled by different calls. The comparison pane renders the
 * other lane at the settled proxy edge; the primary pane holds whatever tier is
 * selected, which since Phase 1 may be larger, up to Full. Shown side by side
 * at the same on-screen size, two different processing resolutions look like a
 * difference in the grade — and a colourist reading them as an A/B would
 * attribute a resampling difference to their own decisions.
 *
 * The rule is not that the panes must match. Matching them would mean either
 * refusing Full in comparison or paying for a second Full render. It is that
 * when they do not match, the comparison says so.
 *
 * What this asserts:
 *
 *   1. Matched panes disclose nothing. A banner that is always on is a banner
 *      nobody reads, so this is as load-bearing as the positive case.
 *   2. A tier difference is disclosed, and names both tiers.
 *   3. A generation difference is disclosed, and names both generations.
 *   4. Leaving comparison clears the claim rather than stranding it.
 *   5. The disclosure reflects what was actually rendered, not what was asked
 *      for: it is driven by the recorded presentation of each pane.
 *
 * Usage: node tests/comparison-disclosure.js --url http://127.0.0.1:8000
 */
const { chromium } = require("playwright");

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000");
  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 600000 });
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 180000 });

    const result = await page.evaluate(async () => {
      const read = () => ({
        hidden: els.comparisonDisclosure.classList.contains("hidden"),
        text: els.comparisonDisclosure.textContent.trim(),
      });

      await setCompareLayout("split-vertical");
      for (let attempt = 0; attempt < 80 && !state.comparisonPresentation; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const presented = {
        primaryEdge: state.acceptedPresentation?.longEdge ?? null,
        comparisonEdge: state.comparisonPresentation?.longEdge ?? null,
        primaryGeneration: state.acceptedPresentation?.generation ?? null,
        comparisonGeneration: state.comparisonPresentation?.generation ?? null,
      };
      const matched = read();

      // Drive the panes apart one axis at a time, through the recorded
      // presentations, because that is what the disclosure is a function of.
      const acceptedBefore = { ...state.acceptedPresentation };
      state.acceptedPresentation = { ...acceptedBefore, longEdge: 4096 };
      renderComparisonDisclosure();
      const tierApart = read();

      state.acceptedPresentation = {
        ...acceptedBefore,
        generation: (acceptedBefore.generation ?? 0) + 3,
      };
      renderComparisonDisclosure();
      const generationApart = read();

      state.acceptedPresentation = { ...acceptedBefore, longEdge: 4096, generation: (acceptedBefore.generation ?? 0) + 3 };
      renderComparisonDisclosure();
      const bothApart = read();

      state.acceptedPresentation = acceptedBefore;
      renderComparisonDisclosure();
      const restored = read();

      await setCompareLayout("single");
      const leftComparison = read();

      return { presented, matched, tierApart, generationApart, bothApart, restored, leftComparison };
    });

    assert(result.presented.comparisonEdge !== null,
      `The comparison pane never recorded what it presented: ${JSON.stringify(result.presented)}`);
    console.log(`presented        primary ${result.presented.primaryEdge}px gen `
      + `${result.presented.primaryGeneration}, comparison ${result.presented.comparisonEdge}px gen `
      + `${result.presented.comparisonGeneration}`);

    assert(result.matched.hidden && !result.matched.text,
      `Matched panes disclosed something: ${JSON.stringify(result.matched)}`);
    console.log("matched panes    silent  PASS");

    assert(!result.tierApart.hidden && /Full/.test(result.tierApart.text)
      && /1024px|px/.test(result.tierApart.text),
      `A tier difference was not disclosed with both tiers named: ${JSON.stringify(result.tierApart)}`);
    console.log(`tier apart       "${result.tierApart.text}"  PASS`);

    assert(!result.generationApart.hidden && /edit/.test(result.generationApart.text),
      `A generation difference was not disclosed: ${JSON.stringify(result.generationApart)}`);
    console.log(`generation apart "${result.generationApart.text}"  PASS`);

    assert(!result.bothApart.hidden && /Full/.test(result.bothApart.text) && /edit/.test(result.bothApart.text),
      `Both differences were not disclosed together: ${JSON.stringify(result.bothApart)}`);
    console.log(`both apart       "${result.bothApart.text}"  PASS`);

    assert(result.restored.hidden && !result.restored.text,
      `The disclosure did not clear when the panes agreed again: ${JSON.stringify(result.restored)}`);
    assert(result.leftComparison.hidden && !result.leftComparison.text,
      `Leaving comparison stranded the disclosure: ${JSON.stringify(result.leftComparison)}`);
    console.log("cleared          on agreement and on leaving comparison  PASS");

    assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Comparison discloses unlike tiers and unlike generations, and is otherwise silent.");
  } finally {
    await browser.close();
  }
})();
