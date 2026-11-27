# Approved export and TIFF follow-ups ? 27 November 2026

Implements Steve's three approvals after the export/IO review and 4c6f77de.

Delivery has a 60-second **inactivity** watchdog, not a total-duration limit.
Stage completions, job permit responses and received response-body bytes reset
it. The one-second renderer-liveness poll cannot reset it. Progress reaches the
broker at most once per second; the broker's former fixed 180-second claimed-job
limit is now an inactivity check. Queued work has no render deadline. A stall
destroys the isolated worker's device, closes its resources by reloading the
worker, and reports the existing one-attempt CPU fallback. The broker releases
its reservations, source maps and partial spool through existing failure cleanup.
A reload is also scheduled if reporting the error hangs. The fallback reason is
available in renderer diagnostics; no new modal UI is added.

Finishing admission sizes resize/sharpening from `photo_output`, separately
charging the canvas during composition and padded-strip readback. It retains
the existing budget, minimum creative room and 32 MiB safety allowance. The
resize estimate conservatively counts native, intermediate and final photo
textures together. It never substitutes photo dimensions for canvas storage.

TIFF fixtures were built first: eight orientations in reduced/full loading,
8/16-bit custom-gamma RGB profiles whose name still says sRGB, and malformed /
non-RGB profiles. 18/20 initial fixture cases failed on the original loader.
Orientation now changes sample positions and oriented source dimensions. ICC
imports run through libvips/LittleCMS into float linear sRGB, in cancellable
128-row bands with 16-bit device-sample precision. Embedded profiles are
validated before conversion because libvips otherwise silently substitutes
sRGB for corrupt profiles. Float/HDR ICC encodings and non-RGB device spaces
remain unresolved and request a source colour choice; they are never guessed
from a display name or clipped into the integer conversion route.

The former fake-ICC/name-classification test now verifies that invalid ICC
payloads remain unresolved regardless of their advertised name. Real ICC
conversion is tested with actual profile bytes. Library's RGB cache identity
is advanced because its stored source interpretation has changed.

Validation on the Windows PC (faulty VRAM remains a hardware qualification):

- Dedicated TIFF/import checks: 94 passed. Delivery/finishing Node checks:
  14 passed; the subsequent watchdog/lifetime checks using the real activity
  class passed all four cases.
- Locked `photo-framing-delivery.js`: passed all six formats on GPU and CPU,
  Proof artifact checks, framing/ceiling agreement and Library checks. Two
  startup attempts hit Playwright's missing execution context; an intermediate
  run found empty HTTP response wrapping and browser timer binding defects in
  the new watchdog. Both were fixed and regression checked before the passing
  final real-app run. No tolerances were relaxed.
- `node --test tests/*.test.js`: failed in `release-runner.test.js` with a
  subprocess timeout while other suites were running. An isolated recheck
  after load dropped is recorded below.
- Full `.venv/Scripts/python.exe tools/test-python.py`: parallel phase
  5008 passed, 56 skipped, seven failed; serial phase 46 passed. Wall time
  1149.39 seconds. Six failures belonged to TIFF integration. The Library's
  authored-SDR flag now recognises ICC-converted linear samples; orientation
  expectations and fake profile-name expectations now match the approved
  interpretation. Manual transfer choices retain precedence over ICC error
  metadata. All nine affected parameterized cases passed their final recheck.
  The accompanying cache/Library/TIFF/API regression run had 193 passing cases
  before those final three expectation/override cases were corrected.
- The one unrelated full-suite failure remains
  `test_library_source_baseline.py::test_source_baseline_counts_preparations_without_touching_source_or_sidecar`:
  Library helper startup exceeded 32 seconds. The standalone quick Library
  check likewise stopped before launch when `library-mixed-fixture.py run-copy`
  timed out. It was not repeated; the successful framing driver includes its
  own Library checks.
- Persistent decoded-source cache provenance and Library RGB/live identities
  are advanced together, so old TIFF orientation/colour pixels are rebuilt.

The first full-suite attempt was discarded because fixture edits overlapped
xdist collection. Only the complete second run is counted above. No additional
full suite or GPU sweep was started after it finished.

Isolated `node --test tests/release-runner.test.js`: **28 passed**, zero failures,
16.32 seconds after the other suites finished. The earlier timeout was not
reproduced under the lower load.
