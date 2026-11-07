/* Appearance only: no image or grade state is involved. */
(function (root) {
  const presets = { "burnt-orange": "#d0612a", "blue-gray": "#566481", "coating-blue": "#38a3dc" };
  function normalize(value) {
    if (Object.hasOwn(presets, value?.preset)) return { preset: value.preset, color: presets[value.preset] };
    if (value?.preset === "custom" && /^#[0-9a-f]{6}$/i.test(value.color)) return { preset: "custom", color: value.color.toLowerCase() };
    return { preset: "burnt-orange", color: presets["burnt-orange"] };
  }
  function luminance(hex) {
    const c = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
  }
  function apply(value, doc = root.document) {
    const accent = normalize(value), style = doc.documentElement.style;
    style.setProperty("--accent", accent.color);
    style.setProperty("--accent-strong", `color-mix(in srgb, ${accent.color} 72%, white)`);
    style.setProperty("--accent-low", `color-mix(in srgb, ${accent.color} 82%, black)`);
    style.setProperty("--accent-bed", `color-mix(in srgb, ${accent.color} 16%, var(--panel))`);
    style.setProperty("--on-accent", luminance(accent.color) > .18 ? "#120c08" : "#ffffff");
    doc.documentElement.dataset.accent = JSON.stringify(accent);
    doc.dispatchEvent(new CustomEvent("appearancechange"));
    return accent;
  }
  function selectChevron(doc = root.document) {
    const ink = getComputedStyle(doc.documentElement).getPropertyValue("--muted").trim();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    doc.documentElement.style.setProperty("--select-chevron", `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  // Canvas text cannot read CSS variables, so graphs ask for the same type tokens here.
  function font(size = "min", family = "body", weight = "", doc = root.document) {
    const style = getComputedStyle(doc.documentElement), token = name => style.getPropertyValue(name).trim();
    return [weight && token(`--font-weight-${weight}`), token(`--font-size-${size}`), token(`--font-${family}`)].filter(Boolean).join(" ");
  }
  const api = { presets, normalize, luminance, apply, font };
  if (typeof module !== "undefined") module.exports = api;
  else {
    root.HDRAppearance = api;
    // Native range inputs can retain :focus-visible after a pointer drag.
    // Track input intent so that only keyboard/assistive focus draws a ring.
    root.document.addEventListener("pointerdown", () => {
      root.document.documentElement.dataset.inputModality = "pointer";
    }, true);
    root.document.addEventListener("keydown", event => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        root.document.documentElement.dataset.inputModality = "keyboard";
      }
    }, true);
    root.document.addEventListener("DOMContentLoaded", () => selectChevron());
    if (root.MutationObserver) new MutationObserver(() => {
      selectChevron();
      if (!root.state?.session && typeof state !== "undefined" && !state.session) return;
      for (const name of ["drawCurveEditor", "drawToneEqualizerEditor", "renderHighlightCompressionControls"]) {
        try { if (typeof root[name] === "function") root[name](); } catch (error) { console.warn("Appearance redraw:",name,error); }
      }
    }).observe(root.document.documentElement, {attributes:true, attributeFilter:["data-theme"]});
  }
})(typeof window === "undefined" ? globalThis : window);
