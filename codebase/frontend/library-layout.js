(function (root) {
  "use strict";
  function gridLayout(count, width, height, scrollTop, minimumSize, laneWidth = 0) {
    // Tiles sit 3px apart with the same 3px around them. The cell dimensions
    // are the pitch, gap included.
    const measure = available => {
      const columns = Math.max(1, Math.floor(Math.max(1, available - 3) / minimumSize));
      const cellWidth = Math.max(4, (available - 3) / columns);
      const rowHeight = Math.ceil((cellWidth - 17) * .75 + 48);
      return { columns, cellWidth, rowHeight, rows: Math.ceil(count / columns) };
    };
    // Decide from the width with no lane, regardless of the current browser
    // layout. If the lane makes the cells just short enough to fit, retain
    // enough row height to maintain overflow. Otherwise the lane and tile
    // sizes can flip back and forth on each ResizeObserver notification.
    let dimensions = measure(width);
    const needsLane = count > 0 && laneWidth > 0 && dimensions.rows * dimensions.rowHeight + 3 > height;
    if (needsLane) dimensions = measure(width - laneWidth);
    const { columns, cellWidth, rows } = dimensions;
    const rowHeight = needsLane
      ? Math.max(dimensions.rowHeight, Math.ceil((height - 2) / rows))
      : dimensions.rowHeight;
    const naturalHeight = rows ? rows * rowHeight + 3 : 0;
    // Chromium caps element height. Compress only the scrollbar, keeping cells
    // their normal size and mapping the full folder onto its available travel.
    const totalHeight = Math.min(naturalHeight, 8000000);
    const scale = Math.max(1, (naturalHeight - height) / Math.max(1, totalHeight - height));
    const logicalTop = scrollTop * scale;
    const firstRow = Math.max(0, Math.min(Math.max(0, rows - 1), Math.floor((logicalTop - 3) / rowHeight)));
    const lastRow = Math.min(rows, Math.ceil((logicalTop + height - 3) / rowHeight));
    return { columns, cellWidth, rowHeight, totalHeight, logicalTop, scrollFor: index => (3 + Math.floor(index / columns) * rowHeight) / scale, top: index => 3 + Math.floor(index / columns) * rowHeight - logicalTop + scrollTop,
      first: Math.min(count, firstRow * columns), last: Math.min(count, Math.max(firstRow, lastRow) * columns) };
  }
  const api = Object.freeze({ gridLayout });
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibraryLayout = api;
})(typeof window === "undefined" ? globalThis : window);
