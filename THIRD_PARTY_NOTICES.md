# Third-party notices

HDR Finisher uses Christoph Gohlke's
[`imagecodecs`](https://github.com/cgohlke/imagecodecs) library through `tifffile` to decode TIFF
compression and prediction schemes, including floating-point predictors. Imagecodecs is distributed
under the BSD 3-Clause License and bundles additional open-source codec libraries under their
respective licenses. Source distributions and packaged applications must retain the imagecodecs
license and the third-party license files shipped with the installed package.

HDR Finisher can redistribute a locally or CI-built `ultrahdr_app` from Google's
[`libultrahdr`](https://github.com/google/libultrahdr) project. libultrahdr is distributed under the
terms of both the MIT License and Apache License 2.0. Binary distributions must include those license terms,
retain applicable copyright and attribution notices, and include the following upstream notice:

> This product includes Gain Map technology under license by Adobe.

The repository's Windows build helper copies libultrahdr's MIT, Apache, combined license, and Adobe
notice files into `codebase/bin/licenses/`. It builds libjpeg-turbo as a dependency and copies its
`LICENSE.md` there as well. Those files are included automatically by the PyInstaller folder build.

HDR Finisher itself remains GPL-3.0. These notices do not change the license of HDR Finisher source
code and must not be removed from packages that contain the optional encoder binaries.

HDR Finisher vendors a selected set of outline SVGs from
[`Tabler Icons`](https://github.com/tabler/tabler-icons). Tabler Icons is Copyright (c) 2020-2026
Paweł Kuna and is distributed under the MIT License. The selected SVGs, pinned upstream revision,
UI mapping, and complete license text are retained in
`codebase/frontend/assets/icons/tabler/` and must remain present in source and packaged distributions
that include those icons.

HDR Finisher bundles IBM Plex Sans and IBM Plex Mono font software. IBM Plex is Copyright © 2017
IBM Corp. with Reserved Font Name "Plex" and is distributed under the SIL Open Font License,
Version 1.1. The complete license text is retained beside each bundled family under
`codebase/frontend/assets/fonts/` and must remain present in source and packaged distributions.
