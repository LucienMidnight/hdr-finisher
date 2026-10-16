(function(root) {
  "use strict";
  const data = typeof module !== "undefined" ? require("./film-character-data.js") : root.HDRFilmCharacterData;
  const owned = Object.freeze(Object.keys(data.stocks.none.defaults));
  const baseline = () => ({
  look_strength: 100,
  // Film stock: measured stock color and tone, applied before
  // the physical paper and scanner. "none" is the straight Neutral stock.
  film_stock: "none",
  stock_overrides: [],
  stock_color: 100,
  stock_tone: 100,
  stock_exposure: 0,
  stock_separation: 0,
  stock_print_warmth: 0,
  stock_print_tint: 0,
  stock_preflash: 0,
  push_pull: 0,
  print_paper: "default",
  print_exposure: 0,
  print_contrast: 0,
  shadow_contrast: 0,
  highlight_contrast: 0,
  scan_sharpening: 0,
  lab_levels: false,
  grain_enabled: true,
  grain_amount: 0,
  grain_size: 50,
  grain_softness: 25,
  grain_chroma: 0,
  grain_film_format: "35mm",
  grain_film_type: "color_negative",
  grain_capture_geometry: "frame",
  grain_custom_width_mm: 36,
  grain_custom_height_mm: 24,
  grain_shadow_response: 100,
  grain_midtone_response: 100,
  grain_highlight_response: 100,
  grain_view_map: false,
  film_resolution: 100,
  lens_filter: "none",
  lens_strength: 0.5,
  lens_size: 1,
  halation_enabled: true,
  halation_amount: 0,
  halation_radius: 0.2,
  halation_hue_offset: 0,
  halation_saturation: 75,
  halation_view_map: false,
  });
  const tracked = Object.freeze(Object.keys(baseline()).filter(key => !["film_stock", "stock_overrides", "grain_view_map", "halation_view_map"].includes(key)));
  function defaults(film) { return {...baseline(), ...character(film).defaults}; }
  function character(film) {
    let id = film.film_stock || "none";
    if (id === "kodak_portra_800" && [1, 2].includes(film.push_pull)) id += `_push${film.push_pull}`;
    return data.stocks[id] || data.stocks.none;
  }
  function refresh(film) {
    const defaults = character(film).defaults;
    for (const key of owned) if (!(film.stock_overrides || []).includes(key)) film[key] = defaults[key];
    return film;
  }
  function select(film, id) { film.film_stock = id; return refresh(film); }
  function set(film, key, value) {
    film[key] = value;
    if (tracked.includes(key)) film.stock_overrides = [...new Set([...(film.stock_overrides || []), key])];
    if (key === "push_pull") refresh(film);
    return film;
  }
  function reset(film, key) {
    if (!tracked.includes(key)) return film;
    film.stock_overrides = (film.stock_overrides || []).filter(item => item !== key);
    film[key] = defaults(film)[key];
    if (key === "push_pull") refresh(film);
    return film;
  }
  // Only the UI is relative. Saved values remain the renderer's ordinary units,
  // so an explicitly set value stays put when the stock changes.
  function scale(film, key) {
    if (film.film_stock === "none") return null;
    const base = character(film).defaults[key];
    if (key === "halation_hue_offset") return {base, offset:true};
    if (["halation_amount", "halation_radius", "halation_saturation"].includes(key)) return {base, offset:false};
    return null;
  }
  function toUi(film, key, value) {
    const s = scale(film, key);
    return !s ? value : s.offset ? value-s.base : value/s.base*100;
  }
  function fromUi(film, key, value) {
    const s = scale(film, key);
    return !s ? value : s.offset ? value+s.base : value*s.base/100;
  }
  // Sparse recipes contain identity and deliberate values, never expanded stock defaults.
  function sparse(film) {
    return {film_stock:film.film_stock, print_paper:film.print_paper,
      ...Object.fromEntries(tracked.filter(key => (film.stock_overrides || []).includes(key)).map(key => [key, film[key]])),
      stock_overrides:[...(film.stock_overrides || [])].filter(key => tracked.includes(key))};
  }
  function expand(recipe) {
    const film = baseline();
    film.film_stock = recipe.film_stock || "none";
    const keys = Object.keys(recipe).filter(key => tracked.includes(key));
    film.stock_overrides = [...new Set([...(recipe.stock_overrides || []).filter(key => keys.includes(key)), ...keys.filter(key => key !== "print_paper")])];
    for (const key of keys) film[key] = recipe[key];
    refresh(film);
    return film;
  }
  const stages = {
    Lens: [
      ["None", {lens_filter:"none", lens_strength:.5, lens_size:1}],
      ["Light diffusion (Black Pro-Mist 1/8)", {lens_filter:"black_pro_mist", lens_strength:.125, lens_size:1}],
      ["Soft glow (Pro-Mist 1/4)", {lens_filter:"pro_mist", lens_strength:.25, lens_size:1}],
      ["Sparkle (Glimmerglass 1/4)", {lens_filter:"glimmerglass", lens_strength:.25, lens_size:1}],
      ["Heavy bloom (CineBloom 1/2)", {lens_filter:"cinebloom", lens_strength:.5, lens_size:1}]],
    Format: ["65mm", "35mm", "super16", "super8"].map((value, i) => [["65mm", "35mm", "Super 16", "Super 8"][i], {grain_film_format:value}]),
    Development: [["Pull 1", {push_pull:-1}], ["Normal", {push_pull:0}], ["Push 1", {push_pull:1}], ["Push 2", {push_pull:2}]],
    Print: [
      ["Neutral print", {}], ["Warm print", {stock_print_warmth:15}],
      ["Cool print", {stock_print_warmth:-15}], ["Soft print (lower contrast)", {print_contrast:-20}],
      ["Rich print (higher contrast)", {print_contrast:20}], ["Cinema print (Kodak 2383)", {print_paper:"kodak_2383"}]]
      .map(([name, values]) => [name, {print_paper:"default", print_exposure:0, stock_print_warmth:0, stock_print_tint:0, stock_preflash:0, print_contrast:0, shadow_contrast:0, highlight_contrast:0, ...values}]),
    Scan: [["Clean scan (no sharpening)", {scan_sharpening:0, lab_levels:false}], ["Lab scan (Lab Levels on, light sharpening)", {scan_sharpening:25, lab_levels:true}]],
  };
  function stage(film, name, index) {
    const values = stages[name]?.[index]?.[1];
    if (!values) return film;
    for (const [key, value] of Object.entries(values)) set(film, key, value);
    return film;
  }
  const api = {tracked, defaults, sparse, expand, stages, stage, owned, character, refresh, select, set, reset, toUi, fromUi, scale};
  if (typeof module !== "undefined") module.exports = api;
  root.HDRFilmCharacter = api;
})(typeof window === "undefined" ? globalThis : window);
