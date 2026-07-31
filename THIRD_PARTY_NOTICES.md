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
