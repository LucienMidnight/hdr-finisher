/* One display convention for configurable shortcuts, fixed keys and help copy.
 * Ctrl in an explicit binding means physical Control; legacy Ctrl+command
 * copy means Mod, accepted by those handlers as Ctrl or Command. */
(function (root) {
  'use strict';
  const isMac = () => (root.hdrFinisherDesktop?.platform || root.navigator?.platform || '').toLowerCase().match(/darwin|mac/) !== null;
  function format(value, mac = isMac()) {
    if (!value) return '';
    const parts = value.split('+');
    if (!mac) return parts.map(part => ({Mod:'Ctrl', Meta:'Win'})[part] || part).join('+');
    const modifiers = new Set(parts.filter(part => ['Mod','Ctrl','Meta','Shift','Alt'].includes(part)));
    return [['Ctrl','⌃'],['Alt','⌥'],['Shift','⇧'],['Mod','⌘'],['Meta','⌘']]
      .filter(([part]) => modifiers.has(part) && !(part === 'Meta' && modifiers.has('Mod'))).map(([,symbol]) => symbol).join('')
      + parts.filter(part => !modifiers.has(part)).join('+');
  }
  function text(value, mac = isMac()) {
    if (!mac || !value) return value;
    return value.replace(/\bCtrl\/Command(?=\+)/g, 'Mod').replace(/\b(?:Ctrl|Mod|Meta|Alt|Shift)(?:\+(?:Ctrl|Mod|Meta|Alt|Shift))*\+(?:[A-Za-z0-9?]+|[←→↑↓,.[\]\/])/g,
      binding => format(/^Ctrl\+(?:(?:Shift|Alt)\+)*[ACVEFZOSR,]$/i.test(binding) ? binding.replace(/^Ctrl\+/, 'Mod+') : binding, true))
      .replace(/\bCtrl-click\b/g, '⌘-click')
      .replace(/\bCtrl\/Cmd\b/g, '⌘')
      .replace(/\bCtrl\b/g, '⌃').replace(/\bAlt\b/g, '⌥').replace(/\bShift\b/g, '⇧');
  }
  const api = Object.freeze({format, text, isMac});
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HDRShortcuts = api;
  if (!root.document) return;
  // Help is authored in several modules. Normalize at the presentation boundary,
  // without changing input values, stored bindings, photo names or user content.
  const attributes = ['title','data-tooltip','data-tip','data-native-tooltip','aria-label'];
  function help(element) {
    if (element.matches('input:not([type="range"]), textarea, select, iframe, .source-filename-wrap, .library-file-name, .folder-name, .picker-tile-name, [contenteditable]')) return;
    for (const name of attributes) {
      const before = element.getAttribute(name), after = text(before);
      if (before !== after) element.setAttribute(name, after);
    }
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    help(node);
    node.querySelectorAll('[title],[data-tooltip],[data-tip],[data-native-tooltip],[aria-label]').forEach(help);
    // Static instructional copy and the shared tooltip's generated text.
    for (const element of [node, ...node.querySelectorAll('.shortcut-hardware-note, .slider-key-legend, #bounded-help-tooltip, #picker-title + p')]) {
      if (!element.matches('.shortcut-hardware-note, .slider-key-legend, #bounded-help-tooltip, #picker-title + p')) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const item = walker.currentNode, after = text(item.data); if (item.data !== after) item.data = after; }
    }
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') help(record.target);
      else if (record.target.matches('.shortcut-hardware-note, .slider-key-legend, #bounded-help-tooltip, #picker-title + p')) scan(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:attributes});
  document.addEventListener('DOMContentLoaded', () => scan(document.body), {once:true});
})(typeof window === 'object' ? window : globalThis);
