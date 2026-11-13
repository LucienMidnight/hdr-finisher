HDR Finisher already covers most everyday editing and Library work for HDR web photographs.
Its strongest feature is full creative control of both the HDR picture and its SDR fallback.
Finish quality and delivery checks before adding a long list of competitor features.
AI masks, tethering, printing and several Library workflows are deliberately outside v1.
JPEG XL currently carries direct HDR, without the authored SDR fallback described in the brief.

# Research C: feature parity — 13 November 2026

## Competitor versions

| Product | Current confirmed version | Release date | Official source | Accessed |
|---|---|---|---|---|
| Adobe Lightroom Classic | 16.0 | November 2026; exact day unconfirmed; page updated November 10 | [Adobe release notes][A0] | 2026-11-13 |
| Capture One Pro desktop | 16.9 | 2026-10-29 | [Capture One release notes][C1] | 2026-11-13 |
| DxO PhotoLab Elite | 10.3; platform build suffix unconfirmed | 2026-11-10 | [DxO news][D4], [current features][D0] | 2026-11-13 |

## Method

Investigation only, on `research/c-feature-parity`, created from main. No code edits, GPU runs, merge or push. Scope is Classic, Pro desktop (not Studio-only features), and PhotoLab Elite (not silently including paid FilmPack/ViewPoint). All external sources were accessed November 13, 2026.

Read master PRD sections 1–3, all eight module PRDs for purpose/scope/state/open work, known limitations, code map, the user guide and release notes. The root AGENTS.md is local/untracked and absent here; read the owner's copy at `D:/AI/AI Projects/HDR Finisher Tool/ai/AGENTS.md`. Export/Proof and pinned shaders, tolerances and budgets remain strict areas. This report needs document checks, not application tests.

HDR Finisher evidence uses repository-relative file:line citations. Short path aliases below expand to exact paths; branch citations explicitly identify their revision. “Has” means documented as implemented, not universally qualified on physical HDR screens. New dated module/release records override stale absence statements: known limitations still says hue masks, Retouch and preset management are unavailable; 0.9.2 confirms them built. Retouch acceptance remains open. The master PRD's opening version statement is also stale: `RELEASE_NOTES.md:1` is 0.9.2.

Competitors: **H** confirmed in official current documentation; **P** qualified/partial; **U** unconfirmed, never shorthand for missing. Current documentation sometimes retains an older update date; archived version PDFs, reviews, forums and memory were not used as confirmation. Each row's source links support its confirmed cells, not its U cells. The matrix deliberately records uncertainty rather than inferring absence from marketing omissions.

Evidence path aliases (all under the Git root):

| Alias | Exact path |
|---|---|
| Master | `docs/product/PRD.md` |
| Limits | `docs/known-limitations.md` |
| Release | `RELEASE_NOTES.md` |
| Library | `docs/user-guide/library.md` |
| Import | `docs/user-guide/import.md` |
| Local | `docs/user-guide/local-adjustments.md` |
| HDR | `docs/user-guide/grade-hdr.md` |
| SDR | `docs/user-guide/grade-sdr.md` |
| Denoise | `docs/user-guide/denoise.md` |
| Film | `docs/user-guide/film-look.md` |
| Export | `docs/user-guide/export.md` |
| Proof | `docs/user-guide/proof.md` |
| Viewer | `docs/user-guide/viewer-and-analysis.md` |
| GradePRD | `docs/product/modules/grade.md` |
| RawPRD | `docs/product/modules/import-and-raw.md` |
| ExportPRD | `docs/product/modules/export-and-proof.md` |

## Feature matrix

