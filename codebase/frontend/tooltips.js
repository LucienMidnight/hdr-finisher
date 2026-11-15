/* Shared by every renderer, including embedded Library and standalone browsers. */
(() => {
  "use strict";
  const HOVER_DELAY_MS = 2500;
  // Steve's neighbour decision is pending. Zero means every target waits.
  const NEIGHBOUR_WINDOW_MS = 0;
  const selector = '[data-tooltip], [data-tip], [data-native-tooltip], [title], button[aria-label], [role="separator"][aria-label], .scope-title-wrap, .preview-title-wrap, .source-filename-wrap';
  function install() {
    if (window.HDRTooltips) return;
    const tooltip = document.createElement('div');
    tooltip.id = 'bounded-help-tooltip'; tooltip.className = 'bounded-help-tooltip';
    tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('popover', 'manual'); tooltip.hidden = true;
    document.body.append(tooltip);
    let active = null, pending = null, timer = 0, lastShown = -Infinity;
    const migrate = element => {
      if (!element.hasAttribute('title')) return;
      const text = element.getAttribute('title');
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
    function textFor(trigger) {
      const authored = trigger.querySelector('.title-tooltip');
      if (trigger.matches('.source-filename-wrap') && !trigger.classList.contains('has-overflow')) return '';
      return trigger.dataset.tooltip || trigger.dataset.tip || trigger.dataset.nativeTooltip || authored?.textContent.trim() || trigger.getAttribute('aria-label') || '';
    }
    function hide() {
      clearTimeout(timer); timer = 0; pending = null;
      if (active) {
        const ids = (active.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
        if (ids.length) active.setAttribute('aria-describedby', ids.join(' ')); else active.removeAttribute('aria-describedby');
      }
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
      const rail = active.closest('.grade-panel, .source-rail, .workflow-rail')?.getBoundingClientRect();
      const beside = rail && rail.left - gap - t.width >= x + margin;
      tooltip.style.left = `${Math.round(clamp(beside ? rail.left-gap-t.width : r.left+(r.width-t.width)/2, x+margin, x+width-margin-t.width))}px`;
      tooltip.style.top = `${Math.round(clamp(beside ? r.top : r.bottom+gap+t.height <= y+height-margin ? r.bottom+gap : r.top-gap-t.height, y+margin, y+height-margin-t.height))}px`;
    }
    function schedule(trigger) {
      if (active === trigger || pending === trigger) return;
      hide(); pending = trigger;
      timer = setTimeout(() => {
        const text = textFor(trigger);
        if (!text || !trigger.isConnected || !trigger.getClientRects().length) return hide();
        pending = null; active = trigger; tooltip.textContent = text; tooltip.hidden = false;
        const ids = new Set((trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        ids.add(tooltip.id); trigger.setAttribute('aria-describedby', [...ids].join(' '));
        tooltip.showPopover(); tooltip.classList.add('visible'); position(); lastShown = performance.now();
      }, NEIGHBOUR_WINDOW_MS && performance.now()-lastShown < NEIGHBOUR_WINDOW_MS ? 0 : HOVER_DELAY_MS);
    }
    const target = event => event.target instanceof Element ? event.target.closest(selector) : null;
    document.addEventListener('pointerover', event => { const t=target(event); if(t && !t.contains(event.relatedTarget)) schedule(t); });
    document.addEventListener('pointerout', event => { const t=target(event); if(t && !t.contains(event.relatedTarget) && (t===active || t===pending)) hide(); });
    document.addEventListener('focusin', event => { const t=target(event); if(t && event.target.matches(':focus-visible')) schedule(t); });
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('keydown', event => { if(event.key==='Escape' || event.key==='Enter' || event.key===' ') hide(); }, true);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', () => { if(active) position(); }, true);
    window.addEventListener('resize', hide);
    window.HDRTooltips = Object.freeze({hide, textFor, delay: HOVER_DELAY_MS});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true}); else install();
})();
