function renderOverlayPresetNote() {
  const levels = falseColorLevels();
  const anchorSource = state.adjustments.shared.false_color_band_anchor || "project";
  const anchorLabel = anchorSource === "project" ? "project HDR reference white" : `fixed ${levels.referenceWhite} nit`;
  els.overlayPresetNote.textContent = `Bands anchor to ${anchorLabel}; the independent warning ceiling is ${levels.peak.toLocaleString()} nit.`;
  const mode = state.adjustments.shared.overlay_mode || "off";
  const active = mode === "false_color" || mode === "zebra";
  els.overlayToggle.textContent = "Overlays";
  els.overlayToggle.classList.toggle("overlay-enabled", active);
  els.overlayToggle.setAttribute("aria-pressed", String(active));
  els.overlayToggle.setAttribute("aria-label", active ? `Overlays on: ${mode === "false_color" ? "False Color" : "Zebra"}` : "Overlays off");
  renderFalseColorKey(mode);
}

function renderFalseColorKey(mode) {
  if (!els.falseColorKey) return;
  els.falseColorKey.classList.toggle("hidden", mode !== "false_color");
  const items = falseColorBands()
    .map(({ lower, upper, paletteIndex }) => {
      const item = document.createElement("span");
      item.className = "false-color-key-item";
      const swatch = document.createElement("i");
      swatch.className = "false-color-key-swatch";
      swatch.style.backgroundColor = exposureBandColor(paletteIndex);
      const text = document.createElement("span");
      text.textContent = lower === null
        ? `< ${formatReferenceNits(upper)}`
        : upper === null
          ? `≥ ${formatReferenceNits(lower)}`
          : `${formatReferenceNits(lower)}–${formatReferenceNits(upper)}`;
      item.append(swatch, text);
      return item;
    });
  els.falseColorKey.replaceChildren(...items);
}

function falseColorLevels() {
  const anchor = state.adjustments.shared.false_color_band_anchor || "project";
  const referenceWhite = anchor === "100_nits" ? 100 : anchor === "203_nits" ? 203 : projectReferenceWhiteNits();
  const requestedPeak = Number(state.adjustments.shared.false_color_ceiling_nits);
  const peak = [100, 1000, 4000].includes(requestedPeak) ? requestedPeak : 1000;
  return { referenceWhite, peak };
}

function falseColorBands() {
  const levels = falseColorLevels();
  const highlightStart = Math.max(levels.referenceWhite, Math.min(levels.referenceWhite * 2, levels.peak * 0.5));
  const boundaries = [
    levels.referenceWhite * 0.1,
    levels.referenceWhite * 0.25,
    levels.referenceWhite * 0.5,
    levels.referenceWhite,
    highlightStart,
    levels.peak,
  ];
  const ranges = boundaries.map((upper, index) => ({
    lower: index === 0 ? null : boundaries[index - 1],
    upper,
    paletteIndex: index,
  }));
  ranges.push({ lower: boundaries.at(-1), upper: null, paletteIndex: falseColorPaletteTokens.length - 1 });
  return ranges.filter(({ lower, upper }) => lower === null || upper === null || upper > lower);
}

