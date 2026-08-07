# Repository Instructions

The repository root is this `ai/` directory. Read [docs/testing/README.md](docs/testing/README.md) before adding or relocating test material.

Put non-code design reviews, layout explorations, and durable design artifacts under `docs/design/`. Keep generated UI screenshots and browser-run evidence under ignored `codebase/output/` unless they are intentionally curated into a design document.

## Test and validation placement

- Put automated test code and small deterministic machine fixtures under `codebase/tests/`.
- Put human-run procedures, acceptance criteria, and durable validation logs under `docs/testing/`.
- Put private or large hands-on source images under ignored `codebase/local-test-media/inputs/`.
- Put generated exports, screenshots, reports, and run evidence under ignored `codebase/output/`.
- Put intentionally bundled, user-facing reference assets under `codebase/samples/`.

Generated output is disposable and must not be the only copy of instructions or durable conclusions. Do not place manual QA documents or private photographs in `codebase/tests/fixtures/`.
