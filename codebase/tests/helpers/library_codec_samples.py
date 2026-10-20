"""Disposable Batch 3 inputs; photographic fixtures stay in ignored local media.
Run from codebase with an output directory. No original sidecars are read.
"""
import hashlib, json, shutil, sys, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image
import imagecodecs
import pillow_heif
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher import jpegxl
from hdr_finisher.models import SourceInterpretationOverride, LocalAdjustment
from hdr_finisher.sessions import SessionStore


def marked_jxl(path, values, transfer="LINEAR", space="BT.2020", bits=32):
    payload=imagecodecs.jpegxl_encode(values, lossless=True, distance=0, bitspersample=bits, usecontainer=True)
    if transfer=="LINEAR":
        path.write_bytes(bytes(payload));return
    if transfer=="sRGB":space="sRGB"
    marker={"schema_version":3,"color_space":space,"transfer_function":transfer,"bit_depth":bits,
        "sample_type":"float" if values.dtype.kind=="f" else "integer","reference_white_nits":203.}
    path.write_bytes(bytes(payload)+jpegxl._box(b"hfmd",json.dumps(marker).encode()))


def sidecar(path, override=None, white=203, edited=False):
    session=SessionStore().prepare_session(path, owns_source_path=False,
        interpretation_override=SourceInterpretationOverride.model_validate(override or {}), hdr_reference_white_nits=white)
    default=session.edit_document().model_dump(mode="json");grade=json.loads(json.dumps(default))
    if edited:
        grade["global_adjustments"]["shared"]["geometry"]["rotation"]=90
        grade["global_adjustments"]["hdr"]["exposure"]=.6
        grade["global_adjustments"]["sdr"]["exposure"]=.3
        local=LocalAdjustment();local.hdr_grade.exposure=.25;local.sdr_grade.exposure=.15
        grade["local_adjustments"]=[local.model_dump(mode="json")];grade["denoise"]["hdr"]["enabled"]=True
    path.with_name(path.name+".hdrf").write_text(json.dumps({"format":"HDR Finisher Photo","schema_version":1,
        "photo_id":"codec-test","marks":{},"albums":[],"grade":grade,"grade_default":default}),encoding="utf8")


# Pinned official photographic examples, downloaded only for this slow driver.
REAL_SAMPLES = {
    "example.heic": ("https://raw.githubusercontent.com/strukturag/libheif/364905fc9841bdda229e0ae2c5fda13b5fc98d1a/examples/example.heic", "7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2"),
    "cosmos.avif": ("https://raw.githubusercontent.com/AOMediaCodec/libavif/b1e4d339c1ff5b547664c85f1713279f4997d694/tests/data/io/cosmos1650_yuv444_10bpc_p3pq.avif", "1c3db1867051ae23ba61ed217f6b7372a4248e6322d76a239feab14bc4c55ab5"),
    "kodim.avif": ("https://raw.githubusercontent.com/AOMediaCodec/libavif/b1e4d339c1ff5b547664c85f1713279f4997d694/tests/data/io/kodim03_yuv420_8bpc.avif", "e69c973a3ddf635412c9a0c6cda66798102d0030303614873b337f658983ef5d"),
}


def generate(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    root=Path(__file__).resolve().parents[2]
    media=root/"local-test-media/inputs/library-batch3"
    media.mkdir(parents=True,exist_ok=True)
    for name,(url,digest) in REAL_SAMPLES.items():
        target=media/name
        if not target.exists():
            payload=urllib.request.urlopen(url,timeout=30).read()
            if hashlib.sha256(payload).hexdigest()!=digest:raise ValueError("Fixture hash mismatch: "+name)
            target.write_bytes(payload)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError("Fixture changed: "+name)
    # Official photographic examples: libheif example.heic; libavif cosmos/kodim.
    photos=[]
    for name in ("example.heic","cosmos.avif","kodim.avif"):
        target=folder/name;shutil.copyfile(media/name,target);photos.append(str(target))
    photographic=Path("D:/Photos/Play_Raw/Zebras Crossing - thekman/darktable_exported/DSC_3931_01.jpg")
    image=np.asarray(Image.open(photographic)).astype(np.float32)/255
    sdr=folder/"photo.jxl";sdr.write_bytes(jpegxl.encode_sdr_jpegxl(image,100));photos.append(str(sdr))
    hdr=folder/"pq12.jxl";hdr.write_bytes(jpegxl.encode_hdr_jpegxl(image*2,100,"uint12"));sidecar(hdr,white=100,edited=True);photos.append(str(hdr))
    ramp=np.linspace(0,1,192*128*3,dtype=np.float32).reshape(128,192,3)
    for name,values,transfer,bits in [("hlg",np.round(ramp*4095).astype(np.uint16),"HLG",12),
        ("linear",ramp*4-.5,"LINEAR",32),("half",(ramp*4-.5).astype(np.float16),"LINEAR",16)]:
        target=folder/(name+".jxl");marked_jxl(target,values,transfer,bits=bits);photos.append(str(target))
        sidecar(target,white=100,override={"color_space":"BT.2020","transfer_function":"LINEAR", **({"linear_reference":"diffuse_white_1_0"} if name=="linear" else {})} if name in {"linear","half"} else None)
    override=folder/"override.jxl";shutil.copyfile(hdr,override)
    sidecar(override,{"color_space":"BT.2020","transfer_function":"BT.709"},white=100);photos.append(str(override))
    for transfer,code in [("sdr",13),("pq",16),("hlg",18)]:
        target=folder/(transfer+".heic")
        a=np.round(ramp*65535).astype(np.uint16)
        heif=pillow_heif.from_bytes("RGB;16",(192,128),a.tobytes())
        heif.save(target,quality=100,bit_depth=10,save_nclx_profile=True,color_primaries=9,
            transfer_characteristics=code,matrix_coefficients=9,chroma=444)
        assert pillow_heif.open_heif(target).info["nclx_profile"]["transfer_characteristics"]==code
        sidecar(target,white=100,edited=transfer=="sdr");photos.append(str(target))
    for transfer,code in [("hlg",18),("linear",8)]:
        target=folder/(transfer+".avif")
        target.write_bytes(imagecodecs.avif_encode(np.round(ramp*4095).astype(np.uint16),level=100,speed=10,
            bitspersample=12,primaries=9,transfer=code,matrix=9,pixelformat="YUV444"))
        photos.append(str(target))
    # Unmarked photographic JXL must keep its manual gate, then work after resolution.
    unmarked=folder/"manual.jxl";unmarked.write_bytes(imagecodecs.jpegxl_encode(np.round(image*255).astype(np.uint8),lossless=True))
    sidecar(unmarked,{"color_space":"sRGB","transfer_function":"sRGB"});photos.append(str(unmarked))
    return {"photos":photos,"sources":[str(sdr),str(folder/"cosmos.avif"),str(folder/"example.heic")]}

if __name__=="__main__":print(json.dumps(generate(sys.argv[1])))
