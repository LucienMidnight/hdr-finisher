# Open items

The one list of what is still to do. Written October 8, 2026, from the
product PRD, the two October sprint PRDs and the known-limitations page.
Each row names where the detail is. When an item is finished or dropped,
remove its row here and record the outcome where the detail lives.

Short names: **Viewport** is
[Viewport-Bounded GPU Preview](Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md),
**Modularization** is
[Codebase Modularization Sprint](Codebase_Modularization_Sprint_PRD_2026-10-06.md),
**PRD** is [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md).

## For 0.9.0

Steve, October 8: the next release is 0.9.0. Nothing is pushed until this
list is done.

| Item | What | Detail |
|---|---|---|
| Explicit interfaces between feature files | Each frontend file states what it reads and what it changes, instead of everything sharing one pool of state | Modularization 9 |
| Publish | Read the draft release notes, tag `v0.9.0`, publish, push | PRD, RELEASE entry in 11a |

## Later

Deferred work and backlog in one list, in no order. None of it blocks 0.9.0.

| Item | What | Detail |
|---|---|---|
| CF-PIX-02 | SDR Black & White preview differs from the export in four filtered cases. Confirmed repeatable; cause not found | Viewport 15.7 |
| CF-PIX-03 | SDR scopes with Exposure Bands show Peak 4.71% off against a 3% limit. Confirmed repeatable | Viewport 15.7 |
| CF-SPEED-01 | Exposure drag at 200% on the heavy project. A two-line fix is known | Viewport 15.7 |
| CF-SPEED-03 | First feedback of 0.75 to 1.0 s on the colour-wheel pad, brush Feather, Shift Edge and the luminance rails; straighten drags | Viewport 15.7 |
| CF-SPEED-04 | Cold 100% zoom feedback 850 ms against 150 ms; warm 200% slider 85 ms against 50 ms | Viewport 15.7 |
| CF-SPEED-05 | Turning Denoise on cold while panned on the 42 MP photo shows few or no frames during a drag | Viewport 15.7 |
| CF-DRIFT-01 | Some operations get 20 to 30% slower over a 30-minute session | Viewport 15.7 |
| CF-DRIFT-02 | The design check disagrees with the app on switch size and border; the original reference images are missing | Viewport 15.7, 16.12 |
| CF-DRIFT-03 | Warm latency misses in the headline timing check. Reopen only if felt in use | Viewport 15.7, 16.22 |
| CF-ROUTE-03 | A few colour controls fetch the whole source | Viewport 15.7 |
| CF-ROUTE-05 | 35 "superseded" responses in the endurance run were never confirmed harmless | Viewport 15.7 |
| CF-ROUTE-09 | The whole frame is fetched about a second after a 100% zoom so later pans need no fetch. Left as it is unless Steve asks | Viewport 15.7 |
| P3-MATCH-01 | Match takes 3 to 5 s against goals of 2 and 4 s | Viewport 15.1 |
| P3-PEAK-02 | Peak reads about 9% low with maximum Sharpen. The automatic highlight-anchor redesign goes with it | Viewport 15.1 |
| P3-ZOOM-01, 02 | Small SDR and HDR differences between zoom levels, at or just over the 2% limit | Viewport 15.1 |
| P3-FALLBACK-01 | A feathered brush no bitmap size suits falls back to a CPU mask | Viewport 15.1 |
| Legacy shader inputs | Three settings left from removed features (159, 156, 157) | Viewport 15.7 |
| Renderer class | `HDRWebGPUPreview` is one class of about 8,000 lines. Not being divided; see Modularization 7.1 for why | Modularization 7.1 |
| PIPE-01 | Review the order of the whole processing pipeline before 1.0 | PRD 11a |
| BW-01 | Black & White slider strength, fade points and preset values are first estimates awaiting Steve's tuning | PRD 11a |
| DETAIL-01 | Texture and Microcontrast behave very differently; review both | PRD 11a |
| CLARITY-01 | Brush and mask Clarity at a large radius works the GPU harder than global Clarity | PRD 11a |
| DENOISE-02 | Other Denoise engines (Open Image Denoise, neural). Ideas only | PRD 11a |
| Local-grade transfer | Copy or move a local adjustment's grade between HDR and SDR. Its own sprint | PRD 13, "Deferred: separate sprints" |
| Preview settling | Optional full-resolution settle and a shorter refinement delay. Its own sprint | PRD 13, "Deferred: separate sprints" |
| Path feather | Stress-test extreme Feather and Softness on awkward paths | PRD 13 |
| TIFF colour space | A TIFF with an unrecognized colour profile falls back to a misleading default | PRD 13, item 12 |
| Source workflows | Untested: Photoshop OpenEXR export, GIMP, linear DNG from Adobe and DxO | PRD 13, item 13 |
| SDR gamut | Research a perceptual HDR-to-SDR colour mapping to replace the luma-first compressor | PRD 13, item 14 |
| Delivery proofing | Physical browser and hosting checks of exported files | PRD 13, items 1 to 5 |
| DNG import | Decide whether Experimental DNG Import can lose the "experimental" label | [Linear DNG Import](Linear_DNG_Import_Sprint_PRD.md) |
| Linux banding | Presentation-only dithering for HDR gradients on KDE/Wayland | [Known limitations](../known-limitations.md) |

## Not requirements

Steve, October 8:

- No formal hardware validation. He checks Linux and macOS when a release
  is made.
- No signing, notarization or clean-machine test programme. Builds ship
  unsigned.
- DISPLAY-01 (HDR preview after moving between monitors) is confirmed fixed.
- The by-eye check of feathered luminance masks is done; they are fine.
