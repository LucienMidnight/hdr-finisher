function bindColorWheels() {
  document.querySelectorAll(".color-wheel-pad").forEach((pad) => {
    const update = (event) => {
      const rect = pad.getBoundingClientRect();
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      const radius = Math.min(1, Math.hypot(dx, dy) / Math.max(1, rect.width / 2));
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      setValueByPath(state.adjustments, `current.color_grading.${wheel}.hue`, hue);
      setValueByPath(state.adjustments, `current.color_grading.${wheel}.saturation`, radius * 100);
      syncControlsFromState();
      invalidatePreview(state.currentView);
      debouncePreview(state.currentView);
    };
    pad.addEventListener("pointerdown", (event) => { pad.setPointerCapture(event.pointerId); update(event); });
    pad.addEventListener("pointermove", (event) => { if (pad.hasPointerCapture(event.pointerId)) update(event); });
    pad.addEventListener("keydown", (event) => {
      if (["Delete", "Backspace", "Home"].includes(event.key)) {
        event.preventDefault();
        const wheel = pad.closest("[data-wheel]").dataset.wheel;
        setValueByPath(state.adjustments, `current.color_grading.${wheel}`, { hue: 0, saturation: 0, luminance_ev: 0 });
        syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      const base = `current.color_grading.${wheel}`;
      const step = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        setValueByPath(state.adjustments, `${base}.hue`, (getValueByPath(state.adjustments, `${base}.hue`) + direction * step + 360) % 360);
      } else {
        const direction = event.key === "ArrowUp" ? 1 : -1;
        setValueByPath(state.adjustments, `${base}.saturation`, Math.max(0, Math.min(100, getValueByPath(state.adjustments, `${base}.saturation`) + direction * step)));
      }
      syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
    });
    pad.addEventListener("dblclick", () => {
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      setValueByPath(state.adjustments, `current.color_grading.${wheel}`, { hue: 0, saturation: 0, luminance_ev: 0 });
      syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
    });
  });
}

function renderColorWheels() {
  document.querySelectorAll(".grading-wheel").forEach((container) => {
    const wheel = state.adjustments[state.currentView]?.color_grading?.[container.dataset.wheel];
    const puck = container.querySelector(".color-wheel-puck");
    if (!wheel || !puck) return;
    const radius = Math.min(100, Math.max(0, wheel.saturation)) * 0.45;
    const angle = wheel.hue * Math.PI / 180;
    puck.style.left = `${50 + Math.cos(angle) * radius}%`;
    puck.style.top = `${50 + Math.sin(angle) * radius}%`;
  });
}

function bindVignetteCenter() {
  const commitNumeric = () => {
    state.adjustments[state.currentView].vignette.center_x = Math.max(0, Math.min(1, Number(els.vignetteCenterX.value) / 100));
    state.adjustments[state.currentView].vignette.center_y = Math.max(0, Math.min(1, Number(els.vignetteCenterY.value) / 100));
    renderVignetteCenter(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
  };
  els.vignetteCenterX?.addEventListener("change", commitNumeric);
  els.vignetteCenterY?.addEventListener("change", commitNumeric);
  els.vignettePickCenter?.addEventListener("click", () => {
    state.vignettePickCenter = !state.vignettePickCenter;
    renderVignetteCenter();
  });
  els.vignetteShowOverlay?.addEventListener("click", () => {
    state.vignetteShowOverlay = !state.vignetteShowOverlay;
    renderVignetteCenter();
  });
  // The outline follows every Vignette slider as it moves.
  document.querySelector(".vignette-group")?.addEventListener("input", () => renderVignetteShape());
  const movePointerGesture = (event) => {
    const gesture = state.vignetteCenterGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateVignetteCenter(
      (event.clientX - gesture.grabOffsetX - gesture.rect.left) / gesture.rect.width,
      (event.clientY - gesture.grabOffsetY - gesture.rect.top) / gesture.rect.height,
      gesture.lane,
    );
  };
  const finishPointerGesture = (event) => {
    const gesture = state.vignetteCenterGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    state.vignetteCenterGesture = null;
    window.removeEventListener("pointermove", movePointerGesture);
    window.removeEventListener("pointerup", finishPointerGesture);
    window.removeEventListener("pointercancel", finishPointerGesture);
    renderVignetteCenter();
    invalidatePreview(gesture.lane);
    debouncePreview(gesture.lane);
    state.previewScheduler?.endInteraction();
  };
  els.vignetteCenterHandle?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    const rect = activePreviewElement()?.getBoundingClientRect();
    const vignette = state.adjustments[state.currentView]?.vignette;
    if (!rect?.width || !rect?.height || !vignette) return;
    event.preventDefault();
    state.vignetteCenterGesture = {
      pointerId: event.pointerId,
      lane: state.currentView,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      grabOffsetX: event.clientX - (rect.left + rect.width * vignette.center_x),
      grabOffsetY: event.clientY - (rect.top + rect.height * vignette.center_y),
    };
    state.previewScheduler?.beginInteraction();
    window.addEventListener("pointermove", movePointerGesture);
    window.addEventListener("pointerup", finishPointerGesture);
    window.addEventListener("pointercancel", finishPointerGesture);
  });
  els.vignetteCenterHandle?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const vignette = state.adjustments[state.currentView].vignette;
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft") vignette.center_x -= step;
    if (event.key === "ArrowRight") vignette.center_x += step;
    if (event.key === "ArrowUp") vignette.center_y -= step;
    if (event.key === "ArrowDown") vignette.center_y += step;
    updateVignetteCenter(vignette.center_x, vignette.center_y);
  });
}

