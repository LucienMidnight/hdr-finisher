# Third-party notices

The photo-framing geometry reference and measured conformance cases are from
Pedro C. Silva's [BorderMuse](https://github.com/pedrocsilva/bordermuse),
Copyright (c) 2026 Pedro C. Silva, under the MIT License. The dependency-free
Python reference is retained unchanged in
[`codebase/backend/hdr_finisher/vendor/bordermuse/`](codebase/backend/hdr_finisher/vendor/bordermuse/),
pinned to revision `83abc8e6594529867c044dabd350ddbe26b6fa59`.
The fixture corpus is unchanged; test imports and fixture paths are adapted
for HDR Finisher. The complete copyright, permission and warranty notice is
retained in the vendored `LICENSE` and
[`codebase/bin/licenses/bordermuse-MIT.txt`](codebase/bin/licenses/bordermuse-MIT.txt),
which the existing backend packaging specifications include. No BorderMuse
Apple renderer, Swift UI, artwork or CLI dependency is copied. HDR Finisher's
planned two-layer framing, viewer integration and HDR composition are its own
extensions; the imported reference is not yet connected to the app.

The isolated CPU Retouch prototype (`codebase/backend/hdr_finisher/retouch.py`)
adapts the PatchMatch nearest-neighbour propagation, shrinking random search
and patch-voting approach in Krita's
[`plugins/tools/tool_smart_patch/kis_inpaint.cpp`](https://github.com/KDE/krita/blob/72446d9edcc45d183ffb769353cef8913873cab5/plugins/tools/tool_smart_patch/kis_inpaint.cpp),
revision `72446d9edcc45d183ffb769353cef8913873cab5`, inspected October 21, 2026.
That file identifies Copyright 2017 Eugene Ingerman and SPDX
`GPL-2.0-or-later`. Its provenance credits original author Xavier Philippeau,
David Chatting's [PatchMatch](https://github.com/davidchatting/PatchMatch), and
the PatchMatch paper by Connelly Barnes, Eli Shechtman, Adam Finkelstein and
Dan B Goldman (SIGGRAPH 2009). These credits are retained; no files are copied
from the earlier project. The adaptation is distributed under GPL version 3
with HDR Finisher (see LICENSE), using the upstream later-version option.
Changes include NumPy batched propagation, float64 matching/float32 RGB
reconstruction, deterministic PCG64, strict whole-patch defect exclusion,
bounded regions and single-scale equal voting. The October 22 v2 local
quadratic tone continuation, edge/fit gating and donor-mean alignment are
HDR Finisher additions, not copied from Krita. No Krita, Qt, Boost or KDE
runtime dependency, image pyramid, colour conversion or application code is
included.

The v3 bounded coherent-donor search, contrast-aware context matching and
harmonic/screened boundary correction are also HDR Finisher implementations.
They preserve contiguous donor detail instead of averaging unrelated texture
samples. No further third-party source or application dependencies were added.

`tools/retouch_prototype.py` optionally calls OpenCV for comparison only.
The local comparison used `opencv-python-headless` 5.0.0.93 / OpenCV 5.0.0;
it is not a runtime requirement or bundled component. OpenCV's top-level
[5.0.0 LICENSE](https://github.com/opencv/opencv/blob/5.0.0/LICENSE) is Apache-2.0;
the exact [inpaint.cpp](https://github.com/opencv/opencv/blob/5.0.0/modules/photo/src/inpaint.cpp)
also retains the Intel Open Source Computer Vision Library licence, Copyright
2000 Intel Corporation (BSD-style three-clause terms). No OpenCV source is
copied. Any future distribution of its binaries must retain the package's
full licence/third-party notices, not just this summary.

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


### spektrafilm lens diffusion

`lens_filter.py` and `frontend/lens-filters.js` reimplement Andrea Volpato's
spektrafilm `model/diffusion.py` family shapes, halo-channel redistribution and
commercial strength mapping, plus `utils/fast_gaussian_filter.py`'s three-Gaussian
exponential surrogate, at GPL-3.0 revision `3bb2c2d`.
Source: https://github.com/andreavolpato/spektrafilm . All 27 components are kept;
rounded amplitudes are normalized, and each Gaussian is cropped and normalized
inside HDR Finisher's existing spatial cap. Explicit bounded kernels replace
the upstream recursive large-sigma implementation; edge handling is clamped.

### Oklab conversions in the isolated HSL prototype

`codebase/tools/hsl-prototype/engine.mjs` and `gpu.mjs` adapt the linear-sRGB
to/from Oklab conversions by Björn Ottosson, using the matrix revision dated
January 25, 2021 in [A perceptual color space for image processing](https://bottosson.github.io/posts/oklab/),
accessed October 22, 2026. The author explicitly dedicates the conversion
code to the public domain (with MIT also offered). The prototype uses the
public-domain grant. Adaptations are JavaScript/WGSL ports with signed cube
roots for unbounded floating-point inputs. The multi-range selection,
mask composition and prototype interface are HDR Finisher code.
