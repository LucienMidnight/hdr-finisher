# Cleanup and performance sprint: morning report (Mac, November 29, 2026)

Brief: `docs/technical/briefs/sprint-cleanup-audit-2026-11-28.md`. Nothing has been pushed.
There are two local branches:
- `sprint/cleanup-audit-2026-11-28`: cleanup, bug fixes and speed-ups with no change to
  pixels.
- `film-fast-look`: the new fast Grain and Mist. It changes the look slightly, so it waits
  for your review.

## What got faster (MacBook Neo, same photos, before and after)

| What you do | This morning | Now (sprint) | With the fast Film branch |
| --- | --- | --- | --- |
| Exposure drag with Film on, 24 MP, Fit: settles after release | 1.32 s | 0.73 s | **0.05 s** |
| Film slider drag, Fit: settles after release | 0.63 s | 0.55 s | **0.02 s** |
| Exposure drag with Film on, 50 MP at 100%: settles | 4.80 s | 1.90 s | **0.91 s** |
| Highlight Compression, Exposure drag: settles | 0.39 s | 0.30 s | 0.30 s |
| Unchanged RAW Apply, 42 MP | 5.57 s | 0.33 s | 0.33 s |
| Micro Grain on at 100%, 50 MP | 7.95 s | 1.34 s | 1.34 s |
| Highest memory, 50 MP at 100% | 4.34 GB (over the 4 GB limit) | 3.63 GB | 2.5 GB in the Film run |
| Print Contrast slider: backend work per new value | about 51 ms and 4.4 MB | about 2 ms and 3 KB | same |

With the fast Film branch, Film adds about 0.04 s to the first new picture while dragging.
That's inside your 100–200 ms aim. The picture while dragging and after release is
identical, so nothing shifts on release.

## Your decisions, one at a time

1. **Fast Film Look (branch `film-fast-look`).** Review the crops in
   `codebase/output/review/film-fast-look/index.html`. At normal size they look nearly the
   same. At 100% the grain specks differ, and the finest grain (Size 0) is quieter when
   zoomed out. Black-and-white keeps its broader shadow clumps.
   - **If you approve:** I merge it into the sprint. You then test it on the PC's big screen.
   - **What could break:** existing grades get slightly different grain specks and glow.
     Export and the preview still match each other. All Film export checks pass with no
     limit loosened, and the HDR ceiling check passes.
   - **CPU export:** with Grain it is 36–38% faster. Mist alone is unchanged.
2. **33 small bug fixes that change what the app shows (`needs-steve`).** These include:
   - stale settings after RAW replacement;
   - old tiles or caches showing outdated pictures at 100%;
   - a cancelled Quit that stays armed;
   - presets hidden by a scan limit.

   Each one corrects wrong behaviour, but the overnight rule kept them back because they
   change what you see. 15 have ready patches in
   `docs/technical/audits/2026-11-28-mac/patches/`. My recommendation is one approval for the
   group: I apply them in small commits with their checks, and the rest get fixed first.
   The list with one line each is in `findings.jsonl` (status `needs-steve`).
3. **When to push and run the PC stage.** I need your OK to push the sprint branch, then
   run Phase 6 on the PC. The PC to-do list is in AGENTS.md.

## Problems found and fixed tonight

- **Denoise off and on again took 3.2 s after the memory fix.** It is now instant again
  (0.06 s). The 100% memory savings held.
- **App start-up could fail on the Mac after many crashes.** Every forced quit leaked 10
  system "semaphores". Yesterday's test crashes used up the Mac's 10,000, so nothing could
  start. The limit was raised until the next restart. The app now creates none at start-up.
- **Measurement fix.** The audit only counted pictures still current at the next frame.
  It now also records the first new picture (`first_frame_ms`). The Wheels and Bands
  "slowdown" was a measurement artefact; both update in about 0.05 s.

## Checks

- Code tests: 1,643 pass.
- Python: 5,169 + 47 pass.
- Quick Library check: passes on a quiet Mac.
- Focused release check (69 minutes): 118 of 125 pass, plus 1 flaky that passed on retry.
  Four failures also failed at v0.9.4 on this Mac: Edge missing, the Windows-only JPEG XL
  helper, a protected project relink, and a window 1 pixel short. Two are intermittent and
  also fail on this morning's code: `tone-preview-overlay` and `library-export-live-tiles`.
- Fast Film branch: all 10 Film delivery checks pass. That covers the 128 lens cases,
  22 tiled Film cases, Grain parity, large photos, Film stocks, local detail, the HDR
  ceiling and tier consistency.
- Disk: 22 GB of the 100 GB allowance.

## Still open

- **Film at 100% on 50 MP.** It is twice as fast but not realtime: Exposure settles in
  0.9 s. The next step would be the 100% tiles.
- **Grade module audit.** 98 findings are still `open` (lower priority, not yet worked).
  The repeatable audit data is in `docs/technical/audits/` for the next run.
- **Leftover semaphores.** A forced quit while the Library is reading many photo details
  can still leave some behind. This is rare.

Review folders that can be deleted after you've looked at them:
`codebase/output/review/film-fast-look/`.
