# Codex Brief — Release test list and runner

## HDR Finisher

**Date:** October 16, 2026
**Branch:** stay on the current branch (`film-look-rebuild`). Do not switch.

Read `ai/AGENTS.md` first. This is test tooling only. **Do not change any
application code, tolerance, limit, budget or pinned value.**

## Goal

Make the release check a single repeatable command instead of a new brief and
a new set of runner scripts each release. When this is done:

1. Every GPU/Electron driver script is listed once, in one committed file, with
   the area it covers, how often it should run, and how to start it.
2. One committed runner reads that list and runs the right drivers for a
   release, the changes since the last release, or a named area. It reports
   in plain language and keeps a history of times and results.
3. The one-off investigation scripts are labelled as such and never run as
   part of a release check.

Steve's target: a normal release check finishes in **about 45 minutes or
less** without anyone writing a brief to choose the tests. The full sweep stays
available, but only when Steve asks.

## Why (what went wrong at 0.9.1)

See `docs/known-limitations.md`, "v0.9.1 pre-release check", and
`codebase/output/performance/review/prerelease-0.9.1-2026-10-16/`:

- The test list was chosen by hand in a brief, then reworked during the run.
- Six runner scripts (`run-initial.cjs`, `run-prioritized.cjs`,
  `run-resume.cjs`…) and several "shared entry" adapters were written for that
  one release. The 0.9.0 runner had paths for that release written into it. None
  of this is reusable.
- Several drivers needed special starting arguments, a native launcher, or an
  adapter. That knowledge lives only in `invocation-notes.json` from that run.
- The run hit the 75-minute limit with 28 drivers unfinished.
- A commit landed during the run, so the results do not describe one revision.
- Many failures were drivers that had fallen behind the app, not app bugs.

For scale: the 0.9.0 sweep ran 149 drivers in 51 minutes. 127 of them took
under 30 seconds and three took 15% of the total. The roughly five-hour
estimate came from the coverage audits, endurance run and timing sweeps, not
from the drivers.

## What to build

### 1. The test list

One committed, machine-readable file in `codebase/tests/` that covers every
driver under `codebase/tests/`, `codebase/tests/performance/` and
`codebase/desktop/tests/`. Choose the format and the fields. Each entry must
answer:

| Question | Notes |
|---|---|
| What is it? | Driver path. |
| What does it protect? | One or more areas, from a short fixed list you define: for example export/Proof, film, lens filters, library, masks/local, detail/denoise, geometry, core preview, UI. Keep the list short enough for Steve to read. |
| How often does it run? | A tier (see below). |
| How is it started? | Electron runner, native runner, plain Node, packaged build, special arguments, a helper only run through another driver. This should replace adapters written for one release. |
| How long does it take? | Filled in from run history, not by hand. |

Tiers, from most to least frequent:

| Tier | Runs | Contents |
|---|---|---|
| **core** | Every release | Export and Proof (AGENTS.md "Still strict"), shader compilation, initial load, parameter layout, and a few quick preview parity checks. Should take no more than about 15 minutes. |
| **area** | At a release, when its area has changed since the last release tag | Regression drivers for a feature. |
| **full** | Only when Steve asks | Slow or broad checks that are worth keeping but not every release. |
| **diagnostic** | Never automatically | Probes, benchmarks, A/B experiments, timing sweeps and endurance runs written to investigate one problem. They stay in the repo and still work on request. |

Decide the tier and area of each driver by reading it. When unsure between
two tiers, choose the less frequent one and list it in your report. The
contents of `tests/performance/` are mostly diagnostic, but check each one: some
(for example `export-parity.js`, `preview-export-compare.js`, `roi-parity.js`)
are real release checks.

A fast check (part of `node --test tests/*.test.js`) must fail when a driver
file exists but is not on the list, or when the list names a file that no
longer exists. That keeps the list up to date as agents add drivers.

### 2. The runner

