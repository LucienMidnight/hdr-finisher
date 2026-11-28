# Repository organisation

## What is well organised and should stay

- The desktop shell starts the backend, the frontend owns the interface and
  preview, and the backend handles file I/O, processing and delivery. The
  [code map](../../code-map.md) is the best starting point for finding an owner.
- The [master PRD](../../../product/PRD.md) holds product-wide decisions.
  Module PRDs keep the detail and open work, and the archive keeps old evidence
  available without presenting it as current guidance.
- Fast tests, longer release checks and manual experiments have separate jobs.
  The [test catalogue](../../test-catalogue.md) keeps the first two findable.
  Generated captures belong in local output, not alongside reusable source.

## What was tidied

- **T1.** The ordinary fast run now picks up all 14 fit-filtering unit tests.
  The inventory and generated catalogue list them.
- **T2.** Four Round 4 Denoise reproduction scripts now live under research
  tools. They still write to the original local output folder.
- **T3.** The documentation map points to existing files, includes the
  previously unlisted briefs and reports and has current archive counts.
  The master PRD identifies v0.9.4. The code map starts with navigation and
  keeps its dated notes under Recent changes.
- **T4.** The finished next-version investigation and Windows startup reports
  moved to the archive. Grade tracks the outstanding Retouch and Match input.
  Desktop and release tracks cross-platform startup confirmation and tuning.
- **T5–T6.** The [tools index](../../../../codebase/tools/README.md) labels
  historical prototypes and manual diagnostics. The three JPEG probes stay
  separate because they answer different questions about a known file, an
  on-screen grid and isolated scene costs. No tools were deleted.

## Left for later

- Keep the RAW starting Exposure brief active. Steve's visual sign-off and
  Library picture agreement are still open in that brief and the PRDs.
- Keep the Library draw-live brief active. Later decisions narrowed direct
  drawing to edited/developed photos, and the record does not close the
  original all-format, whole-grid and picture-agreement work as written.
- Round 4 still needs local Round 3 trial source and staged crop data. They
  are not in Git. Syntax and paths were checked, but the study was not rerun.
- Splitting the large preview, shader, adjustment, render-cache and exporter
  files is outside this sprint package. No application logic was changed.
