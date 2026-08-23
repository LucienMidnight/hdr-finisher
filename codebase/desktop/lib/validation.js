const path = require("node:path");

const SOURCE_EXTENSIONS = new Set([
  ".exr", ".tif", ".tiff", ".hdr", ".pfm", ".heic", ".heif",
  ".avif", ".jxl", ".png", ".jpg", ".jpeg", ".dng", ".arw", ".cr2",
  ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw",
]);
const EXPORT_EXTENSIONS = new Set([".avif", ".jpg", ".jpeg", ".png", ".jxl"]);
const DOCUMENTATION_HOSTS = new Set([
  "chromium.googlesource.com", "developer.android.com", "displayhdr.org", "docs.blender.org",
  "docs.darktable.org", "github.com", "helpx.adobe.com", "learn.microsoft.com", "openexr.com",
  "support.apple.com", "support.microsoft.com", "www.itu.int", "webkit.org",
]);

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
  const normalized = (typeof value === "string" ? value : "").replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
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

function pathKey(value, platform = process.platform) {
  const resolved = path.resolve(String(value || ""));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function allowedProjectUrl(value) {
  try {
    const candidate = new URL(value);
    const pathname = candidate.pathname.toLowerCase().replace(/\/+$/, "");
    return candidate.protocol === "https:"
      && candidate.hostname.toLowerCase() === "github.com"
      && (pathname === "/lucienmidnight/hdr-finisher" || pathname.startsWith("/lucienmidnight/hdr-finisher/"));
  } catch {
    return false;
  }
}

function allowedDocumentationUrl(value) {
  try {
    const candidate = new URL(value);
    return candidate.protocol === "https:" && DOCUMENTATION_HOSTS.has(candidate.hostname.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = {
  EXPORT_EXTENSIONS,
  SOURCE_EXTENSIONS,
  allowedDocumentationUrl,
  allowedProjectUrl,
  allowedProofUrl,
  isExportPath,
  isProjectPath,
  isSourcePath,
  pathKey,
  safeSuggestedName,
};
