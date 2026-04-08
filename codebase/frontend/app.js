const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  adjustments: {
    hdr: { exposure: 0, highlight_rolloff: 0.25, shadow_lift: 0, white_balance_kelvin: 6500, tint: 0 },
    sdr: { exposure: 0, highlight_recovery: 0.25, shadow: 0, contrast: 0, tone_mapper: "aces" },
    shared: {
      active_focus: "hdr",
      curves_enabled: false,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
  },
  selectedCurveChannel: "luma",
  activeCurvePoint: null,
  previewAbortController: null,
  refreshTimer: null,
  previewInfo: {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  },
  displayInfo: buildDisplayProbe(),
};

const defaultAdjustments = () => ({
  hdr: { exposure: 0, highlight_rolloff: 0.25, shadow_lift: 0, white_balance_kelvin: 6500, tint: 0 },
  sdr: { exposure: 0, highlight_recovery: 0.25, shadow: 0, contrast: 0, tone_mapper: "aces" },
  shared: {
    active_focus: state.currentView,
    curves_enabled: false,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
});

const els = {
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  importButton: document.getElementById("import-button"),
  ejectButton: document.getElementById("eject-button"),
  badge: document.getElementById("badge"),
  overrideWarning: document.getElementById("override-warning"),
  interpretationSelect: document.getElementById("interpretation-select"),
  applyInterpretationButton: document.getElementById("apply-interpretation"),
  curvesEnabled: document.getElementById("curves-enabled"),
  curveEditor: document.getElementById("curve-editor"),
  curveStatus: document.getElementById("curve-status"),
  curveReset: document.getElementById("curve-reset"),
  curveChannelButtons: [...document.querySelectorAll("[data-curve-channel]")],
  metadataList: document.getElementById("metadata-list"),
  previewOutputList: document.getElementById("preview-output-list"),
  displayInfoList: document.getElementById("display-info-list"),
  sourcePreviewList: document.getElementById("source-preview-list"),
  sessionName: document.getElementById("session-name"),
  previewImage: document.getElementById("preview-image"),
  emptyState: document.getElementById("empty-state"),
  previewStatus: document.getElementById("preview-status"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  histogram: document.getElementById("histogram"),
  exportButton: document.getElementById("export-button"),
  exportStatus: document.getElementById("export-status"),
  exportFormat: document.getElementById("export-format"),
  exportQuality: document.getElementById("export-quality"),
  viewButtons: [...document.querySelectorAll(".segmented button")],
  controls: [...document.querySelectorAll("[data-path]")],
};

boot();

async function boot() {
  bindEvents();
  renderReadouts();
  drawCurveEditor();
}

function bindEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await uploadFile(file);
    event.target.value = "";
  });
  els.importButton.addEventListener("click", () => els.fileInput.click());

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("drag-active");
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, () => {
      els.dropzone.classList.remove("drag-active");
    });
  });
  els.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("drag-active");
    const [file] = event.dataTransfer.files;
    if (file) await uploadFile(file);
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      els.viewButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.currentView = button.dataset.kind;
      state.adjustments.shared.active_focus = state.currentView;
      renderReadouts();
      await refreshPreview();
      await refreshScopes();
    });
  });

  els.controls.forEach((control) => {
    control.addEventListener("input", () => {
      const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
      setValueByPath(state.adjustments, control.dataset.path, value);
      if (control.dataset.path === "shared.curves_enabled") drawCurveEditor();
      debouncePreview();
    });
  });

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setCurveValues(state.selectedCurveChannel, defaultCurvePoints());
    drawCurveEditor();
    debouncePreview();
  });
  bindCurveEditor();

  els.exportButton.addEventListener("click", exportCurrentSession);
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.ejectButton.addEventListener("click", ejectCurrentSession);

  if (window.matchMedia) {
    ["(dynamic-range: high)", "(color-gamut: p3)", "(color-gamut: rec2020)"].forEach((query) => {
      const media = window.matchMedia(query);
      media.addEventListener?.("change", () => {
        state.displayInfo = buildDisplayProbe();
        renderReadouts();
      });
    });
  }
}

