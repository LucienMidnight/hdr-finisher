# Phase 4 follow-ups 3–4 — engineering Full and native 42 MP parity

**Recorded:** 2026-09-19  
**Sprint:** [Stable Exact Preview Tiers and Full-Resolution Processing](../product/Stable_Exact_Full_Preview_Sprint_PRD_2026-09-19.md)  
**Commits:** `de6608e`, `7f3e857` on `main`  
**Status:** complete

## Result

Full is now selectable only when the application is opened with
`?engineeringFullPreview=1`. The flag installs `Full · Engineering` in both
preview-resolution selectors; the public HTML still contains only 1K, 2K and
4K. Full retains the source dimensions and does not change the selected tier
to satisfy an execution constraint.

On WebGPU, the normal planner chooses Direct or Tiled and the accepted
presentation records the execution. On CPU, Full requests
`execution: "strips"`; an unsupported graph reports the bounded-path refusal
instead of silently running whole-frame or presenting an older tier.

## Engineering Full browser evidence

`codebase/tests/engineering-full-preview.js` proves in one browser session:

- Full is absent from both selectors without the query flag;
- Full appears in both selectors with the flag;
- the GPU result is exact, source-sized and records Direct execution;
- switching to CPU sends `execution: "strips"`;
- the response carries `X-Strip-Execution`; and
- the accepted CPU presentation remains exact at tier `full`.

The built-in 1280×720 source was used for this routing test so it is fast and
discriminates the UI/application contract from the separate native corpus.

## Native 42.4 MP Direct/Tiled comparison

Input:

`codebase/local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr`

Dimensions: **5320×7968 = 42,389,760 pixels**. The test applies a non-neutral
grade (exposure, contrast, saturation and white balance), forces Direct with an
8 GiB engineering budget, then invokes the shared tiled encoder. It waits for
GPU queue completion and compares the compositor output across the entire
native canvas in isolated 1024-pixel viewport captures. This avoids both the
old 424×633 Fit-view comparison and an image-sized browser screenshot buffer.

| Tile size | Tiled tiles | Presentation submissions | Compared pixels | Differing pixels | Max channel delta |
|---:|---:|---:|---:|---:|---:|
| 256 | 672 | **1** | 42,389,760 | **0** | **0** |
| 512 | 176 | **1** | 42,389,760 | **0** | **0** |

The explicit-refusal probe also passed for Vignette, and both tiled generations
were assembled in one submission.

Command:

```powershell
node tests/tiled-direct-parity.js --url http://127.0.0.1:8765 --input local-test-media/inputs/Affinity_DSC06898_DisplayP3_Linear_32f.exr --tile-sizes 256,512 --native
```

## Full-size staging limits exposed by the corpus

The first native capture surfaced a 340,647,936-byte Dawn dynamic-uploader
request: the row-aligned size of the full 42.4 MP surface. That exceeded the
device's default 256 MiB `maxBufferSize`. The earlier Fit-view corpus never
exercised this full-surface browser/compositor boundary.

Two staging boundaries are now explicit. The streamed source loader uses one
mapped `COPY_SRC` buffer per response chunk, submits that copy and waits before
destroying the buffer, so browser response and source-upload staging share the
same bound rather than depending on `queue.writeTexture` uploader pooling. The
renderer also asks for at most a 512 MiB buffer limit, capped to the adapter's
advertised limit; 512 MiB is the maximum size of an 8192² RGBA16F surface and
the request raises a capability limit without allocating such a buffer.

## Regression evidence

| Suite | Result |
|---|---|
| Deterministic Node suites | **69 / 69 passed** |
| Focused Python frontend/Full/strip contracts | **96 passed** |
| `engineering-full-preview` | **PASS**, GPU Direct and CPU strips |
| `tiled-admission-scope-fallback` | **PASS**, CPU scope fallback, zero GPU scope calls |
| Default `tiled-direct-parity` | **maxDelta 0** at 256 and 512 tiles |
| Native 42.4 MP `tiled-direct-parity` | **maxDelta 0** at 256 and 512 tiles |
| `webgpu-shader-compilation` | **PASS** |

The prior full-suite baseline remains `1208 passed, 3 skipped`; it was not
rerun for these frontend and browser-harness follow-ups. The isolated server ran
at `http://127.0.0.1:8765` and was stopped. No application or server process is
intentionally left running.

## Handoff

All four ordered Phase 4 follow-ups are closed. Phase 5 — masks, locals and
Detail — is the next safe implementation phase.
