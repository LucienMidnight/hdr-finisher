# Codex Brief — Smaller release areas, and the Library request limit

## HDR Finisher

**Date:** October 17, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first. There are two separate tasks here. Do them in order
and commit each in small steps. **Do not push.**

0.9.1 is published. Since your runner work, two follow-up commits changed the
runner's data files:

- `ea53ac9` removed the failures that were fixed before release from
  `tests/release/known-failures.json`. Two remain: the film-stock extreme HDR
  range, and the lens tier-consistency decision.
- `f4c3f92` mapped the last 18 unmapped app files to areas. Every tracked
  frontend, backend and desktop file now maps.

Build on those. Do not undo them.

---

## Task 1 — Make the area tier a real release set

### The problem

The runner works, but the **area** tier holds 139 drivers, close to the whole
old sweep split by feature:

| Area | Area-tier drivers |
|---|---|
| preview | 39 |
| library | 31 |
| masks | 23 |
| ui | 17 |
| detail | 16 |
| geometry | 8 |
| film | 5 |
| lens | 3 |

So a change to almost any viewer file selects about 70 drivers. A release the
size of 0.9.1 (changes since `v0.9.0`) selects 152 drivers. That is 53 minutes
from history, and 35 of those drivers have no timing at all, so it would
almost certainly pass the 75-minute cap. Steve's goal was a release check of
about 45 minutes without a hand-written brief. The runner cannot deliver that
until each area is small.

### Goal

For each area, keep a **small release set** in the area tier: the few drivers
that best protect that feature. Move the rest to **full**, which runs only
when Steve asks. Nothing is deleted.

When you are done:

- If **every** area has changed (a 0.9.1-sized release), the estimate
  including retries is **60 minutes or less**.
- A typical single-area change (for example, one Library or one masks file)
  adds **about 15 minutes or less** on top of core.
- Every area still has at least one area-tier driver.
- Core is unchanged unless you find a core driver that is clearly redundant.
  If so, ask before moving it. Export/Proof stays in core (AGENTS.md "Still
  strict").

### How to choose

Use judgment. Read the drivers; their names are not enough. Prefer drivers
that:

- check results (pixels, parity against the CPU export, saved files, what the
  app shows) rather than wording or structure,
- cover a different path from the others kept (do not keep three drivers that
  test the same thing at different sizes),
- have caught real problems (see the 0.9.0 and 0.9.1 results and
  `docs/known-limitations.md`),
- are quick, where two would protect the same thing equally.

Timing, endurance, A/B and benchmark drivers do not belong in the area tier.

### Timing history

The estimate is only as good as the history. For drivers in the **new**
area release sets that have no timing history, run each one once through the
runner (`--driver`), one at a time. That gives the estimate real numbers.
**Cap: 45 minutes of slow tests in total for this step.** If you reach it,
stop and list what is still unmeasured. Do not run the full tier or a full
release check.

### Also

- In `tests/release/README.md`, add the **GitHub trial build** as the last
  release step, before tagging: push the branch, run
  `gh workflow run desktop-release.yml --ref <branch>`, and tag only when
  Windows, macOS, Linux and Flatpak all pass. That build is the only macOS and
  Linux test run. It also runs the packaged-app smoke test
  (`desktop/tests/electron-smoke.js`), which found a real Library focus bug
  in 0.9.1. The runner cannot do this step itself. Document it, do not
  automate it.
- Keep the inventory check passing: every driver stays listed, with a tier.

### Report for Task 1

- A table of drivers per area: kept in the area tier, and moved to full.
- The estimate for a release where every area changed, and for one typical
  area, saying which numbers come from history.
- Any driver you were unsure about, one line each.

---

## Task 2 — The Library opens more pictures at once than its limit

### What is wrong

`tests/photo-library-stage-a.js` opens a real folder with an empty cache,
`D:/Photos/HDR Test Images`. It counts how many `/api/library/picture`
requests are open at the same time. The agreed limit is **4**. The Library's
request queue is created with a concurrency of 4
(`frontend/library-request-queue.js`). In the 0.9.1 work the driver saw a
peak of **8** (recorded in commit `462b305`). The limit was left unchanged.
Every other part of that driver now passes.

### What should happen

When a folder is opened cold, no more than 4 picture requests run at once,
and the first picture is still drawn before the rest of the visible pictures
finish.

### What is known about the cause

Not established. Possible explanations, unconfirmed:

- a second path that asks for pictures without going through the shared
  queue,
- two queues each allowing 4,
- retries or cancelled requests being counted while they are still open,
- the driver counting requests that do not belong to the cold-folder step.

Find the actual cause before changing anything.

### What to do

- If the **app** goes over its limit, fix the app so it stays at 4 or below.
  Too many decodes at once is what makes a cold folder slow and memory-heavy
  on large RAW folders.
- If the **driver** miscounts, fix the driver so it counts only the
  cold-folder requests. Keep the limit of 4.
- **Do not raise the limit of 4** without Steve's agreement (AGENTS.md
  "Loosen").

### Constraints

- `D:/Photos/HDR Test Images` holds Steve's real photos. Never write to,
  rename or delete anything in it.
- Do not change the Library's look, its ordering or what it shows.

### Checks for Task 2

- The fast checks.
- `photo-library-stage-a.js` through the runner (`--driver`).
- One more Library driver only if your fix touches the shared request queue,
  chosen from the new Library release set.

---

## Records

- One short note per commit.
- Record the Task 1 outcome in `tests/release/README.md`, not in a new
  document.
- If Task 2 changes app behaviour, update `docs/known-limitations.md` only if
  something there is no longer true. Its 0.9.1 release-decision paragraph
  names the cold-folder request peak.

## Stop and ask

- If either task needs more than about 30 minutes of slow tests beyond the
  45-minute timing cap above.
- If Task 1 can only meet the 60-minute target by removing an area's last
  driver, or by taking anything out of core.
- If Task 2's cause turns out to be a design choice (for example, deliberate
  read-ahead) rather than a bug.

## Report back to Steve

Plain language and short:

1. Task 1: how long a big release check and a typical one now take, and how
   many drivers moved to full.
2. Task 2: what caused the 8 requests, and what you changed.
3. Anything you were unsure about, one line each.
4. Your local commits. Do not push.
