# Phase 0 preview-resolution boundary inventory

**Recorded:** 2026-09-19  
**Scope:** current dirty worktree based on commit `83bca704dd0422dd470de37cee0b4eb4db0fbe5c` (`main`)  
**Application:** HDR Finisher 0.8.12

This is a source audit, not an exit-gate result. It records every current application boundary found by searching frontend and backend sources for `previewResolution`, `longEdge`, and `long_edge`. Export resizing and proof-artifact sizing are listed separately because they are numeric long-edge contracts but are not preview-tier selectors.

## Semantic tier boundary

The only semantic preview-resolution values are `"1024"`, `"2048"`, `"4096"`, and `"full"`.

| Location | Boundary/coercion | Current result |
|---|---|---|
| `frontend/app.js` — `normalizedPreviewResolution` | `String(value)` followed by membership in `PREVIEW_RESOLUTION_OPTIONS` | Safe normalization; invalid values fall back to `"1024"`. |
| `frontend/app.js` — `previewResolutionLabel` | Branches on `"full"`, then calls `Number(normalized)` | The sentinel does not reach `Number()` here. |
| `frontend/app.js` — `previewTargetLongEdge` | Coerces source width/height with `Number`; branches on `"full"`; only numeric tiers call `Number(normalized)` | This is the authoritative semantic-tier-to-pixel-edge conversion. Full resolves to the source long edge, with a 256-pixel floor. |
| `frontend/app.js` — `previewResolutionDimensions` | Coerces source dimensions; branches on `"full"`; otherwise consumes the numeric result of `previewTargetLongEdge` | Full remains semantic until the source dimensions are known. |
| `frontend/app.js` — `applyPreviewResolution` and the `#preview-resolution` change handler | Normalize before storing | No direct numeric conversion. Current function still resets the GPU session and invalidates the preview; this inventory does not certify the later lifecycle contract. |
| `frontend/application-shell.js` — preference defaults, normalization, settings change | `String(value.previewResolution)` plus set membership | Safe persistence boundary for all four semantic values. |
| `desktop/main.js` — `normalizeApplicationPreferences` | `String(value.previewResolution)` plus array membership | Safe desktop persistence boundary for all four semantic values. |

No other production source converts `state.previewResolution` directly to a number. The remaining `Number(longEdge)` calls consume an already resolved pixel edge, not a semantic tier.

## Frontend numeric pixel-edge boundaries

### Derivation and scheduling

| Location | Input/output contract | Notes |
|---|---|---|
| `previewTargetLongEdge` | semantic tier -> integer pixel edge | Source-capped for 1K/2K/4K; source edge for Full. |
| `interactiveProxyLongEdge` | viewport/device-pixel size -> 512–1024 | Uses `Math.round(clamp(...))`; this is still an interaction-time lower tier in the current implementation. |
| `settledProxyLongEdge` | selected target and viewport -> 768–1024 unless the exact target is already GPU-resident | Returns numeric pixels. |
| `refinementProxyLongEdge` | selected target -> rounded selected pixel edge | Full resolves before this function returns. |
| `residentAuthoringLongEdge` | accepted presentation identity -> selected numeric target or `null` | Requires accepted long edge to equal the selected target exactly. |
| `scopeLongEdge` / `waveformScopeLongEdge` | preview pixel edge -> scope-specific capped edge | Scope density is deliberately independent of semantic tier identity. |
| `window.HDRFinisherPerformance` hooks | `Number(longEdge)` in render/denoise test hooks | These public diagnostic hooks expect pixel edges. Passing `"full"` would produce `NaN`; they are not tier APIs and should remain typed/documented as numeric. |
| `acceptPresentation` and response-header handling | `Number(width/height)` -> presented long edge | Presentation dimensions come from WebGPU results or numeric response headers, not the selector sentinel. |

### Requests that serialize `long_edge`

All of these must receive the resolved numeric edge; none accepts `"full"`:

