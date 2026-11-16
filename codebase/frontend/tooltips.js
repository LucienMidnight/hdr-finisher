/* Shared by every renderer, including embedded Library and standalone browsers. */
(() => {
  "use strict";
  const HOVER_DELAY_MS = 2500;
  // Steve's neighbour decision is pending. Zero means every target waits.
  const NEIGHBOUR_WINDOW_MS = 0;
  const KEEP_SHORTCUT_ONLY = true; // Steve can remove labelled shortcut help here.
  const selector = '[data-tooltip], [data-tip], [data-native-tooltip], [title], button[aria-label], [role="separator"][aria-label], select, .lane-switch button, .scope-title-wrap, .preview-title-wrap, .source-filename-wrap';
  function install() {
    if (window.HDRTooltips) return;
    const tooltip = document.createElement('div');
    tooltip.id = 'bounded-help-tooltip'; tooltip.className = 'bounded-help-tooltip';
    tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('popover', 'manual'); tooltip.hidden = true;
    document.body.append(tooltip);
    let active = null, pending = null, timer = 0, lastShown = -Infinity, previousDescription = null;
    const migrate = element => {
      if (!element.hasAttribute('title')) return;
      const text = element.getAttribute('title');
      // Frame titles name their browsing surface; they are never hover help.
      if (element.matches('iframe')) {
        if (text && !element.getAttribute('aria-label')) element.setAttribute('aria-label', text);
        element.removeAttribute('title'); return;
      }
      element.dataset.nativeTooltip = text;
      // title may have supplied the only accessible name of an icon control.
      if (text && element.matches('button, input, select, iframe, [role="button"]') && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent.trim()) element.setAttribute('aria-label', text);
      element.removeAttribute('title');
    };
    const scan = node => {
      if (node.nodeType !== 1) return;
      migrate(node); node.querySelectorAll('[title]').forEach(migrate);
    };
    scan(document.documentElement);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') { if (record.target.hasAttribute('title')) migrate(record.target); }
        else record.addedNodes.forEach(scan);
      }
      if (active && (!active.isConnected || !active.getClientRects().length)) hide();
    });
    observer.observe(document.documentElement, {subtree:true, childList:true, attributes:true, attributeFilter:['title', 'hidden']});
    function visibleLabel(trigger) {
      const parts = [];
      const walk = node => {
        if (node.nodeType === 3) { parts.push(node.textContent); return; }
        if (node.nodeType !== 1 || node.matches('.title-tooltip, svg, [aria-hidden="true"], .visually-hidden')) return;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.fontSize) === 0) return;
        node.childNodes.forEach(walk);
      };
      walk(trigger);
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
    function clipped(trigger) {
      if (trigger.scrollWidth > trigger.clientWidth + 1 || trigger.scrollHeight > trigger.clientHeight + 1) return true;
      if (trigger.matches('input, select')) {
        const style = getComputedStyle(trigger), canvas = document.createElement('canvas');
        const context = canvas.getContext('2d'); context.font = style.font;
        const text = trigger.matches('select') ? trigger.selectedOptions[0]?.textContent || '' : trigger.value;
        return context.measureText(text).width > trigger.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (trigger.matches('select') ? 20 : 0);
      }
      return [...trigger.querySelectorAll('.name, .picker-tile-name, .directory-browser-entry-name')].some(clipped);
    }
    const normalized = text => text.toLowerCase().replace(/[.…:]+$/g, '').trim();
    function textFor(trigger) {
      if (!trigger.getClientRects().length) return "";
      const authored = trigger.querySelector('.title-tooltip');
      if (trigger.matches('.source-filename-wrap')) return trigger.classList.contains('has-overflow') ? authored?.textContent.trim() || '' : '';
      if (trigger.matches('select') && !trigger.dataset.tooltip && !trigger.dataset.tip && !trigger.dataset.nativeTooltip) return clipped(trigger) ? trigger.selectedOptions[0]?.textContent || '' : '';
      const text = trigger.dataset.tooltip || trigger.dataset.tip || trigger.dataset.nativeTooltip || authored?.textContent.trim() || trigger.getAttribute('aria-label') || '';
      const label = trigger.matches('input[type="range"]')
        ? visibleLabel(trigger.closest('.control-row')?.querySelector('.control-heading label') || trigger)
        : visibleLabel(trigger);
      // Explanation, warnings and disabled reasons always survive. Only names
      // and repeated values are conditional on visible ink / actual overflow.
      if (trigger.matches('input, select') && text === (trigger.matches('select') ? trigger.selectedOptions[0]?.textContent : trigger.value)) return clipped(trigger) ? text : '';
      if (trigger.matches('.directory-browser-entry, .folder-name, .library-file-name, .picker-tile-name, .directory-browser-entry-name, .name, #place-title, #picker-preview-name') && (text === trigger.dataset.path || text === label)) return clipped(trigger) ? text : '';
      const namedOnly = trigger.matches('#index-status') && normalized(text) === 'library activity';
      const [name, ...keys] = text.split(/\s*·\s*/);
      const isName = normalized(name) === normalized(label) || normalized(name) === normalized(label + ' options') || namedOnly;
      if (/[a-z0-9]/i.test(label) && isName) return KEEP_SHORTCUT_ONLY && keys.length ? keys.join(' · ') : clipped(trigger) ? text : '';
      return text;
    }

    function hide() {
      clearTimeout(timer); timer = 0; pending = null;
      if (active) {
        if (previousDescription === null) active.removeAttribute('aria-describedby');
        else active.setAttribute('aria-describedby', previousDescription);
      }
      previousDescription = null;
      active = null;
      if (tooltip.matches(':popover-open')) tooltip.hidePopover();
      tooltip.hidden = true; tooltip.classList.remove('visible');
    }
    function position() {
      if (!active || !active.isConnected || !active.getClientRects().length) return hide();
      const vp = window.visualViewport, x = vp?.offsetLeft || 0, y = vp?.offsetTop || 0;
      const width = vp?.width || innerWidth, height = vp?.height || innerHeight, margin = 8, gap = 7;
      tooltip.style.maxWidth = `${Math.max(0, Math.min(260, width - margin * 2))}px`;
      tooltip.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
      const r = active.getBoundingClientRect(), t = tooltip.getBoundingClientRect();
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(Math.max(lo,hi),v));
      tooltip.style.left = `${Math.round(clamp(r.left+(r.width-t.width)/2, x+margin, x+width-margin-t.width))}px`;
      tooltip.style.top = `${Math.round(clamp(r.bottom+gap+t.height <= y+height-margin ? r.bottom+gap : r.top-gap-t.height, y+margin, y+height-margin-t.height))}px`;
    }
    function schedule(trigger) {
      if (active === trigger || pending === trigger) return;
      hide();
      if (!textFor(trigger)) return;
      pending = trigger;
      timer = setTimeout(() => {
        const text = textFor(trigger);
        if (!text || !trigger.isConnected || !trigger.getClientRects().length) return hide();
        pending = null; active = trigger; tooltip.textContent = text; tooltip.hidden = false;
        previousDescription = trigger.getAttribute('aria-describedby');
        const ids = new Set((previousDescription || '').split(/\s+/).filter(id => id && !document.getElementById(id)?.matches('.title-tooltip')));
        ids.add(tooltip.id); trigger.setAttribute('aria-describedby', [...ids].join(' '));
        tooltip.showPopover(); tooltip.classList.add('visible'); position(); lastShown = performance.now();
      }, NEIGHBOUR_WINDOW_MS && performance.now()-lastShown < NEIGHBOUR_WINDOW_MS ? 0 : HOVER_DELAY_MS);
    }
    const target = event => event.target instanceof Element ? event.target.closest(selector) : null;
    document.addEventListener('pointerover', event => { const t=target(event); if(t && !t.contains(event.relatedTarget)) schedule(t); });
    document.addEventListener('pointerout', event => { const t=target(event); if(t && !t.contains(event.relatedTarget) && (t===active || t===pending)) hide(); });
    document.addEventListener('focusin', event => { const t=target(event); if(t && event.target.matches(':focus-visible') && document.documentElement.dataset.inputModality !== 'pointer') schedule(t); });
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('keydown', event => {
      if(event.key==='Escape') { if(active && !tooltip.hidden) { event.preventDefault(); event.stopPropagation(); } hide(); }
      else if(event.key==='Enter' || event.key===' ') hide();
    }, true);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', () => { if(active) position(); }, true);
    window.addEventListener('resize', hide);
    window.HDRTooltips = Object.freeze({hide, textFor, delay: HOVER_DELAY_MS});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true}); else install();
})();
