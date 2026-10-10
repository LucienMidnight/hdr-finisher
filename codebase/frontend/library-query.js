/* Pure sort/filter rules shared by the Library and its fast checks. */
(() => {
  const rawTypes = new Set(["3FR", "ARW", "CR2", "CR3", "DNG", "ERF", "FFF", "IIQ", "KDC", "MEF", "MOS", "MRW", "NEF", "NRW", "ORF", "ORI", "PEF", "RAF", "RAW", "RW2", "RWL", "SRW", "X3F"]);
  const compareText = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  function apply(photos, sort = "time", descending = false, filters = {}) {
    const needle = (filters.search || "").trim().toLocaleLowerCase();
    const result = photos.filter(photo => {
      const marks = photo.marks || {}, tags = marks.tags || [];
      return (!filters.raw || rawTypes.has(photo.type)) && (!filters.type || photo.type === filters.type)
        && (!filters.rating || (marks.rating || 0) >= Number(filters.rating))
        && (!filters.pick || (filters.pick === "hide-rejected" ? marks.pick !== "reject" : (marks.pick || "unmarked") === filters.pick))
        && (!filters.label || marks.label === filters.label)
        && (!needle || photo.name.toLocaleLowerCase().includes(needle) || tags.some(tag => tag.toLocaleLowerCase().includes(needle)));
    });
    const picks = { pick: 0, unmarked: 1, reject: 2 };
    return result.sort((a, b) => {
      let order = 0;
      if (sort === "time") {
        // Unknown dates remain last in either direction. Before facts arrive, name wins.
        if (!!a.capture_time !== !!b.capture_time) return a.capture_time ? -1 : 1;
        order = compareText(a.capture_time || "", b.capture_time || "");
      } else if (sort === "rating") order = (a.marks?.rating || 0) - (b.marks?.rating || 0);
      else if (sort === "pick") order = picks[a.marks?.pick || "unmarked"] - picks[b.marks?.pick || "unmarked"];
      else if (sort === "type") order = compareText(a.type, b.type);
      else order = compareText(a.name, b.name);
      return (descending ? -1 : 1) * (order || compareText(a.name, b.name) || compareText(a.path, b.path));
    });
  }
  const api = Object.freeze({ apply });
  if (typeof module !== "undefined") module.exports = api;
  else window.HDRLibraryQuery = api;
})();
