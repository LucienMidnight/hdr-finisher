# Local adjustments

Local adjustments are an ordered stage between global color grading and post-local finishing. Film Look, vignette, and final grain therefore retain their existing order, including the grain-last contract.

## State contract

`EditDocument` is the versioned public document. It contains the source reference and SHA-256 fingerprint, source-interpretation override, global `AdjustmentState`, and up to 256 ordered `LocalAdjustment` records. Every local record owns a stable UUID, name, bypass and opacity state, one shared recursive `MaskExpression`, and independent HDR and SDR `LocalGrade` payloads.

Mask leaves use normalized coordinates in the uncropped source. Supported shipping leaves are brush strokes, linear gradients, four-handle scene-EV luminance ranges, and closed paths with sharp or smooth Bezier nodes. Sampled point and sampled gradient records are serializable, but evaluate to an empty mask unless `HDR_FINISHER_ENABLE_SAMPLED_MASKS=1`; release builds must keep that flag off until the documented IP review is complete.

Mask algebra is deliberately soft:

- Union: `max(a, b)`
- Intersection: `a * b`
- Subtraction: `a * (1 - b)`
- Inversion: `1 - a`
- Final influence: `clamp(mask * opacity)`

Content-dependent masks always inspect the fixed geometry-transformed ACEScg source. Local grades and local ordering cannot move selection boundaries. Scene luminance is `log2(Y / 0.18)` using AP1 luminance weights.

## Synchronization and history

The session exposes `GET/PUT /api/session/{id}/edit-state` and `POST /api/session/{id}/edit-commands`. Commands carry an expected revision. A mismatch returns HTTP 409 with both expected and current revisions; preview, scope, proof, and export requests can also require an exact `edit_revision`.

The history stores forward and inverse commands, not image snapshots. It retains at most 100 entries or 64 MiB, clears redo after divergent edits, and coalesces browser slider gestures at change/settle boundaries.

## Rendering and caches

CPU preview and export share the pre-local/local/post-local ordering. The local stage processes 512 by 512 float tiles and reuses the destination tile; export does not allocate one full-resolution mask or image per layer. Preview masks compile to byte masks and live in a separate LRU: 96 MiB through a 1600-pixel proxy and 160 MiB above that. A grade-only change reuses the compiled mask, while geometry or mask signatures naturally compile a new entry. Full adjusted frames remain inside the existing bounded frame cache.

WebGPU uploads compiled masks as budgeted `r8unorm` textures and applies supported pixel-local grades between the global base pass and Film Look using reusable RGBA16F ping-pong surfaces. A mask-signature LRU avoids uploading grade-only changes. Curves or grading-wheel combinations that the local shader does not yet cover fall back to the authoritative CPU renderer. Packing mask textures into arrays and batching eight locals per shader pass is the remaining performance phase before the 16/32/64-layer targets can be signed off.

## Project files

`.hdrfinisher` files are atomically replaced ZIP containers with a manifest and compressed JSON edit document. They contain no source pixels. The first save of an uploaded temporary source requires the durable original path and verifies its SHA-256 fingerprint. Open validates the fingerprint and enters an explicit relink flow when the stored path is missing or changed. Projects never restore automatically at launch.
