# HDR exporter capability contract

Frozen: 2026-08-22 before reference-white implementation.

| Route | Pixel meaning | Standard reference-white signaling | HDRF private metadata | Peak/content-light metadata | SDR rendition |
|---|---|---|---|---|---|
| JPEG Ultra HDR | SDR JPEG base plus adaptive gain-map reconstruction. The bundled libultrahdr 1.4.0 linear API uses 1.0 = 203 nits as a codec-interface convention. | No independent physical reference-white field is written by the current CLI. Gain-map min/max content boost and HDR-capacity fields are relative. | Not supported by the current writer. | `-L` supplies the target display peak to libultrahdr; gain-map capacity/boost metadata is supported. It is not the project reference white. | Authored SDR pixels are supplied as the SDR intent and preserved unless the SDR branch is edited. |
| AVIF gain map | ISO 21496 gain-map reconstruction between base and alternate renditions using headroom, offsets, gamma, base-rendition type, and interpolation metadata. | Relative headroom/base-alternate metadata; no project physical reference-white field is written by the bundled avifgainmaputil 1.4.1 route. | Not supported by the current writer. | Base/alternate headroom and gain-map fields are supported. No separate HDRF content-light box is written. | The current route writes an SDR base and HDR alternate; the base is an independently rendered SDR branch. |
| JPEG XL HDR | Direct BT.2020 PQ. PQ code values are absolute luminance. | Absolute meaning is carried by PQ/BT.2020 signaling; the current imagecodecs container path does not expose a separate standardized diffuse-white field. | Supported in the `hfmd` application box. The v3 marker records project reference white separately from PQ pixels and precision. | The current writer does not expose standardized MaxCLL/mastering-display fields. Measured/export peaks remain application preflight data, not invented container metadata. | Separate SDR JPEG XL delivery generated from the SDR branch; not embedded in the direct-HDR file. |

Only these three HDR routes are in this sprint. HLG output, HEIF export, direct-HDR PNG/TIFF, and a non-gain-map AVIF exporter are unsupported.

## Pinned local tools

- libultrahdr demo application: 1.4.0
- avifgainmaputil/avifenc/avifdec: 1.4.1, libaom 3.13.2, dav1d 1.5.3
- Electron: 43.4.0
- JPEG XL Python `imagecodecs`: available in the pinned `.venv` and packaged runtime, backed by libjxl 0.11.2. The diagnostic system Python is not a supported test environment.
