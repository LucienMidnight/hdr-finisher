# JPEG Ultra HDR encoding drift — November 16, 2026

Research in progress. Shipping encoders, defaults, Proof/export gates and
tolerances are unchanged. The sprint status row was committed separately.

## Measurement contract, recorded before the new runs

- Retain the October 18 perceptual contract: HDR ΔE ITP (BT.2124), SDR ΔE00,
  whole-image mean <1.0 and P99.9 ≤3.0, separately for each image and lane.
  Use the same numbers as a **research screen** for own-source fidelity;
  this is not an approved replacement or relaxation of any existing check.
- Compare initial codec output and ceiling-corrected delivery separately.
  Do not equate better GPU/CPU agreement with faithful encoding.
- Test exactly reproducible inputs/seed and report exact encoded byte counts;
  no speed target or timing benchmark is introduced.
- Use captured matched CPU/GPU finished arrays for the sharp fixture. New
  one-renderer sensitivity cases change one half-float HDR code, one signed
  SDR 8-bit code, or both. These are defined perturbations, not new renders.
- Four real photos are from the SHA-256-approved November 14 manifest:
  sunset `IMG_3129.CR2`, fire dancers `IMG_0790.CR2`, urban HDR
  `5M071612_finished.avif`, and power-out HDR
  `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif`. Process at 1024px long
  edge, even dimensions, default creative controls and a 1000-nit Fixed cap.
  This reduced-output experiment is not native-resolution qualification or
  a claim to reproduce the photos' saved grades.
- Baseline reproduces the sharp check: base Q95/4:4:4, full RGB gain map,
  final map Q95, dithering off. Compare isolated non-default alternatives;
  never install them as production settings.
- Build a private instrumented CLI from the app's pinned libultrahdr commit
  `ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b`. Dump the computed float
  log gains and the quantized map **before JPEG**, and expose display boost
  for partial-headroom decoding. Verify baseline encoded bytes against the
  shipping CLI and full-headroom decoded pixels against the shipping loader.
  The installed `imagecodecs` Ultra HDR decoder is 2.0.2, not the pinned 1.4.0;
  do not silently substitute it for this experiment.

## Policy discrepancy to leave with the coordinator

The current `AGENTS.md` says no encoded allowance, whereas Steve's corrected
November 16 export PRD, the sprint brief and shipping `ENCODING_ALLOWANCE`
retain his November 14 1% allowance. This research changes neither rule nor
gate. Delivery measurements explicitly use the existing shipping allowance;
the coordinator must reconcile the contradictory prose with Steve, not treat
this report as permission to alter it.
