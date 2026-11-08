"""Live output pixels compared against the same Grade scene and adjustments."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.adjustments import apply_adjustments,apply_hdr_output_highlight_compression,apply_sdr_output_highlight_compression
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.models import AdjustmentState,PreviewKind,LocalAdjustment,DenoiseDocumentSettings
from hdr_finisher.exporters import _denoised_export_source
from types import SimpleNamespace

data=json.loads(Path(sys.argv[1]).read_text());root=Path(data["location"]);results=[]
for row in data["rows"]:
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.library_pictures import reduce_picture
    from hdr_finisher.models import SourceInterpretationOverride
    photo=Path(row["photo"]);sidecar=photo.with_name(photo.name+".hdrf")
    document=json.loads(sidecar.read_text())["grade"] if sidecar.exists() else {}
    session=SessionStore().prepare_session(photo, owns_source_path=False,
        interpretation_override=SourceInterpretationOverride.model_validate(document.get("interpretation_override",{})),
        hdr_reference_white_nits=document.get("hdr_reference_white_nits",203))
    meta=row["meta"]
    image=reduce_picture(session.image,meta["edge"])
    reference=reduce_picture(session.sdr_reference_image,meta["edge"]) if session.sdr_reference_image is not None else None
    # Starting values come from full-source measurements, not the reduced scene.
    for lane in ("hdr","sdr"):
        field="highlight_compression_source_peak_nits" if lane=="hdr" else "highlight_compression_source_peak_percent"
        actual=meta["adjustments"][lane][field]
        expected=getattr(getattr(session.starting_adjustments(),lane),field)
        # Steve, November 8, 2026: on photos the Library reduces before developing
        # (b2c02e8c), its starting peak may differ from Grade's full-size peak by up to 1%.
        # Metadata reports the original size, so use the reduction rule itself: long edge over 5120.
        reduced=max(session.image.shape[0],session.image.shape[1])>5120
        assert abs(actual-expected)<=max(.001,abs(expected)*(.01 if reduced else .0001)),dict(
            photo=str(photo), measurement="starting pre-compression source peak",
            field=field, library=actual, grade=expected, renderer=meta.get("renderer"),
            source_size=[session.image.shape[1], session.image.shape[0]],
            library_source_size=[meta.get("source_width"), meta.get("source_height")])
    sampled=None
    for product in (row["large"],row["native"]):
        if product is None:
            assert row.get('nativeMemoryRefusal') is True
            continue
        source=session
        # The Library reads large TIFFs for its 640/2560 tiers through its 5120-edge
        # Lanczos reader, then reduces to the tier (library_rgb.py). Follow that route.
        if photo.suffix.lower() in {".tif",".tiff"} and product["edge"]<=2560 and reduced:
            sampled=sampled or SessionStore().prepare_session(photo, owns_source_path=False,
                interpretation_override=SourceInterpretationOverride.model_validate(document.get("interpretation_override",{})),
                hdr_reference_white_nits=document.get("hdr_reference_white_nits",203),library_edge=5120)
            source=sampled
        file=next(root.glob("library-*/"+product["source_key"]+".npz"))
        with np.load(file) as stored:
            for field,original in (("pixels",source.image),("reference",source.sdr_reference_image)):
                if original is None:
                    assert field not in stored.files
                    continue
                expected=reduce_picture(original,product["edge"])
                actual=stored[field].astype(np.float32)
                assert expected.shape==actual.shape
                # Existing scene-half transport precision, checked before finishing below.
                assert np.allclose(actual,expected,atol=.001,rtol=.001),dict(
                    photo=str(photo),field=field,edge=product["edge"],route="5120 then edge" if source is sampled else "one step",
                    max_abs=float(np.abs(actual-expected).max()),
                    outside=float((~np.isclose(actual,expected,atol=.001,rtol=.001)).mean()))
    grade=AdjustmentState.model_validate(meta["adjustments"]);grade.hdr.highlight_compression_target_nits=1000
    context=RenderColorContext(meta["white"]);checks=[]
    for lane in ("hdr","sdr"):
        frame=SimpleNamespace(image=image,denoise=DenoiseDocumentSettings.model_validate(meta.get("denoise",{})))
        expected=apply_adjustments(_denoised_export_source(frame,PreviewKind(lane)),grade,PreviewKind(lane),sdr_reference_image=reference,
            include_grain=True,include_output_highlight_compression=False,color_context=context,
            local_adjustments=grade.enabled_locals([LocalAdjustment.model_validate(item) for item in meta.get("locals",[])]))
        expected=apply_hdr_output_highlight_compression(expected,grade,color_context=context) if lane=="hdr" else apply_sdr_output_highlight_compression(expected,grade)
        actual=np.frombuffer(base64.b64decode(row["lanes"][lane]),dtype="<f2").reshape(meta["height"],meta["width"],3).astype(np.float32)
        metric=compare_finished_pixels(expected,actual,lane)
        checks.append(dict(lane=lane,mean=metric.mean,p999=metric.p999,passed=metric.passed))
    results.append(dict(photo=Path(row["photo"]).name,prepare_ms=row["prepareMs"],timings=meta.get("source_timings_ms"),checks=checks))
print(json.dumps(results))
