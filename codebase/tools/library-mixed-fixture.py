"""Permanent mixed Library test folder (library-mixed-v1).

The folder lives outside the repository, beside the film data sheets:
    D:\\AI\\AI Projects\\HDR Finisher Tool\\test-fixtures\\library-mixed-v1
Its photos are read-only. The manifest committed beside this script
(`library-mixed-v1.manifest.json`) records every file's size and SHA-256.

    python tools/library-mixed-fixture.py build    # one time: copy from sources
    python tools/library-mixed-fixture.py verify   # full hash check
    python tools/library-mixed-fixture.py run-copy # reset the disposable run folder

The run folder (`output/test-photos/library-mixed-v1-run`) holds a one-time
read-only copy of the photos (D: has no hard links) plus fresh copies of the
sidecars and nothing else, so a test can never change the fixture. Sources are only read;
D:\\Photos is never written.
"""
import hashlib, json, os, shutil, stat, sys
from pathlib import Path

FIXTURE = Path(r"D:\AI\AI Projects\HDR Finisher Tool\test-fixtures\library-mixed-v1")
CODEBASE = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name("library-mixed-v1.manifest.json")
RUN = CODEBASE / "output" / "test-photos" / "library-mixed-v1-run"

HT = r"D:\Photos\HDR Test Images"
P0 = str(CODEBASE / "output" / "test-photos" / "phase0")
TP = str(CODEBASE / "output" / "test-photos")
# (source, why). Names are kept; sidecars (.hdrf) are listed explicitly.
SOURCES = [
    # Two rows of Sony RAWs, several with edits in their sidecars:
    # embedded camera previews, edited thumbnails, ordinary RAW developments.
    *[(rf"{HT}\{n}.ARW", "Sony RAW") for n in (
        "DSC00264", "DSC01204", "DSC01212", "DSC01226", "DSC01244", "DSC01286",
        "DSC01287", "DSC02767", "DSC03819", "DSC04375", "DSC04761", "DSC06615")],
    *[(rf"{HT}\{n}.ARW.hdrf", "edited RAW sidecar") for n in (
        "DSC00264", "DSC01204", "DSC01226", "DSC04375", "DSC06615")],
    (rf"{HT}\Test Suite Images\2L1B8631.CR2", "Canon CR2"),
    (r"D:\Photos\2020\Lucas 2nd Birthday\IMG_5137.CR2", "Canon CR2"),
    (rf"{P0}\IMG_7723.CR3", "Canon CR3"),
    (rf"{P0}\QNY_8816.NEF", "Nikon NEF"),
    (rf"{HT}\Test Suite Images\Nikon_D7500_DSC_3931.NEF", "Nikon NEF"),
    (rf"{HT}\Test Suite Images\Nikon_D7500_DSC_3931.NEF.hdrf", "edited NEF sidecar"),
    (rf"{P0}\P1150601.RW2", "Panasonic RW2"),
    (rf"{P0}\P1010004.ORF", "Olympus ORF"),
    (r"D:\Photos\2025\Yenny BBQ\P1010300.ORF", "Olympus ORF"),
    (rf"{P0}\DSCF6495.RAF", "Fuji X-Trans RAF: unsupported, camera preview only"),
    (rf"{HT}\DJI Samples\DJI_0071.DNG", "20 MP drone DNG"),
    (rf"{HT}\DJI Samples\DJI_0072.DNG", "20 MP drone DNG"),
    (rf"{HT}\DJI Samples\DSC01244_DxO-optical-corr-only.dng", "DxO linear DNG"),
    (rf"{HT}\DJI Samples\DSC04375_DxO-optical-corr-only.dng", "DxO linear DNG"),
    (rf"{HT}\Leica-X2-L1021324.DNG", "Leica DNG"),
    (rf"{P0}\line_scan_2018-05-26-11-35-40_NECTA0000_fbcb8f8f1d37db8bf93c0d46fb748355c01b7f8b.dng",
     "297 MP line scan: reduced DNG route, elastic admission"),
    (rf"{P0}\DJI_0071-2.tif", "388 MB drone TIFF"),
    (rf"{P0}\IMG_1150.tiff", "ordinary TIFF"),
    (rf"{P0}\pano_192mp.tif", "192 MP TIFF: reduced route"),
    (rf"{P0}\pano_192mp.tif.hdrf", "saved TIFF interpretation"),
    (rf"{HT}\DSC04375_DxO_clipped_target.tif", "TIFF needing interpretation in Grade"),
    (rf"{P0}\_DSC6117_DxO.jpg", "JPEG"),
    (rf"{P0}\_DSC6328.jpg", "large JPEG"),
    (rf"{P0}\VKNS0418.JPEG", "JPEG, .jpeg extension"),
    (rf"{P0}\pano_192mp.jpg", "192 MP JPEG: DCT-reduced route"),
    (rf"{HT}\DJI Samples\DJI_0071-2.JPG", "20 MP drone JPEG"),
    (rf"{P0}\IMG_6717.PNG", "PNG"),
    (rf"{P0}\_DSC6510-1.png", "223 MB 16-bit PNG"),
    (rf"{P0}\pano_192mp.png", "192 MP PNG: reduced route, elastic admission"),
    (rf"{P0}\iphone_16_pro_IMG_3324.HEIC", "iPhone HEIC with gain map"),
    (r"D:\Photos\2024\2024 - phone images\202406__\IMG_6705.HEIC", "iPhone HEIC"),
    (rf"{P0}\-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif", "PQ AVIF"),
    (r"D:\Photos\2025\20251210 Power Out\darktable_exported\DSC08883.avif", "AVIF"),
    (rf"{P0}\LR-classic-hdr-source-test-1.avif", "gain-map AVIF: needs more memory at 4 GB"),
    (rf"{P0}\DSC01302.jxl", "JPEG XL needing interpretation"),
    (rf"{P0}\jpeg_xl_16_bit_p3_color.jxl", "16-bit P3 JPEG XL"),
    (rf"{P0}\possibly-cat-prints-texture-v001.exr", "EXR needing interpretation"),
    (rf"{HT}\DSC01287.exr", "EXR"),
    (rf"{P0}\synthetic_24mp.hdr", "Radiance HDR"),
    (rf"{P0}\synthetic_24mp.pfm", "PFM"),
]
# Supported but no sample on Steve's disks (November 1, 2026):
MISSING = [".heif", ".nrw", ".ori", ".pef", ".srw"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def is_sidecar(name):
    return name.lower().endswith(".hdrf")


def build():
    if FIXTURE.exists() and any(FIXTURE.iterdir()):
        sys.exit(f"{FIXTURE} already exists; the fixture is locked. Make library-mixed-v2 instead.")
    FIXTURE.mkdir(parents=True, exist_ok=True)
    entries = []
    for source, why in SOURCES:
        src = Path(source)
        dst = FIXTURE / src.name
        assert not dst.exists(), f"duplicate name {src.name}"
        shutil.copy2(src, dst)  # reads the source only
        entries.append({"name": src.name, "bytes": dst.stat().st_size, "sha256": sha256(dst),
                        "why": why, "source": str(src)})
        os.chmod(dst, stat.S_IREAD)
        print("copied", src.name)
    MANIFEST.write_text(json.dumps({"fixture": str(FIXTURE), "missing_formats": MISSING,
                                    "files": entries}, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(len(entries), "files,", round(sum(e["bytes"] for e in entries) / 1e9, 2), "GB")


def load():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]


def verify(full=True):
    bad = []
    for e in load():
        p = FIXTURE / e["name"]
        if not p.exists() or p.stat().st_size != e["bytes"] or (full and sha256(p) != e["sha256"]):
            bad.append(e["name"])
    extra = sorted(set(os.listdir(FIXTURE)) - {e["name"] for e in load()})
    if bad or extra:
        sys.exit(f"fixture changed: {bad} extra: {extra}")
    print("fixture ok")


def run_copy():
    verify(full=False)
    RUN.mkdir(parents=True, exist_ok=True)
    wanted = {e["name"]: e for e in load()}
    for name in os.listdir(RUN):
        p = RUN / name
        if name not in wanted or is_sidecar(name):
            if p.is_dir():
                shutil.rmtree(p)
            else:
                os.chmod(p, stat.S_IWRITE) if is_sidecar(name) or name not in wanted else None
                p.unlink()
    for name in wanted:
        p, src = RUN / name, FIXTURE / name
        if p.exists():
            continue
        if is_sidecar(name):
            shutil.copyfile(src, p)
            os.chmod(p, stat.S_IREAD | stat.S_IWRITE)
        else:
            # D: does not support hard links: copy once, keep read-only.
            shutil.copy2(src, p)
            os.chmod(p, stat.S_IREAD)
    for name, e in wanted.items():
        if not is_sidecar(name):
            assert (RUN / name).stat().st_size == e["bytes"], f"run copy changed: {name}"
    print(RUN)


if __name__ == "__main__":
    {"build": build, "verify": verify, "run-copy": run_copy}[sys.argv[1]]()
