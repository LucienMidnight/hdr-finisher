# Sprint plan: next-version investigation (November 13, 2026)

**Coordinator:** Claude (Opus 5.5, architect; checks every report, writes the
proposal). **Researchers:** Codex `gpt-6.1-sol`, reasoning effort medium, one
per workstream, each in its own worktree on a `research/<id>` branch made
from `main`. **Owner:** Steve. **Output:** one proposal,
`docs/technical/briefs/proposal-next-version-<date>.md`, for Steve to review
with other agents before anything is built.

This is an investigation sprint. Nothing is merged, pushed or built.
Throwaway prototypes and measurements stay in the researcher's worktree.
`AGENTS.md` applies; where this plan asks for something it does not cover,
the reason is given.

## Workstreams

| ID | Question | Items | GPU time box | Wall time box |
| --- | --- | --- | --- | --- |
| A1 | Grade slow paths | 0.9.2 open items 1–5: SDR HSL Show selection, SDR Match entire, Film/lens drag frame rate, Exposure after Denoise, RAW Edge colour / Highlight method / lens focal waits | 30 min | 3 h |
| A2 | Grade timing coverage | Item 12: time the controls 0.9.2 did not (mask and Boolean authoring, perspective and custom geometry, repair list actions, preset import/export) with `tests/performance/grade-release-sweep.js` | 30 min | 3 h |
| A3 | Preview range and GPU reliability | Items 6, 9, 13: HDR film-stock preview ceiling, random bad GPU edge-colour pixels on this PC, GPU retry audit follow-up | 30 min | 3 h |
| A4 | Library smoothness and file operations | Items 7, 8: 1–3 s drawing gaps in the Library smoke check; marks waiting during rename/move/delete; source-to-cache index | 30 min | 3 h |
| A5 | Cross-platform and leftovers | Items 10, 11, 14: JPEG XL colour tags on macOS/Linux, real Mac test coverage, sweep of module PRD open work and known limitations for things still broken | none expected | 3 h |
| B1 | Local AI denoise | RAW and RGB models against Denoise v2 | 30 min | 3 h |
| B2 | Local AI search and tagging | Image embeddings, text search, tag suggestions, index storage, 10,000-photo indexing speed | 30 min | 3 h |
| B3 | Local AI masking | Sky, subject, people, object and click-to-select segmentation feeding local adjustment masks | 30 min | 3 h |
| C | Feature parity | Matrix against Lightroom Classic, Capture One and DxO PhotoLab (November 2026 versions), gap sorting, candidate releases | none | 3 h |

GPU time box is the total of slow graphics/Electron runs a researcher may
use without asking. Anything more comes to the coordinator first, who takes
it to Steve (AGENTS.md "Stop and ask").

Note for Workstream B: the master PRD lists "AI-based selection or
generation" as decided out of scope and AI search and tagging as "version 2
at the earliest". This sprint only asks whether they are feasible; adopting
any of them is a scope decision for Steve, and the proposal will say so.

## Shared rules for every researcher

- **Investigation only.** No merge, no push, no change to `main`, no
  installer. Prototypes are throwaway and never merged.
- **Base on `main`.** The worktree starts from the coordinator's checkout,
  which is `feat/watermark-and-library-polish` (main plus delivery watermarks
  and Library selection changes). Run `git switch -c research/<id> main`
  first. Use `git diff main feat/watermark-and-library-polish` to see that
  unmerged work where it touches your area.
- **Worktree setup:** if `codebase/node_modules` or `codebase/.venv` is
  missing, make a directory junction to the one in
  `D:\AI\AI Projects\HDR Finisher Tool\ai\codebase`. Never copy or commit them.
- **One graphics run at a time across all agents.** Every Electron, GPU,
  real-app or GPU-inference run goes through
  `python "D:/AI/AI Projects/HDR Finisher Tool/gpu-run-lock.py" --label <id>-<what> --minutes <N> -- <command>`
  from `codebase`. It takes the shared `gpu-run.lock` atomically, also
  respects the older `gpu-check.lock`, sets the 2560x1440 window size, kills
  the run at the time limit and always releases the lock. Never run a
  graphics check outside it. Fast Node and Python suites do not need it.
- **Disk:** run `.venv/Scripts/python.exe tools/output_size.py` before and
  after measurement work; delete scratch afterwards. Model weights and
  packages for prototypes go in `scratch/` under the worktree (git-ignored
  or untracked) and are deleted at the end. No system-wide installs.
- **Never write over the read-only test projects or original photos.** Use
  the copies in `codebase/output/test-photos/` read-only.
- **Evidence:** every claim cites file and line, a run (command, date,
  numbers), a log, or a web source with link and date. Mark each claim
  **measured**, **read in code/docs** or **estimated**.
- **Report:** write it to
  `docs/technical/research/next-version-2026-11-13/<id>.md` in your worktree,
  commit it on your `research/<id>` branch (report only; no raw measurement
  output, no prototype code unless under 200 lines and useful), and return
  the same text as your final message.

## What the coordinator does with the reports

Checks each report, verifies in code or source every claim that decides a
recommendation, and sends weak or conflicting findings to a new researcher
with the objection. Then writes the proposal (summary for Steve, the three
workstreams, phased plan, tolerances, Steve's decisions, open questions),
commits plan, proposal and research notes on `investigate/next-version`,
publishes the proposal as a private page and reports to Steve.