### Library or catalogue

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 01 Folder browsing | H | H | H | has | docs/user-guide/library.md:7 | [A0] [C0] [D2] |
| 02 Grid, single and fullscreen review | H | U | H | has | docs/user-guide/library.md:41 | [A0] [D2] |
| 03 Star ratings | H | U | H | has | docs/user-guide/library.md:86 | [A0] [D2] |
| 04 Pick/reject culling | H | U | H | has | docs/user-guide/library.md:86 | [A0] [D2] |
| 05 Colour labels | H | U | H | has | docs/user-guide/library.md:86 | [A0] [D2] |
| 06 Keywords or tags | H | U | H | has | docs/user-guide/library.md:103 | [A0] [D2] |
| 07 Manual albums | H | H | H | has | docs/user-guide/library.md:127 | [A0] [C0] [D2] |
| 08 Smart albums | H | H | U | has | docs/user-guide/library.md:137 | [A0] [C0] |
| 09 Metadata filtering | H | U | H | has | docs/user-guide/library.md:113 | [A0] [D2] |
| 10 Virtual copies / variants | H | U | H | has | docs/user-guide/library.md:180 | [A0] [D2] |
| 11 Selective batch grade paste | H | U | U | has | docs/user-guide/library.md:188 | [A0] |
| 12 Per-photo caption/date editing in Library | H | U | H | missing | docs/user-guide/library.md:274 | [A0] [D2] |
| 13 Native rename/move/delete | H: Win/Mac | U | H: Win/Mac | partial: Windows only | docs/user-guide/library.md:199–211 | [A0] [C0] [D2] |
| 14 Persistent edit history | H | U | U | partial: recovery, no persistent steps | docs/user-guide/library.md:169,274 | [A0] |
| 15 Linked ongoing grades | H: Sync/Auto Sync | U | U | missing | docs/user-guide/library.md:274; docs/product/PRD.md:172 | [A0] |
| 16 Portable project including originals | H: export catalogue | U | U | missing | docs/user-guide/library.md:274; docs/product/PRD.md:172 | [A0] |
| 17 Burst stacks | H | U | H | missing | docs/product/PRD.md:165 | [A0] [D2] |
| 18 Face recognition catalogue | H | U | U | missing | docs/product/PRD.md:165 | [A0] |
| 19 Map browsing | H | U | U | missing | docs/product/PRD.md:165 | [A0] |
| 20 Cloud sync / mobile companion | P: limited sync | H: separate mobile | U | missing | docs/product/PRD.md:165 | [A0] [C1] |
| 21 Clear selection / fullscreen scroll restoration | U | U | U | has-on-branch | `feat/watermark-and-library-polish:docs/user-guide/library.md:343`; commit `d23ea422` | — |

### RAW development

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 22 Camera RAW development | H | H | H | has | docs/known-limitations.md:106; docs/product/modules/import-and-raw.md:284 | [A0] [C0] [D1] |
| 23 Bayer and X-Trans input | H | U | H | has: X-Trans CPU | docs/known-limitations.md:106; docs/product/modules/import-and-raw.md:731 | [A7] [D1] |
| 24 Linear DNG support/qualification | H | H: DNG | H: DNG | partial: constrained envelope | docs/known-limitations.md:100; docs/product/modules/import-and-raw.md:701 | [A7] [C1] [D3] |
| 25 Camera-specific creative profiles | H | H | H | missing: intentional generic method | docs/known-limitations.md:106; docs/product/PRD.md:134 | [A6] [C0] [D1] |
| 26 RAW highlight recovery | H | H | H | has | docs/known-limitations.md:106 | [A6] [C0] [D1] |
| 27 Scene-linear EXR input | U | U | U | has | docs/user-guide/import.md:30,125 | — |
| 28 ProPhoto / general ICC input | U | U | U | partial | docs/known-limitations.md:92; docs/product/modules/import-and-raw.md:711 | [A0] |
| 29 Non-destructive saved grades | H | H | H | has | docs/user-guide/library.md:153 | [A0] [C0] [D2] |
| 30 Bracketed HDR merge | H | U | U | missing: scope inference | docs/product/PRD.md:156,165; docs/user-guide/import.md:23 | [A0] [C6] |

