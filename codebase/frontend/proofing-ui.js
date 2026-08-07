(() => {
  const SETTINGS_KEY = "hdr-finisher-chrome-proof-v1";
  const FIXED_TARGETS = new Set(["400", "600", "1000", "2000", "4000"]);
  let requestGeneration = 0;
  let artifactDirty = true;
  let phase = "idle";
  let errorMessage = "";
  let reviewSuggestion = "";
  let autoFallbackNotice = false;

  restoreSettings();
  bindProofEvents();
  window.HDRProofing = {
    invalidate: invalidateProof,
    reset: resetProof,
    settled: proofPreviewSettled,
    syncLane: renderProofUi,
    render: renderProofUi,
    reviewExportFormat,
  };
  refreshDisplayTelemetry().catch(() => null).finally(renderProofUi);
  renderProofUi();

  function bindProofEvents() {
    els.chromeProofToggle.addEventListener("click", toggleProof);
    els.chromeProofRefresh.addEventListener("click", buildProofOnDemand);
    els.chromeProofFormat.addEventListener("change", () => {
      state.proofFormat = els.chromeProofFormat.value;
      artifactDirty = true;
      markProofDirty();
      persistSettings();
    });
    els.chromeProofTarget.addEventListener("change", () => {
      state.proofTarget = els.chromeProofTarget.value;
      markProofDirty();
      persistSettings();
      renderProofUi();
    });
    els.chromeProofCustomNits.addEventListener("change", () => {
      const value = Math.round(clamp(Number(els.chromeProofCustomNits.value) || 1000, 100, 10000));
      els.chromeProofCustomNits.value = String(value);
      state.proofCustomNits = value;
      markProofDirty();
      persistSettings();
    });
    els.chromeProofDisplay.addEventListener("change", () => {
      state.proofDisplayId = els.chromeProofDisplay.value;
      markProofDirty();
      persistSettings();
      renderProofUi();
    });
    els.chromeProofImage.addEventListener("dragstart", (event) => event.preventDefault());
    els.reviewChromeProof.addEventListener("click", () => reviewExportFormat(els.exportFormat.value));
    window.addEventListener("focus", refreshAutoProofOnFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshAutoProofOnFocus();
    });
    window.addEventListener("hdrfinisher:workflowchange", (event) => {
      if (event.detail?.workflow === "proof") refreshDisplayTelemetry().catch(() => null).finally(renderProofUi);
      else renderProofUi();
    });
  }

  async function toggleProof() {
    if (!state.session) return;
    if (state.proofEnabled) {
      state.proofEnabled = false;
      cancelPendingProof();
      phase = "idle";
      syncProofPresentation();
      renderProofUi();
      return;
    }
    await refreshDisplayTelemetry().catch(() => null);
    state.proofEnabled = true;
    phase = state.proofDirty ? "updating" : "idle";
    syncProofPresentation();
    renderProofUi();
    if (state.proofDirty || !state.proofReconstruction) await refreshProof().catch(() => null);
  }

  async function buildProofOnDemand() {
    if (!state.session) return;
    state.proofEnabled = true;
    await refreshDisplayTelemetry().catch(() => null);
    await refreshProof().catch(() => null);
  }

  function invalidateProof() {
    if (!state.session) return;
    artifactDirty = true;
    markProofDirty();
  }

  function proofPreviewSettled() {
    // Proof generation is intentionally explicit; settled grades only update the authored preview.
  }

  function markProofDirty() {
    state.proofDirty = true;
    phase = state.proofReconstruction ? "stale" : "idle";
    errorMessage = "";
    renderProofUi();
    renderExportPreflight();
  }

  function resetProof() {
    state.proofEnabled = false;
    state.proofArtifact = null;
    state.proofReconstruction = null;
    state.proofDirty = true;
    artifactDirty = true;
    phase = "idle";
    errorMessage = "";
    reviewSuggestion = "";
    cancelPendingProof();
    els.chromeProofImage.removeAttribute("src");
    els.chromeProofImage.style.display = "none";
    renderProofUi();
  }

  function cancelPendingProof() {
    requestGeneration += 1;
  }

  async function refreshProof() {
    if (!state.session) return;
    const encoderKey = capabilityForFormat[state.proofFormat];
    const capability = state.capabilities[encoderKey];
    if (capability?.status !== "available") {
      showProofFailure(capability?.detail || "The selected proof encoder is unavailable.");
      return;
    }
    if (state.proofTarget === "auto" && !selectedDisplay()?.nominal_headroom && selectedDisplay()?.nominal_headroom !== 0) {
      fallbackFromUnavailableAuto();
    }

    const generation = ++requestGeneration;
    phase = "updating";
    errorMessage = "";
    renderProofUi();
    try {
      let artifact = state.proofArtifact;
      if (artifactDirty || !artifact || artifact.format !== state.proofFormat) {
        const artifactResponse = await fetch(`/api/session/${state.session.session_id}/proof/artifact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adjustments: state.adjustments,
            format: state.proofFormat,
            quality: Number(els.exportQuality.value) || 85,
            jpeg_gain_map_quality: Number(els.jpegGainMapQuality.value) || 100,
            jpeg_gain_map_scale: els.jpegGainMapScale.value || "full",
            long_edge: Math.min(1200, state.session.preview?.long_edge || 1200),
          }),
        });
        const payload = await artifactResponse.json();
        if (!artifactResponse.ok) throw new Error(payload?.detail || "Chrome proof encoding failed.");
        if (generation !== requestGeneration) return;
        artifact = payload;
      }

      const reconstructionResponse = await fetch("/api/proof/reconstruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact_id: artifact.artifact_id, target: proofTargetRequest() }),
      });
      const reconstruction = await reconstructionResponse.json();
      if (!reconstructionResponse.ok) throw new Error(reconstruction?.detail || "Chrome proof reconstruction failed.");
      await preloadImage(reconstruction.tile.url);
      if (generation !== requestGeneration) return;

      state.proofArtifact = artifact;
      state.proofReconstruction = reconstruction;
      state.proofDirty = false;
      artifactDirty = false;
      phase = "idle";
      els.chromeProofImage.src = reconstruction.tile.url;
      syncProofPresentation();
      renderProofUi();
    } catch (error) {
      if (generation !== requestGeneration) return;
      showProofFailure(error?.message || "Chrome proof failed.");
    }
  }

  function proofTargetRequest() {
    if (state.proofTarget === "auto") {
      return { mode: "auto", display_id: state.proofDisplayId || null };
    }
    if (state.proofTarget === "full") return { mode: "full", display_id: state.proofDisplayId || null };
    const peakNits = state.proofTarget === "custom" ? state.proofCustomNits : Number(state.proofTarget);
    return { mode: "fixed", peak_nits: peakNits, display_id: state.proofDisplayId || null };
  }

  function showProofFailure(message) {
    phase = "error";
    errorMessage = message;
    state.proofDirty = true;
    renderProofUi();
  }

  function syncProofPresentation() {
    const suspended = state.activeWorkflow !== "proof" || state.currentView !== "hdr" || state.comparePeekActive;
    const canShow = Boolean(state.proofEnabled && !suspended && state.proofReconstruction && els.chromeProofImage.src);
    els.chromeProofImage.style.display = canShow ? "block" : "none";
    if (state.activeWorkflow === "proof" && state.proofEnabled && state.currentView === "hdr" && !state.comparePeekActive) {
      els.viewerBranchNote.textContent = canShow
        ? `Chrome Proof · ${proofFormatLabel()} · ${proofTargetLabel()} · scopes remain authored HDR.`
        : "Chrome Proof is not current · build or refresh it from the Proof settings rail.";
      els.scopeKindLabel.textContent = "HDR · AUTHORED";
    } else {
      els.viewerBranchNote.textContent = branchCopy[state.currentView];
      els.scopeKindLabel.textContent = state.currentView.toUpperCase();
    }
    if (state.session) applyZoomGeometry();
  }

  function renderProofUi() {
    const hasSession = Boolean(state.session);
    const encoderKey = capabilityForFormat[state.proofFormat];
    const encoderReady = state.capabilities[encoderKey]?.status === "available";
    els.chromeProofToggle.disabled = !hasSession || !encoderReady;
    els.chromeProofToggle.checked = state.proofEnabled;
    els.chromeProofRefresh.disabled = !hasSession || !encoderReady || phase === "updating";
    els.chromeProofRefresh.textContent = phase === "updating"
      ? "Building proof…"
      : state.proofReconstruction ? "Refresh proof" : "Build proof";
    els.chromeProofFormat.value = state.proofFormat;
    els.chromeProofTarget.value = state.proofTarget;
    els.chromeProofCustomNits.value = String(state.proofCustomNits);
    els.chromeProofCustomField.classList.toggle("hidden", state.proofTarget !== "custom");
    els.chromeProofDisplay.disabled = !(state.displayTelemetry?.displays || []).length;
    for (const option of els.chromeProofFormat.options) {
      const key = capabilityForFormat[option.value];
      option.disabled = state.capabilities[key]?.status !== "available";
    }
    const suspended = state.proofEnabled && state.activeWorkflow === "proof" && (state.currentView !== "hdr" || state.comparePeekActive);
    if (!state.proofEnabled) els.chromeProofInlineStatus.textContent = "Off";
    else if (suspended) els.chromeProofInlineStatus.textContent = "Suspended";
    else if (phase === "updating") els.chromeProofInlineStatus.textContent = "Updating…";
    else if (phase === "error") els.chromeProofInlineStatus.textContent = "Unavailable";
    else if (state.proofDirty) els.chromeProofInlineStatus.textContent = "Stale";
    else els.chromeProofInlineStatus.textContent = proofTargetShortLabel();
    els.chromeProofStatus.textContent = proofStatusMessage(encoderReady);
    els.chromeProofStatus.dataset.state = phase;
    syncProofPresentation();
    renderExportPreflight();
    renderWorkflowContext();
  }

  function proofStatusMessage(encoderReady) {
    if (!state.session) return "Import an image to begin proofing.";
    if (!encoderReady) return state.capabilities[capabilityForFormat[state.proofFormat]]?.detail || "The selected encoder is unavailable.";
    if (phase === "error") return `${errorMessage} The last valid proof remains available.`;
    if (phase === "updating") return state.proofReconstruction
      ? "Updating from delivered bytes. The previous proof remains visible until the new one is ready."
      : "Encoding and reconstructing the first Chrome proof…";
    if (state.proofEnabled && state.currentView === "sdr") return "Chrome Proof is suspended on SDR Fallback and will resume on HDR Grade.";
    if (state.proofReconstruction && state.proofDirty) return `Stale · ${proofFormatLabel()} · ${proofTargetLabel()}. Adjustments or delivery settings changed.`;
    if (!state.proofReconstruction) {
      const fallback = autoFallbackNotice ? " Auto is unavailable, so 1,000 nits was selected." : "";
      return `${proofFormatLabel()} · ${proofTargetLabel()}. Build the proof when you are ready to review.${fallback}`;
    }
    const result = state.proofReconstruction;
    const details = [`${proofFormatLabel()} · ${result.target_label}`, `${result.resolved_headroom.toFixed(2)} stops`];
    if (result.display_label) details.push(result.display_label);
    if (result.capped_by_encoded_headroom) details.push(`capped by encoded ${result.encoded_headroom.toFixed(2)} stops`);
    if (result.display_can_represent === false) details.push("selected reference exceeds this display's reported headroom");
    if (autoFallbackNotice) details.push("Auto unavailable; using the 1,000-nit default");
    if (reviewSuggestion) details.push(reviewSuggestion);
    return details.join(" · ");
  }

  async function refreshDisplayTelemetry() {
    const previous = JSON.stringify(state.displayTelemetry?.displays || []);
    try {
      const response = await fetch("/api/display");
      if (!response.ok) throw new Error("Display telemetry is unavailable.");
      state.displayTelemetry = await response.json();
    } catch (error) {
      state.displayTelemetry = { source: "unavailable", displays: [], detail: error?.message || "Display telemetry is unavailable." };
    }
    populateDisplayOptions();
    const changed = previous !== JSON.stringify(state.displayTelemetry?.displays || []);
    if (changed && state.proofTarget === "auto" && state.proofReconstruction) {
      state.proofDirty = true;
    }
    return changed;
  }

  function populateDisplayOptions() {
    const displays = state.displayTelemetry?.displays || [];
    const previous = state.proofDisplayId;
    els.chromeProofDisplay.replaceChildren();
    for (const display of displays) {
      const option = document.createElement("option");
      option.value = display.id;
      const headroom = Number.isFinite(display.nominal_headroom) ? ` · ${display.nominal_headroom.toFixed(2)} stops` : " · headroom unavailable";
      option.textContent = `${display.name}${display.primary ? " · primary" : ""}${headroom}`;
      els.chromeProofDisplay.append(option);
    }
    if (displays.length) {
      const selected = displays.find((display) => display.id === previous)
        || displays.find((display) => display.primary)
        || displays[0];
      state.proofDisplayId = selected.id;
      els.chromeProofDisplay.value = selected.id;
      autoFallbackNotice = false;
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Display telemetry unavailable";
      els.chromeProofDisplay.append(option);
      state.proofDisplayId = "";
    }
    const autoOption = [...els.chromeProofTarget.options].find((option) => option.value === "auto");
    const autoAvailable = displays.some((display) => Number.isFinite(display.nominal_headroom));
    if (autoOption) autoOption.disabled = !autoAvailable;
    if (!autoAvailable && state.proofTarget === "auto") fallbackFromUnavailableAuto();
    persistSettings();
  }

  function fallbackFromUnavailableAuto() {
    state.proofTarget = "1000";
    els.chromeProofTarget.value = "1000";
    state.proofDirty = true;
    errorMessage = "Auto is unavailable; using the 1,000-nit default. Choose another fixed target if needed.";
    phase = "idle";
    autoFallbackNotice = true;
    persistSettings();
  }

  async function refreshAutoProofOnFocus() {
    if (state.activeWorkflow !== "proof" || state.proofTarget !== "auto") return;
    const changed = await refreshDisplayTelemetry().catch(() => false);
    if (changed) markProofDirty();
  }

  function selectedDisplay() {
    return (state.displayTelemetry?.displays || []).find((display) => display.id === state.proofDisplayId) || null;
  }

  function reviewExportFormat(format) {
    if (format === "sdr_png") return;
    const label = format === "avif_gain_map" ? "AVIF + gain map" : "JPEG Ultra HDR";
    if (state.proofFormat !== format) {
      state.proofFormat = format;
      artifactDirty = true;
      markProofDirty();
      persistSettings();
    }
    reviewSuggestion = `Proof settings now match the selected ${label} export.`;
    activateWorkflowTab("proof", { focus: true });
    els.chromeProofFormat.focus();
    renderProofUi();
  }

  function proofFormatLabel() {
    return state.proofFormat === "avif_gain_map" ? "AVIF" : "JPEG Ultra HDR";
  }

  function proofTargetLabel() {
    if (state.proofTarget === "auto") {
      const display = selectedDisplay();
      return display ? `Auto · ${display.name}` : "Auto · current display";
    }
    if (state.proofTarget === "full") return "Full encoded range";
    const nits = state.proofTarget === "custom" ? state.proofCustomNits : Number(state.proofTarget);
    return `${Number(nits).toLocaleString()} nits`;
  }

  function proofTargetShortLabel() {
    if (state.proofTarget === "auto") return "Auto";
    if (state.proofTarget === "full") return "Full";
    const nits = state.proofTarget === "custom" ? state.proofCustomNits : Number(state.proofTarget);
    return `${Number(nits).toLocaleString()} nit`;
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (["jpeg_ultrahdr", "avif_gain_map"].includes(saved.format)) state.proofFormat = saved.format;
      if (["auto", "full", "custom"].includes(saved.target) || FIXED_TARGETS.has(saved.target)) state.proofTarget = saved.target;
      if (Number.isFinite(saved.customNits)) state.proofCustomNits = clamp(saved.customNits, 100, 10000);
      if (typeof saved.displayId === "string") state.proofDisplayId = saved.displayId;
    } catch {
      // Local proof preferences are optional.
    }
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        format: state.proofFormat,
        target: state.proofTarget,
        customNits: state.proofCustomNits,
        displayId: state.proofDisplayId,
      }));
    } catch {
      // Proofing remains usable when local storage is unavailable.
    }
  }

  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = () => reject(new Error("The reconstructed proof image could not be displayed."));
      image.src = url;
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }
})();
