const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8000";

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem("hdr-finisher:high-quality-preview:v1", "true");
    localStorage.setItem("hdr-finisher:library-show-all-files", "true");
    localStorage.setItem("hdr-finisher:scope-zoom:v1", "10000");
    localStorage.setItem("hdr-finisher:compare-layout:v1", "side-vertical");
    localStorage.setItem("hdr-finisher-source-collapsed", "true");
    localStorage.setItem("hdr-finisher-layout:1280", JSON.stringify({ railW: 380, gradeW: 420, dockH: 340, dockOpen: false, dockTab: "technical" }));
    localStorage.setItem("hdr-finisher-chrome-proof-v1", JSON.stringify({ format: "avif_gain_map", target: "4000", showWatermark: false }));
  });

  let warmFolder = null;
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const groupState = await page.locator("section.control-group").evaluateAll((groups) => groups.map((group) => ({
      collapsed: group.classList.contains("collapsed"),
      expanded: group.querySelector(".group-toggle")?.getAttribute("aria-expanded"),
    })));
    if (!groupState.length || groupState.some((group) => !group.collapsed || group.expanded !== "false")) {
      throw new Error(`Every grade group should start collapsed: ${JSON.stringify(groupState)}`);
    }

    const startup = await page.evaluate(() => ({
      fasterDragging: document.querySelector("#settings-faster-dragging")?.checked,
      scopeZoom: document.querySelector("#scope-zoom")?.value,
      compareLayout: document.querySelector("#preview-stage")?.dataset.compareLayout,
      sourceCollapsed: document.querySelector(".source-rail")?.classList.contains("collapsed"),
      sourceSettingsExpanded: document.querySelector("#source-settings-toggle")?.getAttribute("aria-expanded"),
      metadataExpanded: document.querySelector("#metadata-toggle")?.getAttribute("aria-expanded"),
      proofFormat: document.querySelector("#chrome-proof-format")?.value,
      proofTarget: document.querySelector("#chrome-proof-target")?.value,
      proofWatermark: document.querySelector("#chrome-proof-watermark-toggle")?.checked,
    }));

    // Auto can fall back before telemetry arrives, even if Auto is enabled later.
    if(!['auto','1000'].includes(startup.proofTarget))throw Error(`Proof target retained a non-default value: ${startup.proofTarget}`);
    const expected = {
      fasterDragging: false,
      scopeZoom: "4000",
      compareLayout: "single",
      sourceCollapsed: true,
      sourceSettingsExpanded: "false",
      metadataExpanded: "false",
      proofFormat: "jpeg_ultrahdr",
      proofTarget: startup.proofTarget,
      proofWatermark: true,
    };
    if (JSON.stringify(startup) !== JSON.stringify(expected)) {
      throw new Error(`Startup did not return to defaults. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(startup)}.`);
    }

    const library = page.frame({url:/\/library(?:\?|$)/});
    // Since Library batch 5d (3849ef8a) drawing pipelines are prepared after the
    // first grid picture, so show one small generated photo in a temporary folder.
    warmFolder = (require("node:fs").mkdirSync(require("node:path").resolve(__dirname,"../output/startup-state"),{recursive:true}), require("node:fs").mkdtempSync(require("node:path").resolve(__dirname,"../output/startup-state/photos-")));
    {
      require("node:fs").copyFileSync(require("node:path").resolve(__dirname,"fixtures/library_photo.png"), require("node:path").join(warmFolder,"first.png"));
      await page.evaluate(() => activateWorkflowTab("import"));
      await library.waitForFunction(() => window.HDRLibrary);
      await library.evaluate(folder => HDRLibrary.browse(folder), warmFolder);
      await library.locator("#grid-space canvas[data-picture-key]").first().waitFor({timeout:60000});
      await library.waitForFunction(() => HDRIdleWarmup.results.library === "ready", null, {timeout:120000});
    }
    const fixture = require("node:path").resolve(__dirname,"fixtures/sdr_gradient.png");
    const timing = await library.evaluate(async photo => {
      const meta = await fetch("/api/library/picture", {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({path:photo,edge:640,quality:"quick"})}).then(r=>r.json());
      if (!meta.key) throw Error(JSON.stringify(meta));
      const canvas=document.createElement("canvas"); document.body.append(canvas);
      const times=[];
      for(let index=0;index<5;index++) {
        const start=performance.now();
        await HDRLibraryPictures.show(meta,canvas,new AbortController().signal,()=>true,false);
        times.push(performance.now()-start);
      }
      canvas.remove();
      const warm=times.slice(1).sort((a,b)=>a-b);
      return {first:times[0],median:(warm[1]+warm[2])/2,raw:HDRIdleWarmup.results.library};
    }, fixture);
    console.log(`First Library GPU draw: ${timing.first.toFixed(1)} ms; warm median ${timing.median.toFixed(1)} ms (limit 500 ms or 2× median).`);
    if (timing.first > 500 && timing.first > 2*timing.median) throw Error("First Library GPU draw exceeded the idle-launch limit.");
    if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join(" | ")}`);
    console.log("Ephemeral startup-state browser test passed.");
  } finally {
    await browser.close();
    if (warmFolder) require("node:fs").rmSync(warmFolder, {recursive:true, force:true});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
