const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  // Flatpak packages its source-based backend/runtime later in the manifest;
  // that build and the installed-package CI probe verify ExifTool there.
  if (process.env.HDR_FINISHER_FLATPAK_BUILD === "1") return;
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  const fs = require("node:fs");
  const backend = path.join(resources, "backend");
  const runtime = [path.join(backend, "_internal", "bin", "exiftool-runtime", "bin"), path.join(backend, "bin", "exiftool-runtime", "bin")]
    .find(folder => fs.existsSync(path.join(folder, context.electronPlatformName === "win32" ? "exiftool.exe" : "exiftool")));
  if (!runtime) throw Error("Packaged ExifTool is missing.");
  const windows = context.electronPlatformName === "win32";
  const tool = path.join(runtime, windows ? "exiftool.exe" : "exiftool");
  const version = execFileSync(windows ? tool : "/usr/bin/perl", windows ? ["-ver"] : [tool, "-ver"], {encoding:"utf8"}).trim();
  if (version !== "13.59") throw Error(`Packaged ExifTool did not run: ${version}`);
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // Unsigned Electron bundles can retain an incomplete linker signature that
  // Finder rejects before the application gets a chance to show a window.
  // Apply a complete local signature for technical-preview builds; a release
  // Developer ID identity and notarization can replace this later.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
    stdio: "inherit",
  });
  execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { stdio: "inherit" },
  );
};
