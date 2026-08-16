const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([
  ".exr", ".tif", ".tiff", ".hdr", ".pfm", ".heic", ".heif",
  ".avif", ".png", ".jpg", ".jpeg",
]);
const EXPORT_EXTENSIONS = new Set([".avif", ".jpg", ".jpeg", ".png", ".jxl"]);

function isProjectPath(value) {
  return typeof value === "string" && path.extname(value).toLowerCase() === ".hdrfinisher";
}

function isSourcePath(value) {
  return typeof value === "string" && SOURCE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function isExportPath(value) {
  return typeof value === "string" && EXPORT_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function safeSuggestedName(value, fallback) {
  const base = path.basename(typeof value === "string" ? value : "");
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned || fallback;
}

function allowedProofUrl(value, backendOrigin) {
  try {
    const candidate = new URL(value);
    return candidate.origin === backendOrigin && candidate.pathname.startsWith("/proof/");
  } catch {
    return false;
  }
}

module.exports = {
  EXPORT_EXTENSIONS,
  SOURCE_EXTENSIONS,
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  safeSuggestedName,
};
