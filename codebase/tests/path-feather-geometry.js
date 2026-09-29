// Path Feather guide geometry.
//
// Path nodes are normalized to the uncropped, unrotated source, and the
// backend measures Feather in that metric (short source edge = 1). The outer
// guide the frontend materializes must be the same distance from the Path, or
// a customized Feather boundary gives a band that is wider in some places than
// others and the dashed guide no longer shows where the falloff ends.
//
//   node tests/path-feather-geometry.js   (HDR_FINISHER_URL, default :8765)

const { chromium } = require("playwright");

const baseUrl = process.env.HDR_FINISHER_URL || "http://127.0.0.1:8765";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Load test pattern" }).click();
    await page.locator("#grade-workflow-panel").waitFor({ state: "visible", timeout: 30000 });

    const result = await page.evaluate(() => {
      const sharp = (x, y) => ({ x, y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" });
      const inner = [sharp(.20, .20), sharp(.78, .24), sharp(.72, .76), sharp(.24, .70)];
      // Smooth blob with one tight, asymmetric bend (node 4 -> node 0): the
      // shape from the DSC00264 report, where chord-based offsets pushed the
      // guide ~1.4x too far at the nodes and let it sag between them.
      const smooth = [
        [.35, .30, .29, .32, .41, .28], [.62, .33, .59, .28, .65, .38], [.66, .58, .70, .54, .62, .62],
        [.45, .66, .50, .67, .40, .65], [.30, .50, .30, .55, .30, .45],
      ].map(([x, y, inX, inY, outX, outY]) => ({ x, y, in_x: inX, in_y: inY, out_x: outX, out_y: outY, node_type: "smooth" }));
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const source = state.session.source;
      const short = Math.min(source.width, source.height);
      const metric = (point) => ({ x: point.x * source.width / short, y: point.y * source.height / short });
      const distanceToPolygon = (point, polygon) => {
        let best = Infinity;
        for (let index = 0; index < polygon.length; index += 1) {
          const a = polygon[index];
          const b = polygon[(index + 1) % polygon.length];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-18)));
          best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
        }
        return best;
      };
      // Offset of the outer guide from the Path in source metric, as a
      // fraction of the requested Feather, both directions.
      const offsetRange = (nodes, outer, amount) => {
        const innerPolygon = flattenPathNodes(nodes, 64).map(metric);
        const outerPolygon = flattenPathNodes(outer, 64).map(metric);
        const values = [
          ...outerPolygon.map((point) => distanceToPolygon(point, innerPolygon) / amount),
          ...innerPolygon.map((point) => distanceToPolygon(point, outerPolygon) / amount),
        ];
        return { min: Math.min(...values), max: Math.max(...values) };
      };
      const maximumDifference = (first, second) => Math.max(...first.flatMap((node, index) => (
        ["x", "y", "in_x", "in_y", "out_x", "out_y"]
          .filter((key) => node[key] !== null && node[key] !== undefined)
          .map((key) => Math.abs(node[key] - second[index][key]))
      )));

      // 1. The preview element's size (Fit vs zoom) must not change the guide.
      const preview = activePreviewElement();
      const originalRect = preview.getBoundingClientRect;
      preview.getBoundingClientRect = () => ({ width: 480, height: 480 });
      const fitGeometry = uniformFeatherNodes(smooth, .08);
      preview.getBoundingClientRect = () => ({ width: 1600, height: 300 });
      const zoomGeometry = uniformFeatherNodes(smooth, .08);
      preview.getBoundingClientRect = originalRect;

      // 2. Crop and quarter turns change the output frame, not the source
      //    metric Path nodes and backend Feather live in.
      const savedGeometry = clone(state.adjustments.shared.geometry);
      const identity = uniformFeatherNodes(smooth, .08);
      const identitySharp = uniformFeatherNodes(inner, .08);
      const transformed = {};
      for (const [name, change] of Object.entries({
        rotate90: { rotation: 90 },
        rotate270Crop: { rotation: 270, crop: { x: .1, y: .05, width: .5, height: .9 } },
        crop: { crop: { x: 0, y: .2, width: 1, height: .35 } },
        straighten: { straighten_angle: 7 },
      })) {
        state.adjustments.shared.geometry = { ...clone(savedGeometry), ...change };
        const frame = sourcePixelFrameDimensions(state.adjustments.shared.geometry);
        transformed[name] = {
          frameAspect: frame ? frame.width / frame.height : null,
          smooth: maximumDifference(identity, uniformFeatherNodes(smooth, .08)),
          sharp: maximumDifference(identitySharp, uniformFeatherNodes(inner, .08)),
        };
      }
      state.adjustments.shared.geometry = savedGeometry;

      // 3. Offset accuracy against the true Feather distance.
      const smoothRange29 = offsetRange(smooth, uniformFeatherNodes(smooth, .145), .145);
      const smoothRange10 = offsetRange(smooth, uniformFeatherNodes(smooth, .05), .05);
      const sharpRange = offsetRange(inner, identitySharp, .08);

      // 4. The slider on an untouched guide keeps it uniform, and on a
      //    customized guide widens every segment.
      const untouched = offsetBoundaryNodes(smooth, uniformFeatherNodes(smooth, .05), .05, .145);
      const outer = clone(identitySharp);
      outer[0].x -= .035;
      outer[0].y -= .025;
      outer[2].x += .02;
      const expanded = offsetBoundaryNodes(inner, outer, .08, .12);
      const scale = pathDisplayScale();
      const segmentWidths = (boundary) => inner.map((first, index) => {
        const second = inner[(index + 1) % inner.length];
        const dx = (second.x - first.x) * scale.x;
        const dy = (second.y - first.y) * scale.y;
        const length = Math.hypot(dx, dy);
        const orientation = pathSignedArea(inner) >= 0 ? 1 : -1;
        const normal = { x: orientation * dy / length, y: orientation * -dx / length };
        const project = (outerNode, innerNode) => (
          (outerNode.x - innerNode.x) * scale.x * normal.x
          + (outerNode.y - innerNode.y) * scale.y * normal.y
        );
        return {
          first: project(boundary[index], first),
          second: project(boundary[(index + 1) % inner.length], second),
        };
      });
      return {
        sourceAspect: source.width / source.height,
        scale,
        zoomDifference: maximumDifference(fitGeometry, zoomGeometry),
        transformed,
        smoothRange29,
        smoothRange10,
        sharpRange,
        untouchedDifference: maximumDifference(untouched, uniformFeatherNodes(smooth, .145)),
        before: segmentWidths(outer),
        after: segmentWidths(expanded),
        valid: validFeatherGeometry(inner, expanded) && validFeatherGeometry(smooth, uniformFeatherNodes(smooth, .145)),
      };
    });

    assert(Math.abs(result.scale.x / result.scale.y - result.sourceAspect) < 1e-9,
      `Path metric is not the source aspect: ${JSON.stringify(result)}`);
    assert(result.zoomDifference < 1e-10, `Path feather geometry changed with preview zoom: ${result.zoomDifference}`);
    for (const [name, entry] of Object.entries(result.transformed)) {
      assert(entry.smooth < 1e-10 && entry.sharp < 1e-10,
        `Path feather geometry changed under ${name} geometry: ${JSON.stringify(entry)}`);
    }
    // The quarter turn and the crop must actually change the output frame,
    // or the checks above prove nothing.
    for (const name of ["rotate90", "crop"]) {
      const aspect = result.transformed[name].frameAspect;
      assert(aspect !== null && Math.abs(aspect - result.sourceAspect) > .1,
        `${name} did not change the output frame aspect (${aspect} vs ${result.sourceAspect}).`);
    }
    for (const [label, range] of [["29%", result.smoothRange29], ["10%", result.smoothRange10]]) {
      assert(range.min > .97 && range.max < 1.12,
        `Smooth Path guide at Feather ${label} is not the Feather distance from the Path: ${JSON.stringify(range)}`);
    }
    assert(result.sharpRange.min > .999 && result.sharpRange.min < 1.001,
      `Sharp Path guide is not the Feather distance from its edges: ${JSON.stringify(result.sharpRange)}`);
    assert(result.untouchedDifference < 1e-9,
      `Feather slider made an untouched guide non-uniform: ${result.untouchedDifference}`);
    result.before.forEach((width, index) => {
      assert(result.after[index].first > width.first + .039,
        `Increasing Feather moved segment ${index}'s first edge inward: ${JSON.stringify({ width, after: result.after[index] })}`);
      assert(result.after[index].second > width.second + .039,
        `Increasing Feather moved segment ${index}'s second edge inward: ${JSON.stringify({ width, after: result.after[index] })}`);
    });
    assert(result.valid, "Expanded feather geometry no longer contains its Path.");
    console.log(JSON.stringify({
      transformed: result.transformed,
      smoothRange29: result.smoothRange29,
      smoothRange10: result.smoothRange10,
    }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