A committed script, started with one short command (an npm script is fine).
It must:

- **Choose the set to run.** It must handle:
  - a release check: core, plus area drivers for every area touched since the
    last `v*` tag;
  - a named area or tier;
  - the full sweep;
  - a single driver.

  The mapping from changed source files to areas lives in or next to the test
  list. A changed file that maps to no area must be reported, not silently
  skipped.
- **Estimate before running.** Print what it will run and an estimated time
  from history (no history: say so). If the estimate is over 30 minutes and
  this is not a release or full run, it must stop and say so (AGENTS.md "Stop
  and ask"). For a release check, it must say when the 75-minute cap would be
  exceeded.
- **Run one revision.** Refuse to start with uncommitted changes to tracked
  files. Record the revision. If HEAD moves during the run, report this
  clearly.
- **Keep Steve's projects safe.** Hash the read-only test projects before and
  after (the three fixtures in the 0.9.0 `run-sweep.cjs`). Stop if a hash
  changes.
- **Run drivers one at a time** at `HDR_FINISHER_ELECTRON_WINDOW_SIZE=2560x1440`,
  using the start method on the list. Keep one log per driver.
- **Resume.** Rerunning after an interruption continues where it stopped
  instead of starting over.
- **Rerun failures once** and classify each failure:
  - **known**: listed with the same message in a committed known-failures file
    that you create from the current `docs/known-limitations.md` entries;
  - **flaky**: passed on rerun;
  - **new**: everything else.
- **Write a short summary.** It has the verdict line, the counts and one line
  per failure with its class, in the style of the AGENTS.md report. Write it
  under `codebase/output/` (this folder is git-ignored), in one folder per run.
- **Keep history.** Store each driver's duration and result across runs, so
  estimates improve and drivers that keep failing can be seen. History lives
  under `codebase/output/` too; the list itself does not store times.

### 3. Documentation

- Update the "Release points only" section of `ai/AGENTS.md`. It should tell
  agents to run the runner's release check, and to add new drivers to the
  list with an area and tier. **Do not change the policy**: the time limits,
  the "Still strict" rules and the ask-before-pushing rule stay as they are.
- A short README next to the runner covers how to run it, how to add a
  driver, and how to mark a failure as known.

## Constraints

- No application code changes. No changes to tolerances, limits, budgets,
  pinned shader values or exact-match checks.
- Do not delete any driver. When a driver looks dead (it tests a removed
  feature such as Bloom, or the wavelet Denoise), tier it **diagnostic** and
  list it in your report so Steve can decide whether to remove it.
- Do not repair failing drivers as part of this work. The 0.9.1 failures are
  tracked separately. Add them to the known-failures file as they stand.
- Do not change how the fast checks run. Making the Python tests run in
  parallel is a separate job.
- Never save over the read-only test projects.
- Keep each file's existing line endings (see AGENTS.md).

## Testing this work

This is tooling, so keep the slow testing small:

- The fast checks, including the new check that the list is complete.
- The runner's plan-only mode for each selection mode (release, area, tier,
  full, single driver), checked against what you expect.
- One real run of the **core** tier, which shows logging, hashing, summary,
  resume (interrupt it once) and history. This is the only slow run, and it
  should take no more than about 15 minutes. If core is longer, report that
  rather than running it.

Do not run the release check or the full sweep.

## Report back to Steve

Plain language and short:

1. The command to run a release check, and what it does.
2. How many drivers are in each tier, and the estimated time of a release
   check today. Say which parts of the estimate come from history and which
   are guesses.
3. Drivers you were unsure about, and drivers that look dead (candidates for
   removal), one line each.
4. The result of the core run.
5. Your local commits. Commit in small steps. Do not push.

## Questions protocol

If something in this brief conflicts with how the drivers or runners actually
work, ask before inventing a workaround. That includes a driver that cannot run
alone, or a tier that cannot be decided without running it.
