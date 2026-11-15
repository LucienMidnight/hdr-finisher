(function () {
  "use strict";
  const zones = ["shadows", "midtones", "highlights"];
  const cache = new Map();
  const smooth = (value) => { const clipped = Math.max(0, Math.min(1, value)); return clipped * clipped * (3 - 2 * clipped); };
  const multiply = (left, right) => {
    const values = left.flatMap((first) => right.map((second) => first * second));
    return [Math.min(...values), Math.max(...values)];
  };
  const add = (left, right) => [left[0] + right[0], left[1] + right[1]];
  const scale = (interval, amount) => multiply(interval, [amount, amount]);
  function smoothBounds(low, high) {
    low = Math.max(0, Math.min(1, low)); high = Math.max(0, Math.min(1, high));
    const first = 6 * low * (1 - low), last = 6 * high * (1 - high);
    return [[smooth(low), smooth(high)], [Math.min(first, last), low <= 0.5 && high >= 0.5 ? 1.5 : Math.max(first, last)]];
  }
  function parameters(branch, hdr, referenceWhiteNits = 203) {
    const grey = 0.18 * (hdr ? 0.18 : 100 / 203);
    const peak = hdr ? (branch.highlight_compression_target_nits ?? 1000) * 0.18 / referenceWhiteNits : 1;
    const blacks = (branch.blacks || 0) / 100, whites = (branch.whites || 0) / 100;
    const defaults = [[-1.5, 5], [0, 4], hdr ? [2.25, 4.5] : [1.75, 3.5]];
    const shapes = zones.map((zone, index) => [(branch[zone] || 0) / 100, branch[`${zone}_center`] ?? defaults[index][0], (branch[`${zone}_width`] ?? defaults[index][1]) / 2]);
    const key = JSON.stringify([grey, peak, blacks, whites, shapes]);
    if (cache.has(key)) return cache.get(key);
    const knee = Math.min(grey / 8, peak / 16);
    if (!blacks && !whites && shapes.every(([strength]) => !strength)) return [0, 0, 0, 1, knee];
    const blackStart = Math.log2(knee / (2 * grey));
    const minimum = Math.min(blackStart, ...shapes.map(([, center, half]) => center - half));
    const maximum = Math.max(blackStart + 1, ...shapes.map(([, center, half]) => center + half));
    const knotSet = new Set([blackStart, blackStart + 1, ...shapes.flatMap(([, center, half]) => [center - half, center, center + half])]);
    for (let index = Math.floor(minimum * 8); index <= Math.ceil(maximum * 8); index += 1) knotSet.add(index / 8);
    const knots = [...knotSet].sort((left, right) => left - right);
    const bounds = shapes.map(([, , half]) => 1.5 / half);
    const cells = [];
    for (let index = 0; index + 1 < knots.length; index += 1) {
      const low = knots[index], high = knots[index + 1];
      const [blackGate, blackSlope] = smoothBounds(low - blackStart, high - blackStart);
      for (let whiteIndex = 0; whiteIndex < 16; whiteIndex += 1) {
        const whiteLow = whiteIndex / 16, whiteHigh = whiteLow + 1 / 16;
        const [whiteBase, whiteDerivative] = smoothBounds(2 * whiteLow, 2 * whiteHigh);
        const whiteGate = [1 - whiteBase[1], 1 - whiteBase[0]], whiteSlope = [-2 * whiteDerivative[1], -2 * whiteDerivative[0]];
        const gate = multiply(blackGate, whiteGate);
        const gateSlope = add(multiply(blackSlope, whiteGate), multiply(blackGate, whiteSlope));
        const weights = [], slopes = [];
        shapes.forEach(([, center, half], zoneIndex) => {
          const distanceLow = Math.max(center - high, low - center, 0), distanceHigh = Math.max(Math.abs(low - center), Math.abs(high - center));
          const [bumpBase, bumpSlope] = smoothBounds(distanceLow / half, distanceHigh / half);
          const bump = [1 - bumpBase[1], 1 - bumpBase[0]], direction = high <= center ? 1 : -1;
          const derivative = scale(bumpSlope, direction / half);
          const weight = multiply(bump, gate), slope = add(multiply(derivative, gate), multiply(bump, gateSlope));
          bounds[zoneIndex] = Math.max(bounds[zoneIndex], ...slope.map(Math.abs));
          weights.push(weight); slopes.push(slope);
        });
        cells.push({ low, whiteLow, whiteHigh, weights, slopes });
      }
    }
    const amounts = shapes.map(([strength], index) => strength * 0.9 / bounds[index]);
    const whiteAmount = whites * (whites >= 0 ? 1 : Math.log2(1 / 0.775));
    let lowest = 1 - 0.9 * Math.max(blacks, 0);
    for (const cell of cells) {
      let exponent = scale([cell.whiteLow ** 2, cell.whiteHigh ** 2], whiteAmount);
      let derivative = scale([2 * cell.whiteLow, 2 * cell.whiteHigh], whiteAmount);
      amounts.forEach((amount, index) => {
        exponent = add(exponent, scale(cell.weights[index], amount));
        derivative = add(derivative, scale(cell.slopes[index], amount));
      });
      const response = multiply(exponent.map((value) => 2 ** value), [1 + derivative[0], 1 + derivative[1]])[0];
      const floorDerivative = -0.9 * Math.max(blacks, 0) * Math.max(1 - grey * 2 ** cell.low / knee, 0);
      lowest = Math.min(lowest, response + floorDerivative);
    }
    const result = [...amounts, lowest >= 0.1 ? 1 : 0.9 / (1 - lowest), knee];
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
  }
  const api = Object.freeze({ parameters });
  if (typeof window !== "undefined") window.HDRTone = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
