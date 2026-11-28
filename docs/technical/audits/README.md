# Code and performance audits

Repeatable audits of the codebase and the Grade modules. Each audit run gets a
folder `<YYYY-MM-DD>-<machine>/` (`mac` or `pc`) here. Mac and PC folders are
separate baselines and are never compared with each other.

First run: [sprint brief, November 28, 2026](../briefs/sprint-cleanup-audit-2026-11-28.md).

## Running an audit again

1. Code review: hand each reviewer the same area split (R1–R5, M1–M6 in the
   first sprint brief). Each writes `findings-<PKG>.jsonl` in `findings-v1`;
   `audit-summary.cjs` merges them into `findings.jsonl`.
2. Module performance, from `codebase`, nothing else running:

   ```sh
   HDR_FINISHER_ELECTRON_WINDOW_SIZE=<machine window> .venv/bin/python tools/gpu-run-lock.py \
     --label module-audit -- node tests/run-in-electron.js tests/performance/grade-module-impact.js \
     --all --photo typical --zoom fit --samples 5 --out output/audits/<folder>
   ```

   Repeat for `--photo large`, and `--zoom 100` for the modules listed in the
   brief. At Fit, the typical and large aliases use `_DSC7970.ARW` for Lens
   and `IMG_3129.CR2` for Highlight Reconstruction. An explicit path always
   wins. Use `--module denoise --photo noisy --zoom fit` for the additional
   `IMG_0790.CR2` Denoise run. Add `--resume` to continue an existing run.
   (`.venv/Scripts/python.exe` on Windows.)
3. Summarise and compare with the previous run on the same machine:

   ```sh
   node tools/audit-summary.cjs --run output/audits/<folder> \
     --compare ../docs/technical/audits/<previous folder> \
     --write ../docs/technical/audits/<folder>
   ```

## Format `findings-v1` (JSON Lines, `findings-<PKG>.jsonl`, merged to `findings.jsonl`)

One JSON object per line:

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | `"findings-v1"` | Format version |
| `id` | string | `<package>-<n>`, e.g. `R2-3`, unique in the audit |
| `audit` | string | Audit folder name, e.g. `2026-11-28-mac` |
| `commit` | string | Commit the finding was made against |
| `area` | string | Package area: `desktop`, `library`, `grade-frontend`, `backend`, `repo`, or a module id |
| `module` | string or null | Grade module id (see below) when module-specific |
| `file` | string | Path from `ai/` |
| `line` | integer or null | Line in that commit |
| `symbol` | string or null | Function, class or shader entry point (survives line drift) |
| `category` | enum | `bug`, `perf`, `tidy`, `hardening`, `docs`, `test` |
| `severity` | enum | `high` (wrong output, crash, data loss, hang), `medium` (visible slowness, leak, wrong state), `low` (minor, cosmetic, tidy) |
| `confidence` | enum | `confirmed` (reproduced or traced end to end), `likely`, `suspected` |
| `summary` | string | One sentence: what is wrong |
| `evidence` | string | How it was confirmed: reproduction, trace, measurement |
| `felt_impact` | string or null | Expected effect on the wait the user feels, with numbers when measured |
| `output_change` | boolean | Would the fix change pixels, saved files or what the app shows |
| `strict_area` | boolean | Touches export or Proof output, or a pinned tolerance/limit |
| `proposed_fix` | string | Smallest fix |
| `check` | string | The cheapest check that proves the fix |
| `status` | enum | `open`, `fixed`, `deferred`, `needs-steve`, `wontfix`, `duplicate` |
| `patch` | string or null | Path of a ready `.diff` for `needs-steve` findings |
| `fix_commit` | string or null | Commit hash when fixed |
| `notes` | string or null | Anything else |

## Format `module-impact-v1` (JSON, one file per photo × zoom run)

