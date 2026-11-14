# HDR Finisher: Master PRD

- **Owner:** Steve
- **Status:** Living document. Created October 18, 2026, replacing
  `HDR_Finisher_PRD_v1.2.md` and the sprint PRDs. Those are kept, unchanged,
  in [archive](archive/README.md).
- **Last status check:** October 18, 2026, against the code on
  `film-look-rebuild`. A read-only audit compared every PRD with the code.
- **Library batch, October 26:** Steve tests HDR and SDR in the app; Claude
  traces backend.log with summarize_library_log.py. Logs record routes and
  stage durations; the screen wins when they disagree. Five local parts, one
  final fast run, only the focused shared-Denoise GPU check. Built work,
  tolerance and remaining timing targets are in the [Library status](modules/photo-library.md).

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
   HDR pixel is limited to the highlight compression target before encoding.
   Export and Proof are decoded and checked with a 1% encoding allowance
   (Steve, November 14, 2026); larger overshoots are corrected locally toward
   the target or, as a last resort, refused. See the Export and Proof module.
2. **Two authored renditions.** HDR and SDR are graded as independent,
   equally good pictures of the same photo. The SDR side is never just a
   by-product. HDR should win with brightness and range, not with stronger
   colour.
3. **Speed where it is felt; the GPU where it pays** (Steve, November 2,
   2026; replaces "GPU first" of October 18). Judge speed by the wait the
   user feels, measured from their action to the result on screen, not by
   one step inside it. Before changing anything, measure where that whole
   wait goes, then choose the cheapest change that removes a large part of
   it: a better order or design, using more CPU cores, skipping work, or
   the GPU.
   - Move work to the graphics card only when it removes about half or more
     of a wait the user can notice (rule of thumb: 50% faster), or when the
     CPU cannot do it acceptably at all (interactive preview, batch export).
     A GPU route that saves around 100 ms, or only matches the CPU, is not
     worth it for v1: each one keeps the image maths in two places, needs
     CPU/GPU agreement checks and graphics-memory budgets, and is exposed to
     faulty graphics cards.
   - The GPU routes that have already earned their place stay: preview,
     Library development and drawing, and export/Proof delivery (a
     45-photo batch went from an estimated 1.5 h to about 5 s a photo).
     The CPU stays the fallback for them.
   - The CPU path may be made faster when that is the cheaper way to a large
     gain.
   - Example (November 2): GPU RAW development in Grade cut one step but
     moved the whole import only from 6.1 s to 5.9 s, so it was stopped.
   **When a GPU attempt fails: one try, then the CPU** (Steve, November 6,
   2026). Every GPU route makes one attempt. If it fails, the work goes to
   its CPU fallback; it is not run again on the GPU. A second GPU attempt is
   allowed only for a failure that is temporary, caused by something outside
   the work itself, and leaves no doubt about the result. When the CPU
   fallback is too slow to accept, make the CPU faster rather than add GPU
   retries (example below).
   - *Worth a second GPU try (at most one):*
     - preempted or paused for higher-priority work (Grade, export, another
       photo): this is not a failure; the work is resumed or requeued and does
       not count as an attempt;
     - graphics memory or the shared reservation briefly held by other work:
       wait for it to be released, then try once;
     - the GPU device was lost or reset (driver reset, renderer restarted):
       recreate the device, then try once;
     - the renderer is still starting or briefly not responding (for example
       a stale heartbeat while it restarts);
     - a timeout caused by contention, not by the job itself hanging.
   - *Go straight to the CPU (the default):*
     - the result fails a validity or range check (invalid, non-finite or
       out-of-range pixels). The run cannot be trusted, and the check cannot
       rule out subtler damage from the same run, which could reach export;
     - a shader compile or validation error, or any other error that will
       repeat with the same input;
     - the job is larger than the card or its budget allows, or the adapter
       lacks a needed feature or limit;
     - out of graphics memory when nothing else is holding it;
     - no GPU, GPU unavailable, or the user chose CPU rendering;
     - the same work has already failed on the GPU in this session.
   - Every retry and every fallback is logged with its reason. A retry never
     changes the output; GPU and CPU still agree within their tolerance.
   - Example (November 6): on a machine with faulty graphics memory, Edge
     colour highlight reconstruction failed the range check on every GPU
     attempt for one photo (five out of five), so a second try only added
     about 10 s. Running the CPU fallback on all cores instead cut it from
     34 s to 9 s with identical output.
   **Use the whole machine** (Steve, October 25, 2026). CPU work that cannot
   run on the GPU (decoding, encoding, indexing, preparation) should scale
   across the available cores rather than be limited to one thread or a fixed
   small count. Background work also scales up when the user is not competing
   for the machine. It stays responsive by running at lower priority and
   yielding to foreground work, rather than by being capped. Fixed caps need a
   stated reason, such as a measured memory limit or a library that is not
   thread-safe.
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
11. **Assume slow storage** (Steve, November 1, 2026). Serious
    photographers keep large RAW libraries on spinning disks in a NAS or DAS,
    because SSDs are too small. Design for that; a faster drive is a bonus.
    Nothing already prepared waits on a read from the photo drive: it comes
    from the app's own cache on the local disk or from memory. Checks for
    changed files run in the background and in batches (one folder listing,
    not one request per photo). Speed targets are judged on slow storage,
    such as Steve's removable exFAT drive.

