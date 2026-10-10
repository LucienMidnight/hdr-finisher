(function (root) {
  "use strict";
  function gridLayout(count, width, height, scrollTop, minimumSize) {
    const columns = Math.max(1, Math.floor(Math.max(1, width - 20) / minimumSize));
    const cellWidth = Math.max(1, (width - 20) / columns);
    const rowHeight = Math.ceil((cellWidth - 14) * .75 + 42);
    const rows = Math.ceil(count / columns);
    const firstRow = Math.max(0, Math.floor((scrollTop - 10) / rowHeight));
    const lastRow = Math.min(rows, Math.ceil((scrollTop + height - 10) / rowHeight));
    return { columns, cellWidth, rowHeight, totalHeight: rows * rowHeight + 20,
      first: Math.min(count, firstRow * columns), last: Math.min(count, Math.max(firstRow, lastRow) * columns) };
  }
  const api = Object.freeze({ gridLayout });
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibraryLayout = api;
})(typeof window === "undefined" ? globalThis : window);
