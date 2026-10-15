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

HDR Finisher's NumPy opposed-color RAW highlight reconstruction adapts the algorithm and reference
math from darktable's `src/iop/highlights.c`, `src/iop/hlreconstruct/opposed.c`, and
`src/iop/hlreconstruct/segbased.c`, Copyright (C) 2010–2026 darktable developers. darktable is
distributed under GNU GPL version 3 or later. HDR Finisher is GPL-3.0 and retains the algorithm
name, versioned recipe identifier, implementation provenance, and this attribution.

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

HDR Finisher's Film stock data is derived from Andrea Volpato's
[`spektrafilm`](https://github.com/andreavolpato/spektrafilm). The film and print-paper profiles
it is derived from are distributed under the Creative Commons Attribution-ShareAlike 4.0
International License (CC BY-SA 4.0). The HDR Finisher project modified that data by re-sampling it
into its own colour, density and print tables; the derived files in
`codebase/backend/hdr_finisher/film_stocks/` remain under CC BY-SA 4.0, carry an attribution string,
and are accompanied by an unmodified copy of `SPEKTRAFILM_LICENSE.txt` and a `CHANGELOG.txt` that
describes how they were made. The tables are produced offline by `codebase/tools/bake_film_stocks.py`.
HDR Finisher's Film stock engine is its own re-implementation, informed by spektrafilm's code, which
is distributed under GNU GPL version 3; this is compatible with HDR Finisher's GPL-3.0 license.
These files and notices must remain present in source and packaged distributions that include the
Film stock data.

The October 15, 2026 Film Look data expansion uses spektrafilm revision
`3bb2c2d2801ff68b92019cf1dbcbb133d60832bc`: all 20 camera stocks, including
Vision3, Verita, pushed Portra 800, C200, X-Tra 400, Ultramax and the four
slide films (Velvia, Provia, Ektachrome and Kodachrome). Negative-film tables
include their default print medium plus Kodak Vision 2383 and Fujifilm
Crystal Archive Type II; the other default is Kodak Portra Endura. Slides
are scanned directly. The modifications also include storing the sampled
numbers as shared compressed float32 arrays with JSON manifests. These
new files retain CC BY-SA 4.0; the complete stock/paper list and changes are
recorded in the film-data `CHANGELOG.txt`.

### spektrafilm print-curve morph

`codebase/backend/hdr_finisher/film_print_morph.py` is ported from Andrea
Volpato's spektrafilm `utils/morph_curves.py` at revision
`3bb2c2d2801ff68b92019cf1dbcbb133d60832bc`, under GPL-3.0, like HDR Finisher.
Source: https://github.com/andreavolpato/spektrafilm . The formulas are unchanged;
the source profile type annotation is replaced with a local duck type.
The fitted paper layers and scanner calibration in `film_stocks/controls.json`
are derived from the same CC BY-SA 4.0 profiles credited above, extracted by
`tools/bake_film_controls.py`; existing measured stock tables are unchanged.
