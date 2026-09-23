// Phase 0 item 7 / PRD 15.27 -- export/reference parity.
//
//   node tests/performance/export-parity.js --url http://127.0.0.1:8799
//
// The finishing-app contract is perceptual: the preview has to agree with the
// file the user will deliver. Item 6 measured the preview against the
// renderer's own full-resolution frame; that comparison assumed the export
// agrees with the renderer. This run replaces the assumption with the file:
// a proof artifact is encoded through the app's export backend, decoded at
// real precision by the file-side checker, and compared with the retained
// presentation target's float readback in one named encoding.
//
// Two assertions are kept separate:
//
//   export correctness   the decoded file and its metadata agree with the
//                        settings it was declared with (peak within the
//                        declared ceiling, gain-map capacity, bit depth).
//   preview agrees       the decoded file, mapped through the preview's own
//                        display transform, matches the float readback.
//
// Both captures in the review sheets are 8-bit display-referred screenshots
// and are labelled SDR-only. They are the perceptual artifact for the owner;
// every numeric claim rests on the float readback and the decode.
//
// The Chromium surface cannot present an rgba16float target, so a run there is
// recorded as SDR-only and makes no HDR precision claim. The packaged HDR
// surface is the configuration that can sign HDR classes.
//
//   node tests/run-in-electron.js tests/performance/export-parity.js \
//     --output output/performance/electron-export-parity.json

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureFitFilteringFixture, BANDS, BAND_HEIGHT, WIDTH, HEIGHT } = require("./fit-filtering-fixture.js");

const ROOT = path.join(__dirname, "..", "..");
const SETTLE_MS = 600;
const TIER_CANDIDATES = ["1024", "2048", "4096"];
const READBACK_STRIP_ROWS = 384;
const PROOF_TIMEOUT_MS = 1_800_000;
const TRACKED_DEFAULTS = {
  grain_amount: 0,
  grain_size: 50,
  halation_amount: 0,
  bloom_amount: 0,
  texture_amount: 0,
  clarity_amount: 0,
  sharpen_amount: 0,
};
const SCENARIOS = [
  {
    id: "grain",
    band: "smooth",
    settings: [
      ["current.film_look.grain_amount", 40],
      ["current.film_look.grain_size", 60],
    ],
  },
  {
    id: "detail",
    band: "texture",
    settings: [
      ["current.detail.texture_amount", 30],
      ["current.detail.clarity_amount", 40],
      ["current.detail.sharpen_amount", 30],
    ],
  },
  {
    id: "denoise",
    band: "noise",
    denoise: true,
    settings: [],
  },
  {
    id: "halation",
    band: "halation",
    settings: [
      ["current.film_look.halation_amount", 35],
      ["current.film_look.bloom_amount", 25],
    ],
  },
  { id: "fine-detail", band: "fine", settings: [] },
  { id: "highlights", band: "highlights", settings: [] },
];
// Declared delivery settings per format, applied through the app's own export
// controls so the proof request and the export request read the same values.
const DECLARED_SETTINGS = {
  jpeg_ultrahdr: {
    quality: 90,
    jpeg_gain_map_quality: 100,
    jpeg_gain_map_scale: "full",
    jpeg_chroma_subsampling: "420",
    dithering: "auto",
  },
  avif_gain_map: {
    quality: 90,
    avif_bit_depth: 10,
    avif_chroma_subsampling: "420",
    avif_gain_map_quality: 90,
    avif_gain_map_scale: "half",
    dithering: "auto",
  },
};

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function closestTier(displayLongEdge) {
  let best = TIER_CANDIDATES[0];
  let bestDistance = Infinity;
  for (const tier of TIER_CANDIDATES) {
    const distance = Math.abs(Math.log(Number(tier) / displayLongEdge));
    if (distance < bestDistance) { best = tier; bestDistance = distance; }
  }
  return best;
}

function saveDataUrl(dataUrl, filePath) {
  const comma = dataUrl.indexOf(",");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
}

function saveBase64(base64, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
}

function pythonExecutable() {
  if (process.env.HDR_FINISHER_PYTHON) return process.env.HDR_FINISHER_PYTHON;
  const candidate = path.join(ROOT, ".venv", "Scripts", "python.exe");
  return fs.existsSync(candidate) ? candidate : "python";
}

