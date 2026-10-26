(function (root) {
  "use strict";
  function gridLayout(count, width, height, scrollTop, minimumSize) {
    // Tiles sit 3px apart with the same 3px around them. cellWidth and rowHeight are the pitch, gap included.
    const columns = Math.max(1, Math.floor(Math.max(1, width - 3) / minimumSize));
    const cellWidth = Math.max(4, (width - 3) / columns);
    const rowHeight = Math.ceil((cellWidth - 17) * .75 + 48);
    const rows = Math.ceil(count / columns);
    const naturalHeight = rows * rowHeight + 3;
    // Chromium caps element height. Compress only the scrollbar, keeping cells
    // their normal size and mapping the full folder onto its available travel.
    const totalHeight = Math.min(naturalHeight, 8000000);
    const scale = Math.max(1, (naturalHeight - height) / Math.max(1, totalHeight - height));
    const logicalTop = scrollTop * scale;
    const firstRow = Math.max(0, Math.min(Math.max(0, rows - 1), Math.floor((logicalTop - 3) / rowHeight)));
    const lastRow = Math.min(rows, Math.ceil((logicalTop + height - 3) / rowHeight));
    return { columns, cellWidth, rowHeight, totalHeight, top: index => 3 + Math.floor(index / columns) * rowHeight - logicalTop + scrollTop,
      first: Math.min(count, firstRow * columns), last: Math.min(count, Math.max(firstRow, lastRow) * columns) };
  }
  const api = Object.freeze({ gridLayout });
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibraryLayout = api;
})(typeof window === "undefined" ? globalThis : window);
