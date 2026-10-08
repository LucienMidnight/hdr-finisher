# Paste into the next thread — work that still reaches the CPU

## Goal

HDR Finisher's preview is meant to stay on the GPU and to work only on what
the viewer shows. Several ordinary edits still fall back to the CPU or fetch
the whole photo. Find out why for each item below, fix the ones with a
contained cause, and tell Steve plainly about the ones that need a decision.

When you are done Steve has: each item either fixed, or explained in two or
three plain sentences with what a fix would cost and what it could break.

## Context

Workspace: `D:\AI\AI Projects\HDR Finisher Tool`. Git root: `ai`. Run and test
directory: `ai\codebase`. Branch: `viewport-bounded-preview-phase-2-wip`.
Check HEAD and status first; do not reset. Local commits are ahead of the
remote and are not pushed.

**Read `ai/AGENTS.md` first and follow it.** It sets how much to test (little),
how to report, and that old projects may break before 1.0. Where this prompt
or the PRD seems to ask for more testing than it allows, `AGENTS.md` wins.

Then read, in `docs/product/Viewport_Bounded_GPU_Preview_PRD_2026-10-01.md`:
section 2 (principles), section 15.7 (the list these items come from) and
16.22 (how phase 4 closed). You do not need the rest of section 16.

State on October 6: phase 4 is closed. Steve tried a heavy project by hand
and it works well. One fault he found, an endless redraw with Denoise and
Highlight Compression both on, is fixed in `cc94373`; read that commit, as it
shows the kind of cause to look for (two parts of the app naming the same
thing differently, so one never recognises the other's result).

Useful test projects, all read-only (never save over them):

- `D:\Photos\HDR Test Images\highlight-compression-not-settled-DSC00264.hdrfinisher`
  (42 MP, Denoise on; Steve's own)
- `codebase/local-test-media/viewport/DSC00264-four-masks.hdrfinisher`
- `codebase/local-test-media/viewport/DSC00264-fifty-locals.hdrfinisher`

## The items, in suggested order

Work through them in this order unless what you find says otherwise. IDs are
from PRD 15.7.

| ID | What happens | What should happen |
|---|---|---|
| CF-ROUTE-01 | An Exposure edit made after a rotate, flip or straighten is drawn by the CPU. The app's stated reason is `dirty-edit-with-stale-geometry` | The edit is drawn on the GPU like any other |
| CF-ROUTE-09 | After the first sharp frame at 100%, the app downloads the whole 42 MP photo (about 330 MB) and draws the view again, 1-2 s after the click | Only what the viewer shows is fetched, unless the whole photo protects something. Establish why it is fetched before changing it |
| CF-SPEED-06 | On a first visit to 100% the highlight measurement runs twice in a row | It runs once |
| CF-ROUTE-04 | Scopes are sometimes computed on the CPU: on the fifty-local project, and for HDR when switching to SDR | Scopes come from the GPU in these cases too |
| CF-ROUTE-06, 07 | With a 1 GiB memory setting at Full, a drag is refused late, after work has started, and a settle sometimes takes the CPU branch | The refusal happens before work starts; the settle stays on the GPU |
| CF-ROUTE-02 | CPU mask requests beyond the one deferred case (P3-FALLBACK-01): 121 on the primary project, 402 on fifty-local | Find which masks these are and why. Fix what is contained; this one may be several causes |
| CF-SPEED-01 | Dragging Exposure at 200% on the heavy project draws 2-4 frames a second | Explore only: say where the time goes and what a fix would involve. Do not start a large change without Steve |

For CF-ROUTE-09 there is a known trade-off for Steve to decide: without the
whole-photo download, panning at 100% fetches each newly shown strip as it
appears (about 0.2 s each in one trace). Find out what the download is for,
then put that choice to him.

## How to work

- Reproduce each item with the cheapest thing that shows it: usually a short
  throwaway script run through `tests/run-in-electron.js` that opens a
  project, does the edit, and prints what was requested and which route drew
  the frame. Keep such scripts in the gitignored `codebase/output/` and delete
  them when done. Do not run the coverage audits or the full sweep to
  reproduce; they are release-point checks.
- Confirm the cause before fixing. If the PRD's description turns out to be
  wrong or out of date, say so and go with what the code does.
- One item per local commit, so any one can be undone alone.
- After the session's fixes, run the fast checks and only the GPU checks that
  cover what you touched, once, together.

## Constraints

- CPU export and Proof are the exact reference. Do not change them.
- The CPU preview stays as the fallback for a missing or lost GPU;
  `tests/device-loss-fallback.js` must still pass.
- No change to a pinned shader, tolerance, limit or budget (including the
  4,194,304-pixel editing-Peak budget) without asking.
- P3-FALLBACK-01 (the larger-bitmap brush fallback) is deferred by Steve; leave
  it.
- The picture must not change. A fix here changes where the work is done, not
  what it produces. If a fix would alter the picture, stop and ask.
- Out of scope: removing the legacy Denoise method (noted in 15.7 for later),
  the picture-mismatch items (CF-PIX), and further cleanup.
- Ask before pushing. Do not rebuild the installer.

## Questions protocol

Steve is the owner and not a coder. Ask him, one decision at a time and in
plain language with the trade-off, before: changing anything that alters what
the user sees or how panning and zooming behave, starting a change that
reaches well beyond the item, or anything that conflicts with the code or the
PRD. If something in this prompt does not match the code, trust the code and
tell him.

## Finishing

Update the rows in PRD 15.7 for what you closed or learned, in a line or two
each. No new evidence document. End with a short plain-language summary for
Steve: what is fixed, what is not and why, and any decision waiting on him.