```json
{
  "schema": "module-impact-v1",
  "audit": "2026-11-28-mac",
  "driver": { "path": "tests/performance/grade-module-impact.js", "sha256": "<hash>" },
  "machine": { "name": "MacBook Neo", "platform": "darwin", "chip": "A18 Pro", "ramGiB": 8,
               "window": "1408x794", "dpr": 2, "powerSource": "ac", "powerMode": "<HDR_FINISHER_POWER_MODE>",
               "gpuAdapter": "<adapter description>" },
  "app": { "version": "0.9.4", "commit": "<hash>", "dirty": false },
  "photo": { "role": "typical", "file": "IMG_7723.CR3", "sha256": "<hash>", "megapixels": 24.2 },
  "zoom": "fit",
  "previewResolution": "<setting>",
  "samples": 5,
  "warmups": 2,
  "denoiseProbeMethod": "clean_grain",
  "startedAt": "<ISO time>",
  "durationSec": 0,
  "modules": [
    {
      "module": "film",
      "lane": "hdr",
      "photo": { "role": "typical", "file": "IMG_7723.CR3", "sha256": "<hash>", "megapixels": 24.2 },
      "recipe": { "film-stock": "<id>", "film-look-strength": 0.8 },
      "recipeHash": "<sha256 of canonical recipe JSON>",
      "offMethod": "eye",
      "alternation": "interleaved",
      "pixelsChanged": true,
      "loadAverage": [0, 0, 0],
      "denoiseRebuilds": 0,
      "durationSec": 0,
      "status": "complete",
      "errors": [],
      "steps": [
        {
          "step": "own.film-look-strength.drag",
          "kind": "own",
          "state": "on",
          "processedLongEdge": 0,
          "first_feedback_ms": { "samples": [0], "min": 0, "median": 0, "max": 0, "iqr": 0 },
          "settle_ms":         { "samples": [0], "min": 0, "median": 0, "max": 0, "iqr": 0 },
          "drained_ms":        { "samples": [0], "min": 0, "median": 0, "max": 0, "iqr": 0 },
          "route": "gpu-direct",
          "fallbacks": [],
          "signature": "<canvas signature>",
          "memory_mb": { "footprint_baseline": 0, "footprint_peak": 0, "renderer_peak": 0,
                         "backend_peak": 0, "gpu_process_peak": 0, "webgpu_allocator_peak": 0 },
          "skipped": null,
          "errors": []
        }
      ],
      "impact": [
        { "probe": "probe.tone.exposure.drag",
          "first_feedback_delta_ms": 0, "first_feedback_delta_pct": 0,
          "settle_delta_ms": 0, "settle_delta_pct": 0,
          "footprint_delta_mb": 0, "flags": [] }
      ]
    }
  ],
  "noise": { "baseline_start": {}, "baseline_middle": {}, "baseline_end": {}, "spread_pct": 0 }
}
```

- `kind`: `own` (the module's own controls, isolated), `probe` (common
  control run with the module on and off), `cold` (first preparation, e.g.
  first Denoise, one sample before priming). If preparation is already
  resident, the cold row explains why it wasn't timed. Tone's OFF-state Tone
  probes and Denoise's OFF-state Denoise probes are not run (self-reference).
- Run-level `photo` is the requested photo. Module-level `photo` is the
  actual source and uses role `override` for a module-specific fixture. Older
  v1 rows without a module photo inherit the run photo. Regression comparisons
  require the same actual source hash.
- `samplesDetail` records the route, processed long edge, Denoise preparation
  identity and separate counts for selector setups and misses, Fit misses,
  exact reduced misses and CPU preparation misses. `denoiseRebuilds` counts
  timed samples with at least one miss. RAW steps also record Apply phases when
  available. `rawStates` records the developed ON/OFF routes and phases before
  priming. Denoise `methods` records each control map's hash, settled ON/OFF
  signatures, and any eligibility skip.
- `reducedSamples` records accepted reduced CPU fallbacks with requested and
  actual long edges, reason, timing, signature and memory. Their timings do
  not count toward the regular step statistics.
- Timing: `first_feedback_ms` runs from the control's first `input` event to
  the first GPU-fenced frame current at completion; `settle_ms` from release to
  the last current exact on-screen frame; `drained_ms` from release until
  background catch-up is idle. No p95 below 10 samples.
- `alternation`: `interleaved` (ON/OFF order alternates per sample) or
  `blocked` (RAW modules: a settled ON block, then an OFF block).
- `skipped`: null, or the reason a step was not run (e.g. Micro Grain
  unavailable with Retouch repairs).
- `state`: `on` or `off`. `offMethod`: `eye` (bypass eye), `neutral`
  (recipe reset, for modules without an eye), `setting` (RAW settings).
- `flags`: zero or more of `noise`, `impact`, `slow`, `memory`,
  `regression`, `no_op` (module ON and OFF give the same pixels; impact void),
  set by the tolerances in the sprint brief.
- Probes: `probe.tone.exposure.drag`, `probe.tone.contrast.drag`,
  `probe.denoise.toggle_on`, `probe.denoise.toggle_off`.

Module ids: `baseline`, `raw.cleanup`, `raw.lens`, `raw.highlights`,
`denoise`, `tone`, `bands`, `curves`, `highlight_compression`, `color`,
`wheels`, `hsl`, `bw`, `vignette`, `detail`, `film`, `local`, `retouch`,
`geometry`, `sdr_match`.