### Tone and colour

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 31 Exposure and tonal-range sliders | H | H | H | has | RELEASE_NOTES.md:13 | [A6] [C0] [D0] |
| 32 White balance / tint | H | U | U | has | docs/user-guide/grade-hdr.md:79; docs/user-guide/local-adjustments.md:26 | [A6] |
| 33 Contrast | H | U | U | has | docs/user-guide/grade-hdr.md:27 | [A6] |
| 34 Saturation / vibrance | H | H: saturation | U | has | docs/user-guide/grade-hdr.md:85 | [A6] [C0] |
| 35 Tone / RGB curves | H | U | U | has | docs/user-guide/grade-hdr.md:113 | [A6] [C1] |
| 36 Hue-selective colour editing | H | H | U | has | RELEASE_NOTES.md:14; docs/product/modules/grade.md:1493 | [A0] [C1] |
| 37 Black-and-white channel mix | H | U | U | has | docs/user-guide/grade-hdr.md:126 | [A6] |
| 38 Histogram | H | U | H | has | docs/user-guide/viewer-and-analysis.md:83 | [A6] [D0] |
| 39 Waveform | U | U | U | has | docs/user-guide/viewer-and-analysis.md:95 | — |
| 40 Vectorscope | H: new 16.0 | U | U | has | docs/user-guide/viewer-and-analysis.md:105 | [A0] |
| 41 Diffusion and halation | H: new Glow | U | U | has | docs/user-guide/film-look.md:74,92 | [A0] |

### HDR editing and HDR export

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 42 True HDR editing/display | H | U | U | has | docs/product/PRD.md:23; docs/user-guide/viewer-and-analysis.md:17 | [A1] |
| 43 HDR Library grid | No: explicitly unsupported | U | U | has | docs/user-guide/library.md:57 | [A1] |
| 44 Independent full HDR and SDR grades | P: SDR rendition controls | U | U | has | docs/product/PRD.md:55; docs/user-guide/grade-sdr.md:3 | [A1] |
| 45 One-shot HDR-to-SDR grade matching | P: tone mapping | U | U | partial: fault remains open | docs/product/modules/grade.md:1452 | [A1] |
| 46 SDR fallback preview | H | U | U | has | docs/user-guide/grade-sdr.md:3 | [A1] |
| 47 Ultra HDR JPEG gain-map export | U: HDR JPEG confirmed | U | U | has | docs/user-guide/export.md:55 | [A1] [C2] [D3] |
| 48 AVIF gain-map export | U: HDR AVIF confirmed | U | U | has | docs/user-guide/export.md:99 | [A1] [C2] [D3] |
| 49 Direct HDR JPEG XL output | H | U | U | has | docs/user-guide/export.md:127 | [A1] [C2] [D3] |
| 50 Authored SDR fallback inside HDR JPEG XL | U | U | U | missing | docs/user-guide/export.md:129,137 | [A1] [C2] [D3] |
| 51 Encoded HDR peak guarantee option | P: HDR Limit, encoded guarantee U | U | U | has: opt-in | docs/user-guide/export.md:26 | [A1] |
| 52 Display-headroom gain-map Proof | U | U | U | has | docs/user-guide/proof.md:3 | — |
| 53 AVIF source EXIF preservation | U | U | U | missing | docs/user-guide/export.md:123 | — |
| 54 HDR/SDR diagnostic delivery text | U | U | U | has-on-branch | `feat/watermark-and-library-polish:docs/user-guide/export.md:239` “Text watermark and gain-map test”; commit `4ef74e99` | — |

### Local adjustments and masking

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 55 Brush mask | H | H | H: Control Brush | has | docs/user-guide/local-adjustments.md:37 | [A2] [C3] [D0] |
| 56 Linear gradient mask | H | U | U | has | docs/user-guide/local-adjustments.md:58 | [A2] |
| 57 Luminance-range mask | H | U | U | has | docs/user-guide/local-adjustments.md:70 | [A2] |
| 58 Hue-range mask | H | U | H: colour-sensitive U Point | has | docs/user-guide/local-adjustments.md:147 | [A2] [D0] |
| 59 Editable path mask | U | U | U | has | docs/user-guide/local-adjustments.md:82 | — |
| 60 Add/subtract/intersect masks | H | U | U | has | docs/user-guide/local-adjustments.md:110 | [A2] |
| 61 Mask opacity / feather | H | H: opacity | U | has | docs/user-guide/local-adjustments.md:26,37 | [A2] [C3] |
| 62 Separate local HDR/SDR grades | U | U | U | has | docs/user-guide/local-adjustments.md:9 | — |
| 63 Local light / WB / detail controls | H | H | U | has | docs/user-guide/local-adjustments.md:26 | [A2] [C3] |
| 64 Local colour wheels / curves | H: wheels | U | U | missing | docs/user-guide/local-adjustments.md:35 | [A0] |
| 65 AI subject/sky/people masks | H | H | H | missing | docs/product/PRD.md:165 | [A2] [C0] [D0] |
| 66 AI depth masks | H | U | H | missing | docs/product/PRD.md:165 | [A0] [D0] |
| 67 Pixel layers / compositing | No: external editor | No: adjustment layers only | No: Affinity handoff | missing | docs/product/PRD.md:165 | [A0] [C3] [D3] |

