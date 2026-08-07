(() => {
  document.body.dataset.proofMode = state.proofMode;

  els.proofModeButtons.forEach((button) => {
    button.addEventListener("click", () => activateProofMode(button.dataset.proofMode));
  });
  els.buildProofButton.addEventListener("click", () => buildDeliveryProof().catch(showProofError));
  els.proofFormat.addEventListener("change", invalidateProofing);
  els.proofDisplay.addEventListener("change", () => {
    renderDisplayTelemetry();
    if (state.proofArtifact) buildProofMatrix().catch(showProofError);
  });
  els.liveHeadroom.addEventListener("change", renderLiveComparison);
  els.liveMimeMode.addEventListener("change", renderLiveComparison);
  els.dynamicRangeLimit.addEventListener("change", renderLiveComparison);
  els.livePresentation.addEventListener("change", renderLiveComparison);
  els.refreshLiveButton.addEventListener("click", refreshLiveBytes);
  els.observationForm.addEventListener("submit", saveObservation);

  Promise.all([refreshDisplayTelemetry(), loadEvidenceRecords()]).catch(() => null);
  window.HDRProofing = { invalidate: invalidateProofing, reset: resetProofing };

  function activateProofMode(mode) {
    if (!["authoring", "matrix", "live"].includes(mode)) return;
    state.proofMode = mode;
    document.body.dataset.proofMode = mode;
    els.proofModeButtons.forEach((button) => {
      const active = button.dataset.proofMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    els.previewStage.classList.toggle("hidden", mode !== "authoring");
    els.deliveryMatrixView.classList.toggle("hidden", mode !== "matrix");
    els.liveBrowserView.classList.toggle("hidden", mode !== "live");
    renderProofOverlays(mode);
    els.probeReadout.textContent = mode === "authoring"
      ? "Move over the image for pixel coordinates"
      : "Delivery proof uses content-hashed encoded bytes";
    els.viewerBranchNote.textContent = mode === "authoring"
      ? branchCopy[state.currentView]
      : mode === "matrix"
        ? "Fixed-headroom reconstruction · presentation remains display-dependent."
        : "Live Browser Check · authoritative for this browser, OS, and display only.";
    if (mode !== "authoring" && state.session && state.proofDirty) {
      buildDeliveryProof().catch(showProofError);
    }
    if (mode === "live") renderLiveComparison();
  }

  function renderProofOverlays(mode) {
    const gateVisible = mode === "authoring"
      && Boolean(state.session?.analysis?.needs_color_override)
      && !state.interpretationGateDismissed;
    els.interpretationGate.classList.toggle("hidden", !gateVisible);
    const legendVisible = mode === "authoring"
      && state.adjustments.shared.overlay_mode === "false_color"
      && Boolean(state.session);
    els.falseColorLegend.classList.toggle("hidden", !legendVisible);
  }

  function resetProofing() {
    state.proofArtifact = null;
    state.proofMatrix = null;
    state.proofDirty = true;
    clearProofViews();
    els.buildProofButton.disabled = !state.session;
  }

  function invalidateProofing() {
    state.proofDirty = true;
    state.proofArtifact = null;
    state.proofMatrix = null;
    clearProofViews();
    els.matrixStatus.textContent = state.session
      ? "Adjustments or format changed. Rebuild before relying on delivery proof."
      : "Import an image to build a delivery proof.";
  }

  function clearProofViews() {
    els.matrixGrid.replaceChildren();
    els.liveProofImage.removeAttribute("src");
    els.liveMatrixImage.removeAttribute("src");
    els.liveHeadroom.replaceChildren();
    els.liveArtifactMeta.textContent = "No current artifact";
    els.liveMatrixMeta.textContent = "No current tile";
  }

  async function buildDeliveryProof() {
    if (!state.session) return;
    const encoderKey = capabilityForFormat[els.proofFormat.value];
    if (state.capabilities[encoderKey]?.status !== "available") {
      throw new Error(state.capabilities[encoderKey]?.detail || "The selected proof encoder is unavailable.");
    }
    els.buildProofButton.disabled = true;
    els.matrixStatus.textContent = "Encoding the exact delivery proxy…";
    try {
      const response = await fetch(`/api/session/${state.session.session_id}/proof/artifact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustments: state.adjustments,
          format: els.proofFormat.value,
          quality: Number(els.exportQuality.value) || 85,
          jpeg_gain_map_quality: Number(els.jpegGainMapQuality.value) || 100,
          jpeg_gain_map_scale: els.jpegGainMapScale.value || "full",
          long_edge: Math.min(1200, state.session.preview?.long_edge || 1200),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || "Delivery proxy encoding failed.");
      state.proofArtifact = payload;
      state.proofDirty = false;
      const jpegMetadata = payload.jpeg_gain_map
        ? ` · decoded ${payload.jpeg_gain_map.reconstruction_gamut} · useBaseColorSpace=${payload.jpeg_gain_map.use_base_color_space ? 1 : 0}`
        : "";
      els.matrixStatus.textContent = `Encoded ${formatBytes(payload.byte_size)} · SHA-256 ${payload.sha256.slice(0, 16)}… · ${payload.metadata_summary}${jpegMetadata}`;
      await buildProofMatrix();
      await loadEvidenceRecords();
      renderLiveComparison();
    } finally {
      els.buildProofButton.disabled = !state.session;
    }
  }

  async function buildProofMatrix() {
    if (!state.proofArtifact) return;
    els.matrixStatus.textContent = "Reconstructing encoded gain map at fixed headroom targets…";
    const display = selectedProofDisplay();
    const response = await fetch("/api/proof/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact_id: state.proofArtifact.artifact_id,
        display_headroom: Number.isFinite(display?.nominal_headroom) ? display.nominal_headroom : null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.detail || "Matrix reconstruction failed.");
    state.proofMatrix = payload;
    renderProofMatrix();
    const jpegMetadata = state.proofArtifact.jpeg_gain_map;
    const gamut = jpegMetadata ? ` · decoded ${jpegMetadata.reconstruction_gamut}` : "";
    els.matrixStatus.textContent = `${payload.reconstruction} · encoded full headroom ${payload.encoded_headroom.toFixed(2)} stops${gamut}.`;
  }

  function renderProofMatrix() {
    els.matrixGrid.replaceChildren();
    els.liveHeadroom.replaceChildren();
    for (const tile of state.proofMatrix?.tiles || []) {
      const card = document.createElement("article");
      card.className = `matrix-tile${tile.above_display_headroom ? " above-headroom" : ""}`;
      const header = document.createElement("div");
      header.className = "matrix-tile-header";
      const title = document.createElement("strong");
      title.textContent = tile.label;
      const target = document.createElement("span");
      target.className = "proof-status";
      target.textContent = `H ${tile.target_headroom.toFixed(2)}`;
      header.append(title, target);
      const image = document.createElement("img");
      image.src = tile.url;
      image.alt = `${tile.label} fixed-headroom reconstruction`;
      const stats = document.createElement("div");
      stats.className = "matrix-tile-stats";
      const peak = document.createElement("span");
      peak.textContent = `Peak ${tile.peak_nits.toFixed(0)} nit`;
      const clipped = document.createElement("span");
      clipped.textContent = `${tile.clipped_percent.toFixed(2)}% above target`;
      stats.append(peak, clipped);
      card.append(header, image, stats);
      if (tile.above_display_headroom) {
        const warning = document.createElement("p");
        warning.className = "headroom-warning";
        warning.textContent = "Above current nominal display headroom · visible result may be compressed or clipped.";
        card.append(warning);
      }
      els.matrixGrid.append(card);
      const option = document.createElement("option");
      option.value = tile.id;
      option.textContent = `${tile.label} · ${tile.target_headroom.toFixed(2)} stops`;
      els.liveHeadroom.append(option);
    }
    const display = selectedProofDisplay();
    if (display?.nominal_headroom != null) {
      const closest = [...(state.proofMatrix?.tiles || [])].sort(
        (left, right) => Math.abs(left.target_headroom - display.nominal_headroom)
          - Math.abs(right.target_headroom - display.nominal_headroom),
      )[0];
      if (closest) els.liveHeadroom.value = closest.id;
    }
    renderLiveComparison();
  }

  function renderLiveComparison() {
    const artifact = state.proofArtifact;
    const tile = state.proofMatrix?.tiles?.find((item) => item.id === els.liveHeadroom.value)
      || state.proofMatrix?.tiles?.[0];
    if (!artifact || !tile) return;
    const artifactUrl = els.liveMimeMode.value === "wrong" ? artifact.wrong_mime_url : artifact.url;
    els.liveProofImage.src = artifactUrl;
    els.liveMatrixImage.src = tile.url;
    els.liveProofImage.style.setProperty("dynamic-range-limit", els.dynamicRangeLimit.value);
    els.liveMatrixImage.style.setProperty("dynamic-range-limit", els.dynamicRangeLimit.value);
    els.liveProofFrame.dataset.presentation = els.livePresentation.value;
    els.liveArtifactMeta.textContent = `${artifact.format} · ${artifact.width}×${artifact.height} · ${artifact.sha256.slice(0, 12)}…`;
    els.liveMatrixMeta.textContent = `${tile.label} · peak ${tile.peak_nits.toFixed(0)} nit · ${tile.clipped_percent.toFixed(2)}% above target`;
    renderCompatibilityStatus();
  }

  function refreshLiveBytes() {
    if (!state.proofArtifact) return;
    const base = els.liveMimeMode.value === "wrong"
      ? state.proofArtifact.wrong_mime_url
      : state.proofArtifact.url;
    const separator = base.includes("?") ? "&" : "?";
    els.liveProofImage.src = `${base}${separator}refresh=${Date.now()}`;
    const tile = state.proofMatrix?.tiles?.find((item) => item.id === els.liveHeadroom.value);
    if (tile) els.liveMatrixImage.src = `${tile.url}?refresh=${Date.now()}`;
  }

  async function refreshDisplayTelemetry() {
    try {
      const response = await fetch("/api/display");
      state.displayTelemetry = await response.json();
    } catch {
      state.displayTelemetry = { displays: [], detail: "Native display telemetry unavailable." };
    }
    els.proofDisplay.replaceChildren();
    for (const display of state.displayTelemetry.displays || []) {
      const option = document.createElement("option");
      option.value = display.id;
      option.textContent = `${display.name}${display.primary ? " · primary" : ""}${display.hdr_enabled ? " · HDR on" : " · SDR"}`;
      if (display.primary) option.selected = true;
      els.proofDisplay.append(option);
    }
    if (!els.proofDisplay.options.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Browser observation only";
      els.proofDisplay.append(option);
    }
    renderDisplayTelemetry();
  }

  function selectedProofDisplay() {
    return (state.displayTelemetry?.displays || []).find((display) => display.id === els.proofDisplay.value)
      || (state.displayTelemetry?.displays || []).find((display) => display.primary)
      || state.displayTelemetry?.displays?.[0]
      || null;
  }

  function renderDisplayTelemetry() {
    const display = selectedProofDisplay();
    if (!display) {
      const browserRange = mediaQueryMatch("(dynamic-range: high)") ? "high" : "standard/unknown";
      els.displayTelemetry.textContent = `${state.displayTelemetry?.detail || "No native display data."} Browser dynamic range: ${browserRange}.`;
      return;
    }
    const headroom = display.nominal_headroom == null ? "unknown" : `${display.nominal_headroom.toFixed(2)} stops`;
    els.displayTelemetry.textContent = `${display.name} · HDR ${display.hdr_enabled ? "on" : "off"} · ${display.bits_per_channel || "?"}-bit · SDR white ${display.sdr_white_nits ?? "?"} nit · DXGI peak ${display.max_luminance_nits ?? "?"} nit · nominal headroom ${headroom}`;
  }

  async function loadEvidenceRecords() {
    try {
      const response = await fetch("/api/proof/evidence");
      const payload = await response.json();
      state.evidenceRecords = payload.records || [];
    } catch {
      state.evidenceRecords = [];
    }
    renderCompatibilityStatus();
  }

  async function renderCompatibilityStatus() {
    const info = await browserIdentity();
    const format = state.proofArtifact?.format || els.proofFormat.value;
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const record = [...state.evidenceRecords].reverse().find((item) => (
      item.format === format
      && item.browser_name === info.name
      && item.browser_version === info.version
      && Date.parse(item.observed_at) >= cutoff
    ));
    els.liveCompatibility.textContent = record
      ? `Verified ${new Date(record.observed_at).toLocaleDateString()} · ${record.overall_observation.replaceAll("-", " ")} · ${record.display_label}`
      : `No verified compatibility record for ${info.name} ${info.version} · ${format}.`;
  }

  async function saveObservation(event) {
    event.preventDefault();
    if (!state.proofArtifact) return;
    const browser = await browserIdentity();
    const display = selectedProofDisplay();
    const response = await fetch("/api/proof/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact_id: state.proofArtifact.artifact_id,
        format: state.proofArtifact.format,
        browser_name: browser.name,
        browser_version: browser.version,
        operating_system: navigator.userAgentData?.platform || navigator.platform || "Unknown",
        display_label: display?.name || "Unknown display",
        hdr_state: mediaQueryMatch("(dynamic-range: high)") ? "high" : "standard-or-unknown",
        sdr_white_nits: display?.sdr_white_nits ?? null,
        max_luminance_nits: display?.max_luminance_nits ?? null,
        nominal_headroom: display?.nominal_headroom ?? null,
        dynamic_range_limit: els.dynamicRangeLimit.value,
        mime_mode: els.liveMimeMode.value,
        presentation_variant: els.livePresentation.value,
        highlight_observation: els.observationHighlights.value,
        midtone_observation: els.observationMidtones.value,
        color_observation: els.observationColor.value,
        overall_observation: els.observationOverall.value,
        notes: els.observationNotes.value.trim(),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      els.observationStatus.textContent = payload?.detail || "Evidence could not be saved.";
      return;
    }
    state.evidenceRecords = payload.records || [];
    els.observationStatus.textContent = "Evidence saved locally.";
    renderCompatibilityStatus();
  }

  async function browserIdentity() {
    let brands = navigator.userAgentData?.brands || [];
    if (navigator.userAgentData?.getHighEntropyValues) {
      try {
        const details = await navigator.userAgentData.getHighEntropyValues(["fullVersionList"]);
        if (details.fullVersionList?.length) brands = details.fullVersionList;
      } catch {
        // Browser privacy policy may intentionally withhold full version data.
      }
    }
    const preferredNames = ["Microsoft Edge", "Google Chrome", "Opera", "Chromium"];
    const preferred = preferredNames
      .map((name) => brands.find((brand) => brand.brand === name))
      .find(Boolean)
      || brands.find((brand) => !/Not.A.Brand/i.test(brand.brand))
      || brands[0];
    if (preferred) return { name: preferred.brand, version: preferred.version };
    const match = navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/([0-9.]+)/);
    return { name: match?.[1] || "Unknown", version: match?.[2] || "Unknown" };
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function showProofError(error) {
    els.matrixStatus.textContent = error?.message || "Delivery proof failed.";
    els.buildProofButton.disabled = !state.session;
  }
})();
