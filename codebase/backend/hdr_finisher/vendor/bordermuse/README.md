# BorderMuse geometry (vendored)

Copyright (c) 2026 Pedro C. Silva. MIT licensed; the complete original
[license](LICENSE) is retained here and in
[`codebase/bin/licenses/bordermuse-MIT.txt`](../../../../bin/licenses/bordermuse-MIT.txt).

- Upstream: https://github.com/pedrocsilva/bordermuse
- Reviewed revision: `83abc8e6594529867c044dabd350ddbe26b6fa59` (October 24, 2026).
- `reference.py` is a byte-for-byte copy of upstream `geometry/reference.py`.
- The unchanged measured corpus is in
  `codebase/tests/fixtures/bordermuse/conformance-v1.json`.
- `codebase/tests/test_bordermuse_geometry.py` adapts upstream
  `geometry/test_reference.py` only for HDRF's import and fixture locations
  and this attribution header. The test behavior is unchanged.
- [Geometry specification](https://github.com/pedrocsilva/bordermuse/blob/83abc8e6594529867c044dabd350ddbe26b6fa59/docs/GEOMETRY_SPEC.md)
  and [integration guide](https://github.com/pedrocsilva/bordermuse/blob/83abc8e6594529867c044dabd350ddbe26b6fa59/geometry/README.md).

Only the dependency-free Python geometry and measured cases are imported.
No Swift app, Apple renderer, CLI, artwork, or Swift Argument Parser is included.
The geometry returns canvas dimensions and symmetric margins for one layer;
it does not render, resize, encode, or handle HDR colors. HDRF's proposed
photo → Frame → Border composition is a separate extension, not an upstream
feature. This import is not yet wired into HDRF's UI or delivery pipeline.

Keep the upstream reference and evidence unchanged. Put HDRF extensions in
host-owned modules, with behavioral tests. Both PyInstaller specifications
already include `bin` license files; packaged distributions must retain the
MIT notice when the geometry becomes a runtime dependency.
