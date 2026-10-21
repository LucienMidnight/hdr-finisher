# HDR Finisher: Master PRD

- **Owner:** Steve
- **Status:** Living document. Created October 18, 2026, replacing
  `HDR_Finisher_PRD_v1.2.md` and the sprint PRDs. Those are kept, unchanged,
  in [archive](archive/README.md).
- **Last status check:** October 18, 2026, against the code on
  `film-look-rebuild`. A read-only audit compared every PRD with the code.

This page describes what HDR Finisher is, the ideas that shape it, and how
it is divided into modules. Each module has its own PRD, which holds that
module's requirements, decisions, current state and open work. The code is
organised the same way, so that no single document or file grows into a
monolith again.

---

## 1. What HDR Finisher is

HDR Finisher is a free, open-source, offline desktop photo editor for
Windows, macOS and Linux. Its focus is HDR photographs for the web. It
takes a photo from the camera RAW (or a finished HDR file from another
editor), grades it while showing true HDR on an HDR display, and delivers
two authored renditions in one file: an HDR picture and an SDR fallback,
joined by a gain map (Ultra HDR JPEG, AVIF, JPEG XL).

It began in August 2026 as a finishing-only utility, the last step after
another editor. Since then it has grown into a full editor: camera RAW
development, local adjustments, Denoise, Film Look and a photo Library
with culling, albums, copy and paste of grades, and batch export. The
name stays.

**Who it is for:** photographers, and CGI artists who render scene-linear
EXR, who want HDR pictures on the web without an Adobe subscription. They
know photo editing; they are not programmers.

**Where it stands:** before 1.0, with no outside users. Version 0.9.1 is
tagged (October 17, 2026). Steve is the only tester.

## 2. Philosophy

These ideas apply to every module. A module PRD may add its own, but it
may not contradict these.

1. **HDR first, and rigour where HDR matters.** Peak and highlight handling
   keep the tightest limits. The one exact image rule is that a finished
   HDR pixel never exceeds the highlight compression target (rounding
   down: 990 nits passes a 1000-nit target, 1010 fails).
2. **Two authored renditions.** HDR and SDR are graded as independent,
   equally good pictures of the same photo. The SDR side is never just a
   by-product. HDR should win with brightness and range, not with stronger
   colour.
3. **GPU first, CPU as the fallback** (Steve, October 18, 2026). Preview,
   export, Proof and Library pictures should all run on the graphics card,
   as darktable does. The CPU path keeps working, for machines without a
   usable GPU, but it is not made faster.
4. **Judged by eye, within agreed tolerances.** Image differences are
   measured perceptually (ΔE 2000 for SDR, ΔE ITP for HDR): an average below
   the just-noticeable level plus a high-percentile limit, with no
   per-pixel maximum. A tolerance is agreed once, then work stays inside it
   without asking again.
5. **Non-destructive, and the grade lives beside the photo.** Originals are
   never changed. A sidecar beside each photo holds its grade. The Library
   database is an index that can be rebuilt.
6. **Nothing is silently lost or overwritten.** Bulk changes keep the
   previous state. Clashes stop and ask.
7. **Generic, not tuned to one camera.** The same method works for every
   camera and every supported format.
8. **Physically motivated looks.** Film Look follows the physical order
   that light travels through film. Its data comes from manufacturer data
   sheets, labelled as estimates where it doesn't.
9. **Minimal, keyboard first, responsive.** Controls appear when relevant.
   Background work gives way to grading. Whether the app feels fast is
   judged first by Steve using it.
10. **Pre-1.0: no compatibility code.** There is no migration code for old
    projects or preferences. When a feature changes, the affected projects
    are named, and work carries on.

## 3. Scope

**In scope:** RAW and HDR import, HDR and SDR grading, local adjustments,
Denoise, Film Look, Black & White, preview and scopes, Proof, export and
batch export, the photo Library, desktop packaging for three platforms.