### Retouching

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 68 Heal brush | H | H | U | partial: built, quality review open | docs/user-guide/local-adjustments.md:153 | [A8] [C3] |
| 69 Clone brush | H | H | U | partial: built, quality review open | docs/user-guide/local-adjustments.md:153 | [A8] [C3] |
| 70 Non-generative Inpaint / content-aware repair | H | U | U | partial: built, quality review open | docs/user-guide/local-adjustments.md:153 | [A8] |
| 71 Generative object removal | H | U | U | missing | docs/product/PRD.md:165 | [A0] |
| 72 Automatic portrait/skin retouch | H: blemishes | H: skin/hair | H: facial masks | missing | docs/product/PRD.md:165 | [A0] [C1] [D0] |

### Geometry and lens correction

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 73 Crop / aspect ratio | H | U | U | has | docs/product/modules/grade.md:1110 | [A0] |
| 74 Reopen and revise original crop | H | U | U | partial: nested-crop limitation recorded | docs/known-limitations.md:122 | [A0] |
| 75 Rotate / straighten / flip | H | U | U | has | docs/user-guide/local-adjustments.md:143; docs/product/modules/grade.md:1110 | [A0] |
| 76 Perspective correction | H | U | U | has | docs/product/modules/grade.md:1110 | [A0] |
| 77 Profile distortion/vignetting correction | H | H | H | has: Lensfun | docs/known-limitations.md:109; docs/product/modules/import-and-raw.md:284 | [A9] [C4] [D1] |
| 78 Image-adaptive lateral CA with manual trim | H | H | P: profile correction | missing | docs/product/modules/import-and-raw.md:719 | [A9] [C4] [D1] |
| 79 Purple/green defringe | H | H | U | missing | docs/product/modules/import-and-raw.md:725 | [A9] [C4] |
| 80 Mats / framing | U | U | U | has | docs/product/modules/export-and-proof.md:824,835 | — |

### Noise and sharpening

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 81 Luminance / colour denoise | H | H | H | has | docs/user-guide/denoise.md:33 | [A7] [C0] [D1] |
| 82 RAW AI denoise | H | H: Enhanced Denoise | H: DeepPRIME | missing: measured non-ML method | docs/user-guide/denoise.md:7; docs/known-limitations.md:110 | [A7] [C1] [D1] |
| 83 Rendered HDR / EXR denoise | U | U | U | has | docs/user-guide/denoise.md:5 | — |
| 84 Noise-only inspection | U | U | U | has | docs/user-guide/denoise.md:49 | — |
| 85 Capture/detail sharpening | H | H | H | has | docs/product/modules/grade.md:1441 | [A6] [C4] [D1] |
| 86 Noise-aware sharpening / edge masking | H | U | P: lens-aware | partial: accepted basic sharpen | docs/product/modules/grade.md:1445 | [A6] [D1] |
| 87 Local sharpening | H | H | U | has | docs/user-guide/local-adjustments.md:32 | [A2] [C3] |

### Presets and styles

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 88 Save / rename / import / export presets | H | H: Styles | U | has | RELEASE_NOTES.md:16; docs/product/modules/grade.md:1470 | [A3] [C5] |
| 89 Film stocks / paper / grain | P: grain; physical model U | U | P: FilmPack extra | has | docs/user-guide/film-look.md:21,50,74 | [A6] [D1] |
| 90 Library Looks / batch style browser | H | H | U | missing | docs/user-guide/library.md:274; docs/product/PRD.md:172 | [A3] [C5] |