async function loadCapabilities() {
  const response = await fetch("/api/capabilities");
  const data = await response.json();
  state.capabilities = data.capabilities;
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Preparing session...");
  const response = await fetch("/api/session", { method: "POST", body: formData });
  const payload = await response.json();
  if (!response.ok) {
    els.badge.textContent = payload.detail || "Upload failed.";
    els.badge.className = "badge bad";
    setPreviewError("Upload failed before a preview could be created.");
    clearPreviewImage();
    return;
  }
  state.session = payload.session;
  state.adjustments = payload.session.adjustments;
  renderSession();
  await refreshPreview();
  await refreshScopes();
}

async function ejectCurrentSession() {
  if (!state.session) return;
  await fetch("/api/session/current", { method: "DELETE" }).catch(() => null);
  state.session = null;
  state.adjustments = defaultAdjustments();
  state.previewInfo = {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  };
  clearPreviewImage();
  els.badge.textContent = "No file loaded.";
  els.badge.className = "badge neutral";
  els.sessionName.textContent = "No active session";
  els.metadataList.innerHTML = "";
  els.overrideWarning.classList.add("hidden");
  els.exportStatus.textContent = "Export backends are capability-gated in this milestone.";
  syncControlsFromState();
  drawHistogram([]);
  renderReadouts();
  hidePreviewMessage();
  renderSessionChrome();
  state.selectedCurveChannel = "luma";
  renderCurveChannelTabs();
  drawCurveEditor();
}

function renderSession() {
  const session = state.session;
  els.sessionName.textContent = session.source.filename;
  clearPreviewImage();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  els.overrideWarning.classList.toggle("hidden", !session.analysis.needs_color_override);
  els.interpretationSelect.value = defaultInterpretationValue(session);
  renderMetadata(session);
  renderReadouts();
  syncControlsFromState();
  renderSessionChrome();
  drawCurveEditor();
}

function renderMetadata(session) {
  const entries = [
    ["Size", `${session.source.width} x ${session.source.height}`],
    ["Format", session.source.suffix],
    ["Working space", session.source.working_space],
    ["Source space", session.source.source_color_space || "unknown"],
    ["Transfer", session.source.transfer_function || "unknown"],
    ["Bit depth", session.metadata.bit_depth || "unknown"],
    ["Camera", session.metadata.camera_model || "n/a"],
    ["Lens", session.metadata.lens || "n/a"],
  ];
  els.metadataList.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.metadataList.append(dt, dd);
  }
}

function renderReadouts() {
  renderKeyValueList(els.previewOutputList, previewOutputEntries());
  renderKeyValueList(els.displayInfoList, displayProbeEntries());
  renderKeyValueList(els.sourcePreviewList, sourceInterpretationEntries());
  els.curveStatus.textContent = `Curves apply to the currently active preview side: ${state.adjustments.shared.active_focus.toUpperCase()}.`;
}

function previewOutputEntries() {
  return [
    ["View", state.currentView.toUpperCase()],
    ["Transport", state.previewInfo.transport],
    ["Media", state.previewInfo.mediaType],
    ["Space", state.previewInfo.colorSpace],
    ["Transfer", state.previewInfo.transfer],
    ["Bit Depth", state.previewInfo.bitDepth],
    ["Notes", state.previewInfo.notes],
  ];
}

function displayProbeEntries() {
  return [
    ["Dynamic Range", state.displayInfo.dynamicRange],
    ["Color Gamut", state.displayInfo.colorGamut],
    ["Pixel Ratio", state.displayInfo.pixelRatio],
    ["Screen Depth", state.displayInfo.screenDepth],
    ["Browser", state.displayInfo.browser],
  ];
}

