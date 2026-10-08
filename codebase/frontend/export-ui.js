const capabilityForFormat = {
  avif_gain_map: "avif_gain_map_encoder",
  jpeg_ultrahdr: "ultrahdr_encoder",
  jpegxl_hdr: "jpegxl_export",
  sdr_jpegxl: "jpegxl_export",
  sdr_jpeg: "pillow",
  sdr_png: "pillow",
};

const exportPresetMappings = {
  avif_gain_map: {
    web_default: { quality: 85, avifBitDepth: "10", avifChromaSubsampling: "420", avifGainMapQuality: 85, avifGainMapScale: "half", exportDithering: "off", exportMetadataPolicy: "none" },
    web_optimized: { quality: 75, avifBitDepth: "10", avifChromaSubsampling: "420", avifGainMapQuality: 70, avifGainMapScale: "half", exportDithering: "off", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, avifBitDepth: "12", avifChromaSubsampling: "444", avifGainMapQuality: 100, avifGainMapScale: "full", exportDithering: "off", exportMetadataPolicy: "none" },
  },
  jpeg_ultrahdr: {
    web_default: { quality: 85, jpegGainMapQuality: 90, jpegGainMapScale: "full", jpegUltrahdrChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 75, jpegGainMapQuality: 80, jpegGainMapScale: "half", jpegUltrahdrChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegGainMapQuality: 100, jpegGainMapScale: "full", jpegUltrahdrChromaSubsampling: "444", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  jpegxl_hdr: {
    web_default: { quality: 90, jpegxlPrecision: "uint12", exportDithering: "off", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 80, jpegxlPrecision: "uint10", exportDithering: "off", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegxlPrecision: "uint16", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  sdr_jpegxl: {
    web_default: { quality: 90, exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 80, exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, exportDithering: "subtle", exportMetadataPolicy: "all_except_location" },
  },
  sdr_png: {
    web_default: { quality: 100, sdrPngBitDepth: "8", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 100, sdrPngBitDepth: "8", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, sdrPngBitDepth: "16", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  sdr_jpeg: {
    web_default: { quality: 85, jpegChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 75, jpegChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegChromaSubsampling: "444", exportDithering: "subtle", exportMetadataPolicy: "all_except_location" },
  },
};

const exportFormatNotes = {
  avif_gain_map: "Efficient adaptive HDR for current Chromium browsers, with an SDR base for other decoders.",
  jpeg_ultrahdr: "Broad JPEG fallback with HDR in compatible viewers; recompression can remove the gain map.",
  jpegxl_hdr: "Direct Rec.2020 PQ HDR for specialist workflows; no SDR fallback and limited browser support.",
  sdr_jpegxl: "Compact SDR for JPEG XL-aware workflows; browser support remains uneven.",
  sdr_png: "Lossless SDR delivery with 8-bit web and 16-bit fidelity choices.",
  sdr_jpeg: "Conventional compact SDR JPEG, including very wide images up to 65,500 pixels.",
};

const exportOptionTooltips = {
  avifBitDepth: {
    8: "Smallest AVIF primary image; lower gradient precision.",
    10: "Balanced AVIF precision for HDR publishing.",
    12: "Highest available AVIF primary-image precision.",
  },
  avifChromaSubsampling: {
    420: "Smallest primary image; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  avifGainMapScale: {
    full: "Stores the gain map at full image resolution.",
    half: "Stores a half-resolution gain map to reduce delivery size.",
  },
  jpegGainMapScale: {
    full: "Stores the gain map at full image resolution.",
    half: "Stores a half-resolution gain map to reduce delivery size.",
  },
  jpegUltrahdrChromaSubsampling: {
    420: "Smallest primary JPEG; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  jpegChromaSubsampling: {
    420: "Smallest JPEG; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  jpegxlPrecision: {
    uint10: "Compact integer HDR precision.",
    uint12: "Balanced integer HDR precision.",
    uint16: "Highest practical integer precision.",
    float16: "Specialist half-float interchange.",
    float32: "Specialist full-float interchange with the largest files.",
  },
  sdrPngBitDepth: {
    8: "Standard web-compatible PNG precision.",
    16: "High-precision PNG interchange.",
  },
  exportDithering: {
    auto: "Applies deterministic signal-domain dither when exporting 8-bit output.",
    off: "Disables export dithering.",
    subtle: "Applies subtle signal-domain dither.",
  },
  exportMetadataPolicy: {
    none: "Removes optional source metadata while retaining required color and HDR signaling.",
    copyright: "Preserves copyright metadata only.",
    all_except_location: "Preserves source metadata except location information.",
    all_including_location: "Preserves all supported source metadata, including possible GPS coordinates.",
  },
  exportResizeMode: {
    original: "Exports the original cropped dimensions.",
    long_edge: "Resizes by the image's longest edge.",
    fit: "Fits the image within specified width and height limits.",
  },
  exportSharpening: {
    off: "No output sharpening.",
    subtle: "Light edge-aware sharpening after resize.",
    standard: "Moderate edge-aware sharpening after resize.",
    strong: "Strong edge-aware sharpening after resize.",
  },
};

async function loadCapabilities() {
  const response = await fetch("/api/capabilities");
  const data = await response.json();
  state.capabilities = data.capabilities;
}

async function loadDefaultExportDirectory() {
  if (state.appPreferences?.folders?.fileSave) {
    state.defaultExportDirectory = state.appPreferences.folders.fileSave;
    if (!els.exportDirectory.value.trim()) els.exportDirectory.value = state.defaultExportDirectory;
    return;
  }
  const response = await fetch("/api/export-directory/default");
  const payload = await safeJson(response);
  if (!response.ok || !payload?.directory) return;
  state.defaultExportDirectory = payload.directory;
  if (!els.exportDirectory.value.trim()) els.exportDirectory.value = payload.directory;
}

function seedExportFieldsFromSession() {
  if (!state.session) return;
  const sourceName = state.session.source.filename.replace(/\.[^.]+$/, "");
  if (!els.exportFilename.value || els.exportFilename.value === "hdr_finisher_export") {
    els.exportFilename.value = `${sourceName}_finished`;
  }
}

function buildExportOutputPath() {
  const filename = sanitizeFilename(els.exportFilename.value || "hdr_finisher_export");
  const extension = exportExtensionForFormat(els.exportFormat.value);
  const directory = (els.exportDirectory.value || "").trim();
  return joinExportPath(directory, `${filename}${extension}`);
}

function joinExportPath(directory, filename) {
  if (!directory) return filename;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${filename}`;
}

function sanitizeFilename(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "hdr_finisher_export";
}

function exportExtensionForFormat(format) {
  if (format === "sdr_jpeg") return ".jpg";
  if (format === "sdr_png") return ".png";
  if (format === "sdr_jpegxl") return ".jxl";
  if (format === "jpeg_ultrahdr") return ".jpg";
  if (format === "jpegxl_hdr") return ".jxl";
  return ".avif";
}

function splitOutputPath(path) {
  const normalized = String(path || "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  const parts = normalized.split(/[/\\]/);
  const filename = parts.pop() || "";
  let directory = parts.join(separator);
  if (/^[A-Za-z]:[\\/]/.test(normalized) && /^[A-Za-z]:$/.test(directory)) directory += separator;
  else if (normalized.startsWith("/") && !directory) directory = "/";
  return {
    filename: filename.replace(/\.[^.]+$/, ""),
    directory,
  };
}

async function exportCurrentSession() {
  if (!state.session) return;
  status.post({ id: "export", severity: "progress", message: "Export queued…", progress: "indeterminate" });
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  const editsApplied = globalsApplied === false
    ? false
    : await (state.editCommandQueue || Promise.resolve(true));
  if (editsApplied === false) {
    status.post({ id: "export", severity: "error", message: "Export paused because the latest edit could not be saved. Review the edit error and try again." });
    return;
  }
  let outputPath = buildExportOutputPath();
  let pathGrant = null;
  let nativeOverwrite = null;
  if (desktop) {
    const extension = exportExtensionForFormat(els.exportFormat.value);
    const selection = await desktop.chooseExportPath({
      suggestedName: `${sanitizeFilename(els.exportFilename.value || "hdr_finisher_export")}${extension}`,
      directory: (els.exportDirectory.value || "").trim(),
      extension,
      formatName: els.exportFormat.value === "avif_gain_map" ? "AVIF gain map" : els.exportFormat.value === "sdr_jpeg" ? "JPEG image" : els.exportFormat.value === "sdr_png" ? "PNG image" : els.exportFormat.value === "sdr_jpegxl" ? "JPEG XL SDR" : els.exportFormat.value === "jpegxl_hdr" ? "JPEG XL HDR" : "JPEG Ultra HDR",
    });
    if (!selection) {
      status.post({ id: "export", severity: "success", message: "Export cancelled." });
      return;
    }
    outputPath = selection.path;
    pathGrant = selection.grant;
    nativeOverwrite = selection.overwriteTarget || null;
  }
  els.exportConfirmButton.disabled = true;
  status.post({ id: "export", severity: "progress", message: "Rendering full-resolution HDR and SDR endpoints…", progress: "indeterminate" });
  els.exportResult.classList.add("hidden");
  const exportStartedAt = performance.now();
  let lastExportExpectation = "Rendering full-resolution HDR and SDR endpoints";
  const exportTicker = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((performance.now() - exportStartedAt) / 1000));
    const expectation = elapsedSeconds < 20
      ? "Rendering full-resolution HDR and SDR endpoints"
      : elapsedSeconds < 60
        ? "Encoding gain-map media; large sources can take a minute or more"
        : "Still working locally; the final file will be validated before completion";
    if (expectation !== lastExportExpectation) {
      lastExportExpectation = expectation;
      status.update("export", { severity: "progress", message: expectation, progress: "indeterminate" });
    }
  }, 1000);
  try {
    desktop?.setOperationProgress({ kind: "export", value: 0.01, state: "indeterminate" });
    let response = await requestSessionExport(outputPath, Boolean(nativeOverwrite), pathGrant, nativeOverwrite);
    let payload = await safeJson(response);
    if (response.status === 409 && payload?.detail?.code === "overwrite_required") {
      const detail = payload.detail;
      const approved = await window.HDRDialogs.confirm(
        `${detail.message}\n\n${detail.output_path}`,
        { title: "Overwrite file", confirmLabel: "Overwrite", destructive: true },
      );
      if (!approved) {
        status.post({ id: "export", severity: "success", message: "Export cancelled; the existing file was left unchanged." });
        return;
      }
      status.post({ id: "export", severity: "progress", message: "Replacing the existing file and validating the result…", progress: "indeterminate" });
      response = await requestSessionExport(outputPath, true, pathGrant, null);
      payload = await safeJson(response);
    }
    if (!response.ok) {
      status.post({ id: "export", severity: "error", message: responseErrorMessage(payload, "Export failed.") });
      return;
    }
    const exportMessage = payload.message || "Export request finished.";
    const totalExportMs = Number(payload.timings_ms?.total);
    const completedMessage = Number.isFinite(totalExportMs)
      ? `${exportMessage} Completed in ${(totalExportMs / 1000).toFixed(1)}s.`
      : exportMessage;
    const measurementWarning = (payload.measurement_warnings || []).join(" ");
    status.post({ id: "export", severity: measurementWarning ? "warning" : "success", message: `${completedMessage}${measurementWarning ? ` ${measurementWarning}` : ""}` });
    els.exportStatus.textContent = measurementWarning || "The completed export is available below.";
    if (payload.output_path) {
      const parsed = splitOutputPath(payload.output_path);
      els.exportFilename.value = parsed.filename;
      els.exportDirectory.value = parsed.directory;
      state.lastExportPath = payload.output_path;
      els.exportResultPath.textContent = payload.output_path;
      els.exportResult.classList.remove("hidden");
    }
  } catch (error) {
    console.error(error);
    status.post({ id: "export", severity: "error", message: "Export could not reach the local HDR Finisher server." });
  } finally {
    window.clearInterval(exportTicker);
    els.exportConfirmButton.disabled = false;
    desktop?.setOperationProgress({ kind: "export", value: -1, state: "normal" });
  }
}

async function chooseExportDirectory() {
  await openMediaBrowser("export_directory", els.exportDirectory.value);
}

function requestSessionExport(outputPath, overwrite, pathGrant = null, overwriteTarget = null) {
  const resizeMode = els.exportResizeMode?.value || "original";
  return fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: els.exportFormat.value,
      editing_measurements: editingMeasurementsForDelivery(),
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
      sdr_png_bit_depth: Number(els.sdrPngBitDepth.value),
      jpegxl_precision: els.jpegxlPrecision.value,
      dithering: els.exportDithering.value,
      metadata_policy: els.exportMetadataPolicy.disabled ? "none" : els.exportMetadataPolicy.value,
      output_path: outputPath,
      path_grant: pathGrant,
      overwrite,
      overwrite_target: overwriteTarget,
      edit_revision: state.editRevision,
      output_finishing: {
        resize_mode: resizeMode,
        long_edge: resizeMode === "long_edge" ? Number(els.exportLongEdge.value) : null,
        width: resizeMode === "fit" ? Number(els.exportWidth.value) : null,
        height: resizeMode === "fit" ? Number(els.exportHeight.value) : null,
        prevent_enlargement: els.exportPreventEnlargement.checked,
        sharpening: els.exportSharpening.value,
        method: "edge_aware_multiscale",
      },
    }),
  });
}

function prepareExportRail() {
  if (!state.session) return;
  if (!els.exportDirectory.value.trim()) els.exportDirectory.value = state.defaultExportDirectory;
  renderCapabilities();
  renderFormatCards();
  updateExportAvailability();
  els.exportStatus.textContent = "Choose a format and destination.";
}

function openExportSheet() {
  if (!state.session) return;
  activateWorkflowTab("export", { focus: true });
}

function renderCapabilities() {
  const keys = ["avif_gain_map_encoder", "ultrahdr_encoder", "jpegxl_export"];
  const available = keys.filter((key) => state.capabilities[key]?.status === "available").length;
  els.capabilitySummary.textContent = `${available}/3 encoders ready`;
  els.capabilitySummary.className = `capability-chip ${available >= 2 ? "ready" : "attention"}`;

  document.querySelectorAll("[data-capability-for]").forEach((element) => {
    const capability = state.capabilities[element.dataset.capabilityFor];
    const ready = capability?.status === "available";
    element.textContent = ready ? "" : capability?.status === "unverified" ? "Unverified" : "Unavailable";
    element.className = ready ? "ready" : "attention";
    element.title = capability?.detail || "Capability status unavailable.";
  });

  [...els.exportFormat.options].forEach((option) => {
    const capability = state.capabilities[capabilityForFormat[option.value]];
    const availableForExport = capability?.status === "available";
    option.disabled = !availableForExport;
    option.title = availableForExport
      ? exportFormatNotes[option.value] || ""
      : capability?.detail || "This export path is unavailable.";
  });

  if (els.exportFormat.selectedOptions[0]?.disabled) {
    const fallback = [...els.exportFormat.options].find((option) => !option.disabled);
    if (fallback) {
      els.exportFormat.value = fallback.value;
      applyExportPreset(fallback.value, "web_default", { invalidate: false });
    }
  }
  renderFormatCards();
  window.HDRProofing?.render();
}

function markExportPresetCustom() {
  const option = els.exportPreset.querySelector('option[value="custom"]');
  option.hidden = false;
  els.exportPreset.value = "custom";
}

function applyExportPreset(format, presetName, { invalidate = true } = {}) {
  const mapping = exportPresetMappings[format]?.[presetName];
  if (!mapping) return;
  const controls = { quality: els.exportQuality, ...els };
  Object.entries(mapping).forEach(([key, value]) => {
    const control = controls[key];
    if (!control) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
  });
  els.exportResizeMode.value = "original";
  els.exportPreventEnlargement.checked = true;
  els.exportSharpening.value = "off";
  els.exportPreset.value = presetName;
  els.exportPreset.querySelector('option[value="custom"]').hidden = true;
  els.exportQualityValue.textContent = els.exportQuality.value;
  els.jpegGainMapQualityValue.textContent = els.jpegGainMapQuality.value;
  els.avifGainMapQualityValue.textContent = els.avifGainMapQuality.value;
  renderOutputFinishingControls();
  renderFormatCards();
  if (invalidate) window.HDRProofing?.invalidate("settings");
}

function annotateWebDefaultOptions(format) {
  document.querySelectorAll("#export-sheet select option").forEach((option) => {
    if (option.closest("#export-preset, #export-format")) return;
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = option.textContent
        .replace(/ · (Recommended|Web recommended|Web Default|Web \/ privacy default)$/i, "");
    }
    option.textContent = option.dataset.baseLabel;
  });
  const webDefault = {
    ...exportPresetMappings[format]?.web_default,
    exportResizeMode: "original",
    exportSharpening: "off",
  };
  const controls = { quality: els.exportQuality, ...els };
  Object.entries(webDefault).forEach(([key, value]) => {
    const control = controls[key];
    if (!(control instanceof HTMLSelectElement)) return;
    const option = [...control.options].find((candidate) => candidate.value === String(value));
    if (option) option.textContent = `${option.dataset.baseLabel || option.textContent} · Web Default`;
  });
}

function applyExportOptionTooltips() {
  Object.entries(exportOptionTooltips).forEach(([key, descriptions]) => {
    const control = els[key];
    if (!(control instanceof HTMLSelectElement)) return;
    [...control.options].forEach((option) => {
      option.title = descriptions[option.value] || "";
    });
    control.title = descriptions[control.value] || "";
  });
  [...els.exportPreset.options].forEach((option) => {
    option.title = ({
      web_default: "Balanced recommended publishing settings.",
      web_optimized: "Smaller files while retaining acceptable publishing quality.",
      maximum_fidelity: "Highest practical precision and color fidelity.",
      custom: "One or more controls differ from the selected built-in preset.",
    })[option.value] || "";
  });
  els.exportFormat.title = els.exportFormat.selectedOptions[0]?.title || "";
  els.exportPreset.title = els.exportPreset.selectedOptions[0]?.title || "";
}

function renderFormatCards() {
  const format = els.exportFormat.value;
  const capability = state.capabilities[capabilityForFormat[format]];
  els.exportFormatNote.textContent = capability?.status === "available"
    ? exportFormatNotes[format]
    : capability?.detail || exportFormatNotes[format];
  els.exportFormat.title = els.exportFormatNote.textContent;
  els.jpegAdvancedSettings.classList.remove("hidden");
  els.avifSettings.classList.toggle("hidden", format !== "avif_gain_map");
  els.jpegUltrahdrSettings.classList.toggle("hidden", format !== "jpeg_ultrahdr");
  els.sdrJpegSettings.classList.toggle("hidden", format !== "sdr_jpeg");
  els.jpegxlSettings.classList.toggle("hidden", format !== "jpegxl_hdr");
  els.sdrPngSettings.classList.toggle("hidden", format !== "sdr_png");

  const qualityApplicable = format !== "sdr_png";
  els.exportQuality.disabled = !qualityApplicable;
  els.exportQualityRow.classList.toggle("disabled-setting", !qualityApplicable);
  els.exportQualityRow.title = qualityApplicable ? "" : "PNG compression is lossless; the Quality setting does not apply.";

  const sourceMetadataApplicable = format !== "avif_gain_map";
  els.exportMetadataPolicy.disabled = !sourceMetadataApplicable;
  els.exportMetadataPolicyField.classList.toggle("disabled-setting", !sourceMetadataApplicable);
  els.exportMetadataPolicyNote.textContent = sourceMetadataApplicable
    ? "Color, HDR, and gain-map signaling is always retained. ‘All including location’ may expose GPS coordinates."
    : "Source metadata is unavailable in the current AVIF gain-map combiner; required color and gain-map signaling is still retained.";
  els.exportMetadataPolicy.title = els.exportMetadataPolicyNote.textContent;

  const selectedBitDepth = format === "avif_gain_map"
    ? Number(els.avifBitDepth.value)
    : format === "sdr_png" ? Number(els.sdrPngBitDepth.value)
    : format === "jpegxl_hdr" ? Number(String(els.jpegxlPrecision.value).match(/\d+/)?.[0] || 12)
    : 8;
  const ditherApplicable = selectedBitDepth === 8 && format !== "jpegxl_hdr";
  els.exportDithering.disabled = !ditherApplicable;
  els.exportDitheringField.classList.toggle("disabled-setting", !ditherApplicable);
  els.exportDitheringNote.textContent = ditherApplicable
    ? "Auto applies deterministic signal-domain dithering when the selected output is quantized to 8 bits."
    : `Dithering is disabled because this ${selectedBitDepth}-bit output does not benefit from 8-bit quantization dither.`;
  els.exportDithering.title = els.exportDitheringNote.textContent;

  const encodingSummary = {
    avif_gain_map: `${els.avifBitDepth.value}-bit sRGB base · ${formatChroma(els.avifChromaSubsampling.value)} primary · 10-bit 4:4:4 gain map · ${els.avifGainMapScale.value} resolution · Rec.2020 PQ alternate`,
    jpeg_ultrahdr: `8-bit sRGB JPEG · ${formatChroma(els.jpegUltrahdrChromaSubsampling.value)} · 8-bit gain map`,
    jpegxl_hdr: `${els.jpegxlPrecision.options[els.jpegxlPrecision.selectedIndex]?.textContent || "12-bit integer"} · Rec.2020 PQ`,
    sdr_jpegxl: "8-bit sRGB JPEG XL · no gain map",
    sdr_png: `${els.sdrPngBitDepth.value}-bit sRGB PNG`,
    sdr_jpeg: `8-bit sRGB JPEG · ${formatChroma(els.jpegChromaSubsampling.value)}`,
  }[format];
  els.exportResolvedEncoding.textContent = `Resolved encoding: ${encodingSummary || "automatic"}`;
  els.exportReferenceWhite.textContent = `HDR reference white: ${projectReferenceWhiteNits()} nits`;
  annotateWebDefaultOptions(format);
  applyExportOptionTooltips();
  if (!sourceMetadataApplicable) els.exportMetadataPolicy.title = els.exportMetadataPolicyNote.textContent;
  if (!ditherApplicable) els.exportDithering.title = els.exportDitheringNote.textContent;
}

function formatChroma(value) {
  return ({ 420: "4:2:0", 422: "4:2:2", 444: "4:4:4" })[value] || value;
}

function updateExportAvailability() {
  const needsOverride = Boolean(state.session?.analysis?.needs_color_override);
  const sourceReady = Boolean(state.session) && (!needsOverride || state.interpretationGateDismissed);
  const encoderKey = capabilityForFormat[els.exportFormat.value];
  const encoderReady = state.capabilities[encoderKey]?.status === "available";
  els.exportConfirmButton.disabled = state.importInProgress || !state.session || !sourceReady || !encoderReady;
}

async function copyLastExportPath() {
  if (!state.lastExportPath) return;
  try {
    await writeClipboardText(state.lastExportPath);
    els.copyExportPath.textContent = "Copied";
  } catch {
    els.copyExportPath.textContent = "Copy failed";
  }
}

