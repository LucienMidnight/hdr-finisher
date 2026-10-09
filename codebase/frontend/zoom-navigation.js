function setZoomMode(mode) {
  if (mode === "actual") {
    setCustomZoom(100);
    return;
  }
  if (mode === "custom") {
    setCustomZoom(state.zoomPercent);
    return;
  }
  const changed = state.zoomMode !== "fit";
  state.zoomMode = "fit";
  els.dropzone.scrollLeft = 0;
  els.dropzone.scrollTop = 0;
  applyZoomGeometry();
  scheduleNavigationThumbnail();
  if (changed) scheduleZoomRefinement();
}

const navigationThumbnail = { timer: 0, controller: null, key: "", url: "", inflightKey: "" };

function clearNavigationThumbnail() {
  window.clearTimeout(navigationThumbnail.timer);
  navigationThumbnail.timer = 0;
  navigationThumbnail.controller?.abort();
  navigationThumbnail.controller = null;
  navigationThumbnail.key = "";
  if (navigationThumbnail.url) URL.revokeObjectURL(navigationThumbnail.url);
  navigationThumbnail.url = "";
  els.navigationThumbImage.removeAttribute("src");
  els.navigationThumb.classList.add("hidden");
}

const NAVIGATION_WINDOW_MODES = ["auto", "always", "off"];
const NAVIGATION_WINDOW_MARGIN_PX = 12;

/**
 * Whether the Navigate window belongs on screen. Auto shows it for any view
 * closer than Fit, because Fit is the largest view with nothing off screen.
 */
function navigationWindowWanted() {
  if (!state.session || state.navigationWindowMode === "off") return false;
  if (state.navigationWindowMode === "always") return true;
  return state.zoomMode === "custom" && state.zoomPercent > (state.fitZoomPercent || 100) * 1.001;
}

/**
 * The size of the overview picture for an image of this aspect ratio inside a
 * viewer of this size. It stays a modest corner inset for ordinary pictures.
 * A very wide strip (a line-scan panorama) or a very tall one keeps a short
 * edge that can still be clicked, and is squeezed along its long edge once it
 * would otherwise leave the viewer.
 */
function navigationWindowSize(aspect, viewWidth, viewHeight) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const minEdge = 28;
  const chrome = 2 * NAVIGATION_WINDOW_MARGIN_PX + 16;
  const widthLimit = Math.max(minEdge, Math.min(viewWidth * 0.6, viewWidth - chrome));
  const heightLimit = Math.max(minEdge, Math.min(viewHeight * 0.5, viewHeight - chrome - 16));
  let width = Math.min(clamp(viewWidth * 0.22, 120, 260), clamp(viewHeight * 0.3, 90, 220) * ratio);
  let height = width / ratio;
  if (height < minEdge) { height = minEdge; width = height * ratio; }
  if (width < minEdge) { width = minEdge; height = width / ratio; }
  return { width: Math.round(Math.min(width, widthLimit)), height: Math.round(Math.min(height, heightLimit)) };
}

function setNavigationWindowMode(mode) {
  state.navigationWindowMode = NAVIGATION_WINDOW_MODES.includes(mode) ? mode : "auto";
  document.querySelectorAll("[data-navigation-window]").forEach((item) => {
    item.setAttribute("aria-checked", String(item.dataset.navigationWindow === state.navigationWindowMode));
  });
  scheduleNavigationThumbnail();
}