### Export

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 91 SDR JPEG / PNG | H | H | P: JPEG | has | docs/user-guide/export.md:139,148 | [A4] [C2] [D3] |
| 92 SDR JPEG XL | H | U | U | has | docs/user-guide/export.md:154 | [A1] [C2] [D3] |
| 93 TIFF output | H | H | H | missing | docs/user-guide/export.md:48–51,139–156: output list | [A4] [C2] [D3] |
| 94 Batch queue / multiple output versions | H | H | H | has | docs/user-guide/library.md:213; RELEASE_NOTES.md:7 | [A4] [C1] [D3] |
| 95 Output resize / sharpening | H | U | P: resize | has | docs/product/modules/export-and-proof.md:835 | [A4] [D3] |
| 96 Title/caption/creator export templates | H | U | P: metadata | has | docs/product/modules/export-and-proof.md:723 | [A4] [D3] |
| 97 Metadata privacy choices | H | U | H | has | docs/user-guide/export.md:162; docs/product/modules/export-and-proof.md:723 | [A4] [D3] |
| 98 Text delivery watermark | H | H | U | has-on-branch | `feat/watermark-and-library-polish:docs/user-guide/export.md:239`; commit `4ef74e99` | [A0] [C1] |
| 99 ICC display soft proof | H | U | H | missing | docs/known-limitations.md:151 | [A0] [D1] |
| 100 Direct publishing / web galleries | H | P: separate Live | U | missing | docs/known-limitations.md:164; docs/product/PRD.md:165 | [A0] [C1] |

### Tethering

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 101 Tethered capture / live view | H: tethering | H | U | missing | docs/product/PRD.md:165 | [A0] [C0] |

### Printing

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 102 Print layouts / contact sheets | H | H | P: printing | missing | docs/product/PRD.md:165 | [A0] [C7] [D2] |

### Plug-ins and extensibility

| ID / feature | Lightroom Classic | Capture One | DxO PhotoLab | HDR Finisher | HDR Finisher evidence | Competitor sources |
|---|---|---|---|---|---|---|
| 103 Third-party export plug-ins | H | U | U | missing | docs/known-limitations.md:183; docs/product/PRD.md:156 | [A3] |
| 104 External-editor round-trip | H | H | H: Affinity | missing: manual export/open only | docs/user-guide/export.md:20–51; docs/known-limitations.md:183 | [A0] [C1] [D3] |
| 105 Scripting / MCP automation | P: export plug-ins | H: macOS scripts | U | missing | docs/known-limitations.md:110; docs/product/PRD.md:172 | [A3] [C1] |

## Sorted gaps

Every partial/missing HDR Finisher row appears once below. Classifications are research judgments. Class (c) includes explicit v2 deferrals **for v1 planning**, not permanent rejection. The master scope begins at docs/product/PRD.md:156; decided exclusions at docs/product/PRD.md:165; deferred workflows at docs/product/PRD.md:172. Evidence for each implementation gap is in its matrix row.

### (a) In scope and valuable

| IDs | Gap | One-line reason |
|---|---|---|
| 12 | Library metadata editor | Library scope; per-photo captions/dates help find and deliver web photographs; export templates already exist. |
| 13 | Mac/Linux file commands | Three-platform Library scope; the existing Windows workflow needs safe equivalents. |
| 24 | Linear DNG qualification | RAW import is core; qualify the documented envelope instead of promising every valid DNG. |
| 28 | ProPhoto input | RAW/HDR interchange scope; common rendered inputs should not be treated as sRGB. |
| 45 | Match fault | Two authored renditions are core; a broken starting point costs time on every SDR fallback. |
| 53 | AVIF metadata | Export scope; attribution and privacy should survive efficient HDR delivery. |
| 64 | Local colour tools | Local grading scope; selective hue balance is useful, though not a named v1 requirement. |
| 68–70 | Retouch acceptance | Explicit required v1 feature; finish quality before adding another removal mode (docs/product/PRD.md:160,182). |
| 74 | Crop revision | Geometry scope; revising composition should not require nested cropping. |
| 78–79 | Fringe tools | Valuable on bright HDR edges; explicitly an idea for v2, not missing v1 work (docs/product/PRD.md:246; docs/product/modules/import-and-raw.md:719). |
| 86 | Noise-aware sharpening | Detail scope; current Sharpen is accepted, alternatives explicitly v2 (docs/product/modules/grade.md:1441–1448). |

### (b) In scope but lower current value