function updateVignetteCenter(x, y, lane = state.currentView) {
  const vignette = state.adjustments[lane].vignette;
  vignette.center_x = Math.max(0, Math.min(1, x)); vignette.center_y = Math.max(0, Math.min(1, y));
  if (lane === state.currentView) renderVignetteCenter();
  invalidatePreview(lane); debouncePreview(lane);
}

/**
 * One closed outline of the vignette at `radius`, in frame pixels. It is the
 * same shape the renderer shades: a superellipse whose corners follow
 * Roundness and whose axes follow Horizontal and Vertical Scale.
 */
function vignetteOutlinePath(vignette, radius, width, height) {
  const unit = Math.max(1, 0.5 * Math.min(width, height));
  const roundness = (Number(vignette.roundness) || 0) / 100;
  const exponent = Math.max(1, roundness >= 0 ? 2 + 6 * roundness : 2 + roundness);
  const centerX = vignette.center_x * Math.max(width - 1, 1);
  const centerY = vignette.center_y * Math.max(height - 1, 1);
  const reachX = radius * unit * (Number(vignette.scale_x) || 100) / 100;
  const reachY = radius * unit * (Number(vignette.scale_y) || 100) / 100;
  const points = [];
  for (let step = 0; step < 96; step += 1) {
    const angle = step / 96 * 2 * Math.PI;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const x = centerX + Math.sign(cosine) * reachX * Math.abs(cosine) ** (2 / exponent);
    const y = centerY + Math.sign(sine) * reachY * Math.abs(sine) ** (2 / exponent);
    points.push(`${step ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${points.join("")}Z`;
}

function renderVignetteShape() {
  const overlay = els.vignetteShapeOverlay;
  if (!overlay) return;
  const groupOpen = !document.querySelector(".vignette-group")?.classList.contains("collapsed");
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  const frameWidth = preview instanceof HTMLCanvasElement ? preview.width : preview?.naturalWidth;
  const frameHeight = preview instanceof HTMLCanvasElement ? preview.height : preview?.naturalHeight;
  const visible = Boolean(state.session) && state.vignetteShowOverlay && groupOpen && state.activeWorkflow === "grade"
    && imageRect?.width > 0 && frameWidth > 0 && frameHeight > 0;
  overlay.classList.toggle("hidden", !visible);
  if (els.vignetteShowOverlay) {
    els.vignetteShowOverlay.setAttribute("aria-pressed", String(state.vignetteShowOverlay));
    els.vignetteShowOverlay.lastElementChild.textContent = state.vignetteShowOverlay ? "Hide overlay" : "Show overlay";
  }
  if (!visible) return;
  const vignette = state.adjustments[state.currentView]?.vignette || defaultVignette();
  Object.assign(overlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`,
    width: `${imageRect.width}px`, height: `${imageRect.height}px`,
  });
  overlay.setAttribute("viewBox", `0 0 ${frameWidth} ${frameHeight}`);
  overlay.setAttribute("preserveAspectRatio", "none");
  // The same start and end the renderer uses: nothing inside the inner line,
  // full strength outside the dashed outer line.
  const start = 0.15 + 0.70 * (vignette.midpoint ?? 50) / 100;
  const end = start + 0.02 + 0.98 * (vignette.feather ?? 75) / 100;
  overlay.querySelector(".vignette-shape-inner").setAttribute("d", vignetteOutlinePath(vignette, start, frameWidth, frameHeight));
  overlay.querySelector(".vignette-shape-outer").setAttribute("d", vignetteOutlinePath(vignette, end, frameWidth, frameHeight));
}

function renderVignetteCenter() {
  if (!els.vignetteCenterHandle) return;
  const vignette = state.adjustments[state.currentView]?.vignette || defaultVignette();
  els.vignetteCenterX.value = String(Math.round(vignette.center_x * 100));
  els.vignetteCenterY.value = String(Math.round(vignette.center_y * 100));
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  if (paneRect && imageRect) {
    els.vignetteCenterHandle.style.left = `${imageRect.left - paneRect.left + imageRect.width * vignette.center_x}px`;
    els.vignetteCenterHandle.style.top = `${imageRect.top - paneRect.top + imageRect.height * vignette.center_y}px`;
  }
  const groupOpen = !document.querySelector(".vignette-group")?.classList.contains("collapsed");
  const visible = state.activeWorkflow === "grade" && (state.vignettePickCenter || groupOpen);
  els.vignetteCenterHandle.classList.toggle("hidden", !visible);
  els.vignettePickCenter?.setAttribute("aria-pressed", String(state.vignettePickCenter));
  renderVignetteShape();
  const dark = vignette.amount < 0;
  els.vignetteHighlightProtectionRow?.classList.toggle("control-disabled", !dark);
  els.vignetteHighlightProtectionRow?.querySelector("input")?.toggleAttribute("disabled", !dark);
}

