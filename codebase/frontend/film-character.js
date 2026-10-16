(function(root) {
  "use strict";
  const data = typeof module !== "undefined" ? require("./film-character-data.js") : root.HDRFilmCharacterData;
  const owned = Object.freeze(Object.keys(data.stocks.none.defaults));
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
    if (owned.includes(key)) film.stock_overrides = [...new Set([...(film.stock_overrides || []), key])];
    if (key === "push_pull") refresh(film);
    return film;
  }
  function reset(film, key) {
    if (!owned.includes(key)) return film;
    film.stock_overrides = (film.stock_overrides || []).filter(item => item !== key);
    film[key] = character(film).defaults[key];
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
  const api = {owned, character, refresh, select, set, reset, toUi, fromUi, scale};
  if (typeof module !== "undefined") module.exports = api;
  root.HDRFilmCharacter = api;
})(typeof window === "undefined" ? globalThis : window);
