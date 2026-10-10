/* Pure wording for the Details panel. A fact the file does not record is never guessed. */
(() => {
  const query = typeof module !== "undefined" ? require("./library-query.js") : window.HDRLibraryQuery;
  const NONE = "Not recorded";
  const megabytes = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const when = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };
  // Facts arrive a little after the folder listing; until then say so.
  const pending = photo => !photo.indexed && photo.camera === undefined;
  function reader(photo) {
    const waiting = pending(photo);
    return (name, missing = NONE) => {
      const value = photo[name];
      if (value == null || value === "") return waiting ? "Reading…" : missing;
      return query.format[name] ? query.format[name](value) : String(value);
    };
  }
  function summary(photo) {
    const fact = reader(photo);
    return [["Camera", fact("camera")], ["Lens", fact("lens", "Unknown")], ["Focal length", fact("focal_length")],
      ["Aperture", fact("aperture")], ["Shutter", fact("shutter")], ["ISO", fact("iso")]];
  }
  function headline(photo) {
    const captured = photo.capture_time ? when(photo.capture_time) : null;
    return [photo.type, megabytes(photo.bytes), ...(captured ? [captured] : [])].join(" · ");
  }
  function groups(photo) {
    const fact = reader(photo), waiting = pending(photo);
    const captured = photo.capture_time ? when(photo.capture_time) : waiting ? "Reading…" : NONE;
    const separator = Math.max(photo.path.lastIndexOf("\\"), photo.path.lastIndexOf("/"));
    const settings = photo.storage === "sidecar" ? "Beside the photo" : photo.storage === "database" ? "Kept in the library only; this folder cannot be written" : "None yet";
    const bias = photo.exposure_bias == null ? (waiting ? "Reading…" : NONE) : `${photo.exposure_bias > 0 ? "+" : ""}${Number(photo.exposure_bias.toFixed(2))} EV`;
    const place = photo.latitude == null ? (waiting ? "Reading…" : NONE) : `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`;
    return [
      ["File", [["Name", photo.name], ["File type", photo.type], ["Size", megabytes(photo.bytes)],
        ...(photo.width && photo.height ? [["Dimensions", `${photo.width} × ${photo.height}`]] : []),
        ["Modified", when(photo.mtime_ns / 1e6) || NONE], ["Folder", separator > 0 ? photo.path.slice(0, separator) : photo.path], ["Settings file", settings]]],
      ["Camera", [["Maker", fact("camera_make")], ["Camera", fact("camera")], ["Captured", captured], ["Software", fact("software")]]],
      ["Lens", [["Lens", fact("lens", "Unknown")], ["Lens maker", fact("lens_make")], ["Focal length", fact("focal_length")],
        ["35 mm equivalent", photo.focal_length_35 ? `${photo.focal_length_35} mm` : waiting ? "Reading…" : NONE]]],
      ["Exposure", [["Shutter", fact("shutter")], ["Aperture", fact("aperture")], ["ISO", fact("iso")], ["Compensation", bias],
        ["Program", fact("exposure_program")], ["Metering", fact("metering")], ["Flash", fact("flash")]]],
      ["Location", [["Coordinates", place]]],
      ["Written by the camera", [["Creator", fact("artist")], ["Copyright", fact("copyright")]]],
    ];
  }
  const api = Object.freeze({ summary, groups, headline });
  if (typeof module !== "undefined") module.exports = api;
  else window.HDRLibraryFacts = api;
})();