| IDs | Gap | One-line reason |
|---|---|---|
| 14 | Persistent history | Library scope, but saved previous/session grades already provide recovery; full steps are lower priority. |
| 50 | JPEG XL gain-map fallback | HDR delivery fits scope, but JPEG/AVIF already serve web fallback needs; decoder support must justify another format path. |
| 82 | AI denoise | Denoise is in scope; incremental quality gains over the existing method need proof before a second engine/model runtime. |
| 93 | TIFF output | Export scope but mostly interchange/print value; 16-bit SDR PNG and HDR JXL reduce urgency. |
| 99 | ICC display proof | Adjacent to display/export, but gain-map browser Proof is the priority; print-oriented proof belongs with excluded printing. |
| 104 | External-editor handoff | Fits finishing/interchange, but manual export/open exists and intended editing is largely native. |

### (c) Outside v1 scope

| IDs | Gap | One-line reason |
|---|---|---|
| 15 | Linked photos | Explicit v2 deferral (docs/product/PRD.md:172). |
| 16 | Portable projects | Explicit v2 deferral (docs/product/PRD.md:172). |
| 17 | Burst stacks | Explicit exclusion (docs/product/PRD.md:165). |
| 18 | Face catalogue | Face recognition explicitly excluded (docs/product/PRD.md:165). |
| 19 | Maps | Explicit exclusion (docs/product/PRD.md:165). |
| 20 | Cloud/mobile | Cloud sync and phone companion explicitly excluded; offline purpose (docs/product/PRD.md:23,165). |
| 25 | Creative camera profiles | Generic method is intentional (docs/product/PRD.md:134; docs/known-limitations.md:106); correct camera metadata conversion is a different requirement. |
| 30 | Bracket merge | Inferred outside single-photo RAW/HDR import and compositing scope (docs/product/PRD.md:156,165); not explicitly named, so confirm before revisiting. |
| 65–66 | AI selection/depth masks | AI-based selection explicitly excluded (docs/product/PRD.md:165). |
| 67 | Pixel compositing | Layers/compositing explicitly excluded; named local adjustments are not pixel layers (docs/product/PRD.md:165). |
| 71 | Generative removal | AI generation explicitly excluded (docs/product/PRD.md:165). |
| 72 | Advanced portrait retouch | Beyond v1 Retouch brush and includes AI selection; exclusions at docs/product/PRD.md:165. |
| 90 | Library Looks | Explicit deferred Library workflow; existing Film Look presets remain v1 (docs/product/PRD.md:172). |
| 100 | Publishing/galleries | Web galleries/cloud workflow excluded; local delivery remains the focus (docs/product/PRD.md:165). |
| 101 | Tethering | Explicit exclusion (docs/product/PRD.md:165). |
| 102 | Printing/contact sheets | Printing explicitly excluded (docs/product/PRD.md:165); browser Proof is a separate feature. |
| 103 | Plug-in SDK | Outside enumerated v1 scope; inference, not explicit permanent prohibition (docs/product/PRD.md:156). |
| 105 | MCP/automation | MCP explicitly deferred and needs its own PRD (docs/product/PRD.md:172); no v1 scripting commitment. |

## Candidate releases

Effort estimates cover implementation and focused validation: **S ≤1 agent-day, M 2–5, L >5**. Owner visual review and hardware waits are additional. No current valuable gap is safely S without narrowing its brief. These are sequencing candidates, not approved requirements or dates.

