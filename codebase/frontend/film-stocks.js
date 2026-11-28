(function () {
  "use strict";

  // Film stock data for the WebGPU film pass.
  //
  // The static stock/paper/scanner data is packed once. Contrast variants
  // share that data and carry only their own print curve. The shader still
  // reads the same fixed-size slot, so the numerical path is unchanged.

  const IDS = Object.freeze([
    "kodak_portra_400",
    "kodak_portra_160",
    "kodak_portra_800",
    "kodak_ektar_100",
    "kodak_gold_200",
    "fujifilm_pro_400h",
    "fujifilm_c200",
    "fujifilm_provia_100f",
    "fujifilm_velvia_100",
    "fujifilm_xtra_400",
    "kodak_ektachrome_100",
    "kodak_kodachrome_64",
    "kodak_portra_800_push1",
    "kodak_portra_800_push2",
    "kodak_ultramax_400",
    "kodak_verita_200d",
    "kodak_vision3_200t",
    "kodak_vision3_250d",
    "kodak_vision3_500t",
    "kodak_vision3_50d"
]);
  const NAMES = Object.freeze({
    "kodak_portra_400": "Kodak Portra 400",
    "kodak_portra_160": "Kodak Portra 160",
    "kodak_portra_800": "Kodak Portra 800",
    "kodak_ektar_100": "Kodak Ektar 100",
    "kodak_gold_200": "Kodak Gold 200",
    "fujifilm_pro_400h": "Fujifilm Pro 400H",
    "fujifilm_c200": "Fujifilm C200",
    "fujifilm_provia_100f": "Fujifilm Provia 100F",
    "fujifilm_velvia_100": "Fujifilm Velvia 100",
    "fujifilm_xtra_400": "Fujifilm Superia X-Tra 400",
    "kodak_ektachrome_100": "Kodak Ektachrome 100",
    "kodak_kodachrome_64": "Kodak Kodachrome 64",
    "kodak_portra_800_push1": "Kodak Portra 800 (Push 1)",
    "kodak_portra_800_push2": "Kodak Portra 800 (Push 2)",
    "kodak_ultramax_400": "Kodak Ultramax 400",
    "kodak_verita_200d": "Kodak Verita 200D",
    "kodak_vision3_200t": "Kodak Vision3 200T",
    "kodak_vision3_250d": "Kodak Vision3 250D",
    "kodak_vision3_500t": "Kodak Vision3 500T",
    "kodak_vision3_50d": "Kodak Vision3 50D"
});
  const SHARED = (typeof window !== "undefined" && window.HDRFilmStockLayout)
    || (typeof module !== "undefined" && module.exports && require("./gpu-param-layout.js").HDRFilmStockLayout);
  const CURVE_SAMPLES = SHARED.curveSamples;
  const CURVE_FLOATS = CURVE_SAMPLES * 3;
  const MAX_TABLE_SIZE = SHARED.maxTableSize;
  const LAYOUT = SHARED.offsets;
  const SLOT_FLOATS = SHARED.slotFloats;

  const f32 = Math.fround;

  function numbers(value, length, name) {
    const flat = Array.isArray(value) ? value.flat(2) : [];
    if (flat.length !== length || !flat.every((item) => typeof item === "number" && Number.isFinite(item))) {
      throw new Error(`Film stock field '${name}' is missing or malformed.`);
    }
    return flat;
  }

  // The CPU's float32 scale: the span is taken between the float32 bounds in
  // double precision, then rounded to float32 (film_stock.py _curve/_table).
  function axisScale(low, high, steps) {
    const span = f32(high) - f32(low);
    return span > 0 ? f32(steps / span) : 0;
  }

  /** Pack one stock document into a slot. Throws on malformed data. */
  function packFilmStock(stock) {
    if (!stock || stock.format !== "hdr-finisher-film-stock/2") throw new Error("Film stock data is not in the expected format.");
    const slide = stock.type === "slide";
    if (slide) stock = { ...stock, print_table: stock.scan_table, preflash_raw: [0, 0, 0],
      print_warmth_log_shift: [0, 0, 0], print_tint_log_shift: [0, 0, 0],
      print_log_exposure_range: [0, 1], print_curves: Array.from({ length: CURVE_SAMPLES }, () => [0, 0, 0]) };
    const slot = new Float32Array(SLOT_FLOATS);
    slot[LAYOUT.SCAN_FILM] = slide ? 1 : stock.type === "neutral" ? 2 : stock.type === "neutral_paper" ? 3 : 0;
    slot.set(numbers(stock.film_density_max || [0, 0, 0], 3, "film_density_max"), LAYOUT.FILM_DENSITY_MAX);
    slot.set(numbers(stock.input_matrix, 9, "input_matrix"), LAYOUT.INPUT_MATRIX);
    const film = numbers(stock.film_log_exposure_range, 2, "film_log_exposure_range");
    slot[LAYOUT.FILM_LOW] = film[0];
    slot[LAYOUT.FILM_SCALE] = axisScale(film[0], film[1], CURVE_SAMPLES - 1);
    slot.set(numbers(stock.coupler_matrix, 9, "coupler_matrix"), LAYOUT.COUPLER_MATRIX);
    slot[LAYOUT.COUPLER_SHIFT] = Number(stock.coupler_high_exposure_shift) || 0;
    const print = numbers(stock.print_log_exposure_range, 2, "print_log_exposure_range");
    slot[LAYOUT.PRINT_LOW] = print[0];
    slot[LAYOUT.PRINT_SCALE] = axisScale(print[0], print[1], CURVE_SAMPLES - 1);
    slot.set(numbers(stock.preflash_raw, 3, "preflash_raw"), LAYOUT.PREFLASH_RAW);
    // Print Warmth / Tint at 100% shift the print exposure by these log10
    // vectors (a 20 CC enlarger filter).
    slot.set(numbers(stock.print_warmth_log_shift, 3, "print_warmth_log_shift"), LAYOUT.PRINT_WARMTH_SHIFT);
    slot.set(numbers(stock.print_tint_log_shift, 3, "print_tint_log_shift"), LAYOUT.PRINT_TINT_SHIFT);
    slot.set(numbers(stock.film_curves_plain, CURVE_FLOATS, "film_curves_plain"), LAYOUT.FILM_CURVES_PLAIN);
    slot.set(numbers(stock.film_curves_corrected, CURVE_FLOATS, "film_curves_corrected"), LAYOUT.FILM_CURVES_CORRECTED);
    slot.set(numbers(stock.print_curves, CURVE_FLOATS, "print_curves"), LAYOUT.PRINT_CURVES);
    let offset = LAYOUT.TABLES;
    for (const [key, header] of [["print_table", LAYOUT.PRINT_TABLE], ["scan_table", LAYOUT.SCAN_TABLE]]) {
      const table = stock[key] || {};
      const size = table.size;
      if (!Number.isInteger(size) || size < 2 || size > MAX_TABLE_SIZE) throw new Error(`Film stock table '${key}' has an unsupported size.`);
      const low = numbers(table.domain_min, 3, `${key}.domain_min`);
      const high = numbers(table.domain_max, 3, `${key}.domain_max`);
      const values = numbers(table.values, size * size * size * 3, `${key}.values`);
      slot[header] = size;
      slot[header + 1] = offset;
      for (let axis = 0; axis < 3; axis += 1) {
        slot[header + 2 + axis] = low[axis];
        slot[header + 5 + axis] = axisScale(low[axis], high[axis], size - 1);
      }
      slot.set(values, offset);
      offset += values.length;
    }
    return slot;
  }

  const VARIANT_IDS = Object.freeze(Array.from({length: 8}, (_, i) => `variant-${i}`));
  const ALL_IDS = Object.freeze([...IDS, "none", ...VARIANT_IDS]);
  const fixed = new Map();
  const variants = new Map();
  const pendingBases = new Map();
  const pending = new Map();
  const failed = new Set();
  const listeners = new Set();
  let version = 0;

  function recipe(id, film = {}) {
    const push = Number(film.push_pull) || 0;
    if (id === "kodak_portra_800" && (push === 1 || push === 2)) id += `_push${push}`;
    const slide = ["fujifilm_provia_100f", "fujifilm_velvia_100", "kodak_ektachrome_100", "kodak_kodachrome_64"].includes(id);
    const paper = new URLSearchParams();
    if (!slide && film.print_paper && film.print_paper !== "default") paper.set("paper", film.print_paper);
    const base = new URLSearchParams(paper);
    if (film.lab_levels) base.set("lab_levels", "true");
    const curves = new URLSearchParams(paper);
    if (!slide) {
      for (const [field, key] of [["print_contrast", "contrast"], ["shadow_contrast", "shadows"], ["highlight_contrast", "highlights"]]) {
        if (Number(film[field])) curves.set(key, String(Number(film[field])));
      }
    }
    const baseKey = base.size ? `${id}?${base}` : id;
    const curveQuery = curves.size > paper.size ? curves.toString() : null;
    return { id, baseKey, curveQuery, key: curveQuery ? `${baseKey}|${curveQuery}` : baseKey };
  }

  function retain(id, key, base, curve = null) {
    const serial = ++version;
    if (key === id) {
      const index = ALL_IDS.indexOf(id);
      fixed.set(key, { index, base, curve, serial });
    } else {
      let index = ALL_IDS.length - VARIANT_IDS.length + variants.size;
      if (variants.size === VARIANT_IDS.length) {
        const oldest = variants.keys().next().value;
        index = variants.get(oldest).index;
        variants.delete(oldest);
      }
      variants.set(key, { index, base, curve, serial });
    }
  }

  function findRecipe(key) {
    const entry = variants.get(key);
    if (!entry) return fixed.get(key);
    variants.delete(key);
    variants.set(key, entry);
    return entry;
  }

  function findBase(key) {
    if (fixed.has(key)) return fixed.get(key).base;
    for (const {base} of variants.values()) {
      if (base.key === key) return base;
    }
    return null;
  }

  async function download(path, id) {
    const response = await fetch(`/api/film-stocks/${path}`);
    if (!response.ok) throw new Error(`Film stock ${id} is unavailable (${response.status}).`);
    return response;
  }

  function requestBase(id, key) {
    const loaded = findBase(key);
    if (loaded) return loaded;
    if (!pendingBases.has(key)) {
      const task = download(key, id).then(response => response.json()).then(document => {
        const base = { key, token: Symbol(key), data: packFilmStock(document) };
        // Publish the base as soon as it arrives, including when a saved
        // grade opens with a nonzero contrast. No separate retained cache.
        retain(id, key, base);
        return base;
      }).finally(() => pendingBases.delete(key));
      pendingBases.set(key, task);
    }
    return pendingBases.get(key);
  }

  async function requestPrintCurve(id, query) {
    const response = await download(`${id}/print-curve?${query}`, id);
    const bytes = new DataView(await response.arrayBuffer());
    if (bytes.byteLength !== CURVE_FLOATS * 4) throw new Error(`Film stock ${id} has an invalid print curve.`);
    const curve = Float32Array.from({ length: CURVE_FLOATS }, (_, i) => bytes.getFloat32(i * 4, true));
    if (!curve.every(Number.isFinite)) throw new Error(`Film stock ${id} has a non-finite print curve.`);
    return curve;
  }

  function notify(id) {
    listeners.forEach((listener) => {
      try { listener(id); } catch (error) { console.error(error); }
    });
  }

  function requestRecipe({id, baseKey, curveQuery, key}, redraw = false) {
    if (!(IDS.includes(id) || id === "none") || findRecipe(key) || failed.has(key)
      || typeof fetch !== "function") return null;
    const existing = pending.get(key);
    if (existing) {
      existing.redraw ||= redraw;
      return existing.task;
    }
    const load = { redraw };
    load.task = Promise.all([requestBase(id, baseKey), curveQuery && requestPrintCurve(id, curveQuery)])
      .then(([base, curve]) => {
        if (!findRecipe(key)) retain(id, key, base, curve);
      })
      .catch((error) => {
        if (failed.size === ALL_IDS.length) failed.delete(failed.values().next().value);
        failed.add(key);
        console.warn(error?.message || error);
      })
      .finally(() => {
        pending.delete(key);
        // Only an immediate slot lookup can have drawn without the data.
        // A render which awaits request() does not need invalidating.
        if (load.redraw && findRecipe(key)) notify(id);
      });
    pending.set(key, load);
    return load.task;
  }

  function usesStock(stockId, film) {
    return stockId !== "none" || ["stock_exposure", "stock_separation", "stock_print_warmth", "stock_print_tint", "stock_preflash",
      "push_pull", "print_exposure", "print_contrast", "shadow_contrast", "highlight_contrast", "lab_levels"].some(key => Number(film[key]))
      || (film.print_paper && film.print_paper !== "default");
  }

  function request(stockId, film = {}) {
    return usesStock(stockId, film) ? requestRecipe(recipe(stockId, film)) : null;
  }

  // Zero means the stock is not ready. For callers that cannot await the
  // stock, signal when this exact recipe becomes available.
  function slot(stockId, film = {}) {
    const resolved = recipe(stockId, film);
    const entry = findRecipe(resolved.key);
    if (entry) return entry.index + 1;
    if (usesStock(stockId, film)) requestRecipe(resolved, true);
    return 0;
  }

  function writeLoadedSlots(queue, buffer, uploads) {
    for (const entries of [fixed, variants]) {
      for (const {index, base, curve, serial} of entries.values()) {
        const previous = uploads.get(index);
        if (previous?.serial === serial) continue;
        const offset = index * SLOT_FLOATS * 4;
        const writeBase = previous?.base !== base.token;
        if (writeBase) queue.writeBuffer(buffer, offset, base.data);
        if (curve || (!writeBase && previous.curve)) {
          const rows = curve ?? base.data.subarray(LAYOUT.PRINT_CURVES, LAYOUT.PRINT_CURVES + CURVE_FLOATS);
          queue.writeBuffer(buffer, offset + LAYOUT.PRINT_CURVES * 4, rows);
        }
        // Tokens do not keep evicted CPU tables alive for a renderer.
        uploads.set(index, { base: base.token, curve: Boolean(curve), serial });
      }
    }
  }

  const HDRFilmStocks = Object.freeze({
    ids: IDS,
    bufferIds: ALL_IDS,
    names: NAMES,
    layout: LAYOUT,
    slotFloats: SLOT_FLOATS,
    slotCount: ALL_IDS.length,
    maxTableSize: MAX_TABLE_SIZE,
    packFilmStock,
    request,
    slot,
    writeLoadedSlots,
    get loadedCount() { return fixed.size + variants.size; },
    loadedIds: () => [...fixed.values(), ...variants.values()]
      .sort((a, b) => a.index - b.index).map(({index}) => ALL_IDS[index]),
    get version() { return version; },
    onLoad(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Test seam: install packed data without the network. */
    install(id, document) {
      if (!(IDS.includes(id) || id === "none")) return;
      retain(id, id, { key: id, token: Symbol(id), data: packFilmStock(document) });
      failed.delete(id);
      notify(id);
    },
  });

  if (typeof window !== "undefined") window.HDRFilmStocks = HDRFilmStocks;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRFilmStocks };
})();
