/* Pure sort/filter rules shared by the Library and its fast checks. */
(() => {
  const rawTypes = new Set(["3FR", "ARW", "CR2", "CR3", "DNG", "ERF", "FFF", "IIQ", "KDC", "MEF", "MOS", "MRW", "NEF", "NRW", "ORF", "ORI", "PEF", "RAF", "RAW", "RW2", "RWL", "SRW", "X3F"]);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const compareText = (a, b) => collator.compare(String(a), String(b));
  const trim = (value, digits = 1) => String(Number(value.toFixed(digits)));
  const format = Object.freeze({
    shutter: value => value >= 0.3 ? `${trim(value)} s` : `1/${Math.round(1 / value)} s`,
    aperture: value => `f/${trim(value)}`,
    focal_length: value => `${trim(value)} mm`,
    iso: value => `ISO ${value}`,
  });
  // The fields of the "+ Filter" list. The same rules will drive smart albums.
  // "choice" offers the values found in the photos on screen; a photo that
  // records nothing has the empty value, shown with the field's "none" wording.
  const FIELDS = Object.freeze({
    rating: { label: "Rating", kind: "range", get: photo => photo.marks?.rating || 0 },
    pick: { label: "Pick status", kind: "choice", get: photo => photo.marks?.pick || "unmarked" },
    label: { label: "Colour label", kind: "choice", none: "No colour label", get: photo => photo.marks?.label || "" },
    name: { label: "File name", kind: "text", get: photo => (photo.source_path || photo.path).split(/[\\/]/).at(-1) || photo.name },
    search: { label: "File name or tag", kind: "text", get: photo => [photo.name || "", ...(photo.marks?.tags || [])] },
    copy: { label: "Virtual copy", kind: "choice", get: photo => photo.copy_id ? "Virtual copy" : "Original" },
    state: { label: "Edited", kind: "choice", get: photo => photo.edited ? "Edited" : "Not edited" },
    camera: { label: "Camera", kind: "choice", none: "Not recorded", get: photo => photo.camera },
    lens: { label: "Lens", kind: "choice", none: "Not recorded", get: photo => photo.lens },
    iso: { label: "ISO", kind: "range", get: photo => photo.iso },
    focal_length: { label: "Focal length", kind: "range", none: "Not recorded", numeric: true, get: photo => photo.focal_length },
    aperture: { label: "Aperture", kind: "range", none: "Not recorded", numeric: true, get: photo => photo.aperture },
    shutter: { label: "Shutter speed", kind: "range", none: "Not recorded", numeric: true, get: photo => photo.shutter },
    date: { label: "Capture date", kind: "date", get: photo => photo.capture_time ? photo.capture_time.slice(0, 10) : null },
    type: { label: "File type", kind: "choice", get: photo => photo.type },
    tag: { label: "Tag", kind: "choice", none: "No tags", get: photo => photo.marks?.tags || [] },
  });
  function entries(photo, id) {
    // [value, label] pairs; several for tags, one otherwise.
    const raw = FIELDS[id].get(photo), list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
    if (!list.length) return [["", FIELDS[id].none || "Not recorded"]];
    return list.map(value => { const label = format[id] ? format[id](value) : String(value); return [FIELDS[id].kind === "range" ? String(value) : label.toLocaleLowerCase(), label, value]; });
  }
  function values(photos, id) {
    const found = new Map();
    for (const photo of photos) for (const [value, label, raw] of entries(photo, id)) {
      const item = found.get(value) || { value, label, count: 0, raw }; item.count += 1; found.set(value, item);
    }
    const numeric = FIELDS[id].numeric || FIELDS[id].kind === "range";
    return [...found.values()].sort((a, b) => (a.value === "") - (b.value === "") || (numeric ? a.raw - b.raw : b.count - a.count || compareText(a.label, b.label)))
      .map(({ value, label, count, raw }) => FIELDS[id].kind === "range" ? { value, label, count, raw } : { value, label, count });
  }
  function matches(photo, rule, wantedValues = null) {
    const field = FIELDS[rule.field];
    if (!field) return rule.value == null && rule.from == null && rule.to == null;
    let hit;
    const op = rule.op || (field.kind === "text" ? "contains" : "is");
    if (op === "in") {
      const wanted = wantedValues || new Set((rule.values || []).map(value => String(value).toLocaleLowerCase()));
      hit = entries(photo, rule.field).some(([value]) => wanted.has(value));
    } else if (field.kind === "text" || ["contains", "starts", "ends"].includes(op)) {
      const values = field.kind === "text" ? [field.get(photo)].flat() : entries(photo, rule.field).map(([value, label]) => field.kind === "range" ? label : value);
      const needle = String(rule.value ?? "").toLocaleLowerCase();
      hit = values.some(value => { const text = String(value ?? "").toLocaleLowerCase(); return op === "starts" ? text.startsWith(needle) : op === "ends" ? text.endsWith(needle) : op === "is" ? text === needle : text.includes(needle); });
    } else if (field.kind === "choice") hit = entries(photo, rule.field).some(([value]) => value === String(rule.value ?? "").toLocaleLowerCase());
    else if (op === "is" && field.kind === "range" && rule.value === "") hit = field.get(photo) == null;
    else if (["greater", "less", "at-least", "at-most", "is"].includes(op) && rule.value != null) {
      const value = field.get(photo), expected = field.kind === "range" ? Number(rule.value) : rule.value;
      hit = value != null && (op === "greater" ? value > expected : op === "less" ? value < expected : op === "at-least" ? value >= expected : op === "at-most" ? value <= expected : value === expected);
    }
    else {
      const value = field.get(photo), from = rule.from === "" || rule.from == null ? null : rule.from, to = rule.to === "" || rule.to == null ? null : rule.to;
      const number = field.kind === "range";
      hit = value != null && (from == null || (number ? value >= Number(from) : value >= from)) && (to == null || (number ? value <= Number(to) : value <= to));
    }
    return rule.not ? !hit : hit;
  }
  function describe(rule) {
    const field = FIELDS[rule.field];
    if (!field) return "Unknown rule";
    if (rule.op === "in") {
      const labels = rule.labels || rule.values || [];
      return `${field.label}: ${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2} more` : ""}`;
    }
    const display = value => format[rule.field] ? format[rule.field](Number(value)).replace(/^ISO /, "") : String(value);
    if (rule.value != null && field.kind !== "choice") return `${field.label} ${rule.not ? "is not " : ""}${rule.op || "contains"} ${display(rule.value)}`;
    if (field.kind === "choice") return `${field.label} ${rule.not ? "is not" : "is"} ${rule.label ?? rule.value}`;
    const from = rule.from === "" || rule.from == null ? null : rule.from, to = rule.to === "" || rule.to == null ? null : rule.to;
    const span = from != null && to != null ? (String(from) === String(to) ? display(from) : `${display(from)} to ${display(to)}`) : from != null ? `${display(from)} or ${field.kind === "date" ? "later" : rule.field === "shutter" ? "slower" : "more"}` : `${display(to)} or ${field.kind === "date" ? "earlier" : rule.field === "shutter" ? "faster" : "less"}`;
    return `${field.label} ${rule.not ? "is not " : ""}${span}`;
  }
  function predicate(filters = {}) {
    const rules = (filters.rules || []).map(rule => {
      const wanted = rule.op === "in" ? new Set((rule.values || []).map(value => String(value).toLocaleLowerCase())) : null;
      return photo => matches(photo, rule, wanted);
    });
    const folders = (filters.folders || []).map(path => String(path).replaceAll("\\", "/").replace(/\/$/, "").toLocaleLowerCase() + "/");
    return photo => {
      const path = (photo.source_path || photo.path).replaceAll("\\", "/").toLocaleLowerCase();
      return (!folders.length || folders.some(folder => path.startsWith(folder) && (!photo.library_pins || photo.library_pins.some(pin => String(pin).replaceAll("\\", "/").replace(/\/$/, "").toLocaleLowerCase() + "/" === folder))))
        && (!rules.length || (filters.any ? rules.some(accepts => accepts(photo)) : rules.every(accepts => accepts(photo))));
    };
  }
  function count(photos, filters = {}) {
    const accepts = predicate(filters);
    let total = 0;
    for (const photo of photos) if (accepts(photo)) total++;
    return total;
  }
  function apply(photos, sort = "time", descending = false, filters = {}) {
    const result = photos.filter(predicate(filters));
    const picks = { pick: 0, unmarked: 1, reject: 2 };
    const parents = new Map(photos.filter(p=>!p.copy_id).map(p=>[p.path,p]));
    return result.sort((left, right) => {
      const leftKey=left.source_path || left.path,rightKey=right.source_path || right.path;
      if(leftKey===rightKey)return Number(!!left.copy_id)-Number(!!right.copy_id) || (left.copy_order||0)-(right.copy_order||0);
      const a=parents.get(leftKey)||left,b=parents.get(rightKey)||right;
      let order = 0;
      if (sort === "time") {
        // Unknown dates remain last in either direction. Before facts arrive, name wins.
        if (!!a.capture_time !== !!b.capture_time) return a.capture_time ? -1 : 1;
        order = compareText(a.capture_time || "", b.capture_time || "");
      } else if (sort === "rating") order = (a.marks?.rating || 0) - (b.marks?.rating || 0);
      else if (sort === "pick") order = picks[a.marks?.pick || "unmarked"] - picks[b.marks?.pick || "unmarked"];
      else if (sort === "state") order = Number(!!a.edited) - Number(!!b.edited);
      else if (sort === "type") order = compareText(a.type, b.type);
      else if (sort === "modified") order = Math.sign((a.mtime_ns || 0) - (b.mtime_ns || 0));
      else order = compareText(a.name, b.name);
      return (descending ? -1 : 1) * (order || compareText(a.name, b.name) || compareText(a.path, b.path));
    });
  }
  const api = Object.freeze({ apply, count, matches, values, describe, format, FIELDS, rawTypes });
  if (typeof module !== "undefined") module.exports = api;
  else globalThis.HDRLibraryQuery = api;
})();
