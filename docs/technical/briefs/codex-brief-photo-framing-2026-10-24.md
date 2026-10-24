# Codex brief: photo framing

**Date:** October 24, 2026
**Status:** DRAFT. Requested behavior is recorded; remaining product choices
below need discussion with Steve before the UI and output behavior are finalized.
This turn imports the reusable geometry and tests only; it does not implement
the controls or alter current photo pixels.
**Owner PRD:** [Export and Proof, photo framing](../../product/modules/export-and-proof.md#8-photo-framing--requirements-recorded-october-24-2026).
**Other affected surfaces:** Grade and Library. Keep their module PRDs linked
to the owner, rather than creating another framing PRD.
**Working rules:** Read `AGENTS.md` first. Inspect the current branch and dirty
files. Commit locally in small steps; ask before pushing. No installer build.
Do not disturb unrelated work or restore files to remove someone else's edits.

## Intended result

A photo can have two solid rectangular layers around it. From inside outward:
**photo → Frame → Border**. Both Frame and Border have their own color picker
and thickness control. The complete assembly moves and scales with the image.
The viewer surround remains a separate display preference.

In Grade, rename the current **Frame** toolbar button to **Background** and
retain its existing viewer-surround controls. Add a new **Frame** button in the
same toolbar style for the new image-attached controls. Do not confuse these
with crop handles, the compare layout's “Single frame”, or Film Look's capture
geometry named Frame; those are separate concepts.

Export has an **Export with frame** toggle. With it enabled, both layers appear
in the file, and the chosen export size includes the photo, Frame and Border.
With it disabled, export remains unframed. Where practical, show the authored
frame in Library's single-image view and Export's single-image view. The latter
reuses the Grade preview stage, while its grid uses Library tile drawing.
Proof must inspect the actual chosen output.

## Decisions Steve has made

- Independent Frame color/thickness and Border color/thickness.
- Offer both percentage (%) and pixel (px) thickness units for each layer
  (Steve confirmed October 24). Switching units should convert the displayed
  value without changing the current visible width, apart from pixel rounding.
- Thickness reference and scaling (Steve approved October 24, initially to try):
  both layers use the cropped photo as their reference. Percentage is measured
  against its shorter side; px means cropped source pixels. Both scale with
  the photo at export, preserving proportions across output sizes. Switching
  units preserves visible width, apart from pixel rounding. Make the source-pixel
  meaning explicit in Grade and Export. This rule can be revised after use.
- Storage (Steve approved October 24): save one framing record per photo in
  the edit document, shared by HDR and SDR, with project/sidecar persistence
  and undo/redo. Each preset output version independently stores whether to
  include that photo's frame; it does not copy the colors or widths. Changing
  the photo's frame affects every output version that includes it.
- Layer order is photo → Frame → Border (explicit reply, October 24).
- Rename existing Frame to Background; the new Frame control lives in Grade.
- Framing is attached to the photo and follows pan/zoom.
- Export with frame is a simple inclusion toggle.
- Export size includes the Frame and Border (explicit reply, October 24).
  A 2048-pixel long-edge export must fit the complete assembly within 2048 px.
- Include framing in Library and Export single-photo modes if this fits without
  a substantial viewer redesign.
- Credit Pedro C. Silva publicly and retain BorderMuse's proper license notice.
- SVG may be used for inexpensive viewer composition if it behaves correctly.

## Draft recommendations to discuss

These are proposals, not approved requirements. Settle them one at a time with
Steve; do not silently adopt BorderMuse's controls as product decisions.

1. **Defaults:** framing initially off for existing/default photos; propose a
   white Frame with a narrow dark Border when first enabled. Exact widths and
   the default state of Export with frame still need choosing.
2. **Outer ratio:** no ratio selector was requested. Suggest initially following
   the photo plus the two equal-width layers. Add target canvas ratios only if
   Steve wants that; they introduce unequal mat widths and a sizing policy.

No ornamental artwork, rounded corners, shadow baked into export, watermark,
caption, physical print units, grid/thumbnail decoration, per-side widths or
asymmetrical mats are requested in this brief.

## Imported foundation and attribution

Vendored unchanged:

- `codebase/backend/hdr_finisher/vendor/bordermuse/reference.py`
- Upstream `geometry/conformance-v1.json`, now at
  `codebase/tests/fixtures/bordermuse/conformance-v1.json`.
- Original MIT license in the vendor directory and
  `codebase/bin/licenses/bordermuse-MIT.txt`.

`codebase/tests/test_bordermuse_geometry.py` adapts only the upstream test import,
fixture location and attribution header. Source revision:
`83abc8e6594529867c044dabd350ddbe26b6fa59` from
[Pedro C. Silva's BorderMuse](https://github.com/pedrocsilva/bordermuse).
Copyright (c) 2026 Pedro C. Silva. Public credit is in root `README.md` and
`THIRD_PARTY_NOTICES.md`; preserve those and the complete permission/warranty
notice. The two PyInstaller specifications already include the `bin` license
files. Verify packaging still carries the notice when integrating the core;
do not build an installer just to do so.

The imported geometry computes a single centered canvas, using exact integer
arithmetic and symmetric margins. Its 20 measured iOS Lightroom examples are
retained as evidence, not regenerated from the implementation. Original mode
and other unmeasured behavior are not universal Lightroom guarantees.

Our two-layer geometry is an HDRF extension. Keep it in a host-owned module;
do not change the vendored formula to force it into new semantics. Reuse the
core where its canvas/ratio contract applies; ordinary fixed-width nested
rectangles may need a much smaller host-owned calculation. Do not add a runtime
call to the vendor merely to claim reuse if that changes the approved controls.
No Apple renderer, Swift app, CLI dependency or artwork is imported.

## Source map for a clean implementation chat

- `frontend/index.html`, `application-shell.js`, `styles.css`: existing
  `frame-toggle`, `frame-popover` and viewer-frame preference. Rename displayed
  language and accessibility text to Background; internal renaming is optional.
- `frontend/zoom-navigation.js`, `preview-pipeline.js` and the Grade preview
  stage: image fit, transforms, zoom/ROI, crop and rendering ownership.
- `frontend/library-scenes.js`, `library-zoom.js`, `library-editor.js`,
  `photo-library.js`, `library-live-tiles.js`: Library single-photo rendering
  and image-coordinate navigation. Trace actual presentation before editing.
- `frontend/batch-export.js`, `workspace-layout.js`, `styles.css`: Export's
  `view(false)` makes the batch panel transparent over the shared Grade stage;
  `view(true)` hides the workspace and shows the grid. The grid's `startTile`
  calls the Library iframe's `HDRLibraryLiveTiles.draw`; that service is not
  Export's single-image viewer. Apply the current version's inclusion setting
  to the shared stage without overwriting saved photo framing or preferences.
- `backend/hdr_finisher/models.py`, `sessions.py`, `projects.py`, edit command
  handlers, `library_grades.py`, and frontend saving/history: persistence,
  undo/redo, dirty state, virtual copies and saved-vs-unsaved ownership.
- `models.py`, `export_presets.py`, `frontend/export-ui.js`, `batch-export.js`:
  per-version Export with frame, request plumbing and preset round trips.
- `finishing.py`, `gpu_delivery.py`, `frontend/gpu-delivery.js`, shared GPU
  finishing, `exporters.py`: output sizing and matched HDR/SDR composition.
- `proofing.py`: request identity, dimensions, encoded artifact and cache reuse.

Paths in this map are relative to `codebase/`. Inspect current code; this map
is orientation, not a promise that one file owns an entire feature.

## Implementation sequence

### 1. Define geometry and persist the authored settings

Resolve the draft choices, then specify one geometry contract for source photo
rect, Frame rect, outer Border rect and final canvas dimensions. Use explicit
integer rounding. Define behavior for tiny dimensions, zero widths, odd sizes,
portrait/landscape and very thick frames. Derive preview from the export layout
and scale it; do not round anew at thumbnail size. Verify the chosen final size
includes framing. Keep enlargement policy meaningful for photo pixels.

Add the shared photo framing to the edit document, session serialization,
saving/reopen, virtual-copy isolation, history grouping and dirty identity.
Frame changes are authored edits; Background changes are preferences. Do not
make frame edits invalidate expensive RAW development or creative pixels when
only composition changed. No legacy migrations before 1.0, per AGENTS.md.

### 2. Grade controls and attached display

Add Frame popover controls using existing UI tokens and keyboard/focus behavior.
Each layer offers % and px thickness entry. Convert values on unit changes
rather than reinterpreting the same number; persist the authored unit/value
without cumulative rounding drift. Keep each picker and thickness field
explicitly labeled; support validation,
slider/numeric entry and grouped undo. Turning a layer off must not destroy its
chosen color/width. Do not leak framing settings when switching photos.

Prefer SVG filled rectangles or an equivalent lightweight layer underneath the
existing HDR photo surface. It must share the photo's pan/zoom transform and
clip consistently without flattening the HDR image into an SDR intermediate.
An SVG still gets composited by the browser; its advantage is avoiding repeated
photo rendering and cached frame bitmaps, not eliminating all rendering work.

Fit shows the entire framed assembly. At 100%, one photo pixel retains the
existing pixel mapping; a frame must not redefine “100%”. Keep pointer-anchored
zoom, panning limits, HiDPI, resizing and side-by-side lanes coherent. Scopes,
crop, masks, retouch and pickers operate on photo coordinates; clicks on mat
pixels must not be treated as image samples. Crop editing may temporarily hide
framing, but must restore it without altering the saved values.

### 3. Library and Export single-photo display

Reuse the attached-display helper in Grade's stage (also used by Export's
single-image mode) and Library's own single-photo viewer. Pass saved framing
metadata separately from the source/creative image where possible. Do not bake
it into cached photo pixels and then draw it a second time. Library shows the
saved photo framing; Export shows the selected version's Export with frame
state. Respect existing last-saved-grade behavior and unsaved-change notices.

Do not take on grid tiles, filmstrip decoration, compare redesign or a full
Library cache rewrite to satisfy this request. If the shared single-photo path
has a material blocker, document it in the owning PRD and explain the concrete
cost to Steve rather than expanding scope invisibly.

### 4. Actual export and Proof

Resolve final size from the complete framed canvas, then resize/sharpen the photo
for its content rectangle. Compose Frame/Border after creative processing and
photo sharpening so grain, bloom and sharpening cannot dirty the flat layers.
Retain the existing highlight limiter/ceiling behavior. Use GPU first and a
small equivalent CPU fallback. Never post-process an already encoded gain-map
JPEG/AVIF by adding pixels only to its SDR base.

Both HDR and SDR lanes must have identical placement/dimensions before encoding.
Convert picker colors into their correct working representations. Frame white
means reference/display white, not HDR peak; never copy numeric SVG sRGB colors
directly into scene-linear ACEScg. Verify color appearance across the actual
browser HDR surface and encoded Proof. Do not change gain-map maths or encoders
without the permission required by the existing module decisions.

Add all framing inputs and inclusion state to the correct finished-pair,
Proof and output cache identities. If reusing unframed creative/photo pixels,
cache the composition separately. Keep export versions from reusing a framed
pair with different colors or widths. Include canvas growth in memory planning,
GPU texture/encoder limits, tiling and cancellation. Small targets must never
create negative or zero photo dimensions or silently exceed requested bounds.

Export with frame off must preserve existing output behavior. With it on, all
supported HDR and SDR formats need the same geometry. Check the high-contrast
photo/Frame/Border boundaries through gain-map downsampling, existing denoise,
compression and the Ultra HDR near-black floor. Proof must encode/inspect the
same framed selection, with correct reduced/full sizing and no stale cache.

## Validation scaled to each step

Follow AGENTS.md: Node and `.venv` Python fast suites for changes. No GPU checks
are applicable to the isolated import/documentation step. For UI/render changes,
choose the focused interaction and image checks for the touched paths; export
and Proof require every applicable check for their affected output paths. If
slow validation will exceed roughly 30 minutes, explain scope and estimate to
Steve before running it. No broad sweep, installer or release check for drafting.

Tests should exercise behavior:

- Preserve all upstream measured conformance cases and exact-margin tests.
- Host geometry: %/px conversion and repeated unit switches without width drift,
  zero/one/two layers, colors independent, odd/tiny/extreme sizes,
  portrait/landscape, round trip and final-size limits. Integer geometry can be
  exact; perceptual tolerances apply to color/image output.
- Real controls: Background still works; Frame color/width changes persist;
  keyboard, undo/redo, reopen, photo switching and virtual copies behave.
- Fit/100%/wheel/pan/HiDPI: both layers remain attached, photo sampling/crop
  positions stay correct, and changing colors does not rerender the creative
  graph. Test compare paths affected by shared transforms.
- Library and Export single-image states, current-version switching, framed vs
  unframed export, per-version preset save/reopen and multi-version batch.
- Both lane rectangles, expected flat colors, unchanged photo interiors where
  applicable, CPU/GPU fallback, Proof/export, decoded dimensions and HDR peaks.
  Existing perceptual limits remain mean <1 and p99.9 <=3 with the repository's
  lane-specific metrics; no tolerance is relaxed. Existing ceiling rules remain.

Add any new Electron driver to `tests/release/drivers.json`; run GPU drivers
serially through the normal runner at 2560×1440. Use synthetic fixtures and never
write over read-only test projects. Add screenshot/UI review for the frame
assembly, since passing geometry tests does not prove an attached zooming UI.

## Completion and handoff

Keep each coherent part in a reversible local commit. A clean chat should read
this brief and the owner PRD, check decisions, inspect the current tree, and
continue at the first unbuilt stage. Do not spawn chats or push automatically.
Record what actually shipped, tests run, failures/limits and attribution in the
module PRD. Mark built only once committed. When the whole feature is complete,
move this brief to `docs/technical/archive/briefs/` and update its links.
