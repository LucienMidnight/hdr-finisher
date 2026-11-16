/* Shared top-layer placement. Keep DOM ancestry (menu keyboard/click handlers
 * depend on it), while escaping chrome stacking contexts and overflow clips. */
(function (root) {
  'use strict';
  function fit(rect, viewport, margin = 8) {
    const width = Math.max(0, viewport.width - 2 * margin), height = Math.max(0, viewport.height - 2 * margin);
    return {left:Math.max(margin, Math.min(rect.left, viewport.width - Math.min(rect.width, width) - margin)),
      top:Math.max(margin, Math.min(rect.top, viewport.height - Math.min(rect.height, height) - margin)), maxWidth:width, maxHeight:height};
  }
  if (typeof module === 'object' && module.exports) module.exports = {fit};
  if (!root.document) return;
  const selector = '.window-menu-bar, [role="menu"], .library-popover, .overlay-popover, .chrome-proof-popover, .library-filter-panel, .library-activity';
  const open = new Map();
  function visible(element) {
    return element.isConnected && !element.closest('[hidden], .hidden') && element.checkVisibility();
  }
  function place(element) {
    const record = open.get(element); if (!record) return;
    const rect = element.getBoundingClientRect();
    const position = fit({...record.origin, width:rect.width, height:rect.height}, {width:innerWidth,height:innerHeight});
    for (const [key,value] of Object.entries(position)) element.style[key] = `${value}px`;
  }
  const resize = new ResizeObserver(entries => entries.forEach(({target}) => place(target)));
  function close(element) {
    const record = open.get(element); if (!record) return;
    resize.unobserve(element); open.delete(element);
    if (element.matches(':popover-open')) element.hidePopover();
    element.removeAttribute('popover'); element.removeAttribute('data-floating-surface');
    for (const key of Object.keys(record.styles)) element.style[key] = record.styles[key];
  }
  function sync(element) {
    if (open.has(element)) { if (!visible(element)) close(element); else place(element); return; }
    if (!visible(element) || element.hasAttribute('popover')) return;
    const rect = element.getBoundingClientRect();
    const styles = Object.fromEntries(['left','top','right','bottom','maxHeight','maxWidth','width'].map(key => [key,element.style[key]]));
    open.set(element, {origin:{left:rect.left,top:rect.top}, styles});
    element.dataset.floatingSurface = '';
    element.setAttribute('popover', 'manual'); element.showPopover();
    place(element); resize.observe(element);
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) sync(node);
    node.querySelectorAll(selector).forEach(sync);
  }
  new MutationObserver(records => {
    for (const element of open.keys()) if (!visible(element)) close(element);
    for (const record of records) {
      if (record.type === 'attributes') scan(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden','class']});
  root.addEventListener('resize', () => { for (const element of open.keys()) place(element); });
  document.addEventListener('DOMContentLoaded', () => scan(document.body), {once:true});
  root.HDRFloatingSurfaces = Object.freeze({fit, refresh:sync});
})(typeof window === 'object' ? window : globalThis);
