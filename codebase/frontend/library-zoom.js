/* Coordinates are normalized per photo; 100% maps one source pixel to one display pixel. */
(() => {
 function center(x, y, sourceWidth, sourceHeight, width, height) {
  const bound = (value, source, viewport) => source <= viewport ? .5 : Math.max(viewport / source / 2, Math.min(1 - viewport / source / 2, value));
  return { x: bound(x, sourceWidth, width), y: bound(y, sourceHeight, height) };
 }
 function click(x, y, width, height, sourceWidth, sourceHeight) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return { x: Math.max(0, Math.min(1, (x - (width - sourceWidth * scale) / 2) / (sourceWidth * scale))),
   y: Math.max(0, Math.min(1, (y - (height - sourceHeight * scale) / 2) / (sourceHeight * scale))) };
 }
 const api = Object.freeze({ center, click });
 if (typeof module !== "undefined") module.exports = api; else window.HDRLibraryZoom = api;
})();
