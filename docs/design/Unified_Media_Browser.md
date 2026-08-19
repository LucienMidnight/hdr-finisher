# Unified Media Browser

## Intent

Use one in-app browser for source selection and export-folder selection. It extends the existing
export browser's panel, border, typography, spacing, button, and status language rather than adding a
second visual system.

## Layout and behavior

- The left rail contains platform places and locally pinned favorites. Unavailable favorites remain
  visible so users can understand and remove stale paths.
- The center list shows directories first, then files. In source mode only supported images are
  selectable; in export mode files remain visible as destination context.
- The right pane shows an SDR thumbnail and selected-file details. The grid/list thumbnail remains
  SDR by design; the normal editor preview becomes the authoritative HDR preview after opening.
- Single-click selects, double-click opens a folder or selected source, Enter confirms, and Escape
  closes. The primary action reads **Open image** or **Select this folder** according to mode.
- Export selection chooses the containing folder only. The native Save dialog still owns the final
  filename, overwrite approval, and desktop path grant.

## Responsiveness

Thumbnails are requested lazily, cached by path/size/mtime, and generated at 256–512 px. RAW files
prefer embedded previews. Opening a source creates a staged job that immediately reports a real phase,
updates elapsed time every 250 ms, exposes a quick preview when available, and continues authoritative
full-resolution development in a two-worker pool.

## Lens development controls

RAW/DNG sessions expose Off, Auto, and Manual Lensfun choices. Auto accepts only one unambiguous
camera/lens match; Manual presents searchable named database profiles. Distortion, lateral chromatic
aberration, and vignetting remain separately editable. Re-development is explicit and saved project
data keeps the chosen profile identifier and optical overrides.
