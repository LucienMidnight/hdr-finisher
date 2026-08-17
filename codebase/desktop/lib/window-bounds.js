"use strict";

const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 1440, height: 940 });
const MINIMUM_WINDOW_BOUNDS = Object.freeze({ width: 1100, height: 720 });

function finiteNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function clampWindowBounds(bounds = {}, workArea, minimum = MINIMUM_WINDOW_BOUNDS) {
  if (!workArea || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)) {
    return { ...DEFAULT_WINDOW_BOUNDS, ...bounds };
  }

  const minimumWidth = Math.min(minimum.width, workArea.width);
  const minimumHeight = Math.min(minimum.height, workArea.height);
  const width = clamp(finiteNumber(bounds.width, DEFAULT_WINDOW_BOUNDS.width), minimumWidth, workArea.width);
  const height = clamp(finiteNumber(bounds.height, DEFAULT_WINDOW_BOUNDS.height), minimumHeight, workArea.height);
  const centeredX = workArea.x + Math.round((workArea.width - width) / 2);
  const centeredY = workArea.y + Math.round((workArea.height - height) / 2);
  const x = clamp(finiteNumber(bounds.x, centeredX), workArea.x, workArea.x + workArea.width - width);
  const y = clamp(finiteNumber(bounds.y, centeredY), workArea.y, workArea.y + workArea.height - height);

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

module.exports = {
  DEFAULT_WINDOW_BOUNDS,
  MINIMUM_WINDOW_BOUNDS,
  clampWindowBounds,
};