function updateNavigationViewport() {
  const visible = navigationWindowWanted() && Boolean(els.navigationThumbImage.src);
  els.navigationThumb.classList.toggle("hidden", !visible);
  if (!visible) return;
  const preview = activePreviewElement();
  const frameWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
  const frameHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
  if (!(frameWidth > 0 && frameHeight > 0)) return;
  // Anchor the bottom-right corner just inside the picture area, clear of its
  // scroll bars; the top-left corner moves with the picture's shape.
  const panel = els.navigationThumb.parentElement.getBoundingClientRect();
  const frame = els.dropzone.getBoundingClientRect();
  const size = navigationWindowSize(frameWidth / frameHeight, els.dropzone.clientWidth, els.dropzone.clientHeight);
  els.navigationThumb.style.right = `${panel.right - (frame.left + els.dropzone.clientLeft + els.dropzone.clientWidth) + NAVIGATION_WINDOW_MARGIN_PX}px`;
  els.navigationThumb.style.bottom = `${panel.bottom - (frame.top + els.dropzone.clientTop + els.dropzone.clientHeight) + NAVIGATION_WINDOW_MARGIN_PX}px`;
  els.navigationThumbImage.parentElement.style.width = `${size.width}px`;
  els.navigationThumbImage.parentElement.style.height = `${size.height}px`;
  const rect = visibleOutputRect(frameWidth, frameHeight)
    || { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const outline = els.navigationThumbViewport.style;
  outline.left = `${rect.x / frameWidth * 100}%`;
  outline.top = `${rect.y / frameHeight * 100}%`;
  outline.width = `${rect.width / frameWidth * 100}%`;
  outline.height = `${rect.height / frameHeight * 100}%`;
}

function scheduleNavigationThumbnail() {
  updateNavigationViewport();
  window.clearTimeout(navigationThumbnail.timer);
  if (!navigationWindowWanted()) return;
  navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
}

function navigationThumbnailWorkReady() {
  const lane = state.currentView;
  const accepted = state.acceptedPresentation;
  return !state.importInProgress && !state.zoomRefinementTimer
    && !state.gpuDraftInFlight && !state.previewScheduler?.interacting
    && !state.gpuScopeRequestInFlight && !state.scopeRequestInFlight
    && !(state.gpuPreview?.activeRenderCount > 0)
    && !(state.gpuPreview?.activeScopeCount > 0)
    && accepted?.lane === lane && accepted.exact
    && accepted.generation === state.previewGeneration[lane]
    && accepted.geometrySignature === geometrySignature()
    && accepted.processedLongEdge >= requiredProcessingLongEdge();
}

async function refreshNavigationThumbnail() {
  if (!navigationWindowWanted()) return;
  // Overview work starts only after the requested picture and scopes settle.
  // The GPU route grades a separate 512-edge canvas; CPU mode keeps its small
  // fallback here, outside foreground refinement.
  if (!navigationThumbnailWorkReady()) {
    navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
    return;
  }
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  if (await syncGlobalEditState() === false || state.session?.session_id !== sessionId) return;
  if (!navigationThumbnailWorkReady()) {
    navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
    return;
  }
  const request = window.HDRWholeImagePreviewPipe.request("navigation", state.session.source.width,
    { sessionId, lane, editRevision: state.editRevision, generation: state.previewGeneration[lane],
      geometrySignature: geometrySignature(), includeLocals: !localsBypassed() });
  const key = JSON.stringify(request);
  if (navigationThumbnail.key === key && navigationThumbnail.url) return;
  if (navigationThumbnail.inflightKey === key && navigationThumbnail.controller) return;
  navigationThumbnail.controller?.abort();
  const controller = new AbortController();
  navigationThumbnail.controller = controller;
  navigationThumbnail.inflightKey = key;
  const isCurrent = () => controller === navigationThumbnail.controller
    && state.session?.session_id === sessionId && state.currentView === lane
    && state.editRevision === request.editRevision && !state.globalEditDirty
    && state.previewGeneration[lane] === request.generation
    && geometrySignature() === request.geometrySignature
    && navigationWindowWanted()
    && request.includeLocals === !localsBypassed()
    && !state.previewScheduler?.interacting && !state.gpuDraftInFlight;
  try {
    let blob;
    if (gpuPreviewEligible(lane) && state.activeWorkflow !== "proof") {
      blob = await state.gpuPreview.renderNavigationProxy(sessionId, lane, state.adjustments, sampleCurvePoints,
        request.includeLocals ? localAdjustments() : [], request.editRevision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: request.generation, isCurrent });
    } else {
      const response = await fetch(`/api/session/${sessionId}/preview/${lane}?purpose=navigation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_revision: request.editRevision, include_locals: !localsBypassed(),
          long_edge: request.longEdge, execution: "whole", hdr_display: false }),
        signal: controller.signal,
      });
      if (!response.ok) return;
      blob = await response.blob();
    }
    if (!blob || !isCurrent()) return;
    const url = URL.createObjectURL(blob);
    const previous = navigationThumbnail.url;
    navigationThumbnail.url = url;
    navigationThumbnail.key = key;
    els.navigationThumbImage.onload = updateNavigationViewport;
    els.navigationThumbImage.src = url;
    if (previous) URL.revokeObjectURL(previous);
  } catch (error) {
    if (error.name !== "AbortError") console.warn("Navigation thumbnail unavailable", error);
  } finally {
    if (navigationThumbnail.controller === controller) {
      navigationThumbnail.controller = null;
      navigationThumbnail.inflightKey = "";
    }
  }
}

function scheduleZoomRefinement({ continuous = false } = {}) {
  if (!state.session || !gpuPreviewEligible(state.currentView)) return;
  window.clearTimeout(state.zoomRefinementTimer);
  // A pending adjustment settle from the previous scale can otherwise race
  // this zoom and start a whole-frame CPU fallback at the new edge.
  state.previewScheduler?.cancel();
  state.inactiveSourceController?.abort();
  state.inactiveSourceController = null;
  // Zoom changes the requested processing scale without changing the edit
  // generation. Recompute the visible status before the replacement starts.
  renderViewerStatus();
  // Single navigation actions need no gesture debounce. Retain it for wheel
  // and slider input so a gesture replaces pending work instead of flooding it.
  state.zoomRefinementTimer = window.setTimeout(async () => {
    state.zoomRefinementTimer = 0;
    if (!state.session || !gpuPreviewEligible(state.currentView)) return;
    const target = requiredProcessingLongEdge();
    const lane = state.currentView;
    const sessionId = state.session.session_id;
    if (state.acceptedPresentation?.processedLongEdge !== target) {
      const decision = interactiveScaleDecision(lane);
      if (decision.coarse && decision.edge < target) {
        // Zoom can require the tiled renderer even for its reduced pass.
        // Interactive tier explicitly refuses tiles; refinement tier accepts
        // them while the coarse flag keeps the presentation truthful.
        await renderGpuDraft(lane, { tier: "refinement", longEdge: responseCoarseLongEdge(target),
          coarse: true, reason: "zoom-current-coarse" });
      }
      // A failed, cancelled, or superseded coarse pass never cancels the exact
      // obligation. A newer zoom owns its own request and wins at presentation.
      if (state.session?.session_id !== sessionId || state.currentView !== lane
        || requiredProcessingLongEdge() !== target) return;
      if (state.acceptedPresentation?.processedLongEdge !== target
        || !state.acceptedPresentation.exact) {
        await renderGpuDraft(lane, { tier: "refinement", longEdge: target, reason: "zoom-scale" });
      }
    } else {
      noteViewerPan();
    }
    // Zoom cancels the adjustment scheduler, including its scope obligation.
    // Restore scopes only after the replacement frame is exact and current;
    // a superseded zoom must not analyze the next zoom's old canvas.
    const accepted = state.acceptedPresentation;
    if (state.session?.session_id === sessionId && state.currentView === lane
      && requiredProcessingLongEdge() === target && accepted?.lane === lane
      && accepted.generation === state.previewGeneration[lane]
      && accepted.exact && accepted.processedLongEdge === target) {
      await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane });
    }
  }, continuous ? 80 : 0);
}

function shouldKeepHdrGpuSurface(lane) {
  return lane === state.currentView
    && Boolean(state.gpuPreview?.available)
    && !state.comparePeekActive;
}

function setCustomZoom(percent, anchor = null, { continuous = false } = {}) {
  const nextPercent = clamp(Number(percent) || 100, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
  const changed = state.zoomMode !== "custom" || Math.abs(state.zoomPercent - nextPercent) > 0.001;
  const preview = anchor?.previewElement || activePreviewElement();
  const imageVisible = previewIsVisible();
  const oldRect = imageVisible ? preview.getBoundingClientRect() : null;
  const anchorX = anchor?.clientX ?? (els.dropzone.getBoundingClientRect().left + els.dropzone.clientWidth / 2);
  const anchorY = anchor?.clientY ?? (els.dropzone.getBoundingClientRect().top + els.dropzone.clientHeight / 2);
  const normalizedX = oldRect?.width ? clamp((anchorX - oldRect.left) / oldRect.width, 0, 1) : 0.5;
  const normalizedY = oldRect?.height ? clamp((anchorY - oldRect.top) / oldRect.height, 0, 1) : 0.5;

  state.zoomMode = "custom";
  state.zoomPercent = nextPercent;
  applyZoomGeometry();

  if (oldRect) {
    const newRect = preview.getBoundingClientRect();
    els.dropzone.scrollLeft += (newRect.left + normalizedX * newRect.width) - anchorX;
    els.dropzone.scrollTop += (newRect.top + normalizedY * newRect.height) - anchorY;
  }
  syncOverlayPlacement();
  scheduleNavigationThumbnail();
  if (changed) scheduleZoomRefinement({ continuous });
}

function applyZoomGeometry() {
  const preview = activePreviewElement();
  const visible = previewIsVisible();
  els.dropzone.classList.toggle("zoom-custom", state.zoomMode === "custom");
  els.zoomFit.classList.toggle("active", state.zoomMode === "fit");
  els.zoomActual.classList.toggle("active", state.zoomMode === "custom" && Math.abs(state.zoomPercent - 100) < 0.01);
  if (!visible) {
    updateZoomReadout();
    return;
  }
  if (state.geometryPresentationPending && !state.perspectiveDraftFrame) {
    updateZoomReadout();
    syncOverlayPlacement();
    return;
  }

  // Geometry can change the rendered frame's dimensions. Size the viewer from
  // the current bitmap, not the original source, or a crop is stretched back
  // into the source aspect ratio after it is applied.
  const renderedWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
  const renderedHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
  const renderedFrameWidth = Math.max(1, renderedWidth || state.session.source.width);
  const renderedFrameHeight = Math.max(1, renderedHeight || state.session.source.height);
  const renderedAspect = renderedFrameWidth / renderedFrameHeight;
  const interactiveRotateAngle = Number.parseFloat(
    preview.style.getPropertyValue("--interactive-rotate-angle"),
  ) || 0;
  const interactiveQuarterTurns = Math.round(Math.abs(interactiveRotateAngle) / 90) % 4;
  const interactiveRotationSwapsAxes = interactiveQuarterTurns % 2 === 1;
  const sessionId = state.session?.session_id || null;
  const geometrySignature = JSON.stringify(state.adjustments?.shared?.geometry || {});
  const previewFrameReady = preview instanceof HTMLCanvasElement
    ? Boolean(state.gpuPreparedLane[state.currentView])
    : Boolean(preview.complete && preview.naturalWidth > 0);
  if (previewFrameReady && !interactiveRotationSwapsAxes && (
    !state.zoomReferenceFrame
    || state.zoomReferenceFrame.sessionId !== sessionId
    || state.zoomReferenceFrame.geometrySignature !== geometrySignature
  )) {
    state.zoomReferenceFrame = {
      sessionId,
      geometrySignature,
      longEdge: state.zoomReferenceFrame?.sessionId === sessionId
        ? state.zoomReferenceFrame.longEdge
        : Math.max(renderedFrameWidth, renderedFrameHeight),
      aspect: renderedAspect,
    };
  }
  // Settled/local previews can replace the interactive bitmap with a slightly
  // different proxy size (for example 726px -> the 768px settled minimum).
  // CSS geometry must use one stable per-session reference or every such swap
  // looks like a zoom and shifts the scroll position at custom magnification.
  // Keep one aspect for the whole geometry state. Interactive and settled
  // proxies can differ by a pixel after crop/rotation rounding; using each
  // bitmap's aspect made ordinary grading gestures appear to shift the image.
  // A geometry-signature change captures a new aspect, while tonal/color edits
  // can freely swap proxy resolution without changing viewport placement.
  const referenceLongEdge = state.zoomReferenceFrame?.sessionId === sessionId
    ? state.zoomReferenceFrame.longEdge
    : Math.max(renderedFrameWidth, renderedFrameHeight);
  const referenceAspect = state.zoomReferenceFrame?.sessionId === sessionId
    && state.zoomReferenceFrame.geometrySignature === geometrySignature
    && Number.isFinite(state.zoomReferenceFrame.aspect)
    ? state.zoomReferenceFrame.aspect
    : renderedAspect;
  // Actual-size and custom zoom are defined in source/output pixels, including
  // while Rotate is transforming the previously committed bitmap. Falling
  // back to the smaller proxy frame during a draft makes the image zoom out;
  // accepting the authoritative frame then jumps back to source size. Use the
  // transaction's original geometry because that is the bitmap currently
  // receiving the CSS transform. A committed handoff returns above while its
  // old bitmap is still mounted.
  const draftFrame = state.perspectiveDraftFrame?.signature === geometrySignature
    ? state.perspectiveDraftFrame : null;
  const draftScale = Math.min(1, perspectiveDraftLongEdge() / Math.max(state.session.source.width, state.session.source.height));
  const sourceFrame = draftFrame
    ? { width: draftFrame.width / draftScale, height: draftFrame.height / draftScale }
    : sourcePixelFrameDimensions(state.rotateDraftGeometry || state.adjustments?.shared?.geometry);
  const sourceWidth = sourceFrame?.width
    || (referenceAspect >= 1 ? referenceLongEdge : referenceLongEdge * referenceAspect);
  const sourceHeight = sourceFrame?.height
    || (referenceAspect >= 1 ? referenceLongEdge / referenceAspect : referenceLongEdge);
  const frameWidth = Math.max(1, els.dropzone.clientWidth);
  const frameHeight = Math.max(1, els.dropzone.clientHeight);
  const paneWidth = state.compareLayout === "side-horizontal" ? frameWidth / 2 : frameWidth;
  const paneHeight = state.compareLayout === "side-vertical" ? frameHeight / 2 : frameHeight;
  const fitSourceWidth = interactiveRotationSwapsAxes ? sourceHeight : sourceWidth;
  const fitSourceHeight = interactiveRotationSwapsAxes ? sourceWidth : sourceHeight;
  const deviceRatio = Math.max(1, Number(window.devicePixelRatio) || 1);
  const fitPercent = Math.min(paneWidth * deviceRatio / fitSourceWidth,
    paneHeight * deviceRatio / fitSourceHeight) * 100;
  state.fitZoomPercent = fitPercent;
  const percent = state.zoomMode === "fit" ? fitPercent : state.zoomPercent;
  const displayWidth = Math.max(1, sourceWidth * percent / (100 * deviceRatio));
  const displayHeight = Math.max(1, sourceHeight * percent / (100 * deviceRatio));
  const visualDisplayWidth = interactiveRotationSwapsAxes ? displayHeight : displayWidth;
  const visualDisplayHeight = interactiveRotationSwapsAxes ? displayWidth : displayHeight;

  const stageContentWidth = state.compareLayout === "side-horizontal" ? visualDisplayWidth * 2 : visualDisplayWidth;
  const stageContentHeight = state.compareLayout === "side-vertical" ? visualDisplayHeight * 2 : visualDisplayHeight;
  els.previewStage.style.width = `${Math.max(frameWidth, stageContentWidth)}px`;
  els.previewStage.style.height = `${Math.max(frameHeight, stageContentHeight)}px`;
  els.previewImage.style.width = `${displayWidth}px`;
  els.previewImage.style.height = `${displayHeight}px`;
  els.previewCanvas.style.width = `${displayWidth}px`;
  els.previewCanvas.style.height = `${displayHeight}px`;
  els.comparisonImage.style.width = `${displayWidth}px`;
  els.comparisonImage.style.height = `${displayHeight}px`;
  els.comparisonCanvas.style.width = `${displayWidth}px`;
  els.comparisonCanvas.style.height = `${displayHeight}px`;
  if (els.chromeProofImage) {
    els.chromeProofImage.style.width = `${displayWidth}px`;
    els.chromeProofImage.style.height = `${displayHeight}px`;
  }
  if (els.chromeProofWatermark) {
    els.chromeProofWatermark.style.width = `${displayWidth}px`;
    els.chromeProofWatermark.style.height = `${displayHeight}px`;
  }
  // Past 100% one source pixel covers more than one device pixel. Show it as
  // a flat square, the way an inspection zoom should; at and below 100% the
  // compositor keeps its smooth filtering so Fit does not alias.
  const magnified = percent > 100.5;
  for (const element of [els.previewCanvas, els.comparisonCanvas, els.previewImage, els.comparisonImage]) {
    element.classList.toggle("pixel-magnified", magnified);
  }
  state.zoomPercent = percent;
  updateZoomReadout();
  syncOverlayPlacement();
}

function updateZoomReadout() {
  const percent = Math.max(0.01, state.zoomPercent || 100);
  if (document.activeElement !== els.zoomReadout) {
    els.zoomReadout.value = formatZoomPercent(percent);
  }
  els.zoomSlider.value = String(zoomPercentToSlider(clamp(percent, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)));
  els.zoomSlider.setAttribute("aria-valuetext", state.zoomMode === "fit" ? `Fit, ${formatZoomPercent(percent)}` : formatZoomPercent(percent));
  updateRangeVisual(els.zoomSlider);
}

function formatZoomPercent(percent) {
  const digits = percent < 10 ? 1 : 0;
  return `${Number(percent).toFixed(digits)}%`;
}

function commitZoomReadout() {
  const raw = els.zoomReadout.value.trim();
  if (/^fit/i.test(raw)) {
    setZoomMode("fit");
    return;
  }
  const percent = Number.parseFloat(raw.replace("%", ""));
  if (Number.isFinite(percent)) setCustomZoom(percent);
  else updateZoomReadout();
}

function stepZoom(direction) {
  const current = state.zoomPercent || 100;
  const epsilon = 0.001;
  const next = direction > 0
    ? ZOOM_STEPS.find((value) => value > current + epsilon) ?? MAX_ZOOM_PERCENT
    : [...ZOOM_STEPS].reverse().find((value) => value < current - epsilon) ?? MIN_ZOOM_PERCENT;
  setCustomZoom(next);
}

function handleViewerWheel(event) {
  const candidates = [activePreviewElement()];
  if (state.compareLayout !== "single") {
    if (els.comparisonCanvas.style.display !== "none") candidates.push(els.comparisonCanvas);
    if (els.comparisonImage.style.display !== "none") candidates.push(els.comparisonImage);
  }
  const preview = candidates.find((candidate) => {
    if (!candidate) return false;
    const rect = candidate.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!preview) return;
  event.preventDefault();
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * els.dropzone.clientHeight
      : event.deltaY;
  const nextPercent = (state.zoomPercent || 100) * Math.exp(-delta * 0.0022);
  setCustomZoom(nextPercent, { clientX: event.clientX, clientY: event.clientY, previewElement: preview }, { continuous: true });
}

function zoomPercentToSlider(percent) {
  return Math.log(percent / MIN_ZOOM_PERCENT) / Math.log(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT) * 100;
}

function sliderToZoomPercent(value) {
  return MIN_ZOOM_PERCENT * Math.pow(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT, clamp(value, 0, 100) / 100);
}

