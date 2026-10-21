"""Library-only linear-DNG bridge; the ordinary decoder remains unchanged."""
from pathlib import Path
from time import perf_counter
import numpy as np
from .library_gpu_raw import NotEligible, _identity
from .models import SourceImageDescriptor


def decoded(path, inputs, inspection, progress=None, cancelled=None, edge=640):
    import tifffile
    from . import linear_dng as dng
    from .dng_color import normalize_camera_samples, build_color_transform, _build_clipped_highlight_support, _validated_response_limit
    from .color import _ACESCG_TO_LINEAR_SRGB, _ACESCG_TO_LINEAR_BT2020
    from .import_defaults import RAW_CALIBRATION_EV
    from .library_pictures import reduce_picture
    from .library_dng import geometry
    # A declared operation-free subset. Other linear cases retain the correct
    # decoder; no required correction or rendered SDR rendition is skipped.
    if inspection.required_opcodes or inspection.optional_opcodes:
        raise NotEligible("Linear DNG operations retain the existing CPU route")
    if edge == 100000 and inspection.metadata.get("sdr_preview_series_index") is not None:
        raise NotEligible("Native linear DNG with an embedded SDR rendition retains the CPU route")
    path=Path(path);identity=_identity(path);started=perf_counter()
    report=lambda stage,text: progress(stage,text) if progress else None
    metadata=inspection.metadata;reference=None
    with tifffile.TiffFile(path) as tif:
        page=tif.series[inspection.primary_series_index].pages[0]
        dng._verify_fingerprint(path,page,inspection.fingerprint)
        preview_index=metadata.get("sdr_preview_series_index")
        if preview_index is not None:
            report("dng_sdr_preview","Reading the embedded SDR picture")
            series=tif.series[int(preview_index)]
            preview=dng.crop_and_orient(dng._normalize_layout(series.asarray(),getattr(series,"axes",None)),metadata)
            reference=dng._decode_srgb_reference(preview,cancelled=cancelled)
            del preview
        report("dng_decode","Reading linear DNG samples")
        source=tifffile.memmap(path,series=inspection.primary_series_index,mode="r") if page.is_memmappable else page.asarray()
        source=dng._normalize_layout(source,getattr(tif.series[inspection.primary_series_index],"axes",None))
        colour=dng.color_metadata_from_mapping(metadata)
        report("dng_normalize","Normalizing DNG black and white levels")
        image=normalize_camera_samples(source,colour,cancelled=cancelled)
        del source
    decode_ms=(perf_counter()-started)*1000
    h,w=image.shape[:2];outw,outh,ax,ay=geometry(metadata,w,h)
    if reference is not None and reference.shape!=(outh,outw,3):reference=None
    transform=build_color_transform(colour)
    limit=_validated_response_limit(colour.linear_response_limit)
    report("dng_highlight_support","Finding clipped DNG highlights")
    support_started=perf_counter()
    support=_build_clipped_highlight_support(image,limit,cancelled=cancelled) if limit is not None else None
    support_ms=(perf_counter()-support_started)*1000
    parts=[memoryview(image).cast("B")];offset=image.nbytes
    linear=dict(width=w,height=h,affine_x=ax,affine_y=ay,neutral=transform.camera_neutral.tolist(),response_limit=limit)
    if support is not None:
        mask,block=support;mask=np.ascontiguousarray(mask,dtype="<f4")
        linear["support"]=dict(offset=offset,bytes=mask.nbytes,width=mask.shape[1],height=mask.shape[0],block=block)
        parts.append(memoryview(mask).cast("B"));offset+=mask.nbytes
    references={};reference_peak=0.0
    if reference is not None:
        report("dng_sdr_reduce","Preparing the embedded SDR picture")
        reference_peak=float(np.max(reference))
        for size in sorted({640,2560,edge},reverse=True):
            dng._raise_if_cancelled(cancelled)
            reduced=np.ascontiguousarray(reduce_picture(reference,size).transpose(2,0,1),dtype="<f4")
            references[str(size)]=dict(offset=offset,bytes=reduced.nbytes,width=reduced.shape[2],height=reduced.shape[1])
            parts.append(memoryview(reduced).cast("B"));offset+=reduced.nbytes
        del reference
    facts=dict(bit_depth=inspection.dtype,color_space="ACEScg",source_color_space_label="Camera native (embedded DNG profile)",
        transfer_function="LINEAR",decoder_normalized_to_acescg=True,dng_input=True,raw_input=True,raw_mosaiced=False,
        experimental_dng_import=True,experimental_dng_label="Experimental DNG Import",dng_route=inspection.route.value,
        dng_color_path=transform.color_path,dng_highlight_color_recovery="spatial_camera_neutral_reconstruction_near_linear_response_limit",
        dng_sdr_rendition="embedded_full_resolution" if references else "generated",dng_operations="none",
        dng_warnings=" | ".join(inspection.warnings) or "none",
        dng_diagnostics=dict(route=inspection.route.value,producer=metadata.get("producer"),make=metadata.get("make"),model=metadata.get("model"),
            dng_version=metadata.get("dng_version"),source_dimensions=[w,h],compression=inspection.compression,source_dtype=inspection.dtype,
            primary_series_index=inspection.primary_series_index,primary_page_offset=inspection.fingerprint.primary_offset,
            color_path=transform.color_path,linear_response_limit=colour.linear_response_limit,
            highlight_color_recovery="spatial_camera_neutral_reconstruction_near_linear_response_limit",
            estimated_profile_temperature=transform.estimated_temperature,profile_weight1=transform.profile_weight1,
            opcode_operations=[],merge_xmp_crop=metadata.get("xmp_merge_crop"),warnings=list(inspection.warnings),
            resource_estimate=dng._resource_payload(inspection.resource_estimate)))
    descriptor=SourceImageDescriptor(filename=path.name,suffix=".dng",width=outw,height=outh,channels=3,dtype="float32",
        source_color_space=facts["source_color_space_label"],transfer_function="LINEAR")
    dng._raise_if_cancelled(cancelled)
    if _identity(path)!=identity:raise ValueError("Photo changed during linear DNG preparation")
    return dict(rgb=True,adapter_version="library-dng-linear-v1",path=str(path),identity=identity,width=outw,height=outh,flip=0,
        mosaic_bytes=image.nbytes,sample_stride=max(1,int(np.ceil(np.sqrt(outw*outh/2_000_000)))),
        layout=dict(dtype="float32",order="HWC",channels=["R","G","B"],ownership="request-owned"),
        orientation=dict(original=int(metadata["orientation"]),applied=True),dng_linear=linear,dng_references=references,
        dng_reference_peak=reference_peak,raw_import_settings=inputs["raw_import_settings"],
        colour=dict(primaries="camera",transfer="LINEAR",reference_white_nits=inputs["hdr_reference_white_nits"],authored_sdr=False,
            scale=2.0**RAW_CALIBRATION_EV,decoder_metadata=facts,descriptor=descriptor.model_dump(mode="json")),
        rgb_to_acescg=(transform.camera_to_acescg.astype(np.float32)*np.float32(2**colour.baseline_exposure)).tolist(),
        acescg_to_srgb=_ACESCG_TO_LINEAR_SRGB.T.tolist(),acescg_to_bt2020=_ACESCG_TO_LINEAR_BT2020.T.tolist(),
        decode_ms=decode_ms,highlight_support_ms=support_ms),parts
