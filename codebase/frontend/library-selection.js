(function (root) {
  "use strict";
  function choose(paths, selected, anchor, index, mode = "single") {
    if (!paths.length) return { selected: new Set(), anchor: -1, index: -1 };
    index = Math.max(0, Math.min(paths.length - 1, index));
    let next = new Set(selected);
    if (mode === "range") {
      anchor = anchor < 0 ? index : anchor;
      next = new Set(paths.slice(Math.min(anchor, index), Math.max(anchor, index) + 1));
    } else if (mode === "toggle") {
      next.has(paths[index]) ? next.delete(paths[index]) : next.add(paths[index]); anchor = index;
    } else if (mode !== "preserve") { next = new Set([paths[index]]); anchor = index; }
    return { selected: next, anchor, index };
  }
  function boxIndices(layout, count, box) {
    const result = [];
    const firstRow = Math.max(0, Math.floor((box.top - 10) / layout.rowHeight));
    const lastRow = Math.min(Math.ceil(count / layout.columns) - 1, Math.floor((box.bottom - 10) / layout.rowHeight));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = 0; column < layout.columns; column++) {
        const left = 10 + column * layout.cellWidth, top = 10 + row * layout.rowHeight;
        const index = row * layout.columns + column;
        if (index < count && left < box.right && left + layout.cellWidth > box.left && top < box.bottom && top + layout.rowHeight > box.top) result.push(index);
      }
    }
    return result;
  }
  const api = Object.freeze({ choose, boxIndices });
  if (typeof module !== "undefined") module.exports = api;
  else root.HDRLibrarySelection = api;
})(typeof window === "undefined" ? globalThis : window);