| Valuable gap | Value for HDR web photographers | Effort | Risk and strict areas | Candidate |
|---|---|---|---|---|
| Retouch acceptance | High: clean distractions before authoring either rendition | M bounded fixes; L redesign | Shared source, masks, replay; export/Proof and pinned CPU/GPU contracts | 0.9.3 |
| Match fault | High: saves work on the SDR fallback for every photo | M after reproduction | SDR colour/brightness fitting and editable controls; delivery/shaders | 0.9.3 |
| Crop revision | High: composition is routine | M | Frame/source coordinates, masks, undo, saved grades; export/Proof geometry | 0.10 |
| Mac/Linux file commands | High: safe management on advertised platforms | L | Trash APIs, sidecars/copies, clashes and partial recovery; no image-math change | 0.10 |
| Library metadata | Medium: caption/date authoring improves finding and delivery | M | Sidecar schema, filters, template precedence/privacy; strict export metadata | 0.10 |
| Linear DNG qualification | High: trust in RAW and converter interchange | M corpus; L decoder fixes | Colour, opcodes, geometry and every output; no blanket camera promise | 1.0 |
| ProPhoto input | High: prevents wrong colour in rendered interchange | M | D50 adaptation, transfer, Library assumptions/cache identity; delivery | 1.0 |
| AVIF metadata | Medium: retain credit/privacy in compact web output | M; L combiner replacement | Container edits must preserve gain map, SDR, colour tags and decoded output; export/Proof strict | 1.0 contingent |
| Local colour tools | Medium: targeted balance without global compromise | L | Saved schema, lane independence, CPU/GPU and pinned shader layouts; delivery parity | Post-1.0/v2 |
| Fringe tools | High on affected photos: HDR makes coloured rims conspicuous | L | RAW channel alignment before masks/grade; geometry and delivery agreement | Post-1.0/v2 |
| Sharpen exploration | Medium: cleaner texture after lifted shadows; current method accepted | L | Noise amplification, radii/tiling, local/global Detail and output sharpening; strict shaders/export | Post-1.0/v2 |

- **0.9.3 — acceptance and trust:** finish bounded Retouch issues and reproduce Match; incorporate already-built watermark/selection work through normal owner review. This report does not merge it. Physical HDR checks, encoded peak behaviour and repeat-export checks are readiness gates, not new parity features (RELEASE_NOTES.md:54; docs/product/modules/export-and-proof.md:683).
- **0.10 — everyday workflow:** crop revision, safe native file operations and metadata remove recurring friction while keeping the HDR identity. Prioritize crash/partial-failure recovery over convenience.
- **1.0 — reliable colour and delivery:** qualify supported DNG and ProPhoto interchange; AVIF metadata is contingent on a safe bounded route and need not hold launch. Follow AGENTS' pre-tag multi-platform packaged build rule and owner screen acceptance.
- **Post-1.0/v2 — selective image quality:** fringe correction, noise-aware sharpening and local colour tools need real-photo comparison before algorithm choice. Respect explicit v2 deferrals; no AI-mask/tether/print detour.

Additional readiness work should not become invented competitor feature gaps: cold/heavy Library speed, 8 GB Mac acceptance, Linux HDR banding, Mac/Linux JPEG XL colour-tag automation, estimated Film Look grain data and owner visual reviews remain in module PRDs and RELEASE_NOTES.md:54. Measure the whole wait before proposing another GPU route (Master philosophy 3); do not relax image limits to meet a release.

## Where HDR Finisher leads

**Confirmed narrower advantage over Lightroom Classic:** HDR Library grid, which Adobe explicitly excludes from supported HDR views [A1]; HDR Finisher exposes an HDR Library toggle (docs/user-guide/library.md:57). Capture One/PhotoLab equivalence remains unconfirmed, so this does not prove an all-three lead.

Strong differentiators, with an absolute all-three lead **not yet proven**:

- Full independent HDR and SDR creative grades, including local grades and Denoise, joined through Ultra HDR JPEG or AVIF (docs/product/PRD.md:55; docs/user-guide/local-adjustments.md:9; docs/user-guide/denoise.md:64). Lightroom documents SDR rendition controls, not a second complete editing lane; Capture One/PhotoLab equivalents are unconfirmed [A1] [C0] [D0].
- Explicit headroom gain-map Proof plus authored HDR/SDR diagnostic text (docs/user-guide/proof.md:3; `feat/watermark-and-library-polish:docs/user-guide/export.md:239`). Equivalent competitor workflows are unconfirmed. The test diagnoses decoding, not actual screen luminance.
- Offline, open-source, three-platform desktop delivery of that workflow (docs/product/PRD.md:23). Vendor sources describe commercial Windows/macOS workflows [A1] [C1] [D0]; none establishes an equivalent open-source Linux product. This does not imply equal physical HDR qualification across platforms.

Do not market gain-map authoring alone as unique: Lightroom already documents HDR JPEG/AVIF export [A1]. Its inspected HDR guide does not explicitly establish gain-map container details, hence U cells rather than an invented absence. Do not claim JPEG XL contains this app's SDR fallback: docs/user-guide/export.md:129 explicitly says otherwise.

