# Test photos (proposed November 14, 2026; waiting for Steve's approval)

Every test reads its photos from one folder, `HDR Test Images`, under the
machine's photos root (PC `D:/Photos`, Mac `~/HDR Finisher Tool/Photos`). The
folder is identical on both machines and stays around 2–4 GB. Only tests
against Steve's personal library (for example the `2026/20261017 badminton`
folder) are PC-only, and they are marked so.

The new folder replaces the old 40 GB `D:/Photos/HDR Test Images`. Build it
by **copying**: never move, rename inside, or delete Steve's originals. Keep
the file names below (sidecars such as `.hdrf` must keep matching their
photo's name). The folder is flat except `Projects/`.

## Files

Sizes are approximate. "PC source" is where the file is today; `P0` is
`D:/AI/AI Projects/HDR Finisher Tool/ai/codebase/output/test-photos/phase0`,
`HTI` the old `D:/Photos/HDR Test Images`, `PR` is `D:/Photos/Play_Raw`.

| File | MB | Covers | PC source |
| --- | ---: | --- | --- |
| **Sony RAW (large, 42 MP)** | | | |
| `DSC00264.ARW` + `.hdrf` | 82 | main Grade, Edge colour, Library, masks; saved grade | HTI |
| `DSC04375.ARW` + `.hdrf` | 82 | Retouch; pairs with the DxO DNG and TIFF below | HTI |
| `DSC01212.ARW` | 82 | Library focus trial | HTI |
| `DSC06615.ARW` + `.hdrf` | 42 | compressed Sony RAW; saved grade | HTI |
| `A7R00619.ARW` | 41 | another photographer's Sony (A7R IIIa) | PR/Lakeland landscape in dry Summer |
| `2025_0730_1331_3.arw` | 82 | lower-case extension; another photographer | PR/An alley at Seoul - lucas faco |
| `DSC00950.ARW` + `.ARW.hdrf` | 35 | heavy saved project baseline | PR/Fantastic light over village - AdamFromCanada |
| **Other cameras** | | | |
| `IMG_0114.CR2` + `.hdrf` | 25 | Canon CR2; all HSL checks | PR/Balanced Rock in Arches Nat Park - LaurentFromSF |
| `IMG_0790.CR2` | 23 | noisy Canon (Denoise, focus) | PR/Hawai'ian Fire Dancers - Challenge the Darkside - LaurentFromSF |
| `IMG_3129.CR2` | 20 | Edge colour on Canon | PR/Sunset on ferry -silicoid |
| `IMG_7723.CR3` | 27 | Canon CR3 | PR/Foggy morning at Dunn Lake |
| `DSC_3931.NEF` | 24 | Nikon NEF | PR/Zebras Crossing - thekman |
| `DSC_3931.NEF.hdrf` | 0 | saved NEF grade | HTI/Test Suite Images/Nikon_D7500_DSC_3931.NEF.hdrf (rename to match) |
| `P1010004.ORF` | 14 | **small RAW** (Olympus, 16 MP) | P0 |
| `P1150601.RW2` | 23 | Panasonic RW2 | P0 |
| `DSCF6495.RAF` | 32 | Fuji X-Trans (camera preview only) | P0 |
| `Leica-X2-L1021324.DNG` | 23 | camera DNG | HTI |
| `DJI_0071-2.DNG` | 92 | drone DNG | HTI/DJI Samples |
| `DSC04375_DxO-optical-corr-only.dng` | 135 | linear (DxO) DNG | HTI/DJI Samples |
| **iPhone** | | | |
| `iphone_16_pro_IMG_3324.HEIC` | 3 | HEIC with gain map | HTI/Test Suite Images |
| `IMG_6705.HEIC` | 2 | ordinary HEIC | D:/Photos/2024/2024 - phone images/202406__ |
| any other iPhone samples Steve has (ProRAW DNG, JPEG, HDR) | ≤50 each | iPhone variety | Steve's choice |
| **Other files** | | | |
| `DSC04375_DxO_clipped_target.tif` | 242 | the TIFF; needs interpretation | HTI |
| `pano_192mp.jpg` / `.png` / `.tif` + `.tif.hdrf` | 22 | huge pixel count, reduced route | P0 |
| `DJI_0071-2.JPG` | 13 | camera JPEG | HTI/DJI Samples |
| `_DSC6328.jpg` | 33 | large JPEG | P0 |
| `VKNS0418.JPEG` | 13 | `.JPEG` extension | P0 |
| `IMG_0790_finished.jpg` | 11 | edited JPEG | PR/Hawai'ian Fire Dancers… |
| `DSC_3931_01.jpg` | 1 | small exported JPEG | PR/Zebras Crossing - thekman/darktable_exported |
| `IMG_6717.PNG` | 2 | 8-bit PNG | P0 |
| `_DSC6510-1.png` | 213 | 16-bit PNG | P0 |
| `-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif` | 2 | PQ AVIF | P0 |
| `DSC08883.avif` | 4 | ordinary AVIF | D:/Photos/2025/20251210 Power Out/darktable_exported |
| `LR-classic-hdr-source-test-1.avif` | 24 | gain-map AVIF | P0 |
| `5M071612_finished.avif` | 1 | small AVIF | PR/HDR exercise on urbanscape |
| `DSC01302.jxl` | 89 | JPEG XL needing interpretation | P0 |
| `jpeg_xl_16_bit_p3_color.jxl` | 1 | 16-bit P3 JPEG XL | P0 |
| `e053a5bf16a9398eaa3da890-900x1200.jxl` | 1 | JPEG XL source colour | HTI |
| `A7R00619.exr` | 476 | large camera EXR | PR/Lakeland landscape in dry Summer/darktable_exported |
| `possibly-cat-prints-texture-v001.exr` | 14 | EXR needing interpretation | P0 |
| `synthetic_24mp.hdr` | 79 | Radiance HDR | P0 |
| `synthetic_24mp.pfm` | 275 | PFM | P0 |
| `Projects/DSC00950.hdrfinisher` | 0 | saved project | PR/Fantastic light over village - AdamFromCanada |

Total about 2.4 GB before extra iPhone samples.

## Dropped (tests move to a file above)

- Eight more 82 MB Sony ARWs from the old Library fixture (`DSC01204`,
  `DSC01226`, `DSC01244`, `DSC01286`, `DSC01287`, `DSC02767`, `DSC03819`,
  `DSC04761`). The Library check keeps enough photos by using every file
  in the folder.
- Duplicates or near duplicates: `DJI_0071.DNG`, `DJI_0072.DNG`,
  `DSC00264_DxO-optical-corr-only.dng`, `DSC01244_DxO-optical-corr-only.dng`,
  `2L1B8631.CR2`, `IMG_5137.CR2`, `QNY_8816.NEF`, `P1010300.ORF`,
  `IMG_1193.CR2`, `_DSC6117_DxO.jpg`, `_DSC3289_DxO.jpg`, `IMG_1150.tiff`.
- Too large for both machines: `DJI_0071-2.tif` (370 MB), `DSC01287.exr`
  (472 MB) and the 297 MP line-scan DNG (1.7 GB). If Steve wants a
  very-large-file check, it becomes PC-only like the badminton folder.
- Folder-scale one-off measurements (`2017/Aceh-Wedding/Pesta`, `2023/11`)
  become PC-only personal-library checks.

## On each machine

`HDR Test Images/manifest.json` lists every file with its size and SHA-256.
Setup compares the folder against it and names anything missing or changed.
