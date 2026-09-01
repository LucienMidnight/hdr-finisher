# HDR Finisher 0.8.7

HDR Finisher 0.8.7 makes **Match entire HDR grade** produce a normal, editable SDR starting point and removes visible Texture halos from thin wires and high-contrast edges. It includes the latest local `main` commit, `c791cb4` ("Materialize editable HDR-to-SDR matches"), plus the subsequent Texture correction.

- Materializes HDR-to-SDR matching into ordinary SDR controls and ordered local adjustments instead of retaining a hidden captured rendering recipe.
- Keeps the matched SDR result independently editable and records whether the conversion matched within tolerance or needs review.
- Preserves deterministic edit history and existing project behavior around matching, conversion, and source-specific state.
- Adds scale-aware edge protection to Texture in CPU preview/export and in global and masked-local WebGPU rendering.
- Prevents the difference-of-blurs Texture band from drawing light or dark outlines around narrow, high-contrast structures while retaining low-amplitude surface texture.
- Adds regression coverage for dark and bright one-pixel wires, surface-detail retention, WebGPU shader compilation, and global/local Detail rendering.

Release automation builds and verifies Windows x64 Setup and Portable executables, macOS Apple Silicon DMG and ZIP packages, Linux x86_64 Debian and Flatpak packages, and SHA-256 checksum manifests before publishing the GitHub release.

This remains a technical-alpha release. Windows artifacts are not code-signed. macOS packages use the project's existing ad-hoc signature and are not notarized, so macOS users may need Finder's one-time **Open** flow. Linux HDR presentation is qualified for the documented Kubuntu 26.04 native-Wayland environment; X11/Xwayland uses an explicit SDR simulation.
