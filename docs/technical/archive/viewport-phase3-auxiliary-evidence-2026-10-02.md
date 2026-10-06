# Phase 3 GPU scopes and navigation — October 2, 2026

A tiled viewport cannot provide a retained whole-picture texture to the scope
reader. Previously this sent scopes to the CPU. Settled tiled scopes now
grade a separate GPU canvas at the requested scope edge, capped at 1,600.
Direct scopes keep reading their already finished picture. Interactive tiled
scopes retain the previous scope and wait for settlement; they do not run an
extra grading graph beside a gesture. Settled requests wait for foreground
work, then validate session, edit generation, geometry, lane and scope
generation before rendering, readback and publication.

Auxiliary renders own separate intermediates and do not replace the accepted
picture, placeholder, mask-frame evidence or presentation target. They keep
resident native sources when loading coarse sources. Coarse masks reuse the
normal GPU/cache contracts. Scope peak still comes from bounded native
measurement; a coarse scope texture is not native peak evidence. The 1%
limit, candidate budget and analysis mask contracts are unchanged.

Navigation grades a separate 512-edge GPU canvas after picture/scopes settle.
Its PNG uses the established SDR-display HDR mapping even on HDR displays.
Latest-state checks reject an overview when editing resumes. CPU rendering
mode keeps its bounded idle overview fallback. No native whole-image CPU
grade is added. Export and Proof are unchanged.

## Short fixture observations

`phase3-local-route-smoke.js` opens the read-only fifty-local fixture in
disposable Electron at 2560 × 1440, changes one path local's luma curve and
midtone wheel in the session, then zooms once to native. It never saves. The
recorder now waits for an actual new settled scope event; an old readiness
label can precede a newly scheduled scope. Early diagnostic attempts stopped
at that observation race and are not performance samples.

| Build / raw report | Fit picture / scopes (ms) | Native picture / scopes (ms) | Native scope |
|---|---|---|---|
| Before: `fifty-local-route-smoke.json` | 35.8 / 467.4 | 674.6 / 3,971.7 | CPU |
| GPU scopes: `fifty-gpu-scope-smoke.json` | 38.5 / 478.4 | 735.5 / 1,586.0 | GPU |
| Final: `fifty-gpu-auxiliary-smoke.json` | 39.5 / 491.8 | 820.8 / 1,767.8 | GPU |

Each cell is one operation, not a median or controlled alternating study.
Scope delay is lower in these observations; native picture time still misses
the speed goal. No general speed gain or phase 3 closure is claimed. No
five-minute session was repeated.

The final check verifies a loaded overview no larger than 512 pixels, unchanged
accepted-picture source serial, zero CPU scope/navigation-preview requests
during the operations, and rejection of superseded auxiliary rendering. No
page errors occur; all 50 locals remain. Raw reports are ignored under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`.

Focused Node checks cover graph scale, masks, local cache identities and
unchanged Peak/Denoise byte pins (27 pass). The final actual local-shader
regression covers 24 cases / 192 pixels and independent LUT offsets.
Fifteen additional Node scope/readback/disclosure/zoom-recovery checks pass
(42 focused Node checks total). Proof/export identity and peak enforcement
pass (10 Python tests). All three read-only fixture hashes remain unchanged. Mask/control
fixture comparisons are recorded separately and were not repeated for these
auxiliary canvases. The known failing tiled-admission fallback driver was not
rerun or repaired incidentally.

Phase 3 remains open for Match, brush feather/shift, transformed masks, SDR
regional luminance, the complete Detail matrix and broader scaling/continuity
coverage. This continuation is uncommitted; the earlier fixes are committed
as `fe43970`. No push or phase 4 work occurred.