## 3. Scope

**In scope:** RAW and HDR import, HDR and SDR grading, local adjustments,
Denoise, Film Look, Black & White, preview and scopes, Proof, export and
batch export, the photo Library, desktop packaging for three platforms.

**V1 additions (Steve, October 21, 2026):** a healing brush in the local
adjustment module (Retouch: Inpaint, Heal and Clone; CPU first), and hue
selection as a local-adjustment mask. Both are required for v1. Hue selection is built. Inpaint, Heal and Clone
are implemented on the GPU with CPU fallback; Retouch acceptance remains open. Details belong to the [Grade PRD](modules/grade.md).

**Minimum hardware (Steve, November 13, 2026):** the MacBook Neo (Apple
A18 Pro, 8 GB unified memory, 6 cores, built-in 2408×1506 Retina screen)
is the minimum supported machine. Every feature must work on it, and
performance work optimises for this class of machine as well as the
Windows PC. Development and testing happen on both machines, which hand
work to each other through GitHub.

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

**V1 scope check (Steve, October 26, 2026).** Remaining v1 work, before the
broken release checks are repaired, the polish pass, the installer and the
bug hunt:

- Retouch brush (Inpaint, Heal, Clone), October 21 requirement. **On the GPU
  since October 28**, but Steve's November 2 review found the tool still needs
  work; the specific problems are still to be captured with Steve. This is the
  only unfinished v1 feature. Hue-selection local mask **built October 27**,
  awaiting Steve’s by-eye review.
- Highlight and Shadow Desaturation in Color (COLOR-DESAT-01): **built
  October 27**, awaiting Steve’s by-eye review.
- Presets window: rename, edit, import, export (PRESETS-01). Moved up to v1
  by Steve. **Built October 27:** rename, update, export/import, search and
  `<name>-preset.json` file names.
- Review of Grade's Sharpen control (Detail section). Steve suspects it is
  broken or simply a weak algorithm. Added by Steve. **Done October 27:**
  kept for v1 with a "judge at 100%" reminder; better noise-aware sharpening
  is v2.
- Photo Library: smooth scrolling in very large folders, the Build previews
  command, and batch-export metadata (bundled ExifTool, title and caption,
  creator/copyright template, privacy options). **Built October 27.** Steve
  accepted large-folder speed (now the regression baseline); Build previews
  and metadata await his try. Slight JPEG export differences are accepted for
  v1 and Ultra HDR JPEG stays the HDR export format.
- Tone sliders (Steve, October 27, 2026): Blacks, Shadows, Midtones and
  Highlights with Center and Width replace Lift/Gamma/Gain and Shadow / Black
  in both lanes, under one app-wide naming rule ("Exposure" is an equal
  change in stops; tone names are curves). See the Grade PRD. **Built
  October 27**, awaiting Steve's by-eye review.
- Graceful old, damaged and newer grades (Steve, October 28, 2026): no
  blank pictures, keep the readable sections, let the user choose, protect
  grades written by newer versions, and say when an update changes a look.
  See the Grade PRD. **Built October 28.**