**V1 additions (Steve, October 21, 2026):** a healing brush in the local
adjustment module (Retouch: Inpaint, Heal and Clone; CPU first), and hue
selection as a local-adjustment mask. Both are
required for v1 and not built; details belong to the [Grade PRD](modules/grade.md).

**Out of scope (decided):** compositing and layers, pixel painting and
retouching beyond the v1 Retouch brush, AI-based selection or generation,
stacks for bursts, face
recognition, maps, cloud sync, phone companion, tethering, printing, web
galleries, slideshows and video. Details are in each module's
out-of-scope list.

**Deferred to v2 (Steve, October 21, 2026):** Library Looks, linked
photos, portable projects, and an MCP server so an AI assistant can
operate the app. These are not v1 launch requirements. The MCP server
will have its own PRD when work starts. Existing Film Look presets remain
in v1; the deferred Looks feature is the Library browser and workflow.

**Later, not planned yet:** AI search and tagging (version 2 at the earliest).

## 4. How the app is built

| Part | Folder | Job |
| --- | --- | --- |
| Backend | `codebase/backend/hdr_finisher/` | Python. Opens files, holds the exact colour maths, encodes exports, runs the Library helper. |
| Frontend | `codebase/frontend/` | The interface and the WebGPU renderer, in plain JavaScript. |
| Desktop shell | `codebase/desktop/` | Electron windows. Starts one shared backend. |

The image maths exists twice: in Python (the CPU path) and in GPU shaders.
Parity checks keep the two within tolerance. Under GPU first, the shaders
become the main path for export as well as preview.

Technical detail: [code map](../technical/code-map.md),
[architecture](../technical/architecture.md),
[image-processing pipeline](../technical/image-processing-pipeline.md).
Working rules for coding agents, including how much to test:
`AGENTS.md` at the repository root.

## 5. Module map

| Module | Covers | Main code | PRD | State, October 18 |
| --- | --- | --- | --- | --- |
| Import and RAW | Input formats, camera RAW and DNG development, source interpretation, starting look | `loader.py`, `raw_import.py`, `linear_dng.py`, `gainmap_decoders.py`, `sessions.py` | [import-and-raw](modules/import-and-raw.md) | Built. **RAW Exposure zero implemented; Library picture agreement and final review open.** |
| Grade | HDR and SDR controls, curves, Detail, local adjustments and masks, Denoise, Black & White, SDR Match, presets | `adjustments.py`, `local_adjustments.py`, `denoise_adaptive.py`, `sdr_match.py`, `frontend/*` panels | [grade](modules/grade.md) | Built. V1 healing brush and hue-selection mask not built; desaturation controls, preset management and the Match fault open. |
| Film Look | Stocks, papers, lens filter, grain, halation, Looks | `film_stock.py`, `film_grain.py`, `film_stocks/`, shaders | [film-look](modules/film-look.md) | Rebuild phases 1 to 6 built. Grain data mostly estimates. |
| Preview and GPU | WebGPU preview, viewport-bounded rendering, zoom, scopes, GPU memory, CPU/GPU parity | `webgpu-*.js`, `gpu-*.js`, `render_cache.py`, `scopes.py` | [preview-and-gpu](modules/preview-and-gpu.md) | Built. Several performance follow-ups open. |
| Export and Proof | Output formats, settings, presets, batch export, Proof, HDR ceiling, **GPU delivery** | `exporters.py`, `batch_export.py`, `proofing.py`, `hdr_ceiling.py` | [export-and-proof](modules/export-and-proof.md) | CPU export built. **GPU export, Proof and Library pictures not built (top priority).** |
| Photo Library | Browsing, culling, albums, sidecars, thumbnails, paste, Library pictures | `library_*.py`, `photo-library.js`, `library-*.js` | [photo-library](modules/photo-library.md) | Slices 0 to 6 and paste built. Metadata not built; Library Looks, links and portable projects deferred to v2. |
| Desktop and release | Electron shell, windows, packaging, updates, platforms, release process | `codebase/desktop/`, `packaging/`, `.github/` | [desktop-and-release](modules/desktop-and-release.md) | 0.9.1 tagged. Linux leftovers open. |

