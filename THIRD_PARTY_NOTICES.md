# Third-party notices

HDR Finisher's SDR gamut clipping adapts Bjorn Ottosson's analytic OKLab/sRGB
gamut-intersection reference implementation, Copyright (c) 2021 Bjorn Ottosson,
distributed under the MIT License. The source and license are available at
https://bottosson.github.io/posts/gamutclipping/ .

HDR Finisher uses Christoph Gohlke's
[`imagecodecs`](https://github.com/cgohlke/imagecodecs) library through `tifffile` to decode TIFF
compression and prediction schemes, including floating-point predictors. Imagecodecs is distributed
under the BSD 3-Clause License and bundles additional open-source codec libraries under their
respective licenses. Source distributions and packaged applications must retain the imagecodecs
license and the third-party license files shipped with the installed package.

JPEG XL import and export use the libjxl codec bundled by `imagecodecs`. libjxl is distributed under
the BSD 3-Clause License and includes a patent grant. Packaged applications must retain the libjxl
license shipped with imagecodecs.

RAW and DNG convenience import uses [`rawpy`](https://github.com/letmaik/rawpy), distributed under
the MIT License, and LibRaw, available under the LGPL 2.1 or CDDL 1.0 dual license. Camera/lens
correction uses [`lensfunpy`](https://github.com/letmaik/lensfunpy) and
[`Lensfun`](https://github.com/lensfun/lensfun). Lensfun code is LGPL-3.0 and its correction database
is CC BY-SA 3.0. Packages containing these components must retain their bundled license and database
attribution files.

> This product includes DNG technology under license by Adobe.

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

HDR Finisher can redistribute statically built command-line tools from
[`libavif`](https://github.com/AOMediaCodec/libavif), which is distributed under the BSD 2-Clause
License. The macOS native-tool build copies the exact upstream license into
`codebase/bin/licenses/` together with the licenses and patent notices for the statically linked AOM,
libargparse, libjpeg-turbo, libpng, libwebp/SharpYUV, libyuv, and zlib dependencies. Packages containing
`avifenc`, `avifdec`, or `avifgainmaputil` must retain those files.

HDR Finisher vendors a selected set of outline SVGs from
[`Tabler Icons`](https://github.com/tabler/tabler-icons). Tabler Icons is Copyright (c) 2020-2026
Paweł Kuna and is distributed under the MIT License. The selected SVGs, pinned upstream revision,
UI mapping, and complete license text are retained in
`codebase/frontend/assets/icons/tabler/` and must remain present in source and packaged distributions
that include those icons.

HDR Finisher bundles Source Sans 3, Gabarito, and Space Mono font software. Source Sans 3 is
Copyright 2010–2020 Adobe, Gabarito is Copyright 2023 The Gabarito Project Authors, and Space Mono
is Copyright 2016 The Space Mono Project Authors. Each family is distributed under the SIL Open
Font License, Version 1.1. The complete family-specific license text is retained beside each bundled
family under `codebase/frontend/assets/fonts/` and must remain present in source and packaged
distributions.