(async () => {
  const url = argument("--url", process.env.HDR_FINISHER_URL || "http://127.0.0.1:8799");
  const only = argument("--only", null);
  const format = argument("--format", "jpeg_ultrahdr");
  const proofTarget = argument("--peak", "1000");
  const deliveredKind = argument("--delivered", "proof");
  const output = argument("--output", path.join("output", "performance", `export-parity-${format}.json`));
  const reviewDirectory = argument("--review", path.join(path.dirname(output), "export-parity"));
  const fixture = argument("--input", null) || ensureFitFilteringFixture();
  const declared = DECLARED_SETTINGS[format];
  assert(declared, `No declared settings for format ${format}`);
  assert(["proof", "export"].includes(deliveredKind), `--delivered must be proof or export, got ${deliveredKind}`);

  const browser = await chromium.launch({
    headless: true,
    channel: argument("--channel", "msedge"),
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const waitReady = () => page.waitForFunction(() => viewerState().status === "ready", null, { timeout: 900000 });
  const waitDenoiseReady = async () => {
    await page.waitForFunction(
      () => ["ready", "error"].includes(state.denoiseRuntime[state.currentView].status),
      null, { timeout: 900000 },
    );
    const status = await page.evaluate(() => state.denoiseRuntime[state.currentView].status);
    assert(status === "ready", `Denoise did not reach ready: ${status}`);
  };
  const settle = async () => {
    await waitReady();
    await page.evaluate(async () => { await state.gpuPreview.waitForSubmittedWork(); });
    await page.evaluate(() => window.HDRFinisherPerformance?.cancelRoiCatchUp?.());
    await waitReady();
    await page.waitForTimeout(SETTLE_MS);
  };

  const applyScenario = async (scenario) => {
    const resetReport = await page.evaluate(async (definition) => {
      if (state.denoise?.[state.currentView]?.enabled) await setDenoiseEnabled(false);
      const report = [];
      for (const control of document.querySelectorAll(
        "[data-path^='current.film_look.'], [data-path^='current.detail.']",
      )) {
        const isCheckbox = control.type === "checkbox";
        const isSelect = control.tagName === "SELECT";
        const before = isCheckbox ? control.checked : control.value;
        if (isCheckbox) {
          control.checked = control.defaultChecked;
        } else if (isSelect) {
          const option = control.querySelector("option[selected]") ?? control.options[0];
          control.value = option ? option.value : "";
        } else {
          control.value = control.defaultValue;
        }
        control.dispatchEvent(new Event("input", { bubbles: true }));
        report.push({
          path: control.dataset.path,
          before,
          after: isCheckbox ? control.checked : control.value,
          connected: control.isConnected,
        });
      }
      for (const [controlPath, value] of definition.settings) {
        const control = document.querySelector(`[data-path="${controlPath}"]`);
        if (!control) throw new Error(`Missing control ${controlPath}`);
        control.value = String(value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (definition.denoise) await setDenoiseEnabled(true);
      return report;
    }, scenario);
    if (scenario.denoise) await waitDenoiseReady();
    return resetReport;
  };

  // The run declares a delivery ceiling and applies it through the real
  // controls. Without one, the fixture's 72,000-nit speculars exceed what any
  // gain-map format can carry above a tone-mapped base, and the delivered file
  // would clip below the preview for a reason that says nothing about the
  // preview. The ceiling is the delivery spec the comparison is about.
  const applyDeliverySettings = async () => page.evaluate(() => {
    const bypass = document.querySelector('[data-section-path="hdr.highlight_section_enabled"]');
    if (bypass && bypass.getAttribute("aria-pressed") !== "true") bypass.click();
    const mode = document.querySelector("#hdr-compression-mode");
    if (mode && mode.value !== "peak_fit") {
      mode.value = "peak_fit";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const target = document.querySelector("#hdr-compression-target");
    if (target && Number(target.value) !== 1000) {
      target.value = "1000";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const lane = state.adjustments?.[state.currentView] || {};
    return {
      highlightSectionEnabled: Boolean(lane.highlight_section_enabled),
      mode: lane.highlight_compression_mode,
      targetNits: lane.highlight_compression_target_nits,
    };
  });

  // The declared settings are applied through the app's own export controls so
  // the proof request and the export request read exactly the same values.
  const applyDeclaredSettings = async () => page.evaluate((settings) => {
    els.exportFormat.value = settings.format;
    els.exportFormat.dispatchEvent(new Event("change", { bubbles: true }));
    els.exportQuality.value = String(settings.quality);
    if (settings.jpeg_gain_map_quality !== undefined) {
      els.jpegGainMapQuality.value = String(settings.jpeg_gain_map_quality);
    }
    if (settings.jpeg_gain_map_scale !== undefined) {
      els.jpegGainMapScale.value = settings.jpeg_gain_map_scale;
    }
    if (settings.jpeg_chroma_subsampling !== undefined) {
      els.jpegUltrahdrChromaSubsampling.value = settings.jpeg_chroma_subsampling;
    }
    if (settings.avif_bit_depth !== undefined) {
      els.avifBitDepth.value = String(settings.avif_bit_depth);
    }
    if (settings.avif_chroma_subsampling !== undefined) {
      els.avifChromaSubsampling.value = settings.avif_chroma_subsampling;
    }
    if (settings.avif_gain_map_quality !== undefined) {
      els.avifGainMapQuality.value = String(settings.avif_gain_map_quality);
    }
    if (settings.avif_gain_map_scale !== undefined) {
      els.avifGainMapScale.value = settings.avif_gain_map_scale;
    }
    if (settings.dithering !== undefined && !els.exportDithering.disabled) {
      els.exportDithering.value = settings.dithering;
    }
    return {
      format: els.exportFormat.value,
      quality: Number(els.exportQuality.value),
      jpeg_gain_map_quality: Number(els.jpegGainMapQuality.value),
      jpeg_gain_map_scale: els.jpegGainMapScale.value,
      jpeg_chroma_subsampling: els.exportFormat.value === "jpeg_ultrahdr"
        ? els.jpegUltrahdrChromaSubsampling.value
        : els.jpegChromaSubsampling.value,
      avif_bit_depth: Number(els.avifBitDepth.value),
      avif_chroma_subsampling: els.avifChromaSubsampling.value,
      avif_gain_map_chroma_subsampling: "444",
      avif_gain_map_quality: Number(els.avifGainMapQuality.value),
      avif_gain_map_scale: els.avifGainMapScale.value,
      dithering: els.exportDithering.disabled ? "off" : els.exportDithering.value,
    };
  }, { format, ...declared });

  const readPrecision = async () => page.evaluate(() => {
    const target = state.gpuPreview.presentationTarget;
    const targetFormat = target ? String(target.format) : null;
    const lane = state.adjustments?.[state.currentView] || {};
    const capabilities = {};
    for (const [key, value] of Object.entries(state.capabilities || {})) {
      capabilities[key] = value?.status ?? null;
    }
    return {
      targetFormat,
      realPrecision: Boolean(targetFormat && targetFormat.includes("16float")),
      referenceWhiteNits: projectReferenceWhiteNits(),
      ceilingNits: lane.highlight_compression_target_nits ?? null,
      ceilingActive: Boolean(lane.highlight_section_enabled) && lane.highlight_compression_mode !== "off",
      lane: state.currentView,
      capabilities,
    };
  });

  const readPresentationFrame = async () => page.evaluate(async ({ stripRows }) => {
    const presentationTarget = state.gpuPreview.presentationTarget;
    if (!presentationTarget?.valid || !presentationTarget.texture) {
      throw new Error("no retained presentation target to read back");
    }
    const width = presentationTarget.width;
    const height = presentationTarget.height;
    const format = String(presentationTarget.format);
    const values = new Float32Array(width * height * 4);
    for (let y0 = 0; y0 < height; y0 += stripRows) {
      const rows = Math.min(stripRows, height - y0);
      const region = await state.gpuPreview.readPresentationRegion(width, rows, 0, y0);
      if (!region?.values) throw new Error(`readback failed at row ${y0}`);
      const source = region.values;
      const base = y0 * width * 4;
      for (let index = 0; index < source.length; index += 1) values[base + index] = source[index];
    }
    // An 8-bit canvas target is bgra8unorm, and the readback does not reorder;
    // the comparison consumes RGBA, so reorder once here.
    const bgra = !format.includes("16float");
    if (bgra) {
      for (let index = 0; index < values.length; index += 4) {
        const blue = values[index];
        values[index] = values[index + 2];
        values[index + 2] = blue;
      }
    }
    const bytes = new Uint8Array(values.buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return {
      width,
      height,
      format,
      channelOrder: bgra ? "RGBA (reordered from BGRA)" : "RGBA",
      float32: btoa(binary),
    };
  }, { stripRows: READBACK_STRIP_ROWS });

  const buildProof = async (scenarioId) => {
    const requested = await page.evaluate(async ({ proofFormat, target }) => {
      activateWorkflowTab("proof", { focus: false });
      const formatSelect = document.querySelector("#chrome-proof-format");
      const option = [...formatSelect.options].find((entry) => entry.value === proofFormat);
      if (!option || option.disabled) {
        throw new Error(`proof format ${proofFormat} is unavailable: ${option?.title || "no option"}`);
      }
      formatSelect.value = proofFormat;
      formatSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const targetSelect = document.querySelector("#chrome-proof-target");
      const targetOption = [...targetSelect.options].find((entry) => entry.value === target);
      if (!targetOption) throw new Error(`proof target ${target} is not a preset option`);
      targetSelect.value = target;
      targetSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const watermark = document.querySelector("#chrome-proof-watermark-toggle");
      if (watermark.checked) {
        watermark.checked = false;
        watermark.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Build proof enables the proof and forces an encode with the current
      // graph, so a cached artifact can never be mistaken for this scenario's.
      const refresh = document.querySelector("#chrome-proof-refresh");
      if (refresh.disabled) throw new Error("Build proof is disabled");
      refresh.click();
      return { format: proofFormat, target };
    }, { proofFormat: format, target: proofTarget });

    await page.waitForFunction(
      (expected) => {
        const status = document.querySelector("#chrome-proof-status");
        return Boolean(state.proofArtifact)
          && state.proofArtifact.format === expected
          && state.proofDirty === false
          && status?.dataset.state === "idle";
      },
      format,
      { timeout: PROOF_TIMEOUT_MS },
    );
    await page.waitForFunction(() => {
      const image = document.querySelector("#chrome-proof-image");
      return Boolean(image) && image.style.display !== "none" && image.complete && image.naturalWidth > 0;
    }, null, { timeout: 120000 });

    const info = await page.evaluate(() => ({
      artifact: {
        artifact_id: state.proofArtifact.artifact_id,
        format: state.proofArtifact.format,
        media_type: state.proofArtifact.media_type,
        byte_size: state.proofArtifact.byte_size,
        sha256: state.proofArtifact.sha256,
        url: state.proofArtifact.url,
        width: state.proofArtifact.width,
        height: state.proofArtifact.height,
        quality: state.proofArtifact.quality,
        encoded_headroom: state.proofArtifact.encoded_headroom,
        jpeg_gain_map: state.proofArtifact.jpeg_gain_map,
      },
      reconstruction: state.proofReconstruction ? {
        target_label: state.proofReconstruction.target_label,
        resolved_headroom: state.proofReconstruction.resolved_headroom,
        encoded_headroom: state.proofReconstruction.encoded_headroom,
        capped_by_encoded_headroom: state.proofReconstruction.capped_by_encoded_headroom,
      } : null,
      previewMode: state.proofPreview,
      deliveryAvailable: state.proofDeliveryAvailable,
      watermark: state.proofWatermarkEnabled,
      statusText: document.querySelector("#chrome-proof-status")?.textContent || "",
    }));

    const download = await page.evaluate(async (artifactUrl) => {
      const response = await fetch(artifactUrl);
      if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      return { base64: btoa(binary), mediaType: response.headers.get("content-type") };
    }, info.artifact.url);
    assert(download.mediaType === info.artifact.media_type,
      `${scenarioId}: artifact media type mismatch: ${download.mediaType} vs ${info.artifact.media_type}`);

    return { requested, info, base64: download.base64 };
  };

  const captureSheets = async (scenarioId, proofImage, proofBox, precision, proofInfo) => {
    const previewPng = await page.locator("#preview-canvas").screenshot();
    const previewBox = await page.locator("#preview-canvas").boundingBox();
    assert(previewBox && proofBox, `${scenarioId}: a capture target has no box`);
    const sizeDifference = Math.abs(previewBox.width - proofBox.width) + Math.abs(previewBox.height - proofBox.height);
    assert(sizeDifference <= 2,
      `${scenarioId}: preview and proof boxes differ: ${JSON.stringify({ previewBox, proofBox })}`);

    const sheet = await page.evaluate(async ({ previewBase64, proofBase64, captionLines, gap }) => {
      const decode = async (base64) => {
        const response = await fetch(`data:image/png;base64,${base64}`);
        return createImageBitmap(await response.blob());
      };
      const preview = await decode(previewBase64);
      const proof = await decode(proofBase64);
      const width = Math.min(preview.width, proof.width);
      const height = Math.min(preview.height, proof.height);
      const captionHeight = 18 * captionLines.length + 14;
      const compose = (draw) => {
        const canvas = document.createElement("canvas");
        canvas.width = draw.width;
        canvas.height = height + captionHeight;
        const context = canvas.getContext("2d");
        context.fillStyle = "#101014";
        context.fillRect(0, 0, canvas.width, canvas.height);
        draw.draw(context);
        context.fillStyle = "#e6e6ee";
        context.font = "12px Consolas, 'Courier New', monospace";
        captionLines.forEach((line, index) => {
          context.fillText(line, 8, height + 16 + index * 18);
        });
        return canvas.toDataURL("image/png");
      };
      const sideBySide = compose({
        width: width * 2 + gap,
        draw(context) {
          context.drawImage(preview, 0, 0, width, height, 0, 0, width, height);
          context.drawImage(proof, 0, 0, width, height, width + gap, 0, width, height);
          context.fillStyle = "#ff5d5d";
          context.fillRect(width, 0, gap, height);
        },
      });
      const difference = compose({
        width,
        draw(context) {
          const left = document.createElement("canvas");
          left.width = width;
          left.height = height;
          const leftContext = left.getContext("2d", { willReadFrequently: true });
          leftContext.drawImage(preview, 0, 0, width, height, 0, 0, width, height);
          const right = document.createElement("canvas");
          right.width = width;
          right.height = height;
          const rightContext = right.getContext("2d", { willReadFrequently: true });
          rightContext.drawImage(proof, 0, 0, width, height, 0, 0, width, height);
          const leftData = leftContext.getImageData(0, 0, width, height).data;
          const rightData = rightContext.getImageData(0, 0, width, height).data;
          const output = leftContext.createImageData(width, height);
          for (let index = 0; index < output.data.length; index += 4) {
            output.data[index] = Math.min(255, Math.abs(leftData[index] - rightData[index]) * 4);
            output.data[index + 1] = Math.min(255, Math.abs(leftData[index + 1] - rightData[index + 1]) * 4);
            output.data[index + 2] = Math.min(255, Math.abs(leftData[index + 2] - rightData[index + 2]) * 4);
            output.data[index + 3] = 255;
          }
          context.putImageData(output, 0, 0);
        },
      });
      return { sideBySide, difference, width, height };
    }, {
      previewBase64: previewPng.toString("base64"),
      proofBase64: proofImage.toString("base64"),
      gap: 8,
      captionLines: [
        `export/reference parity · ${scenarioId} · ${proofInfo.info.artifact.format} · proof target ${proofTarget} nits`,
        "left: preview canvas capture (8-bit, SDR-only) · right: Chromium proof capture (8-bit, SDR-only)",
        `real-precision reads: preview ${precision.targetFormat} presentation readback + decoded ${format} (numeric table in the summary)`,
        precision.realPrecision
          ? "HDR surface: the float readback carries the numeric claim; this sheet is SDR-only"
          : "SDR surface: the preview target is not float, so this run makes no HDR precision claim",
      ],
    });

    const sideBySidePath = path.join(reviewDirectory, `${scenarioId}-side-by-side.png`);
    const differencePath = path.join(reviewDirectory, `${scenarioId}-difference-x4.png`);
    const proofPath = path.join(reviewDirectory, `${scenarioId}-proof.png`);
    const previewPath = path.join(reviewDirectory, `${scenarioId}-preview.png`);
    saveDataUrl(sheet.sideBySide, sideBySidePath);
    saveDataUrl(sheet.difference, differencePath);
    fs.writeFileSync(proofPath, proofImage);
    fs.writeFileSync(previewPath, previewPng);
    return {
      sideBySide: path.relative(path.dirname(output), sideBySidePath).replaceAll("\\", "/"),
      difference: path.relative(path.dirname(output), differencePath).replaceAll("\\", "/"),
      proof: path.relative(path.dirname(output), proofPath).replaceAll("\\", "/"),
      preview: path.relative(path.dirname(output), previewPath).replaceAll("\\", "/"),
      box: { width: previewBox.width, height: previewBox.height },
      differenceImageNote: "absolute difference x4 of the two 8-bit captures; SDR-only",
    };
  };

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.setInputFiles("#file-input", fixture);
    await page.waitForFunction(() => state.session?.session_id, null, { timeout: 900000 });
    await page.waitForTimeout(500);
    const interpretationGated = await page.locator("#interpretation-gate").isVisible().catch(() => false);
    if (interpretationGated) await page.click("#accept-interpretation");
    await page.waitForFunction(() => state.gpuPreview?.available === true, null, { timeout: 120000 });
    await waitReady();

    const delivery = await applyDeliverySettings();
    assert(delivery.highlightSectionEnabled && delivery.mode === "peak_fit" && delivery.targetNits === 1000,
      `Delivery ceiling did not apply: ${JSON.stringify(delivery)}`);
    const declaredSettings = await applyDeclaredSettings();
    assert(declaredSettings.format === format, `Export format did not apply: ${declaredSettings.format}`);
    const sourceSize = await page.evaluate(() => [state.session.source.width, state.session.source.height]);
    const [sourceWidth, sourceHeight] = sourceSize;
    await page.evaluate(() => setZoomMode("fit"));
    await settle();

    const display = await page.evaluate(() => {
      const rect = els.previewCanvas.getBoundingClientRect();
      return {
        longEdge: displayedLongEdge(),
        dpr: window.devicePixelRatio || 1,
        canvasBox: { width: Math.round(rect.width), height: Math.round(rect.height) },
        roiMode: window.HDRFinisherPerformance?.roiPreviewMode?.() ?? null,
      };
    });
    // The preview side is the preview as displayed at Fit, so the tier is the
    // display tier, not whatever preference the packaged app last persisted.
    // The override is re-asserted after applyPreviewResolution for the same
    // reason item 6 does it: the shell's preference echo drops it otherwise.
    const displayTier = closestTier(display.longEdge);
    assert(Number(displayTier) < sourceWidth,
      `The display tier ${displayTier} is not below the source, so there is nothing to compare`);
    await page.evaluate((tier) => {
      applyExecutionOverride("tiled");
      applyPreviewResolution(tier);
    }, displayTier);
    await settle();

    const precision = await readPrecision();
    const decodeCapability = precision.capabilities[format === "jpeg_ultrahdr" ? "ultrahdr_encoder" : "avif_gain_map_encoder"];
    assert(decodeCapability === "available", `The ${format} encoder is not available: ${decodeCapability}`);

    const scenarios = [];
    for (const scenario of SCENARIOS.filter((entry) => !only || only.split(",").includes(entry.id))) {
      const band = BANDS.find((entry) => entry.id === scenario.band);
      assert(band, `Scenario ${scenario.id} names an unknown band ${scenario.band}`);
      const resetReport = await applyScenario(scenario);
      await settle();

      const frame = await readPresentationFrame();
      assert(Math.abs(Math.max(frame.width, frame.height) - Number(displayTier)) <= 2,
        `${scenario.id}: the presentation target is ${frame.width}x${frame.height}, not the display tier ${displayTier}`);
      const scenarioPrecision = { ...precision, targetFormat: frame.format };
      const previewBinPath = path.join(reviewDirectory, `${scenario.id}-preview.f32`);
      const previewJsonPath = path.join(reviewDirectory, `${scenario.id}-preview.json`);
      saveBase64(frame.float32, previewBinPath);
      fs.writeFileSync(previewJsonPath, `${JSON.stringify({
        scenario: scenario.id,
        lane: scenarioPrecision.lane,
        target: { width: frame.width, height: frame.height, format: frame.format, realPrecision: scenarioPrecision.realPrecision },
        channelOrder: frame.channelOrder,
        box: display.canvasBox,
        referenceWhiteNits: scenarioPrecision.referenceWhiteNits,
        ceilingNits: scenarioPrecision.ceilingNits,
        ceilingActive: scenarioPrecision.ceilingActive,
        hdrSurface: scenarioPrecision.realPrecision,
        bands: BANDS.map((entry) => ({ ...entry, height: BAND_HEIGHT })),
        fixture: { width: WIDTH, height: HEIGHT },
      }, null, 2)}\n`);

      const proof = await buildProof(scenario.id);
      const proofPath = path.join(reviewDirectory, `${scenario.id}-delivered${proof.info.artifact.format === "avif_gain_map" ? ".avif" : ".jpg"}`);
      saveBase64(proof.base64, proofPath);
      const proofImage = await page.locator("#chrome-proof-image").screenshot();
      const proofBox = await page.locator("#chrome-proof-image").boundingBox();
      // Capture the preview with the proof hidden: the proof image is painted
      // over the canvas, so a canvas screenshot taken while it is shown would
      // capture the proof's pixels.
      await page.evaluate(() => {
        const toggle = document.querySelector("#chrome-proof-toggle");
        if (toggle.checked) toggle.click();
      });
      const sheets = await captureSheets(scenario.id, proofImage, proofBox, scenarioPrecision, proof);
      await page.evaluate(() => {
        const toggle = document.querySelector("#chrome-proof-toggle");
        if (!toggle.checked) toggle.click();
      });

      let deliveredPath = proofPath;
      let deliveredSource = "proof-artifact";
      let exportResult = null;
      if (deliveredKind === "export") {
        const exportPath = path.join(ROOT, reviewDirectory, `${scenario.id}-export${format === "avif_gain_map" ? ".avif" : ".jpg"}`);
        fs.mkdirSync(path.dirname(exportPath), { recursive: true });
        if (fs.existsSync(exportPath)) fs.rmSync(exportPath);
        exportResult = await page.evaluate(async ({ outputPath }) => {
          const response = await requestSessionExport(outputPath, true);
          return response.json();
        }, { outputPath: exportPath });
        assert(exportResult.accepted, `${scenario.id}: export refused: ${exportResult.message}`);
        assert(fs.existsSync(exportPath), `${scenario.id}: export reported success but wrote no file`);
        deliveredPath = exportPath;
        deliveredSource = "export";
      }

      const settings = {
        ...declaredSettings,
        ceiling_nits: scenarioPrecision.ceilingNits,
        ceiling_active: scenarioPrecision.ceilingActive,
        encode_scale: deliveredSource === "export" ? "delivery" : "proof",
        sha256: deliveredSource === "proof-artifact" ? proof.info.artifact.sha256 : null,
        delivered_source: deliveredSource,
      };
      if (deliveredSource === "proof-artifact") {
        settings.expected_width = proof.info.artifact.width;
        settings.expected_height = proof.info.artifact.height;
        settings.expected_encoded_headroom = proof.info.artifact.encoded_headroom;
      } else {
        // A full-size export's gain-map capacity is chosen by the encoder from
        // the authored peak at that resolution, so it is recorded but not
        // asserted equal to the proof-sized artifact's.
        settings.expected_width = sourceWidth;
        settings.expected_height = sourceHeight;
      }
      const settingsPath = path.join(reviewDirectory, `${scenario.id}-settings.json`);
      fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      const comparePath = path.join(reviewDirectory, `${scenario.id}-compare.json`);
      execFileSync(pythonExecutable(), [
        path.join(__dirname, "export_parity_check.py"),
        "--delivered", path.resolve(deliveredPath),
        "--format", format,
        "--preview-json", path.resolve(previewJsonPath),
        "--preview-bin", path.resolve(previewBinPath),
        "--settings", path.resolve(settingsPath),
        "--review-dir", path.resolve(reviewDirectory),
        "--out", path.resolve(comparePath),
      ], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
      const comparison = JSON.parse(fs.readFileSync(comparePath, "utf8"));

      scenarios.push({
        id: scenario.id,
        band: { id: band.id, label: band.label, y: band.y, height: BAND_HEIGHT },
        settings: Object.fromEntries(scenario.settings),
        denoise: Boolean(scenario.denoise),
        resetReport,
        preview: {
          target: { width: frame.width, height: frame.height, format: frame.format, realPrecision: scenarioPrecision.realPrecision },
          channelOrder: frame.channelOrder,
          box: display.canvasBox,
          referenceWhiteNits: scenarioPrecision.referenceWhiteNits,
          ceilingNits: scenarioPrecision.ceilingNits,
          ceilingActive: scenarioPrecision.ceilingActive,
          readbackBin: path.relative(path.dirname(output), previewBinPath).replaceAll("\\", "/"),
        },
        proof: {
          requested: proof.requested,
          previewMode: proof.info.previewMode,
          deliveryAvailable: proof.info.deliveryAvailable,
          watermark: proof.info.watermark,
          statusText: proof.info.statusText,
          reconstruction: proof.info.reconstruction,
          artifact: { ...proof.info.artifact, url: undefined },
        },
        delivered: {
          source: deliveredSource,
          path: path.relative(path.dirname(output), deliveredPath).replaceAll("\\", "/"),
          exportResult,
        },
        sheets,
        assertions: {
          exportCorrectness: comparison.exportCorrectness,
          encoding: comparison.encoding,
          precision: comparison.precision,
          comparison: comparison.comparison,
        },
        comparisonFiles: comparison.files,
      });

      const whole = comparison.comparison.whole;
      const focus = comparison.comparison.bands[band.id];
      const ceiling = comparison.exportCorrectness.ceiling || {};
      console.log(
        scenario.id.padEnd(11),
        `proof ${proof.info.artifact.width}x${proof.info.artifact.height}`,
        `preview ${frame.width}x${frame.height} ${frame.format}`,
        `| export ${comparison.exportCorrectness.ok ? "OK" : "FAIL"}`,
        ceiling.active
          ? `peak ${ceiling.peak_nits} nits (${ceiling.rule}; ${ceiling.exceed_count} above ${ceiling.allowed_nits})`
          : "no ceiling declared",
        `| focus ${band.id.padEnd(10)}`,
        `max ${String(focus.maxAbs).padStart(6)}`,
        `p99 ${String(focus.p99Abs).padStart(6)}`,
        `mean ${focus.meanAbs.toFixed(2).padStart(6)}`,
        `| whole max ${whole.maxAbs.toFixed(1)} p99 ${whole.p99Abs.toFixed(1)} mean ${whole.meanAbs.toFixed(2)} levels`,
      );
    }

    assert(pageErrors.length === 0, `Page errors were raised: ${JSON.stringify(pageErrors)}`);
    const summary = {
      url,
      generatedAt: new Date().toISOString(),
      method: {
        question: "Does the preview agree with the delivered file at the size the viewer displays?",
        delivered: deliveredKind === "export"
          ? "a real export through the app's export endpoint, decoded at real precision"
          : "a proof artifact encoded through the app's export backend, decoded at real precision",
        preview: "the retained presentation target at Fit, read back as float (half-float on an HDR surface)",
        commonEncoding: "the preview presentation encoding: display-referred, transfer-encoded, extended canvas convention",
        exportCorrectness: "decoded values and metadata versus the settings the file was declared with",
        sheets: "8-bit display-referred captures of the preview canvas and the Chromium proof, side-by-side and difference x4; SDR-only",
        precisionRule: "page captures are SDR-only; HDR claims rest on the float readback and the decode",
      },
      format,
      deliveredKind,
      proofTarget,
      declaredSettings,
      delivery,
      fixture: { path: fixture, width: WIDTH, height: HEIGHT, bandHeight: BAND_HEIGHT },
      display: { ...display, tier: displayTier },
      precision,
      interpretationGated,
      scenarios,
      pageErrors,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote ${output}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
