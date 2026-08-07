# Local Test Media

Put private or large source images used for hands-on testing in `inputs/`. Everything in this directory except this README is ignored by Git.

Typical contents include personal HEIC captures, full-resolution EXRs, TIFF handoffs, and other media that is unsuitable as a small deterministic automated fixture. Generated exports and reports belong in `../output/`, while reusable procedures and findings belong in `../../docs/testing/`.

Create the local input directory when needed:

```powershell
New-Item -ItemType Directory -Force -Path .\codebase\local-test-media\inputs
```

Generate the repeatable float32 HDR scene and delivery-proof TIFFs with:

```powershell
cd codebase
.\.venv\Scripts\python.exe .\tools\generate_manual_test_media.py
```

The generated files and their manifest are written to `inputs/generated/`. They are local manual-test inputs, not committed automated fixtures. The TIFF container does not identify their working primaries, so select **ACEScg Linear** when HDR Finisher requests manual source interpretation.
