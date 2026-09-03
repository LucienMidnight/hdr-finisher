# HDR Finisher 0.8.7

HDR Finisher 0.8.7 makes **Match entire HDR grade** produce a normal, editable SDR starting point and removes visible Texture halos from thin wires and high-contrast edges. It includes the latest local `main` commit, `c791cb4` ("Materialize editable HDR-to-SDR matches"), plus the subsequent Texture correction.

- Materializes HDR-to-SDR matching into ordinary SDR controls and ordered local adjustments instead of retaining a hidden captured rendering recipe.
- Keeps the matched SDR result independently editable and records whether the conversion matched within tolerance or needs review.
- Preserves deterministic edit history and existing project behavior around matching, conversion, and source-specific state.
- Adds scale-aware edge protection to Texture in CPU preview/export and in global and masked-local WebGPU rendering.
- Prevents the difference-of-blurs Texture band from drawing light or dark outlines around narrow, high-contrast structures while retaining low-amplitude surface texture.
- Adds regression coverage for dark and bright one-pixel wires, surface-detail retention, WebGPU shader compilation, and global/local Detail rendering.
- Keeps Highlight Compression opt-in while making Smooth color rolloff the default Peak Fit color behavior.
- Compresses linear BT.2020 channels independently through the shared monotonic shoulder, reducing abrupt colored highlight transitions without lifting weaker channels; Preserve color and Neutralize peak remain available.
- Replaces the SDR Base Rendition tone-mapper choices and Highlight Recovery slider with the same Highlight Compression design: generated SDR starts with Peak Fit and Smooth color rolloff, while imported authored SDR starts bypassed.
- Keeps generated SDR middle-gray placement fixed at `100/203`, adds SDR percentage-based peak measurement and a display-white endpoint, and mirrors the curve in CPU export and WebGPU preview.
- Preserves the retired SDR renderer for existing projects that predate the rendering-version marker, preventing a silent appearance change when older work is reopened.

Release automation builds and verifies Windows x64 Setup and Portable executables, macOS Apple Silicon DMG and ZIP packages, Linux x86_64 Debian and Flatpak packages, and SHA-256 checksum manifests before publishing the GitHub release.

This remains a technical-alpha release. Windows artifacts are not code-signed. macOS packages use the project's existing ad-hoc signature and are not notarized, so macOS users may need Finder's one-time **Open** flow. Linux HDR presentation is qualified for the documented Kubuntu 26.04 native-Wayland environment; X11/Xwayland uses an explicit SDR simulation.
