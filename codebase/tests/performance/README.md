# Preview performance harness

Run the app, install the browser-test dependency with `npm install`, then run:

```powershell
npm run test:performance -- --url http://127.0.0.1:8000
```

The default matrix covers deterministic EXR and TIFF fixtures in fast, high-quality, and forced no-WebGPU modes with 30 timed adjustment repetitions followed by 100 settled changes for memory/cache stability. Add a local Apple HDR HEIC without committing it:

```powershell
npm run test:performance -- --inputs tests/fixtures/blender_linear_rec2020.exr,tests/fixtures/hdr_headroom.tiff,local-test-media/inputs/IMG_4109.HEIC
```

Reports are written to `output/performance/preview-performance.json`. Use `--enforce` only on the named benchmark workstation; other machines should retain the report for relative comparison.

## GPU local-adjustment sprint

The Luma opacity/feather and live-scope benchmark records isolated changes,
30-event rapid drags (including opacity direction reversals), presentation-order
guards, mask request counts, CPU mask time, transport, scheduler
queue delay, GPU submission/presentation, optional GPU timestamp queries, scope
freshness/content fingerprints, draft-local scope payloads, stale cancellation,
browser, adapter, fixture, and active resolutions:

```powershell
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase0
npm run test:gpu-local-adjustments -- --url http://127.0.0.1:8000 --phase phase1
```

Generated JSON is written below `output/performance/`. Durable conclusions and
the exact percentile method belong in the dated validation record under
`docs/testing/`.
