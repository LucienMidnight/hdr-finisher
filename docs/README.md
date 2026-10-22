# HDR Finisher Documentation

This manual is organized by what you are trying to do. You do not need to understand color science before using HDR Finisher, but the technical detail is available when a source, display, or delivery pipeline needs closer control.

HDR Finisher is a full HDR photo editor: a photo Library, camera RAW development, HDR and SDR grading, local adjustments, Denoise, Film Look, Proof, and batch export to gain-map formats. The [project README](../README.md) summarises its capabilities and supported formats.

Pages carry their own verification dates where implementation freshness matters. The [image-processing pipeline technical contract](technical/image-processing-pipeline.md) was last reviewed on **August 25, 2026**; GPU-first rendering for export, Proof and Library pictures (October 18, 2026) is described in [Architecture](technical/architecture.md) and the [Export and Proof module PRD](product/modules/export-and-proof.md). Browser, operating-system, and display behavior can change; dated platform guidance links to first-party sources.

## Choose a path

### I just want an HDR image

1. [Five-minute quick start](getting-started/quick-start.md)
2. [Monitor setup](setup/monitors.md)
3. [Export and delivery](user-guide/export.md)
4. [Troubleshooting](troubleshooting.md)

### I am a photographer

1. [Quick start: from the Library to export](getting-started/quick-start.md)
2. [Photo Library](user-guide/library.md)
3. [Grade HDR](user-guide/grade-hdr.md), then [local adjustments](user-guide/local-adjustments.md), [Denoise](user-guide/denoise.md) and [Film Look](user-guide/film-look.md)
4. [Author the SDR fallback](user-guide/grade-sdr.md)
5. [Proof](user-guide/proof.md) and [export](user-guide/export.md)
6. If you develop in another editor first: [prepare a source from Affinity, Lightroom, Photoshop, darktable, DxO PhotoLab, or an iPhone](workflows/source-preparation.md) and [confirm its interpretation on import](user-guide/import.md)

### I am a 3D artist

1. [Blender OpenEXR handoff](workflows/source-preparation.md#blender-52-lts)
2. [Scene-linear HDR basics](concepts/hdr-basics.md)
3. [Grade HDR](user-guide/grade-hdr.md)
4. [Color-pipeline assumptions](concepts/color-pipeline.md)

### I manage a color or delivery pipeline

1. [Color-pipeline specification](concepts/color-pipeline.md)
2. [Gain maps and output formats](concepts/gain-maps-and-formats.md)
3. [System and monitor setup](setup/monitors.md)
4. [Architecture and data flow](technical/architecture.md)
5. [Image-processing pipeline technical contract](technical/image-processing-pipeline.md)
6. [Implementation traceability](traceability.md)

### I am developing HDR Finisher

1. [Code map](technical/code-map.md): which file to open for a given change
2. [Architecture](technical/architecture.md)
3. [Image-processing pipeline technical contract](technical/image-processing-pipeline.md)
4. [Photo Library: how it works](technical/photo-library.md)
5. [Development guide](technical/development.md)
6. [Documentation maintenance](contributing/documentation.md)

### Where the repository lives

- `codebase/` contains the application, frontend, desktop shell, tests, and build tools. Disposable test and build output goes in its ignored `output/` directory.
- `docs/` is the home for product plans, design work, technical evidence, test strategy, and user documentation.
- `packaging/` contains operating-system packaging definitions; `.github/` contains repository automation.

## User manual

- [Install and run](getting-started/install-and-run.md)
- [Photo Library](user-guide/library.md)
- [Application settings and shortcuts](user-guide/application-settings-and-shortcuts.md)
- [Import and metadata](user-guide/import.md)
- [Projects and schema](user-guide/projects.md)
- [HDR Reference White](user-guide/hdr-reference-white.md)
- [Viewer, scopes, and overlays](user-guide/viewer-and-analysis.md)
- [HDR grading](user-guide/grade-hdr.md)
- [SDR fallback grading](user-guide/grade-sdr.md)
- [Local adjustments and masks](user-guide/local-adjustments.md)
- [Denoise](user-guide/denoise.md)
- [Film Look](user-guide/film-look.md)
- [Grading controls and direct-entry limits](user-guide/grading-controls-reference.md)
- [Typed values reference: every slider and typed range](user-guide/typed-values-reference.md)
- [Chrome Proof](user-guide/proof.md)
- [Export and delivery](user-guide/export.md)

## Setup

- [Windows settings](setup/windows.md)
- [macOS settings](setup/macos.md)
- [Linux and Wayland settings](setup/linux.md)
- [Monitors and viewing environment](setup/monitors.md)

## Concepts

- [HDR without the jargon](concepts/hdr-basics.md)
- [Gain maps and formats](concepts/gain-maps-and-formats.md)
- [Color-pipeline specification](concepts/color-pipeline.md)
- [Glossary](glossary.md)

## Support and project truth

- [Troubleshooting](troubleshooting.md)
- [Photo Library: how it works](technical/photo-library.md) — where ratings, tags and albums are kept, what happens when the app is interrupted, and what each message means
- [Known limitations and support status](known-limitations.md)
- [Master PRD](product/PRD.md) — scope, philosophy, the module map, priorities and what is still to do
- [Module PRDs](product/modules/) — one per part of the app: requirements, decisions, current state, open work
- [Implementation traceability](traceability.md)
- [Archived PRDs and sprint plans](product/archive/README.md) — history, not current status
- [Design work](design/README.md)

## How to read status language

| Label | Meaning |
|---|---|
| **Validated** | Exercised with the named platform, file, browser, or display and recorded in the repository. |
| **Implemented** | Present in code and automated tests, but not necessarily physically checked on every target device. |
| **Expected** | The dependencies should support it, but this repository does not yet contain enough direct evidence. |
| **Unavailable** | The current application deliberately disables it or has no implementation. |

If a page and the application disagree, treat the active application as operational truth and report the documentation mismatch.