function formatReferenceNits(value) {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} nit`;
}

function requestLiveOverlay(tier) {
  if (!state.session || state.adjustments.shared.overlay_mode === "off") return;
  const loop = state.liveOverlay;
  loop.pending = tier;
  if (loop.running) return;
  loop.running = true;
  void (async () => {
    try {
      while (loop.pending) {
        const next = loop.pending;
        loop.pending = null;
        const interim = next === "interactive";
        const longEdge = interim
          ? Math.min(interactiveProxyLongEdge(), settledProxyLongEdge())
          : settledProxyLongEdge();
        const presented = state.overlayPresented;
        const lane = state.currentView;
        // The settle path may already have delivered this exact overlay.
        if (!interim && presented && !presented.interim
          && presented.lane === lane
          && presented.generation === state.previewGeneration[lane]
          && presented.revision === state.editRevision
          && presented.signature === geometrySignature()
          && presented.longEdge === longEdge) continue;
        await refreshOverlay(longEdge, { interim }).catch(() => null);
      }
    } finally {
      loop.running = false;
    }
  })();
}

async function refreshOverlay(longEdge = state.session?.preview?.long_edge || 1600, { interim = false } = {}) {
  if (geometryDraftActive() || await syncGlobalEditState() === false || geometryDraftActive()) return;
  if (!state.session) return;
  state.overlayAbortController?.abort();
  state.overlayAbortController = null;
  if (state.adjustments.shared.overlay_mode === "off") {
    clearPreviewOverlay();
    return;
  }
  const controller = new AbortController();
  state.overlayAbortController = controller;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  // The overlay must describe the image underneath it. editRevision alone does
  // not move for local-only invalidations or geometry changes, so a response
  // could be painted over a different generation of the picture.
  const overlayGeneration = state.previewGeneration[lane];
  const overlaySignature = geometrySignature();
  const revision = state.editRevision;
  const response = await fetch(`/api/session/${sessionId}/overlay/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edit_revision: state.editRevision, include_locals: !localsBypassed(), long_edge: longEdge }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  // A settled overlay must describe exactly the picture under it. An interim
  // one, requested while a drag is still moving the picture, is allowed to lag
  // it by the overlay's own render time -- that is what live means here -- but
  // never to go backwards, change lane or geometry, or outlive the overlay
  // being switched off. The settled pass that follows every drag replaces it.
  const requestIsCurrent = () => controller === state.overlayAbortController
    && state.session?.session_id === sessionId
    && state.currentView === lane
    && geometrySignature() === overlaySignature
    && state.adjustments.shared.overlay_mode !== "off"
    && (interim
      ? (state.overlayPresented?.lane !== lane
        || (state.overlayPresented.generation ?? -1) <= overlayGeneration)
      : state.editRevision === revision && state.previewGeneration[lane] === overlayGeneration);
  if (!requestIsCurrent()) return;
  if (response.status === 204) {
    // Keep the last valid overlay continuously composited until a replacement
    // arrives. A transient empty response must not flash the bare image.
    return;
  }
  if (!response.ok) {
    // A refused request (typically a revision the backend has already moved
    // past) keeps the last overlay; the next valid generation replaces it.
    await response.body?.cancel?.().catch(() => null);
    return;
  }

  const blob = await response.blob();
  if (!requestIsCurrent()) return;
  const url = URL.createObjectURL(blob);
  if (await applyOverlayUrl(url, requestIsCurrent)) {
    state.overlayPresented = {
      lane, generation: overlayGeneration, revision, signature: overlaySignature, longEdge, interim,
    };
  }
}

function syncOverlayPlacement() {
  const preview = activePreviewElement();
  if (!previewIsVisible()) {
    renderScopeRegionOverlay();
    return;
  }
  const paneRect = els.previewPrimaryPane.getBoundingClientRect();
  const imageRect = state.straightenPreviewFrameRect || preview.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) return;
  if (els.previewOverlay.style.display !== "none") {
    els.previewOverlay.style.left = `${imageRect.left - paneRect.left + imageRect.width / 2}px`;
    els.previewOverlay.style.top = `${imageRect.top - paneRect.top + imageRect.height / 2}px`;
    els.previewOverlay.style.width = `${imageRect.width}px`;
    els.previewOverlay.style.height = `${imageRect.height}px`;
  }
  if (els.cropEditorOverlay) Object.assign(els.cropEditorOverlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`, width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  if (els.scopeRegionOverlay) Object.assign(els.scopeRegionOverlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`, width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  renderScopeRegionOverlay();
  renderVignetteCenter();
  renderPerspectiveGuides();
  syncLocalMaskOverlayViewport();
  queueLocalMaskOverlayRender();
}

async function applyOverlayUrl(url, isCurrent = () => true) {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      const decoder = new Image();
      decoder.onload = () => resolve();
      decoder.onerror = () => reject(new Error("Overlay image failed to decode."));
      decoder.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
  if (!isCurrent()) {
    URL.revokeObjectURL(url);
    return false;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewOverlay.src = url;
  els.previewOverlay.dataset.objectUrl = url;
  delete els.previewOverlay.dataset.stale;
  els.previewOverlay.style.opacity = "1";
  els.previewOverlay.style.display = "block";
  syncOverlayPlacement();
  return true;
}

function clearPreviewOverlay() {
  state.overlayPresented = null;
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewOverlay.dataset.objectUrl;
  delete els.previewOverlay.dataset.stale;
  els.previewOverlay.removeAttribute("src");
  els.previewOverlay.style.display = "none";
  els.previewOverlay.style.opacity = "";
  els.previewOverlay.style.left = "";
  els.previewOverlay.style.top = "";
  els.previewOverlay.style.width = "";
  els.previewOverlay.style.height = "";
}

function cycleOverlayMode() {
  const order = ["off", "false_color", "zebra"];
  const current = state.adjustments.shared.overlay_mode || "off";
  const next = order[(order.indexOf(current) + 1) % order.length];
  state.adjustments.shared.overlay_mode = next;
  const control = document.querySelector('[data-path="shared.overlay_mode"]');
  if (control) control.value = next;
  renderOverlayPresetNote();
  refreshOverlay();
}

