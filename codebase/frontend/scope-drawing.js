function drawHistogram(scope) {
  const canvas = els.histogram;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--deep");
  ctx.fillRect(0, 0, width, height);
  if (!scope?.channels?.length) {
    els.scopeTitle.textContent = "Histogram";
    els.scopeNote.textContent = "Reference scopes will appear here after a preview is rendered.";
    canvas.removeAttribute("title");
    els.scopeStats.innerHTML = "";
    state.lastScope = null;
    renderDockSummary();
    return;
  }
  els.scopeTitle.textContent = scopeTitleFor(scope);
  canvas.setAttribute("aria-label", els.scopeTitle.textContent);
  els.scopeNote.textContent = scope.scope_type === "vectorscope"
    ? "Vectorscope plots chroma direction and saturation from the same current authored preview. Density is log-scaled."
    : scope.preview_kind === "hdr"
    ? scope.scope_type.includes("waveform")
      ? `HDR waveform plots horizontal image position against reference nits. In this project, 0.18 scene-linear equals ${projectReferenceWhiteNits()} nits. RW marks the active project reference white.`
      : "HDR histogram plots BT.2020 transport RGB and luminance in reference nits on a logarithmic scale. Density is log-scaled to retain fine tonal detail. RW marks the active project reference white."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against the nonlinear Rec.709/sRGB output signal. Guides and percentages are signal levels, not scene-linear values."
      : "SDR histogram plots sRGB/Rec.709 signal values from black to white. Density is log-scaled so small tonal populations remain visible.";
  canvas.title = scopeGuideTooltip(scope);
  renderKeyValueList(els.scopeStats, (scope.stats || []).map((item) => [item.label, item.value]));

  if (scope.scope_type === "vectorscope") {
    drawVectorscope(ctx, scope, width, height);
    return;
  }

  const channels = filteredScopeChannels(scope.channels);
  const palette = {
    R: uiToken("--scope-red"),
    G: uiToken("--scope-green"),
    B: uiToken("--scope-blue"),
    Y: uiToken("--scope-luma"),
  };
  const isWaveform = scope.scope_type.includes("waveform");
  const plotLeft = isWaveform ? 62 : 14;
  const plotRight = 10;
  const plotTop = 8;
  const plotBottom = 22;
  const plotWidth = Math.max(1, width - plotLeft - plotRight);
  const plotHeight = Math.max(1, height - plotTop - plotBottom);

  ctx.font = '11px "Space Mono", "Cascadia Mono", Consolas';
  ctx.textBaseline = "middle";
  drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, height);
  drawZoneScopeOverlay(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight);

  if (scope.scope_type.includes("waveform")) drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
  else drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
}

function resizeCanvasSurface(canvas) {
  const width = Math.round(canvas.clientWidth);
  const height = Math.round(canvas.clientHeight);
  if (width < 2 || height < 2) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const bitmapWidth = Math.round(width * dpr);
  const bitmapHeight = Math.round(height * dpr);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { ctx, width, height };
}

function drawVectorscope(ctx, scope, width, height) {
  const grid = scope.channels?.[0]?.grid || [];
  const bins = grid.length;
  if (!bins) return;
  const size = Math.max(1, Math.min(width - 28, height - 20));
  const left = (width - size) / 2;
  const top = (height - size) / 2;
  ctx.save();
  ctx.strokeStyle = uiToken("--scope-guide-line-labeled");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(left + size / 2, top + size / 2, size / 2, 0, Math.PI * 2);
  ctx.moveTo(left + size / 2, top); ctx.lineTo(left + size / 2, top + size);
  ctx.moveTo(left, top + size / 2); ctx.lineTo(left + size, top + size / 2);
  ctx.stroke();
  const peak = Math.max(1, scope.normalization_peak || 1);
  const cell = size / bins;
  for (let row = 0; row < bins; row += 1) {
    for (let column = 0; column < bins; column += 1) {
      const value = grid[row][column];
      if (!value) continue;
      const density = Math.min(1, Math.log1p(value) / Math.log1p(peak));
      const hue = (Math.atan2(row / bins - 0.5, column / bins - 0.5) * 180 / Math.PI + 360) % 360;
      ctx.fillStyle = `hsla(${hue}, 80%, 68%, ${0.08 + density * 0.72})`;
      ctx.fillRect(left + column * cell, top + (bins - row - 1) * cell, Math.max(1, cell), Math.max(1, cell));
    }
  }
  ctx.restore();
}

function drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, canvasHeight) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = uiToken("--scope-grid-line");
  [0, 0.25, 0.5, 0.75, 1].forEach((position) => {
    const y = plotTop + plotHeight - position * plotHeight;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
  });

  const labeledGuides = scopeGuidesForDisplay(scope);
  (scope.guides || []).forEach((guide) => {
    const normalized = guidePosition(scope, guide.value);
    const showLabel = labeledGuides.has(Number(guide.value));
    ctx.strokeStyle = showLabel ? uiToken("--scope-guide-line-labeled") : uiToken("--scope-guide-line");
    ctx.fillStyle = uiToken("--scope-guide-label");
    if (isWaveform) {
      const y = plotTop + plotHeight - normalized * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = "right";
        ctx.fillText(compactScopeGuideLabel(scope, guide), plotLeft - 7, clamp(y, plotTop + 6, plotTop + plotHeight - 6));
      }
    } else {
      const x = plotLeft + normalized * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = normalized <= 0.02 ? "left" : normalized >= 0.98 ? "right" : "center";
        ctx.fillText(compactScopeGuideLabel(scope, guide), x, canvasHeight - 7);
      }
    }
  });
  ctx.restore();
}

function scopeGuidesForDisplay(scope) {
  return scopeUi.guidesForDisplay(scope);
}

function compactScopeGuideLabel(scope, guide) {
  return scopeUi.compactGuideLabel(scope, guide);
}

function scopeGuideTooltip(scope) {
  return scopeUi.guideTooltip(scope);
}

function guidePosition(scope, value) {
  return scopeUi.guidePosition(scope, value);
}

function scopeHdrCeiling(scope) {
  return scopeUi.hdrCeiling(scope);
}

function bindZoneScopeOverlays() {
  document.querySelectorAll("[data-zone-hover]").forEach((target) => {
    const show = () => {
      state.scopeZoneOverlay = {
        zone: target.dataset.zoneHover,
        lane: target.closest("[data-lane-panel]")?.dataset.lanePanel || state.currentView,
      };
      drawHistogram(state.lastScope || []);
    };
    const hide = (event) => {
      if (event.type === "focusout" && target.contains(event.relatedTarget)) return;
      state.scopeZoneOverlay = null;
      drawHistogram(state.lastScope || []);
    };
    target.addEventListener("pointerenter", show);
    target.addEventListener("pointerleave", hide);
    target.addEventListener("focusin", show);
    target.addEventListener("focusout", hide);
  });
}

function drawZoneScopeOverlay(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight) {
  const overlay = state.scopeZoneOverlay;
  if (!overlay || overlay.lane !== scope.preview_kind) return;
  const settings = state.adjustments[overlay.lane];
  const pivot = Number(settings?.[`${overlay.zone}_pivot`] ?? 0);
  const range = Math.max(0.1, Number(settings?.[`${overlay.zone}_range`] ?? 4));
  const lowerStop = pivot - range * 0.5;
  const upperStop = pivot + range * 0.5;
  const toValue = overlay.lane === "hdr"
    ? (stop) => 100 * (2 ** stop)
    : (stop) => clamp(0.5 * (2 ** stop), 0, 1);
  const lower = clamp(guidePosition(scope, toValue(lowerStop)), 0, 1);
  const upper = clamp(guidePosition(scope, toValue(upperStop)), 0, 1);
  const start = Math.min(lower, upper);
  const end = Math.max(lower, upper);
  ctx.save();
  ctx.fillStyle = "rgba(151, 224, 236, 0.13)";
  ctx.strokeStyle = "rgba(151, 224, 236, 0.55)";
  ctx.lineWidth = 1;
  if (isWaveform) {
    const top = plotTop + (1 - end) * plotHeight;
    const bandHeight = Math.max(2, (end - start) * plotHeight);
    ctx.fillRect(plotLeft, top, plotWidth, bandHeight);
    ctx.strokeRect(plotLeft, top, plotWidth, bandHeight);
  } else {
    const left = plotLeft + start * plotWidth;
    const bandWidth = Math.max(2, (end - start) * plotWidth);
    ctx.fillRect(left, plotTop, bandWidth, plotHeight);
    ctx.strokeRect(left, plotTop, bandWidth, plotHeight);
  }
  ctx.restore();
}

function drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawHistogramParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const peak = robustHistogramPeak(channels);
  ctx.save();
  ctx.globalCompositeOperation = channels.length > 1 ? uiToken("--histogram-blend-mode") : "source-over";
  channels.forEach((channel) => {
    drawHistogramTrace(ctx, channel, palette[channel.name], peak, plotLeft, plotTop, plotWidth, plotHeight);
  });
  ctx.restore();
}

function robustHistogramPeak(channels) {
  if (Number.isFinite(state.lastScope?.normalization_peak)) return Math.max(1, state.lastScope.normalization_peak);
  const populations = channels
    .flatMap((channel) => channel.bins || [])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!populations.length) return 1;
  return Math.max(1, populations[Math.floor((populations.length - 1) * 0.985)]);
}

function histogramHeight(value, peak) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(Math.max(peak, 1)));
}

function drawHistogramTrace(ctx, channel, color, peak, plotLeft, plotTop, plotWidth, plotHeight) {
  const bins = channel.bins || [];
  if (!bins.length) return;
  const baseline = plotTop + plotHeight;
  const colorRgb = hexToRgb(color);
  const points = bins.map((value, index) => ({
    x: plotLeft + (index / Math.max(bins.length - 1, 1)) * plotWidth,
    y: baseline - histogramHeight(value, peak) * plotHeight,
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, baseline);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, baseline);
  ctx.closePath();
  ctx.fillStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.22)`;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.9)`;
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawWaveformParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const peak = robustWaveformPeak(channels);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();
  ctx.globalCompositeOperation = channels.length > 1 ? uiToken("--waveform-blend-mode") : "source-over";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  channels.forEach((channel) => {
    const density = waveformDensityCanvas(channel, hexToRgb(palette[channel.name]), peak);
    if (density) ctx.drawImage(density, plotLeft, plotTop, plotWidth, plotHeight);
  });
  ctx.restore();
}

function robustWaveformPeak(channels) {
  if (Number.isFinite(state.lastScope?.normalization_peak)) return Math.max(1, state.lastScope.normalization_peak);
  const populations = channels
    .flatMap((channel) => (channel.grid || []).flat())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!populations.length) return 1;
  return Math.max(1, populations[Math.floor((populations.length - 1) * 0.995)]);
}

function waveformDensityCanvas(channel, color, peak) {
  const grid = channel.grid || [];
  const rowCount = grid.length;
  const columnCount = grid[0]?.length || 0;
  if (!rowCount || !columnCount) return null;
  const profile = scopeQualityProfile();
  const densityGain = profile.densityGain;
  const horizontalSpread = profile.horizontalSpread;
  const cacheKey = `${color.r},${color.g},${color.b}:${peak}:${rowCount}x${columnCount}:h5:${densityGain}:${horizontalSpread}`;
  const cached = waveformCanvasCache.get(channel);
  if (cached?.key === cacheKey) return cached.canvas;
  const surface = document.createElement("canvas");
  surface.width = columnCount;
  surface.height = rowCount;
  const surfaceContext = surface.getContext("2d");
  const pixels = surfaceContext.createImageData(columnCount, rowCount);
  grid.forEach((row, rowIndex) => {
    row.forEach((_value, columnIndex) => {
      const value = smoothedWaveformPopulation(row, columnIndex, horizontalSpread);
      if (value <= 0) return;
      const density = Math.min(1, value / Math.max(1, peak));
      const offset = (((rowCount - 1 - rowIndex) * columnCount) + columnIndex) * 4;
      pixels.data[offset] = color.r;
      pixels.data[offset + 1] = color.g;
      pixels.data[offset + 2] = color.b;
      // Exponential exposure gives sparse traces useful lift without flattening
      // dense areas into one opaque slab. Each detail profile calibrates gain
      // with its sample count so changing quality does not make the scope dimmer.
      const opacity = 1 - Math.exp(-densityGain * Math.pow(density, 0.72));
      pixels.data[offset + 3] = Math.round(opacity * 255);
    });
  });
  surfaceContext.putImageData(pixels, 0, 0);
  waveformCanvasCache.set(channel, { key: cacheKey, canvas: surface });
  return surface;
}

