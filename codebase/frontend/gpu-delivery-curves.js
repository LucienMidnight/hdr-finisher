window.clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function sampleCurvePoints(points, samples, forcedX = null) {
  const sampleX = forcedX === null
    ? Array.from({ length: samples }, (_, index) => samples <= 1 ? 0 : index / (samples - 1))
    : [forcedX];
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

