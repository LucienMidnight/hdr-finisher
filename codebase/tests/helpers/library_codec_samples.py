"""Disposable Batch 3 inputs; photos come only from the curated HDR Test Images.
Run from codebase with an output directory. No original sidecars are read.
"""
import sys as _tool_sys
from pathlib import Path as _ToolPath
_tool_sys.path.insert(0, str(_ToolPath(__file__).resolve().parents[2] / 'tools'))
from lib.machine_settings import photos_path
import json, shutil, sys
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


REAL_SAMPLES = {
    "example.heic": "IMG_6705.HEIC",
    "cosmos.avif": "-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif",
    "kodim.avif": "DSC08883.avif",
}


def generate(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    photos=[]
    for name,source in REAL_SAMPLES.items():
        target=folder/name;shutil.copyfile(photos_path('D:/Photos/HDR Test Images/'+source),target);photos.append(str(target))
    photographic=Path(photos_path("D:/Photos/HDR Test Images/DSC_3931_01.jpg"))
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