- Steve's by-eye reviews (RAW exposure sheet, film grain/Looks/lens filter,
  HSL, exposure-warning wording, Black & White sliders) and the Match fault
  (waiting on Steve's recorded photo and message).
- Library loose ends (November 6): virtual-copy creation/indexing and the remaining
  mezzanine decode/stand-in work are fixed. Windows 4d memory/retained-owner
  acceptance was already completed November 5. Batch 5b true cold/heavy-grade
  acceptance and 4b hand-off speed remain partial; the long idle scope wait
  is removed but some modes still miss 500 ms. The 8 GB Mac acceptance is
  Steve's to run. Unedited HDR-source SDR behavior needs Steve's decision;
  the source audit found a mismatch and did not change what is shown.

**Status, November 6, 2026.** Every v1 feature except Retouch is built.
What remains: Retouch, the Match fault, the Library loose ends above and
Steve's by-eye reviews; then the release-check repair, polish pass,
installer and bug hunt.

**After v1 (Steve, October 26, 2026).** Not v1 launch requirements; kept in
each module's open work:

- Detail (100%) stored previews; GPU AVIF gain-map reconstruction.
- Library speed polish: faster HDR/SDR switching, stored previews at
  0.1 s, graded Denoise sharp draws at 0.5 s.
- Library leftovers: indexing settings, dimmed offline drives, drag a
  folder in to pin it.
- **V2 (Steve, November 6, 2026):** the HDR grid comfort cap. It is not
  needed in v1, because unedited RAWs show in SDR until graded (files with
  HDR data still show in HDR when the Library is set to HDR). If built, it
  is an optional advanced setting, not a default.
- Export speed: full-size single export under 15 s, RAW development on the
  GPU inside export, tiled finishing for large sharpened originals.
- Grade reviews: pipeline order (PIPE-01), Texture against Microcontrast
  (DETAIL-01), local Clarity cost (CLARITY-01). (Lift/Gamma/Gain moved into
  v1 as the new tone sliders, October 27.)
- Linux leftovers, unrecognised TIFF colour profiles, the Releases link.

**Idea for v2 (Steve, October 27, 2026):** a fringe tool in RAW development
(chromatic aberration and purple/green defringe). See the
[Import and RAW PRD](modules/import-and-raw.md), open work item 5.

**V2 (Steve, November 1, 2026):** GPU development for Fuji X-Trans RAWs
(the 6x6 sensor pattern). In v1, X-Trans develops on the CPU. See the
[Import and RAW PRD](modules/import-and-raw.md), open work item 6.

**Later, not planned yet:** AI search and tagging (version 2 at the earliest).

## 4. How the app is built

| Part | Folder | Job |
| --- | --- | --- |
| Backend | `codebase/backend/hdr_finisher/` | Python. Opens files, holds the exact colour maths, encodes exports, runs the Library helper. |
| Frontend | `codebase/frontend/` | The interface and the WebGPU renderer, in plain JavaScript. |
| Desktop shell | `codebase/desktop/` | Electron windows. Starts one shared backend. |

The image maths exists twice: in Python (the CPU path) and in GPU shaders.
Parity checks keep the two within tolerance. The shaders are the main path
for preview, Library pictures, export and Proof. Each extra GPU route adds to
this second copy, which is why a new one must clearly pay for itself
(philosophy 3).

Technical detail: [code map](../technical/code-map.md),
[architecture](../technical/architecture.md),
[image-processing pipeline](../technical/image-processing-pipeline.md).
Working rules for coding agents, including how much to test:
`AGENTS.md` at the repository root.

## 5. Module map

| Module | Covers | Main code | PRD | State, October 18 |
| --- | --- | --- | --- | --- |
| Import and RAW | Input formats, camera RAW and DNG development, source interpretation, starting look | `loader.py`, `raw_import.py`, `linear_dng.py`, `gainmap_decoders.py`, `sessions.py` | [import-and-raw](modules/import-and-raw.md) | Built. **RAW Exposure zero implemented; Library picture agreement and final review open.** |
| Grade | HDR and SDR controls, curves, Detail, local adjustments and masks, Denoise, Black & White, SDR Match, presets | `adjustments.py`, `local_adjustments.py`, `denoise_adaptive.py`, `sdr_match.py`, `frontend/*` panels | [grade](modules/grade.md) | Built, including hue-selection masks, Color desaturation and preset management. Complete v1 Retouch and the Match fault remain open. |
| Film Look | Stocks, papers, lens filter, grain, halation, Looks | `film_stock.py`, `film_grain.py`, `film_stocks/`, shaders | [film-look](modules/film-look.md) | Rebuild phases 1 to 6 built. Grain data mostly estimates. |
| Preview and GPU | WebGPU preview, viewport-bounded rendering, zoom, scopes, GPU memory, CPU/GPU parity | `webgpu-*.js`, `gpu-*.js`, `render_cache.py`, `scopes.py` | [preview-and-gpu](modules/preview-and-gpu.md) | Built. Several performance follow-ups open. |
| Memory and caches | Whole-app RAM ceiling and its split between caches, disk allowances, VRAM budget pointers, memory-pressure response | `app_memory.py`, `library_raw.py`, `library_pictures.py`, `library_cache.py`, `library-tile-pool.js`, `gpu-budget.js` | [memory-and-caches](modules/memory-and-caches.md) | 4 GB budget agreed October 29; implementation and acceptance status are recorded in the module PRD. |
| Export and Proof | Output formats, settings, presets, batch export, Proof, HDR ceiling, **GPU delivery** | `exporters.py`, `batch_export.py`, `proofing.py`, `hdr_ceiling.py` | [export-and-proof](modules/export-and-proof.md) | GPU export, Proof and Library pictures built; repeatability and speed follow-ups remain open. |
| Photo Library | Browsing, culling, albums, sidecars, thumbnails, paste, Library pictures | `library_*.py`, `photo-library.js`, `library-*.js` | [photo-library](modules/photo-library.md) | Slices 0 to 6 and paste built. Batch-export metadata built; Library Looks, links and portable projects deferred to v2. |
| Desktop and release | Electron shell, windows, packaging, updates, platforms, release process | `codebase/desktop/`, `packaging/`, `.github/` | [desktop-and-release](modules/desktop-and-release.md) | 0.9.1 tagged. Linux leftovers open. |

## 6. Priorities (Steve, October 18, 2026)

**Superseded October 26, 2026:** GPU delivery, Library responsiveness and
the RAW Exposure zero start are built (pending Steve's reviews where noted
in their modules). The remaining v1 work is the "V1 scope check" list in
section 3; the October 18 list below is kept as history.

1. **GPU delivery:** export, batch export, Proof and saved-grade Library
   pictures on the GPU. Brief:
   [codex-brief-gpu-delivery-build-2026-10-18](../technical/briefs/codex-brief-gpu-delivery-build-2026-10-18.md).
   Details: [export-and-proof](modules/export-and-proof.md).
2. **Library responsiveness** (goal clarified by Steve, October 25): prepare
   a folder of roughly 200-300 photos, then browse and rate fullscreen in real
   time. Preparation completion must mean ready-to-display pictures; stored
   development alone does not establish this. The existing October 18-19
   develop-once/live-GPU architecture is under review for unchanged browsing.
   Finished-preview caching, retention policy and measurable acceptance targets
   are proposed, not implemented or approved. See
   [Photo Library: prepared-folder culling](modules/photo-library.md#prepared-folder-fullscreen-culling-october-25-2026).
3. **Starting exposure at zero and RAW tuning.** This was meant to come
   before paste, but paste shipped first. See
   [import-and-raw](modules/import-and-raw.md).
4. The remaining v1 Library work: batch-export metadata, leftovers, then
   the polish pass. Library Looks, linked photos and portable projects are
   deferred to v2 (Steve, October 21, 2026). See
   [photo-library](modules/photo-library.md).
5. **V1 local adjustments** (Steve, October 21, 2026): add a healing brush
   and a hue-selection mask. Hue selection is built October 27; complete Retouch remains open. See
   [grade](modules/grade.md).

### Next performance round: heavy Film looks with Denoise (Steve, November 14, 2026)

The focus of the next round of performance work. On the MacBook Neo
(minimum hardware), editing works with many Film look adjustments stacked
together with Denoise, but it is slow. In Steve's November 14 manual test,
Tone changes took about 2–3.7 s at 100% zoom; Fit was faster but still
sluggish. Steve expected some slowness here, but this case is the next
target: heavy Film stacks plus Denoise at Fit and 100%, measured on the
Mac first. See [film-look](modules/film-look.md) and
[grade](modules/grade.md).

### To do: briefs to write (November 8, 2026)

Found during the November 8 release check. Each needs a brief before work starts.

1. **GPU exports may not repeat exactly.** Two GPU renders of the same grade
   came out noticeably different (possibly tiling that depends on free
   graphics memory). Affects export; Proof reuses the export's render, so
   it no longer shows the difference. See
   [export-and-proof](modules/export-and-proof.md).
   November 11 W5: not reproduced with independent sessions and 3/2 GiB
   admission caps (byte-identical files); cause still unconfirmed. Core
   repeatability regression added; no rendering change.
2. **Library delete, rename and move are slow.** About 10 seconds each with
   Steve's cache, and saving marks or settings waits during that time. See
   [photo-library](modules/photo-library.md).
3. **Film export mismatch.** The GPU preview's half-precision shader limit
   (the known film-stock-parity failure). Waiting on Steve: do the shader
   work, or leave it as a known limit. See [film-look](modules/film-look.md).

## 7. Waiting on Steve

| Item | Kind | Module |
| --- | --- | --- |
| V2 linked photos: whole grade or chosen groups; where the link is stored | Deferred decision | Photo Library |
| V2 portable projects: one-file packing; project index file ending | Deferred decision | Photo Library |
| V2 Library Looks: one menu or two | Deferred decision | Photo Library |
| Nested tags | Decision | Photo Library |
| Retouch: what still needs to change after the November 2 review | Report | Grade |
| Film grain values, Looks and lens filter by eye | Test | Film Look |
| Black & White slider strength, fade points and presets | Test | Grade |
| Exposure-warning wording, shadow warning threshold | Test | Photo Library |
| Match entire HDR grade fault: photos and message | Report | Grade |

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

### Glossary: Library pictures (Steve, October 25, 2026)

Use these words in documents, briefs, logs, code comments and reports. Picture
**sizes** describe what is stored or drawn. Fullscreen **steps** describe what
the user sees happen. A step uses a size; the two are never interchangeable.

**Picture sizes**

| Term | Meaning |
| --- | --- |
| Camera preview | The JPEG embedded in a camera RAW file. Not HDRF's grade. Used in the grid and filmstrip only without an eligible finished thumbnail; extracted previews are retained in bounded RAM (October 26). In Single and fullscreen it may be the quick draw only for an **unedited** photo with no thumbnail yet (Steve, October 25; amends the October 14 "never" rule). |
| Thumbnail | 640 px picture with the current grade and HDR/SDR mode. Used in the grid and filmstrip. |
| Screen preview | Picture sized to the display (2560 px long edge today), with the current grade and HDR/SDR mode. Used in Single, fullscreen and Compare at Fit. A *stored screen preview* is one saved to disk (built for Single/fullscreen Fit and Build previews, October 26-27). |
| Detail preview | Full-resolution picture for 100% focus checking. Today it is developed for the selected photo only; stored detail previews are later work. |

**Fullscreen steps**

| Term | Meaning |
| --- | --- |
| Quick draw | The photo's own thumbnail, enlarged to Fit as an instant stand-in. For an unedited photo with no thumbnail yet, its camera preview may provide the quick draw until HDRF's picture is ready. Never another photo or an obsolete grade. |
| Sharp draw | The screen preview replacing the quick draw. |

**Related terms**

| Term | Meaning |
| --- | --- |
| Scene | Developed, ungraded working data (640 and 2560 px, float16) that thumbnails and screen previews are drawn from. Not a finished picture. |
| Ready window | Finished screen previews kept in memory around the current photo in fullscreen. |
| Build previews | The implemented user command that makes stored screen previews for a selection, kept until discarded. Stored detail previews remain later work. |

Older documents say "640 tier", "2560 tier", "Fit picture", "kept picture",
"stand-in" or "1:1". Read them with this table; do not rewrite history to match.
