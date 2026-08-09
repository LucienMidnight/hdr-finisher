# Documentation Maintenance

The manual serves beginners, working artists, color-pipeline users, and developers. Keep those audiences on the same page by layering detail instead of creating contradictory “simple” and “technical” explanations.

## Page pattern

For a feature or module, prefer this order:

1. What it is for
2. Recommended starting approach
3. Control-by-control behavior
4. What to watch for
5. Under the hood
6. How to validate

Plain-language sections must remain accurate. Avoid metaphors that imply incorrect math, such as calling all values above a display peak “clipped.”

## Status language

Use the definitions in the documentation index:

- **Validated:** direct, recorded evidence on the named target
- **Implemented:** present and tested in code
- **Expected:** reasonable but not directly evidenced
- **Unavailable:** no current path

Always name the relevant application/browser/OS/display version for a time-sensitive result.

## Technical claims

For current application behavior, cite code and tests through [Traceability](../traceability.md). For external color, OS, display, browser, or format behavior:

- Prefer standards bodies, platform vendors, upstream projects, and official documentation.
- Add a verification date to platform pages.
- Avoid treating a vendor marketing peak as measured sustained output.
- Distinguish a standard’s requirement from what HDR Finisher validates.
- Do not call an output “certified” unless an actual certification process exists and passed.

## UI changes

When a control is added, renamed, moved, or removed, update:

- Its module guide
- Quick Start if the main workflow changes
- Traceability
- Troubleshooting and limitations when relevant
- Screenshots only after the UI and labels settle
- Frontend contract tests

Search the entire documentation tree for the old label. Historical design/validation records may retain old terminology when their date/context makes that useful.

## Color-pipeline changes

Update [Color Pipeline](../concepts/color-pipeline.md) in the same change as any modification to:

- Internal color space or reference white
- Source detection or normalization
- Transfer functions or HLG assumptions
- Adjustment order/formulas
- Gamut conversion/compression
- Preview CICP or YUV signaling
- Gain-map metadata/reconstruction
- Encoder reference scaling

Add numerical examples/tests. Do not rely on a screenshot to document a transform.

## Screenshots and diagrams

- Store intentionally curated design/documentation images under `docs/design/` or a dedicated documented asset directory.
- Keep generated browser-run evidence under ignored `codebase/output/` unless promoted into a durable document.
- Crop screenshots to the relevant area and include alt text.
- Prefer diagrams for stable data flow; avoid screenshots that become obsolete after a minor layout change.
- Record the application commit/date when a screenshot demonstrates behavior.

## Links and paths

- Use relative links inside repository Markdown.
- Link directly to the relevant first-party page, not a search result.
- Check every relative link before merging.
- Keep commands rooted explicitly at `ai/` or `codebase/` so readers know their working directory.

## Preserve validation history

Do not rewrite dated testing evidence merely because the current UI changed. Add a note, superseding record, or new dated result. User-guide pages should describe current behavior; validation logs should preserve what was observed at the time.

## Review personas

Before calling a documentation release complete, walk these paths:

- Photographer: Affinity/iPhone source to JPEG Ultra HDR
- 3D artist: Blender EXR to AVIF gain map
- SDR-display user: scopes, fallback, fixed-headroom proof, external acceptance
- Limited-HDR user: 400/500-nit proof and monitor caveats
- Color engineer: reconstruct all space/transfer/reference assumptions
- Developer: locate model, function, test, and manual section for a control

If any path requires guessing, the manual is incomplete even if every code module has a paragraph.
