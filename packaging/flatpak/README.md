# HDR Finisher Flatpak

The checked-in manifest builds the current working tree for CI and local validation. It uses Freedesktop 25.08, Electron2.BaseApp, Zypak, a bundled CPython 3.12 interpreter, pinned native encoders, and committed offline npm/Python source manifests.

Build and install locally:

```bash
flatpak-builder --force-clean --user --install build-flatpak io.github.LucienMidnight.hdr-finisher.yml
flatpak run io.github.LucienMidnight.hdr-finisher
```

The sandbox intentionally has Wayland/fallback-X11, DRI, IPC, and network access, with no `home` or `host` filesystem grant. Electron file dialogs use XDG portals. Projects opened by a document portal may require relinking if their document grant is unavailable after moving between the Flatpak and `.deb` builds.

Before submitting to Flathub, copy this manifest and metadata into the Flathub repository, replace the local `type: dir` application source with the signed `v0.8.5` archive plus SHA-256, and validate with `flatpak-builder-lint manifest` and `flatpak-builder-lint repo`. `generate-sources.sh` reproduces the offline dependency manifests; run it with Python 3.12 and the official `flatpak-builder-tools` generators.