## Open questions and uncertain rows

1. Adobe's exact November release day and DxO platform build suffixes are unconfirmed. Do not turn documentation-update dates into release dates.
2. Competitor U cells need current manual or trial verification before negative sales claims. Highest priorities: Capture One/PhotoLab true HDR display/export, Lightroom gain-map container details, Capture One catalogue/variant/recipe details, and PhotoLab local tools by edition. This report does not claim those U features are absent.
3. No current official evidence proves all competitors lack full dual-grade gain-map authoring. Describe the concrete workflow benefit rather than “the only editor.”
4. HDR merge is not explicitly named in the master exclusion list. Its class (c) is an inference, to confirm with Steve, not authorization to add a merge engine.
5. AI selection/generation exclusions do not automatically prohibit ML denoise; its lower priority reflects unproven incremental value and runtime cost.
6. Lightroom 16.0 adds mask colour grading. HDR Finisher's guide explicitly excludes local curves/wheels; determine real-photo demand before changing saved fields/shaders.
7. Reconcile stale hue/Retouch/preset and crop-current-state wording before commissioning a fix. Research did not run the app or alter those documents.
8. Qualification differs from existence: Retouch/Match are partial because of acceptance/faults; DNG has a constrained supported envelope. None is a promise of ISO certification or every camera/codec working.
9. The watermark branch adds text, not confirmed logo/image watermarks. Main already has framing. Branch selection changes should not be commissioned again.

## Official sources

All accessed 2026-11-13. Short identifiers are reference-style footnote links used beside claims. Current vendor pages can change; the access date matters. Current general guide navigation confirms broad features; specialist pages support more specific claims.

[A0]: https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/release-notes.html "Adobe Classic release notes and current guide navigation"
[A1]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/hdr-output.html "Adobe HDR editing/export and supported views"
[A2]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html "Adobe masking"
[A3]: https://helpx.adobe.com/lightroom-classic/desktop/export-photos/export-presets-settings-plug-ins.html "Adobe export presets and plug-ins"
[A4]: https://helpx.adobe.com/lightroom-classic/desktop/export-photos/export-files-disk-or-cd.html "Adobe export files"
[A6]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html "Adobe tone, colour and grayscale"
[A7]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html "Adobe Enhance and denoise"
[A8]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html "Adobe retouch"
[A9]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html "Adobe lens corrections"
[C0]: https://www.captureone.com/en/products/capture-one-pro "Capture One Pro current features"
[C1]: https://support.captureone.com/hc/en-us/articles/39723944605725-Capture-One-16-9-release-notes "Capture One 16.9 release notes"
[C2]: https://support.captureone.com/hc/en-us/articles/360002629217-File-formats-for-processing-and-export "Capture One export formats"
[C3]: https://support.captureone.com/hc/en-us/articles/360002615097-Working-with-multiple-Layers "Capture One layers, updated May 31 2026"
[C4]: https://support.captureone.com/hc/en-us/articles/360002582318-The-Lens-Correction-tool "Capture One lens correction"
[C5]: https://www.captureone.com/blog/10-questions-migrating-from-lightroom-to-capture-one "Capture One current migration/Styles page"
[C6]: https://support.captureone.com/hc/en-us/articles/360012248397-The-history-of-tools-and-features-added-to-Capture-One-Pro "Capture One current feature history"
[C7]: https://support.captureone.com/hc/en-us/articles/31355885087517-Contact-Sheets "Capture One contact sheets"
[D0]: https://www.dxo.com/en/dxo-photolab/whats-new/ "PhotoLab 10.3 and new features"
[D1]: https://www.dxo.com/en/dxo-photolab/features/ "PhotoLab current image-quality features"
[D2]: https://userguides.dxo.com/en/photolab/managing-images "PhotoLab current Library/metadata guide"
[D3]: https://userguides.dxo.com/en/photolab/exporting-images "PhotoLab current export guide"
[D4]: https://www.dxo.com/en/news/ "DxO dated release announcements"

Record: report only; checked document structure, gap coverage and local evidence. No application tests, GPU runs, merge or push.
