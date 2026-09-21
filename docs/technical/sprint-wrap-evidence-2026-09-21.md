# Stable Exact Full Preview — Sprint Wrap Evidence

**Date:** September 21, 2026  
**Scope:** non-hardware work remaining after Phases 0–8 and the Phase 9 hardware-matrix deferral

## Outcomes

### Exact peak on the bounded CPU route

The strip executor now reduces the exact peak over the same processed pixels it
presents and returns it as `X-Scope-Peak`. The accepted CPU frame carries that
value into the settled HDR scope without replacing the bounded histogram,
waveform, or vectorscope transport.

The negative controls were observed before implementation: the strip report
test failed because `scope_peak_value` was absent, the API test failed because
the header was absent, and the Full-tier browser assertion failed because the
accepted CPU peak was undefined. All three passed after the implementation.

### Full-tier presentation continuity — not reproduced

The original tier-change harness used `drawImage` to read an already-presented
WebGPU canvas. Chromium returned zeroes for that readback on this host, so the
harness reported a black viewer even when the page compositor remained
painted. The harness now samples clipped page screenshots and decodes those
pixels instead. It observed 4/4 painted samples and zero blank samples during a
4K-to-Full transition.

A retained 2D overlay and a dual-WebGPU-canvas approach were investigated, but
both were discarded: the compositor-level harness passed when those changes
were removed, so neither had a load-bearing negative control. No production
continuity workaround ships from this investigation. PERF-07 remains an
unconfirmed manual-testing item, especially on a cold proxy and other GPU
configurations.

### Full-tier scheduling and overlapping readbacks

`minimumExecutionDecision` is a one-sided admission bound: it suppresses an
interactive draft only when even the smallest Direct graph cannot fit. The
final Full tone-drag run measured 33 `interactive:pre-dispatch-tiled` refusals,
zero late `interactive:renderer-returned-nothing` refusals, zero CPU fallbacks,
zero blank samples, and a 0.9x Full-to-4K gesture time ratio on this host.

The load-bearing negative control disabled the early guard. The same harness
then failed with 38 `interactive:renderer-returned-nothing` refusals and no
pre-dispatch refusals. Restoring the guard returned the test to green.

The previously intermittent overlapping-readback defect also reproduced while
an exact peak measurement overlapped tiled rendering: WebGPU rejected a submit
because the shared readback buffer was pending map. Scope peak readback now
uses a bounded two-target pool and omits the optional measurement under further
backpressure rather than reusing a busy buffer. Eight instrumented Full renders
and three forced overlaps then completed tiled with no device errors.

### CPU-only geometry refusal

The bounded strip executor intentionally refuses roll geometry. That refusal
was confirmed as the cause of the stranded straighten handoff: no authoritative
frame could arrive to clear the temporary transform. An Unavailable result now
ends the matching geometry handoff, removes the temporary transform, retains
the last valid frame, and leaves tier selection and editing usable. The existing
Electron smoke suite reached its unchanged `straighten slider cancellation`
checkpoint after this repair.

### Manual follow-up — 4K/Full Bloom diffusion remains open

Manual testing found a stronger dark/bright/cyan echo around decisive edges at
Full than at 4K. A first hypothesis implicated Bloom Highlight Detail's
subtractive diffusion term. CPU/export and WebGPU were given matching edge
protection, but a manual retest of the reported image showed no visible
improvement. The reported defect therefore remains open; the visible ridge is
likely produced or amplified by another film or display-sampling stage.

The new compositor-level cross-tier harness isolates each film contribution by
subtracting a neutral render. Before the repair, diffusion disagreed between
4K and Full by 0.127 RGB counts on average with a 33.7-count local peak, versus
0.074 and 22 for additive Bloom. After the repair, diffusion measured 0.083
and 22, within the additive Bloom floor. Direct/Tiled film parity remains
byte-exact at both tile sizes and maximum spatial radii.

The packaged frontend shader was subsequently verified byte-for-byte against
the edited source, and the running Electron renderer and backend were verified
to come from that package. A stale Electron build is not the explanation. The
harness proves only the narrower synthetic diffusion behavior above and must
not be cited as evidence that the reported manual defect is fixed.

## Focused verification

- Python suite — 1,290 passed, 3 skipped.
- Browser/static unit suite — 91/91 passed.
- Desktop unit suite — 18/18 passed.
- `npm run test:full-tier-tone-cost` — pass; negative control failed as expected.
- `npm run test:full-tier-instrumented-tiling` — 8/8 tiled, three overlaps, no device errors.
- `npm run test:tier-change-blank` — 4/4 compositor samples painted; PERF-07 not reproduced.
- `npm run test:tier-film-consistency` — diffusion stays within the additive Bloom cross-tier floor.
- `npm run test:full-tier` — exact accepted CPU peak was 12,000 nit.
- `npm run test:tiled-parity` — byte-exact Direct/Tiled parity at both tile sizes.
- `npm run test:tiled-film-parity` — byte-exact film parity at both tile sizes.
- `npm run test:full-tier-denoise` — bypass changes both 4K Direct and Full Tiled output.
- `node tests/tiled-cpu-detail-parity.js` — no seam introduced by tiling.
- `tests/test_cpu_strips.py` and `tests/test_cpu_strips_api.py` — exact CPU peak contract.
- `tests/startup-state.js` — preference migration/recovery passed in an ephemeral browser.
- `cd desktop && npm run pack:dir` — Windows x64 unpacked application built successfully.

The Electron smoke suite passed the formerly failing straighten-cancellation
checkpoint and reached project save. The run was stopped after more than 15
minutes in later project-save work, so this is checkpoint evidence rather than
a claim that the entire Electron suite passed.

## Deferred release evidence

The hardware matrix remains deferred. This host cannot establish discrete-GPU,
integrated/unified-GPU, physical HDR-display, or physical SDR-display behavior.
Those are release-readiness checks, not implied by the automated results above.
