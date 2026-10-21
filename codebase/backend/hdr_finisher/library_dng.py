"""Narrow Library bridge: CPU AHD/GainMap, GPU WarpRectilinear, then colour.

No Grade/export/Proof entry point calls this module.
"""
from pathlib import Path
from time import perf_counter
import numpy as np
from .library_gpu_raw import NotEligible, _identity
from . import raw_import
from .models import RawImportSettings, SourceImageDescriptor


def plan(inspection):
    from .linear_dng import DngRoute
    from .dng_opcodes import parse_warp_rectilinear, parse_gain_map
    if inspection.route is not DngRoute.MOSAICED_RAW_DNG or not inspection.required_opcodes:
        raise NotEligible("DNG GPU warp requires a mosaiced DNG with mandatory corrections")
    ordered = sorted((*inspection.required_opcodes, *inspection.optional_opcodes), key=lambda op: op.index)
    applied = []
    for op in ordered:
        if op.list_name != "OpcodeList3" or op.opcode_id not in {1, 9}:
            if op.optional: continue
            raise NotEligible("Unsupported mandatory DNG operation: " + op.name)
        if op.minimum_version > (1,3,0,0):
            raise NotEligible("DNG opcode version requires the existing CPU route")
        (parse_gain_map if op.opcode_id == 9 else parse_warp_rectilinear)(op.parameters)
        applied.append(op)
    if not applied or applied[-1].opcode_id != 1 or sum(op.opcode_id == 1 for op in applied) != 1:
        raise NotEligible("DNG GPU route requires one final WarpRectilinear after any GainMaps")
    warp = parse_warp_rectilinear(applied[-1].parameters)
    if not (0 <= warp.center_x <= 1 and 0 <= warp.center_y <= 1):
        raise NotEligible("DNG optical centre is outside supported bounds")
    return ordered, applied[-1], warp


def geometry(metadata, width, height):
    from .linear_dng import crop_and_orient
    # Validate with the existing crop routine, using a zero-stride view (no image allocation).
    dummy = np.lib.stride_tricks.as_strided(np.zeros(1, np.float32), shape=(height,width,3), strides=(0,0,0))
    output = crop_and_orient(dummy, metadata)
    top,left,_,_ = map(int,metadata["active_area"])
    origin = np.rint(metadata["default_crop_origin"]).astype(int)
    cw,ch = np.rint(metadata["default_crop_size"]).astype(int)
    left += int(origin[0]);top += int(origin[1])
    orientation = int(metadata["orientation"])
    # Source x/y as affine functions of oriented output x/y, at integer pixel centres.
    transforms = {1:([1,0,0],[0,1,0]),2:([-1,0,cw-1],[0,1,0]),
        3:([-1,0,cw-1],[0,-1,ch-1]),4:([1,0,0],[0,-1,ch-1]),
        5:([0,1,0],[1,0,0]),6:([0,1,0],[-1,0,ch-1]),
        7:([0,1,0],[-1,0,ch-1]),8:([0,-1,cw-1],[1,0,0])}
    # Preserve the current CPU orientation 7 semantics (horizontal flip AFTER transpose).
    ax,ay = [list(row) for row in transforms[orientation]]
    ox=oy=0
    if metadata.get("xmp_merge_crop") is not None:
        ow,oh = (ch,cw) if orientation >= 5 else (cw,ch)
        ox,oy = np.rint(np.asarray(metadata["xmp_merge_crop"][:2])*[ow,oh]).astype(int)
    ax[2] += left + ax[0]*ox + ax[1]*oy
    ay[2] += top + ay[0]*ox + ay[1]*oy
    return output.shape[1],output.shape[0],list(map(int,ax)),list(map(int,ay))


