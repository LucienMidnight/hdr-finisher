/* Pure sort/filter rules shared by the Library and its fast checks. */
(() => {
  const rawTypes = new Set(["3FR", "ARW", "CR2", "CR3", "DNG", "ERF", "FFF", "IIQ", "KDC", "MEF", "MOS", "MRW", "NEF", "NRW", "ORF", "ORI", "PEF", "RAF", "RAW", "RW2", "RWL", "SRW", "X3F"]);
  const compareText = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
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
    copy: { label: "Virtual copy or original", kind: "choice", get: photo => photo.copy_id ? "Virtual copy" : "Original" },
    state: { label: "State", kind: "choice", get: photo => photo.edited ? "Edited" : "Not edited" },
    camera: { label: "Camera", kind: "choice", none: "Not recorded", get: photo => photo.camera },
    lens: { label: "Lens", kind: "choice", none: "Unknown", get: photo => photo.lens },
    iso: { label: "ISO", kind: "range", get: photo => photo.iso },
    focal_length: { label: "Focal length", kind: "choice", none: "Not recorded", numeric: true, get: photo => photo.focal_length },
    aperture: { label: "Aperture", kind: "choice", none: "Not recorded", numeric: true, get: photo => photo.aperture },
    shutter: { label: "Shutter speed", kind: "choice", none: "Not recorded", numeric: true, get: photo => photo.shutter },
    date: { label: "Capture date", kind: "date", get: photo => photo.capture_time ? photo.capture_time.slice(0, 10) : null },
    type: { label: "File type", kind: "choice", get: photo => photo.type },
    tag: { label: "Tag", kind: "choice", none: "No tags", get: photo => photo.marks?.tags || [] },
  });
  function entries(photo, id) {
    // [value, label] pairs; several for tags, one otherwise.
    const raw = FIELDS[id].get(photo), list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
    if (!list.length) return [["", FIELDS[id].none || "Not recorded"]];
    return list.map(value => { const label = format[id] ? format[id](value) : String(value); return [label.toLocaleLowerCase(), label, value]; });
  }
  function values(photos, id) {
    const found = new Map();
    for (const photo of photos) for (const [value, label, raw] of entries(photo, id)) {
      const item = found.get(value) || { value, label, count: 0, raw }; item.count += 1; found.set(value, item);
    }
    const numeric = FIELDS[id].numeric;
    return [...found.values()].sort((a, b) => (a.value === "") - (b.value === "") || (numeric ? a.raw - b.raw : b.count - a.count || compareText(a.label, b.label)))
      .map(({ value, label, count }) => ({ value, label, count }));
  }
  function matches(photo, rule) {
    const field = FIELDS[rule.field];
    if (!field) return true;
    let hit;
    if (field.kind === "choice") hit = entries(photo, rule.field).some(([value]) => value === rule.value);
    else {
      const value = field.get(photo), from = rule.from === "" || rule.from == null ? null : rule.from, to = rule.to === "" || rule.to == null ? null : rule.to;
      const number = field.kind === "range";
      hit = value != null && (from == null || (number ? value >= Number(from) : value >= from)) && (to == null || (number ? value <= Number(to) : value <= to));
    }
    return rule.not ? !hit : hit;
  }
  function describe(rule) {
    const field = FIELDS[rule.field];
    if (field.kind === "choice") return `${field.label} ${rule.not ? "is not" : "is"} ${rule.label ?? rule.value}`;
    const from = rule.from === "" || rule.from == null ? null : rule.from, to = rule.to === "" || rule.to == null ? null : rule.to;
    const span = from != null && to != null ? (String(from) === String(to) ? `${from}` : `${from} to ${to}`) : from != null ? `${from} or ${field.kind === "date" ? "later" : "more"}` : `${to} or ${field.kind === "date" ? "earlier" : "less"}`;
    return `${field.label} ${rule.not ? "is not" : "is"} ${span}`;
  }
  function apply(photos, sort = "time", descending = false, filters = {}) {
    const needle = (filters.search || "").trim().toLocaleLowerCase();
    const rules = filters.rules || [];
    const result = photos.filter(photo => {
      const marks = photo.marks || {}, tags = marks.tags || [];
      return (!filters.raw || rawTypes.has(photo.type)) && (!filters.type || photo.type === filters.type)
        && (!filters.rating || (marks.rating || 0) >= Number(filters.rating))
        && (!filters.pick || (filters.pick === "hide-rejected" ? marks.pick !== "reject" : (marks.pick || "unmarked") === filters.pick))
        && (!filters.label || marks.label === filters.label)
        && (!needle || photo.name.toLocaleLowerCase().includes(needle) || tags.some(tag => tag.toLocaleLowerCase().includes(needle)))
        && (!rules.length || (filters.any ? rules.some(rule => matches(photo, rule)) : rules.every(rule => matches(photo, rule))));
    });
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
  const api = Object.freeze({ apply, matches, values, describe, format, FIELDS });
  if (typeof module !== "undefined") module.exports = api;
  else window.HDRLibraryQuery = api;
})();
