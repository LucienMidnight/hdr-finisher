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
