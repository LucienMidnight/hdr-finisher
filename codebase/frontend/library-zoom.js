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
 // Scale is device pixels per source pixel: 1 is 100%, fit is the whole photo in the view.
 function fitScale(sourceWidth, sourceHeight, width, height) {
  return Math.min(width / sourceWidth, height / sourceHeight);
 }
 // One wheel notch (deltaY 100) is about 16%. Crossing 100% stops there once.
 function wheel(scale, deltaY, fit, max = 4) {
  let next = scale * Math.exp(-deltaY * .0015);
  if ((scale < 1 && next > 1) || (scale > 1 && next < 1)) next = 1;
  return Math.max(Math.min(fit, 1), Math.min(max, next));
 }
 // Keeps the source point under the pointer still while the scale changes.
 // The pointer is in device pixels from the view's top-left corner.
 function anchor(x, y, pointerX, pointerY, width, height, sourceWidth, sourceHeight, from, to) {
  const offsetX = pointerX - width / 2, offsetY = pointerY - height / 2;
  const sourceX = x + offsetX / (sourceWidth * from), sourceY = y + offsetY / (sourceHeight * from);
  return center(sourceX - offsetX / (sourceWidth * to), sourceY - offsetY / (sourceHeight * to), sourceWidth * to, sourceHeight * to, width, height);
 }
 const api = Object.freeze({ center, click, fitScale, wheel, anchor });
 if (typeof module !== "undefined") module.exports = api; else window.HDRLibraryZoom = api;
})();
