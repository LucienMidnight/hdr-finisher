(function () {
  "use strict";

  // Film stock data for the WebGPU film pass.
  //
  // Each stock's baked tables (backend/hdr_finisher/film_stocks/<id>.json,
  // served by GET /api/film-stocks/<id>) are fetched once and packed into one
  // fixed-size slot of floats. The renderer copies loaded slots into a single
  // storage buffer, and the film pass finds a lane's stock by its slot number
  // (FILM_STOCK_SLOT, 0 while the data has not arrived). The shader's chain
  // mirrors backend/hdr_finisher/film_stock.py: clamped linear 1D lookups and
  // clamped trilinear 3D lookups, with the same float32 scale factors.

  const IDS = Object.freeze([
    "kodak_portra_400",
    "kodak_portra_160",
    "kodak_portra_800",
    "kodak_ektar_100",
    "kodak_gold_200",
    "fujifilm_pro_400h",
  ]);
  const NAMES = Object.freeze({
    kodak_portra_400: "Kodak Portra 400",
    kodak_portra_160: "Kodak Portra 160",
    kodak_portra_800: "Kodak Portra 800",
    kodak_ektar_100: "Kodak Ektar 100",
    kodak_gold_200: "Kodak Gold 200",
    fujifilm_pro_400h: "Fujifilm Pro 400H",
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
    if (!stock || stock.format !== "hdr-finisher-film-stock/1") throw new Error("Film stock data is not in the expected format.");
    const slot = new Float32Array(SLOT_FLOATS);
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

  const packed = new Map();
  const pending = new Map();
  const failed = new Set();
  const listeners = new Set();
  let version = 0;

  function notify(id) {
    version += 1;
    listeners.forEach((listener) => {
      try { listener(id); } catch (error) { console.error(error); }
    });
  }

  function request(id) {
    if (!IDS.includes(id) || packed.has(id) || pending.has(id) || failed.has(id)) return pending.get(id) || null;
    if (typeof fetch !== "function") return null;
    const task = fetch(`/api/film-stocks/${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Film stock ${id} is unavailable (${response.status}).`);
        return response.json();
      })
      .then((document) => {
        packed.set(id, packFilmStock(document));
        pending.delete(id);
        notify(id);
      })
      .catch((error) => {
        pending.delete(id);
        failed.add(id);
        console.warn(error?.message || error);
      });
    pending.set(id, task);
    return task;
  }

  /**
   * The slot number the film pass reads for a stock: its position in IDS
   * plus one, or 0 while its data is not loaded (the stage then stays off and
   * the preview re-renders when the data arrives). Asking starts the load.
   */
  function slot(id) {
    if (!IDS.includes(id)) return 0;
    if (!packed.has(id)) {
      request(id);
      return 0;
    }
    return IDS.indexOf(id) + 1;
  }

  const HDRFilmStocks = Object.freeze({
    ids: IDS,
    names: NAMES,
    layout: LAYOUT,
    slotFloats: SLOT_FLOATS,
    slotCount: IDS.length,
    maxTableSize: MAX_TABLE_SIZE,
    packFilmStock,
    request,
    slot,
    packedSlot: (id) => packed.get(id) || null,
    loadedIds: () => IDS.filter((id) => packed.has(id)),
    get version() { return version; },
    onLoad(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Test seam: install packed data without the network. */
    install(id, document) { packed.set(id, packFilmStock(document)); failed.delete(id); notify(id); },
  });

  if (typeof window !== "undefined") window.HDRFilmStocks = HDRFilmStocks;
  if (typeof module !== "undefined" && module.exports) module.exports = { HDRFilmStocks };
})();