function smoothedWaveformPopulation(row, columnIndex, spread = 1) {
  const kernel = WAVEFORM_HORIZONTAL_KERNELS[spread] || WAVEFORM_HORIZONTAL_KERNELS[1];
  const radius = Math.floor(kernel.weights.length / 2);
  let weightedPopulation = 0;
  for (let offset = 0; offset < kernel.weights.length; offset += 1) {
    const sampleIndex = Math.max(0, Math.min(row.length - 1, columnIndex + offset - radius));
    weightedPopulation += (Number(row[sampleIndex]) || 0) * kernel.weights[offset];
  }
  return weightedPopulation / kernel.total;
}

function drawHistogramParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  channels.forEach((channel, laneIndex) => {
    const laneLeft = plotLeft + laneIndex * laneWidth + 4;
    drawHistogramTrace(
      ctx,
      channel,
      palette[channel.name],
      robustHistogramPeak([channel]),
      laneLeft,
      plotTop,
      Math.max(1, laneWidth - 8),
      plotHeight,
    );
  });
}

function drawWaveformParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  channels.forEach((channel, laneIndex) => {
    const density = waveformDensityCanvas(channel, hexToRgb(palette[channel.name]), robustWaveformPeak([channel]));
    if (density) ctx.drawImage(density, plotLeft + laneIndex * laneWidth + 3, plotTop, Math.max(1, laneWidth - 6), plotHeight);
  });
  ctx.restore();
}

function filteredScopeChannels(channels) {
  return scopeUi.filteredChannels(channels, state.scopeChannelMode);
}

function scopeTitleFor(scope) {
  return scopeUi.titleFor(scope, state.scopeChannelMode);
}

function hexToRgb(value) {
  const normalized = value.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function activeScopeRegion() {
  if (!state.scopeRegionEnabled || !state.scopeRegion || state.scopeRegionSessionId !== state.session?.session_id) return null;
  return { ...state.scopeRegion };
}

function toggleScopeRegion(force = null) {
  if (!state.session) return false;
  if (state.scopeRegionSessionId !== state.session.session_id) {
    state.scopeRegion = null;
    state.scopeRegionSessionId = state.session.session_id;
  }
  state.scopeRegionEnabled = force === null ? !state.scopeRegionEnabled : Boolean(force);
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  if (state.scopeRegionEnabled && state.scopeRegion) els.scopeRegionBox?.focus({ preventScroll: true });
  return true;
}

function clearScopeRegion() {
  state.scopeRegion = null;
  state.scopeRegionDrag = null;
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
}

function renderScopeRegionOverlay() {
  if (!els.scopeRegionToggle || !els.scopeRegionOverlay || !els.scopeRegionBox) return;
  const available = Boolean(state.session && previewIsVisible());
  if (state.scopeRegionSessionId && state.scopeRegionSessionId !== state.session?.session_id) {
    state.scopeRegionEnabled = false;
    state.scopeRegion = null;
    state.scopeRegionSessionId = null;
  }
  els.scopeRegionToggle.disabled = !available;
  els.scopeRegionToggle.classList.toggle("active", state.scopeRegionEnabled);
  els.scopeRegionToggle.setAttribute("aria-pressed", String(state.scopeRegionEnabled));
  const shown = available && state.scopeRegionEnabled;
  els.scopeRegionOverlay.classList.toggle("hidden", !shown);
  els.scopeRegionOverlay.setAttribute("aria-hidden", String(!shown));
  const region = activeScopeRegion();
  els.scopeRegionBox.classList.toggle("hidden", !region);
  if (region) {
    Object.assign(els.scopeRegionBox.style, {
      left: `${region.x * 100}%`,
      top: `${region.y * 100}%`,
      width: `${region.width * 100}%`,
      height: `${region.height * 100}%`,
    });
  }
  const coverage = region ? region.width * region.height * 100 : 100;
  els.scopeRegionBadge?.classList.toggle("hidden", !region);
  if (els.scopeRegionBadge) {
    els.scopeRegionBadge.textContent = region ? `Region · ${coverage < 1 ? coverage.toFixed(1) : Math.round(coverage)}%` : "Region";
  }
}

function scopeRegionPoint(event) {
  const rect = els.scopeRegionOverlay.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    rect,
  };
}