function sourceInterpretationEntries() {
  if (!state.session) {
    return [
      ["Format", "n/a"],
      ["Source Space", "n/a"],
      ["Transfer", "n/a"],
      ["Working", "n/a"],
      ["Signal", "n/a"],
    ];
  }

  return [
    ["Format", state.session.source.suffix],
    ["Source Space", state.session.source.source_color_space || "unknown"],
    ["Transfer", state.session.source.transfer_function || "unknown"],
    ["Working", state.session.source.working_space || "ACEScg"],
    ["Signal", state.session.analysis.classification],
    ["Source Depth", state.session.metadata.bit_depth || "unknown"],
  ];
}

function renderKeyValueList(container, entries) {
  container.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    container.append(dt, dd);
  }
}

function debouncePreview() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    await refreshPreview();
    await refreshScopes();
  }, 180);
}

async function refreshPreview() {
  if (!state.session) return;
  if (state.previewAbortController) state.previewAbortController.abort();
  state.previewAbortController = new AbortController();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  const response = await fetch(`/api/session/${state.session.session_id}/preview/${state.currentView}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments }),
    signal: state.previewAbortController.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  if (response.status === 409) {
    setPreviewMessage("Dropped a stale preview request. Refreshing...");
    return;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    setPreviewError(payload?.detail || "Preview failed to render.");
    clearPreviewImage();
    return;
  }

  state.previewInfo = previewInfoFromResponse(response, state.currentView);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  await applyPreviewUrl(url);
  els.scopeKindLabel.textContent = state.currentView.toUpperCase();
  renderReadouts();
}

async function refreshScopes() {
  if (!state.session) return;
  const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=${state.currentView}`);
  if (!response.ok) return;
  const payload = await response.json();
  drawHistogram(payload.channels);
}

