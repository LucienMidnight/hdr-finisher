# Phase 3 Texture repair and wide-Clarity peak gap — October 2, 2026

Steve requested autonomous sprint continuation. Match speeds remain accepted
for now and were committed as `e3a5a7f`; no push was made. This continuation
is uncommitted. CPU export and full-size Proof remain unchanged references.

## Texture filtering repaired

A four-mask HDR native check set global Texture 100, Clarity 100 / radius 3%,
Sharpen 100 / radius 3 px / threshold 0. Sharpen's maximum is 200, so this
is an upper-range combination, not the complete maximum-control matrix.
The original GPU Texture used five sparse Gaussian taps per axis, while
export uses three box passes. Its native centre comparison failed:
luminance p99 4.3531%, maximum 25.7087%, 13,159 pixels above the 5% ceiling.
OKLab p99/max was 0.00546/0.02635.

Both global and local Texture now use the exact export box kernel already
used by Sharpen. Interior convolution is fused per axis. At image boundaries,
counts retain each box pass's clamping; quadratic counting replaces the
previous Sharpen cubic boundary loop. Texture retains production half-float
fine/coarse channels, while Sharpen retains its high/remainder packing.
The graph's tile halo now covers three integer box radii plus Texture's
two-coarse-radius edge guide and the existing sampling margin. Cache reuse
across amount changes is unchanged.

`sharpen-blur-reference.js --texture` checks the actual shared kernel with
float32 intermediates against `_gaussian_blur`, not a JS reimplementation.
36 cases pass (HDR/SDR, 64x40 and 3x2, nine sigmas including 2.875 and 11.5).
Maximum absolute log-luminance error is 0.0000171662. The Sharpen mode also
passes 36 cases through its production half-float high/remainder packing,
maximum 0.0000176430. The existing 0.00002 limit is unchanged. An initial
shader startup failed on a reserved WGSL identifier; it was corrected before
these passing runs.

`detail-upper-final-halo-native.json` tests the final implementation, including
the increased halo, on the app-selected native tiled route at scale 1:

| HDR region | Pixels | Luminance p99 / max | OKLab p99 / max |
|---|---:|---:|---:|
| Centre | 1,947,690 | 0.4251% / 4.1098% | 0.001897 / 0.018311 |
| Export peak vicinity | 1,932,615 | 0.382% / 1.880% | 0.00155 / 0.00389 |

Paired-pixel, picture and mask verdicts pass. The centre path/gradient are
exact; the peak-vicinity gradient differs by 0.06 levels and the path is
exact. Regional luma maxima are 2.13 / 2.54 levels, within the unchanged
three-level gradual-mask trial. The previous centre-only repair capture,
before the final halo change, is `detail-global-upper-native-exact-texture.json`.
The failing baseline is `detail-global-upper-native.json`.

## Unresolved Peak readout at wide Clarity

All three native runs fail the separate 1% editing peak requirement. The
scope panel reports **2,989 nit**, versus export's full-frame luma maximum
**3,703.3081 nit**, **19.2884% low**. The export peak is at (4564, 2939).
There is no valid bounded editing-peak cache for this state; the reported
number is explicitly labelled `Peak (preview)`. No assertion was relaxed.

`editing-peak-diagnostic.js` forces the existing bounded measurement and
records its candidate patches and source halo without a CPU export:
`detail-upper-peak-diagnostic.json` reports **editing peak patch budget
exceeded**, source halo **1,121 pixels**, calculated patch processing bound
**89,870,400 pixels**, versus the unchanged **4,194,304-pixel budget**.
Wide global Clarity needs its brightness map's source neighbourhood even
though the foreground tile halo only carries the smaller Detail bands.
Simply raising this guard would permit more work than this entire 42 MP
frame; it would undermine the bounded editing design.

This is a measurement-design limit, not the repaired Texture picture error.
No new measurement algorithm, whole-image native edit processing, peak-shader
change, or CPU-export change was introduced. The 1% requirement remains open.
Under the supplied continuation instruction, an unmet accuracy limit requires
showing evidence and stopping for Steve's decision. The owner decision is
whether to carry this wide-Clarity measurement issue while continuing other
phase 3 work, or prioritize a new bounded measurement design first.

Steve decided on October 2 to mark this as an open issue and continue the
remaining phase 3 work. The 1% accuracy requirement and bounded-work budget
remain unchanged. The measurement redesign is deferred; this decision
authorizes continued work despite this documented gap, not phase 3 closure.

## Provenance and remaining work

Electron ran serially at 2560x1440 with disposable profiles; fixtures were
never saved. Four-mask SHA-256 remains
`3004b621783d77d7fefee6a1997392e1599954ab845b833208841fab1f4d1825`.
Raw artifacts are ignored under
`codebase/output/performance/review/viewport-phase3-2026-10-02/`.
58 focused graph/halo/admission/mask/shader checks pass, and 31 Python
comparison, Detail and peak-accuracy checks pass. Peak and both Denoise byte
pins remain unchanged. No new performance improvement is claimed;
Texture's denser exact kernel has not yet been timed against a baseline.

Phase 3 remains open: full local/global Detail matrix, whole-brush feather/
shift, resampling mask transforms, authored/Match SDR regional scene masks,
broader fifty-local scaling and zoom continuity, and this wide-Clarity peak
gap. Phase 4 has not started.