function beginScopeRegionDrag(event) {
  if (!state.scopeRegionEnabled || event.button !== 0) return;
  event.preventDefault();
  const point = scopeRegionPoint(event);
  const handle = event.target.closest("[data-scope-region-handle]")?.dataset.scopeRegionHandle
    || (event.target.closest("#scope-region-box") ? "move" : "draw");
  state.scopeRegionDrag = {
    handle,
    pointerId: event.pointerId,
    start: { x: point.x, y: point.y },
    region: state.scopeRegion ? { ...state.scopeRegion } : null,
    rect: point.rect,
  };
  if (handle === "draw") {
    state.scopeRegion = { x: point.x, y: point.y, width: 0.001, height: 0.001 };
  }
  els.scopeRegionOverlay.setPointerCapture?.(event.pointerId);
  renderScopeRegionOverlay();
}

function moveScopeRegionDrag(event) {
  const drag = state.scopeRegionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = scopeRegionPoint(event);
  const minWidth = Math.max(0.01, 12 / Math.max(1, drag.rect.width));
  const minHeight = Math.max(0.01, 12 / Math.max(1, drag.rect.height));
  let next;
  if (drag.handle === "draw") {
    next = {
      x: Math.min(drag.start.x, point.x),
      y: Math.min(drag.start.y, point.y),
      width: Math.max(minWidth, Math.abs(point.x - drag.start.x)),
      height: Math.max(minHeight, Math.abs(point.y - drag.start.y)),
    };
    next.x = Math.min(next.x, 1 - next.width);
    next.y = Math.min(next.y, 1 - next.height);
  } else if (drag.handle === "move" && drag.region) {
    next = {
      ...drag.region,
      x: clamp(drag.region.x + point.x - drag.start.x, 0, 1 - drag.region.width),
      y: clamp(drag.region.y + point.y - drag.start.y, 0, 1 - drag.region.height),
    };
  } else if (drag.region) {
    const left = drag.region.x;
    const top = drag.region.y;
    const right = left + drag.region.width;
    const bottom = top + drag.region.height;
    const west = drag.handle.includes("w");
    const north = drag.handle.includes("n");
    const nextLeft = west ? clamp(point.x, 0, right - minWidth) : left;
    const nextRight = west ? right : clamp(point.x, left + minWidth, 1);
    const nextTop = north ? clamp(point.y, 0, bottom - minHeight) : top;
    const nextBottom = north ? bottom : clamp(point.y, top + minHeight, 1);
    next = { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
  }
  if (!next) return;
  state.scopeRegion = next;
  renderScopeRegionOverlay();
  scheduleScopeRegionRefresh();
}

function scheduleScopeRegionRefresh() {
  if (state.scopeRegionRefreshTimer) return;
  state.scopeRegionRefreshTimer = window.setTimeout(() => {
    state.scopeRegionRefreshTimer = 0;
    void refreshScopes(scopeLongEdge("interactive"), { tier: "interactive" });
  }, 80);
}

function endScopeRegionDrag(event) {
  const drag = state.scopeRegionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  state.scopeRegionDrag = null;
  if (els.scopeRegionOverlay.hasPointerCapture?.(event.pointerId)) els.scopeRegionOverlay.releasePointerCapture(event.pointerId);
  window.clearTimeout(state.scopeRegionRefreshTimer);
  state.scopeRegionRefreshTimer = 0;
  if (state.scopeRegion && (state.scopeRegion.width < 0.01 || state.scopeRegion.height < 0.01)) state.scopeRegion = null;
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  els.scopeRegionBox?.focus({ preventScroll: true });
}

function handleScopeRegionKeydown(event) {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    clearScopeRegion();
  } else if (event.key === "Escape") {
    event.preventDefault();
    toggleScopeRegion(false);
    els.scopeRegionToggle?.focus();
  }
}