## 6. Priorities (Steve, October 18, 2026)

1. **GPU delivery:** export, batch export, Proof and saved-grade Library
   pictures on the GPU. Brief:
   [codex-brief-gpu-delivery-build-2026-10-18](../technical/briefs/codex-brief-gpu-delivery-build-2026-10-18.md).
   Details: [export-and-proof](modules/export-and-proof.md).
2. **Library speed plan** (October 18): develop each photo once, draw
   Library pictures live on the GPU, move RAW development to the GPU, one
   scheduler. Phase 0 quick wins first. See
   [photo-library](modules/photo-library.md), open work item 1.
3. **Starting exposure at zero and RAW tuning.** This was meant to come
   before paste, but paste shipped first. See
   [import-and-raw](modules/import-and-raw.md).
4. The remaining v1 Library work: batch-export metadata, leftovers, then
   the polish pass. Library Looks, linked photos and portable projects are
   deferred to v2 (Steve, October 21, 2026). See
   [photo-library](modules/photo-library.md).
5. **V1 local adjustments** (Steve, October 21, 2026): add a healing brush
   and a hue-selection mask. Both are unbuilt v1 requirements; see
   [grade](modules/grade.md).

## 7. Waiting on Steve

| Item | Kind | Module |
| --- | --- | --- |
| V2 linked photos: whole grade or chosen groups; where the link is stored | Deferred decision | Photo Library |
| V2 portable projects: one-file packing; project index file ending | Deferred decision | Photo Library |
| Comfort cap: roll-off or clip; grid only or everywhere | Decision | Photo Library |
| V2 Library Looks: one menu or two | Deferred decision | Photo Library |
| Nested tags; what "HDR" means for an unedited photo | Decision | Photo Library |
| Film grain values, Looks and lens filter by eye | Test | Film Look |
| Black & White slider strength, fade points and presets | Test | Grade |
| Exposure-warning wording, shadow warning threshold | Test | Photo Library |
| Match entire HDR grade fault: photos and message | Report | Grade |
| Whether 0.9.0 and 0.9.1 were published as GitHub releases | Check | Desktop and release |

## 8. How the documents are kept

The aim is one place for each fact, so plans and code don't drift apart
again.

- **This page** holds the scope, the philosophy, the module map and the
  priorities. Update it when any of those changes.
- **One PRD per module** in `docs/product/modules/`. Each has the same
  sections: Purpose, Scope, Decisions (dated), Current state, Open work,
  Detail and history. When a requirement, decision or status changes,
  update that module's PRD in the same commit as the code.
- **Status comes from the code, not from memory.** A build is marked done
  in its module only when the code is committed. A brief that is only
  partly finished leaves its remaining items listed under Open work.
- **No new sprint PRDs.** A piece of work is a brief in
  `docs/technical/briefs/`, pointing to the module PRD it serves. When the
  brief is finished, its outcome goes into the module PRD and the brief
  moves to `docs/technical/archive/briefs/`.
- **History is archived, not deleted.** The old PRDs, sprint plans and
  finished briefs keep their original text in
  [archive](archive/README.md) and `docs/technical/archive/`. Code comments
  that cite an old PRD section (for example "Viewport-Bounded GPU Preview
  PRD 5.1") refer to those archived files.
- **Other living documents:** [known limitations](../known-limitations.md)
  (what doesn't work and why), [photo library internals](../technical/photo-library.md),
  [library speed architecture](../technical/library-speed-architecture.md),
  the user guide under `docs/user-guide/`, and the mock-ups in
  `library-wireframes/` and `export-wireframes/`.

### Status words

| Word | Meaning |
| --- | --- |
| Built | In the code and covered by checks. Not necessarily tested by Steve. |
| Partly built | Some of it is in the code. The module lists what is missing. |
| Not built | No code yet. |
| Decided out | Will not be built. Stays listed so it isn't proposed again. |
