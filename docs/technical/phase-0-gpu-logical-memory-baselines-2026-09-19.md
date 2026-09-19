# Phase 0 GPU logical-memory baselines

**Recorded:** 2026-09-19  
**Source state:** dirty worktree based on `83bca704dd0422dd470de37cee0b4eb4db0fbe5c`  
**Application:** HDR Finisher 0.8.12  
**Host:** Windows 10.0.26200.9457; Node v24.14.0; Python 3.10.10  
**Display adapters observed:** NVIDIA GeForce RTX 4070 Ti, 12,282 MiB reported by `nvidia-smi`, driver 616.92; AMD Radeon(TM) Graphics, Windows driver 32.0.21045.5002

These are deterministic logical resource-size models derived from the allocation sites in `frontend/webgpu-preview.js`. They are not physical VRAM measurements and do not include driver padding, heap fragmentation, the browser compositor, swapchain surfaces, or operating-system use. No WebGPU runtime capture was made for this record.

## Confirmed allocation inventory

Let `P = width × height` pixels and `Q = ceil(width / 4) × ceil(height / 4)` pixels.

| Resource | Allocation evidence | Logical bytes |
|---|---|---:|
| Source proxy | `loadProxy`; one `rgba16float` texture, or `rgba32float` when half-float transport cannot preserve values | `8P` normally; `16P` fallback |
| Core grading graph | `ensureIntermediate`; Base, Film, Finish, and Local are four full-size `rgba16float` textures | `32P` |
| Global Detail | `ensureIntermediate`; Detail A and Detail B are two full-size `rgba16float` textures | `16P` when active |
| Spatial film | `ensureIntermediate`; two quarter-width/quarter-height `rgba16float` textures | `16Q` when active |
| Two-level Denoise evidence | three `rgba16float` evidence textures at each decimated level | `24 × (P1 + P2)` |
| Denoise resolved image | one full-size `rgba16float` texture | `8P` |
| Denoise reconstruction scratch | one `rgba16float` scratch image for each level deeper than the first | `8 × sum(previous-level pixels)`; `2P` for two levels on divisible dimensions |
| CPU spatial-mask leaf on GPU | one full-size `r8unorm` texture | `P` per retained leaf; padded upload bytes are not recorded as GPU residency |
| Scene luminance | one full-size `r16float` texture | `2P` per retained entry |
| GPU luma mask | `r16float` base, plus two full-size refinement textures when needed | `2P + 16` base; up to `6P + 48` refined, excluding scene luminance |
| Boolean mask graph | one `r16float` node texture per combine pass | `2P × pass_count` |
| Scope pool entry | `rgba16float` target, row-aligned MAP_READ buffer, and 160-float parameter buffer | `8Pscope + align256(8Wscope) × Hscope + 640`; up to two entries per size |
| Parameter/curve buffers | global, curve, local, and composite buffers | Actual `GPUBuffer.size`; included in runtime resident diagnostics, not the static baselines below |
| Comparison canvas | `ensureIntermediate` stores a graph per canvas | Adds another graph of the applicable size; not included below |

The source cache retains up to two proxy levels per session/lane. Scene-luminance caching retains up to two session entries. Local masks are LRU-trimmed to 96 MiB at edges up to 1,600 and 160 MiB above 1,600. Those cache multiplicities are runtime state, not part of the single-canvas minimum.

## Static model formula

The checked-in `directPreviewMemoryModel` defaults to RGBA16F source, active Detail, active spatial film, and two Denoise levels:

```text
resident = source + four grading + detail + spatial
         + denoise evidence + denoise resolved

transient = denoise reconstruction scratch

planned = resident + transient
peak logical = planned + retained-presentation overlap
```

For two levels and dimensions divisible by four, this is `74.5P` bytes before retained-presentation overlap:

```text
8P + 32P + 16P + 1P + 7.5P + 8P + 2P = 74.5P
```

The model's retained-presentation overlap defaults to zero. Runtime diagnostics currently estimate overlap as one largest full-size RGBA16F surface (`8P`) after any recorded presentation, not a complete retained graph.

## Named baselines

1K/2K/4K use square maximum envelopes because the tier specifies a maximum edge; real non-square images consume proportionally less. Values are MiB (`bytes / 1,048,576`) and may differ by 0.1 MiB due to display rounding.

| Case | Dimensions | Source | Four grading | Detail | Spatial | Denoise evidence | Denoise resolved | Denoise scratch | Planned total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1K | 1024 × 1024 | 8.0 | 32.0 | 16.0 | 1.0 | 7.5 | 8.0 | 2.0 | **74.5** |
| 2K | 2048 × 2048 | 32.0 | 128.0 | 64.0 | 4.0 | 30.0 | 32.0 | 8.0 | **298.0** |
| 4K | 4096 × 4096 | 128.0 | 512.0 | 256.0 | 16.0 | 120.0 | 128.0 | 32.0 | **1,192.0** |
| 24 MP | 6000 × 4000 | 183.1 | 732.4 | 366.2 | 22.9 | 171.7 | 183.1 | 45.8 | **1,705.2** |
| 42 MP | 7000 × 6000 | 320.4 | 1,281.7 | 640.9 | 40.1 | 300.4 | 320.4 | 80.1 | **2,984.0** |
| 8K UHD | 7680 × 4320 | 253.1 | 1,012.5 | 506.3 | 31.6 | 237.3 | 253.1 | 63.3 | **2,357.2** |

RGBA32F source fallback adds another `8P`: 8.0, 32.0, 128.0, 183.1, 320.4, and 253.1 MiB respectively. Each CPU `r8unorm` mask adds `P`; each GPU mask/luminance `r16float` surface adds `2P`.

## Diagnostic coverage and known gaps

`resourceMemorySnapshot()` now reports planned, resident, transient, cached, retained-overlap, and peak-logical fields. Its resident core-grading calculation agrees with the four textures allocated by `ensureIntermediate` (`32P`), correcting the historic three-texture undercount.

The following are recorded limitations of this static record. They are **not** open Phase 0 gate items; see
[phase-0-exit-gate-evidence-2026-09-19.md](phase-0-exit-gate-evidence-2026-09-19.md) for the gate results.

- No WebGPU adapter capture was taken on the recorded GPU. Deterministic agreement between the diagnostics and the renderer's own allocation calls is instead proved by `codebase/tests/webgpu-allocation-agreement.test.js`, which drives `ensureIntermediate`, `ensureStorageBuffers`, and `acquireScopeResource` through a recording `GPUDevice` stub. Physical allocation behavior is measured in Phase 2, where the planner attempts real allocations and backs off.
- `transient.submittedWorkPendingDestructionBytes` is explicitly zero/untracked; deferred destruction can keep logical resources live.
- The static model does not include Denoise analysis low-pass temporaries, uniform buffers, upload staging, scope pools, masks, comparison surfaces, multiple cached proxy tiers, compositor/swapchain surfaces, or a full retained old graph.
- Runtime retained-presentation overlap is only an `8P` approximation.
- CPU `r8unorm` mask upload padding and the full RGBA proxy response/typed-array staging footprint are outside GPU resident totals.
- No 1K/2K/4K behavior or export regression suite was run for *this* record. That evidence is in [phase-0-exit-gate-evidence-2026-09-19.md](phase-0-exit-gate-evidence-2026-09-19.md).

**Gate status:** closed. The allocation inventory and static baselines here are the Phase 0 baseline evidence; deterministic allocation agreement and unchanged-behavior evidence are recorded in [phase-0-exit-gate-evidence-2026-09-19.md](phase-0-exit-gate-evidence-2026-09-19.md).
