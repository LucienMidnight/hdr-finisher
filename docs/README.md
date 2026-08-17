# HDR Finisher Documentation

This manual is organized by what you are trying to do. You do not need to understand color science before using HDR Finisher, but the technical detail is available when a source, display, or delivery pipeline needs closer control.

Documentation reflects the active implementation as of **August 12, 2026**. Browser, operating-system, and display behavior can change; dated platform guidance links to first-party sources.

## Choose a path

### I just want an HDR image

1. [Five-minute quick start](getting-started/quick-start.md)
2. [Monitor setup](setup/monitors.md)
3. [Export and delivery](user-guide/export.md)
4. [Troubleshooting](troubleshooting.md)

### I am a photographer

1. [Prepare a source from Affinity, Lightroom, Photoshop, darktable, DxO PhotoLab, or an iPhone](workflows/source-preparation.md)
2. [Import and confirm source interpretation](user-guide/import.md)
3. [Grade HDR](user-guide/grade-hdr.md)
4. [Author the SDR fallback](user-guide/grade-sdr.md)
5. [Proof and export](user-guide/proof.md)

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
5. [Implementation traceability](traceability.md)

### I am developing HDR Finisher

1. [Architecture](technical/architecture.md)
2. [Development guide](technical/development.md)
3. [Testing and validation](testing/README.md)
4. [Documentation maintenance](contributing/documentation.md)

## User manual

- [Install and run](getting-started/install-and-run.md)
- [Import and metadata](user-guide/import.md)
- [Viewer, scopes, and overlays](user-guide/viewer-and-analysis.md)
- [HDR grading](user-guide/grade-hdr.md)
- [SDR fallback grading](user-guide/grade-sdr.md)
- [Grading controls and direct-entry limits](user-guide/grading-controls-reference.md)
- [Chrome Proof](user-guide/proof.md)
- [Export and delivery](user-guide/export.md)

## Setup

- [Windows settings](setup/windows.md)
- [macOS settings](setup/macos.md)
- [Monitors and viewing environment](setup/monitors.md)

## Concepts

- [HDR without the jargon](concepts/hdr-basics.md)
- [Gain maps and formats](concepts/gain-maps-and-formats.md)
- [Color-pipeline specification](concepts/color-pipeline.md)
- [Glossary](glossary.md)

## Support and project truth

- [Troubleshooting](troubleshooting.md)
- [Known limitations and support status](known-limitations.md)
- [Implementation traceability](traceability.md)
- [Product requirements](product/HDR_Finisher_PRD_v1.2.md) — historical intent and planning, not the user manual
- [Interactive preview and scopes performance sprint](product/Interactive_Preview_and_Scopes_Performance_Sprint_PRD.md) — implementation plan, performance budgets, and acceptance gates
- [Design work](design/README.md)
- [Testing and validation](testing/README.md)

## How to read status language

| Label | Meaning |
|---|---|
| **Validated** | Exercised with the named platform, file, browser, or display and recorded in the repository. |
| **Implemented** | Present in code and automated tests, but not necessarily physically checked on every target device. |
| **Expected** | The dependencies should support it, but this repository does not yet contain enough direct evidence. |
| **Unavailable** | The current application deliberately disables it or has no implementation. |

If a page and the application disagree, treat the active application as operational truth and report the documentation mismatch.