def decoded(path, inputs, progress=None, cancelled=None):
    from .linear_dng import inspect_dng, color_metadata_from_mapping
    from .dng_opcodes import apply_opcode_list3, _diagnostic
    from .dng_color import build_color_transform
    from .color import _ACESCG_TO_LINEAR_SRGB, _ACESCG_TO_LINEAR_BT2020
    from .import_defaults import RAW_CALIBRATION_EV
    path=Path(path).resolve(strict=True);identity=_identity(path);start=perf_counter()
    inspection=inspect_dng(path)
    ordered,warp_op,warp=plan(inspection)
    settings=RawImportSettings.model_validate(inputs["raw_import_settings"])
    raw_inspection=raw_import._inspect_raw(path,dng_inspection=inspection,progress=progress,cancelled=cancelled)
    decode_plan=raw_import._build_raw_decode_plan(settings,raw_inspection)
    decoded=raw_import._execute_raw_decode(path,settings,raw_inspection,decode_plan,progress=progress,cancelled=cancelled)
    image=decoded.developed.astype(np.float32);image*=np.float32(1/65535)
    decoded.developed=np.empty((0,),np.uint16)
    h,w=image.shape[:2]
    if (w,h)!=(inspection.fingerprint.width,inspection.fingerprint.height):
        raise NotEligible("DNG decoder dimensions differ from opcode coordinates")
    decode_ms=(perf_counter()-start)*1000
    gain_started=perf_counter()
    image,audit=apply_opcode_list3(image,[op for op in ordered if op is not warp_op],cancelled=cancelled,progress=progress)
    gain_ms=(perf_counter()-gain_started)*1000
    outw,outh,ax,ay=geometry(inspection.metadata,w,h)
    colour=color_metadata_from_mapping(inspection.metadata);transform=build_color_transform(colour)
    correction=raw_import._RawCorrectionResult(image,settings.lens.model_copy(update={"mode":"off"}),
        {"mode":"off","requested_mode":settings.lens.mode,"applied":False,"reason":"Mandatory DNG corrections prevent duplicate Lensfun correction."},
        {"decoder_behavior":"verified_ignores_opcode_list3","application_stage":"camera_linear_after_demosaic_before_dng_color_transform",
         "operations":sorted([*audit,_diagnostic(warp_op,"applied_gpu")],key=lambda op:op["index"])})
    metadata=raw_import._build_raw_provenance(path,settings,raw_inspection,decode_plan,decoded,correction)
    metadata["raw_start_brightness"]={"calibration_ev":RAW_CALIBRATION_EV,"recorded_brightness_ev":0.0,"fuji_dynamic_range_percent":None}
    descriptor=SourceImageDescriptor(filename=path.name,suffix=".dng",width=outw,height=outh,channels=3,dtype="float32",source_color_space="ACEScg",transfer_function="LINEAR")
    cx=warp.center_x*w;cy=warp.center_y*h
    if _identity(path)!=identity: raise ValueError("Photo changed during DNG preparation")
    return {"rgb":True,"adapter_version":"library-dng-warp-v1","path":str(path),"identity":identity,
        "width":outw,"height":outh,"flip":0,"mosaic_bytes":image.nbytes,"sample_stride":max(1,int(np.ceil(np.sqrt(outw*outh/2_000_000)))),
        "layout":{"dtype":"float32","order":"HWC","channels":["R","G","B"],"ownership":"request-owned"},
        "orientation":{"original":int(inspection.metadata["orientation"]),"applied":True},
        "dng_warp":{"width":w,"height":h,"coefficients":warp.coefficients.tolist(),"center":[cx,cy],
            "radius":float(np.hypot(max(cx,w-cx),max(cy,h-cy))),"affine_x":ax,"affine_y":ay},
        "colour":{"primaries":"camera","transfer":"LINEAR","reference_white_nits":inputs["hdr_reference_white_nits"],"authored_sdr":False,
            "scale":2.0**RAW_CALIBRATION_EV,"decoder_metadata":metadata,"descriptor":descriptor.model_dump(mode="json")},
        "raw_import_settings":settings.model_dump(mode="json"),
        "rgb_to_acescg":(transform.camera_to_acescg.astype(np.float32)*np.float32(2**colour.baseline_exposure)).tolist(),
        "acescg_to_srgb":_ACESCG_TO_LINEAR_SRGB.T.tolist(),"acescg_to_bt2020":_ACESCG_TO_LINEAR_BT2020.T.tolist(),
        "decode_ms":decode_ms,"gain_map_ms":gain_ms},[memoryview(image).cast("B")]