function drawHistogram(channels) {
  const canvas = els.histogram;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!channels.length) return;
  const palette = { R: "#ff6b6b", G: "#5cd6b3", B: "#5fa8ff" };
  const maxValue = Math.max(1, ...channels.flatMap((channel) => channel.bins));
  channels.forEach((channel) => {
    ctx.beginPath();
    ctx.strokeStyle = palette[channel.name];
    ctx.lineWidth = 2;
    channel.bins.forEach((value, index) => {
      const x = (index / (channel.bins.length - 1)) * canvas.width;
      const y = canvas.height - (value / maxValue) * (canvas.height - 20);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

async function exportCurrentSession() {
  if (!state.session) return;
  const response = await fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: els.exportFormat.value, quality: Number(els.exportQuality.value) }),
  });
  const payload = await response.json();
  els.exportStatus.textContent = payload.message || "Export request finished.";
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload(els.interpretationSelect.value);
  els.badge.textContent = "Re-interpreting source file...";
  setPreviewMessage("Rebuilding preview with the new interpretation...");
  const response = await fetch(`/api/session/${state.session.session_id}/interpretation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(override),
  });
  const payload = await safeJson(response);
  if (!response.ok || !payload?.session) {
    els.badge.textContent = payload?.detail || "Interpretation override failed.";
    els.badge.className = "badge bad";
    setPreviewError(payload?.detail || "Interpretation override failed.");
    return;
  }
  state.session = payload.session;
  renderSession();
  await refreshPreview();
  await refreshScopes();
}

function badgeClass(classification) {
  if (classification === "HDR_TRUE") return "badge good";
  if (classification === "HDR_ENCODED" || classification === "HDR_LINEAR_UNCONFIRMED") return "badge warn";
  return "badge bad";
}

function setValueByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], target);
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
  });
}

function renderSessionChrome() {
  els.ejectButton.disabled = !state.session;
}

function renderCurveChannelTabs() {
  els.curveChannelButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.curveChannel === state.selectedCurveChannel);
  });
}

function bindCurveEditor() {
  const canvas = els.curveEditor;
  const beginDrag = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    state.activeCurvePoint = nearestCurvePointIndex(clientX, clientY, rect);
    updateCurveFromPointer(clientX, clientY);
    const move = (event) => {
      event.preventDefault();
      updateCurveFromPointer(event.clientX, event.clientY);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      state.activeCurvePoint = null;
      debouncePreview();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    beginDrag(event.clientX, event.clientY);
  });
}

function updateCurveFromPointer(clientX, clientY) {
  const rect = els.curveEditor.getBoundingClientRect();
  const index = state.activeCurvePoint ?? nearestCurvePointIndex(clientX, clientY, rect);
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  const point = [...curve[index]];
  if (index === 0) point[0] = 0;
  else if (index === curve.length - 1) point[0] = 1;
  else point[0] = clamp(normalizedX, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
  point[1] = clamp(normalizedY, 0, 1);
  curve[index] = point;
  setCurveValues(state.selectedCurveChannel, curve);
  drawCurveEditor();
}

function drawCurveEditor() {
  const canvas = els.curveEditor;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 18;
  const curve = currentCurveValues();
  const curveSamples = sampleCurvePoints(curve, 96);
  const channelColor = curveColor(state.selectedCurveChannel);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = padding + ((width - padding * 2) * step) / 4;
    const y = padding + ((height - padding * 2) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(236,233,223,0.18)";
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, padding);
  ctx.stroke();

  ctx.strokeStyle = channelColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  curveSamples.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  curve.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    ctx.fillStyle = index === 0 || index === curve.length - 1 ? "#7f7a6f" : "#ece9df";
    ctx.beginPath();
    ctx.arc(x, y, index === 0 || index === curve.length - 1 ? 4 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function currentCurveValues() {
  const path = curvePath(state.selectedCurveChannel);
  return getValueByPath(state.adjustments, path).map(([x, y]) => [x, y]);
}

function setCurveValues(channel, values) {
  setValueByPath(state.adjustments, curvePath(channel), values);
}

function curvePath(channel) {
  return `shared.${channel}_curve`;
}

function curvePointCount() {
  return currentCurveValues().length;
}

function nearestCurvePointIndex(clientX, clientY, rect) {
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  curve.forEach(([x, y], index) => {
    const distance = ((x - normalizedX) ** 2) + ((y - normalizedY) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function curveColor(channel) {
  if (channel === "red") return "#ff8585";
  if (channel === "green") return "#7fe6a8";
  if (channel === "blue") return "#7db8ff";
  return "#ece9df";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultCurvePoints() {
  return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]];
}

function sampleCurvePoints(points, samples) {
  const sampleX = Array.from({ length: samples }, (_, index) => index / (samples - 1));
  const sampleY = monotoneCurveValues(points, sampleX);
  return sampleX.map((x, index) => [x, sampleY[index]]);
}

function monotoneCurveValues(points, sampleX) {
  const x = points.map((point) => point[0]);
  const y = points.map((point) => point[1]);
  const h = x.slice(1).map((value, index) => Math.max(value - x[index], 1e-6));
  const delta = y.slice(1).map((value, index) => (value - y[index]) / h[index]);
  const slopes = y.map(() => 0);
  slopes[0] = delta[0];
  slopes[slopes.length - 1] = delta[delta.length - 1];

  for (let index = 1; index < y.length - 1; index += 1) {
    if (delta[index - 1] === 0 || delta[index] === 0 || Math.sign(delta[index - 1]) !== Math.sign(delta[index])) {
      slopes[index] = 0;
    } else {
      const w1 = 2 * h[index] + h[index - 1];
      const w2 = h[index] + 2 * h[index - 1];
      slopes[index] = (w1 + w2) / ((w1 / delta[index - 1]) + (w2 / delta[index]));
    }
  }

  return sampleX.map((sample) => {
    let segmentIndex = 0;
    while (segmentIndex < x.length - 2 && sample > x[segmentIndex + 1]) segmentIndex += 1;
    const x0 = x[segmentIndex];
    const x1 = x[segmentIndex + 1];
    const y0 = y[segmentIndex];
    const y1 = y[segmentIndex + 1];
    const m0 = slopes[segmentIndex];
    const m1 = slopes[segmentIndex + 1];
    const segment = Math.max(x1 - x0, 1e-6);
    const t = clamp((sample - x0) / segment, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = (2 * t3) - (3 * t2) + 1;
    const h10 = t3 - (2 * t2) + t;
    const h01 = (-2 * t3) + (3 * t2);
    const h11 = t3 - t2;
    return clamp((h00 * y0) + (h10 * segment * m0) + (h01 * y1) + (h11 * segment * m1), 0, 1);
  });
}

async function applyPreviewUrl(url) {
  const previousUrl = els.previewImage.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      els.previewImage.onload = () => resolve();
      els.previewImage.onerror = () => reject(new Error("Image element could not load preview data."));
      els.previewImage.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    setPreviewError(error.message || "Preview image failed to decode.");
    clearPreviewImage();
    return;
  } finally {
    els.previewImage.onload = null;
    els.previewImage.onerror = null;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewImage.dataset.objectUrl = url;
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  hidePreviewMessage();
}

function clearPreviewImage() {
  const previousUrl = els.previewImage.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewImage.dataset.objectUrl;
  els.previewImage.removeAttribute("src");
  els.previewImage.style.display = "none";
  els.emptyState.style.display = "grid";
}

function setPreviewMessage(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden", "error");
}

function setPreviewError(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden");
  els.previewStatus.classList.add("error");
}

function hidePreviewMessage() {
  els.previewStatus.textContent = "";
  els.previewStatus.classList.add("hidden");
  els.previewStatus.classList.remove("error");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function interpretationPayload(value) {
  if (value === "linear_acescg") return { color_space: "ACEScg", transfer_function: "LINEAR" };
  if (value === "pq_bt2020") return { color_space: "BT.2020", transfer_function: "PQ" };
  if (value === "hlg_bt2020") return { color_space: "BT.2020", transfer_function: "HLG" };
  if (value === "sdr_srgb") return { color_space: "sRGB", transfer_function: "sRGB" };
  return { color_space: "scene-linear", transfer_function: "LINEAR" };
}

function defaultInterpretationValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  const colorSpace = (session.source.source_color_space || "").toLowerCase();
  if (transfer.includes("pq")) return "pq_bt2020";
  if (transfer.includes("hlg")) return "hlg_bt2020";
  if (colorSpace.includes("acescg")) return "linear_acescg";
  if (transfer.includes("srgb") || colorSpace.includes("srgb")) return "sdr_srgb";
  return "linear_srgb";
}

function buildDisplayProbe() {
  return {
    dynamicRange: mediaQueryMatch("(dynamic-range: high)") ? "high" : "standard/unknown",
    colorGamut: mediaQueryMatch("(color-gamut: rec2020)")
      ? "rec2020"
      : mediaQueryMatch("(color-gamut: p3)")
        ? "p3"
        : mediaQueryMatch("(color-gamut: srgb)")
          ? "srgb"
          : "unknown",
    pixelRatio: String(window.devicePixelRatio || 1),
    screenDepth: `${window.screen?.colorDepth || "?"}-bit`,
    browser: navigator.userAgentData?.brands?.map((brand) => brand.brand).join(", ") || navigator.userAgent,
  };
}

function mediaQueryMatch(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function previewInfoFromResponse(response, kind) {
  const mediaType = response.headers.get("content-type") || "unknown";
  if (kind === "hdr") {
    return {
      mediaType,
      transport: "AVIF",
      colorSpace: "BT.2020",
      transfer: "PQ",
      bitDepth: "10-bit 4:4:4",
      notes: "Browser-decoded HDR preview",
    };
  }
  return {
    mediaType,
    transport: "PNG",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Embedded or derived SDR fallback",
  };
}

renderSessionChrome();
renderCurveChannelTabs();