- `geometryCoordinateMap` -> `POST /geometry-map`.
- `renderPreviewForLane` -> `POST /preview/{lane}`.
- `renderRawPreviewForLane` -> `POST /preview-raw/{lane}`.
- `refreshOverlay` -> `POST /overlay/{lane}`.
- `refreshScopes` / queued scope requests -> `GET` or `POST /scopes`.
- SDR-match preview actions -> preview request bodies.
- local-mask fetch, draft-mask preview, local-luminance sampling, and mask-coordinate caches.
- `webgpu-preview.js` `loadProxy` -> `GET /proxy/{lane}?long_edge=...`.
- `webgpu-preview.js` CPU spatial-mask leaf fetch -> `GET /local-mask/{id}?long_edge=...`.
- WebGPU proxy, scene-luminance, luma-mask, Boolean-mask, Denoise-analysis, and Denoise-resolve cache identities include the numeric `longEdge`.

The frontend currently has legacy fallbacks to `state.session.preview.long_edge || 1600` in `refreshPreview` and `refreshOverlay`. `PreviewSettings.long_edge` is an internal numeric session field and must not be populated with the semantic sentinel.

## Backend admission and coercion boundaries

### API validation

| Contract | Accepted range | Consumers |
|---|---:|---|
| `PreviewRequest.long_edge` | optional integer, 256–16,384 | encoded preview, raw preview, overlay, and adjustment-backed scopes |
| `GeometryMapRequest.long_edge` | integer, 256–16,384 | geometry-coordinate map |
| `LocalMaskPreviewRequest.long_edge` | integer, 256–16,384 | transient mask preview |
| `LocalLuminanceSampleRequest.long_edge` | integer, 256–16,384 | content-mask sampling |
| `GET /proxy/{kind}` query | integer, 256–16,384 | RGBA16F/RGBA32F WebGPU source transport |
| `GET /local-mask/{id}` query | integer, 256–16,384 | byte mask transport |
| `GET`/`POST /scopes` query | integer, 256–2,000 | scope analysis proxy |
| `GET /preview-preflight` `max_dimension` | integer, 256–100,000 | host-resource estimate only |
| `PreviewSettings.long_edge` | plain integer, default 1,600 | serialized session default; no field bounds in the model |

FastAPI/Pydantic rejects the string `"full"` at all numeric request boundaries. Therefore the sentinel must be resolved in the frontend before serialization.

### Backend normalization and guard

- `main.py` resolves optional preview/overlay values with `request.long_edge or session.preview.long_edge`; raw preview uses 768 (SDR) or 960 (HDR) when absent.
- `_guard_preview_resources` coerces with `int(max_dimension)`. It bypasses the host preflight at or below the 4K baseline, and calls the host estimate above it.
- `render_cache.py` normalizes every preview/cache entry with `edge = max(256, int(long_edge))`: geometry source, matched SDR base, geometry maps, compiled masks, mask drafts, luminance sampling, adjusted frames, scopes, and source proxy cache.
- Cache keys use that normalized integer edge. `_proxies_locked` retains at most the configured number of source-proxy levels.
- `preview.py::downsample_image` consumes the numeric maximum edge and never enlarges an image.
- `resource_preflight.py` computes `scale = min(1.0, proxy_long_edge / longest)` from a numeric edge.

## Numeric long edges outside preview-tier selection

- `ProofArtifactRequest.long_edge` is independently limited to 256–1,600 and is used by `proofing.py`; the string `"full"` elsewhere in that model is a gain-map scale enum, not preview resolution.
- `OutputFinishingSettings.long_edge` is an export resize dimension (1–100,000), converted with `float()` in export/finishing code. It must remain separate from preview resolution.
- `proofing-ui.js` derives a proof edge capped at 1,200 from the numeric session preview default.

## Open discrepancies / gate status

- The semantic sentinel is guarded at the main selector helpers and preference boundaries, but the diagnostic `Number(longEdge)` hooks have no runtime validation of their numeric-only contract.
- Backend request models cap most preview work at 16,384 pixels. A source whose Full long edge exceeds that cannot currently cross these monolithic endpoints.
- The current interaction scheduler still requests a 512–1024 pixel proxy during gestures, so the stable exact-tier lifecycle gate is not satisfied by this inventory.
- This audit did not execute rendering or export tests. It does **not** by itself establish that existing 1K/2K/4K behavior or exports are unchanged; that evidence is recorded in [phase-0-exit-gate-evidence-2026-09-19.md](phase-0-exit-gate-evidence-2026-09-19.md), which compares the full Python suite on this worktree against clean `83bca70`.

