"""Existing Denoise corpus, finished-pixel qualification; no knob sweeps."""
import json
from pathlib import Path
import struct
import sys
import time
import numpy as np
from hdr_finisher import denoise_adaptive as da
from hdr_finisher.adjustments import apply_adjustments
import colour
from hdr_finisher.color import acescg_to_linear_bt2020
from hdr_finisher.color_context import scene_linear_to_nits

def compare(a,b,lane):
    if lane=="sdr":
        pair=[colour.XYZ_to_Lab(colour.RGB_to_XYZ(np.clip(v,0,1),colour.RGB_COLOURSPACES["sRGB"])) for v in (a,b)]
        delta=colour.difference.delta_E_CIE2000(*pair)
    else:
        pair=[colour.RGB_to_ICtCp(np.maximum(scene_linear_to_nits(acescg_to_linear_bt2020(v),203),0),method="ITU-R BT.2100-2 PQ") for v in (a,b)]
        delta=colour.difference.delta_E_ITP(*pair)
    mean=float(np.mean(delta));p99=float(np.percentile(delta,99))
    return {"mean":mean,"p99":p99,"passed":mean<1 and p99<3}

from hdr_finisher.models import AdjustmentState, PreviewKind

root=Path(sys.argv[2])
if sys.argv[1]=="make":
    import tifffile
    from tools.denoise_lab.corpus import cases
    entries=[]
    for reference, case, clean, noisy in cases():
        name=reference+"-"+case.name
        target=root/(name+".tiff")
        tifffile.imwrite(target,noisy,photometric="rgb")
        entries.append(str(target))
    (root/"corpus.json").write_text(json.dumps(entries))
else:
    results=[]
    for item in json.loads((root/"models.json").read_text()):
        body=Path(item["source"]).read_bytes();length=struct.unpack("<I",body[:4])[0]
        description=json.loads(body[4:4+length]);assert len(description["windows"])==1
        image=np.frombuffer(body,offset=4+length,dtype="<f4").reshape(description["height"],description["width"],4)[...,:3]
        def model(value):
            return da.AdaptiveNoiseModel(a=value["a"],b=value["b"],c=value["c"],band_sigmas=tuple(tuple(row) for row in value["band_sigmas"]))
        row={k:item[k] for k in ("name","cpu_ms","gpu_ms","reuse_ms")}
        row["differences"]=[]
        for amount in (.5,.85):
            controls=da.AdaptiveControls(amount=amount,luminance=.7,color_noise=.8,detail_recovery=.3)
            reference=da.resolve_adaptive(image,model(item["cpu"]),controls)
            measured=da.resolve_adaptive(image,model(item["gpu"]),controls)
            grade=AdjustmentState()
            grade.hdr.exposure=1.5
            grade.hdr.highlight_section_enabled=True
            grade.hdr.highlight_compression_target_nits=1000
            for lane in (PreviewKind.HDR,PreviewKind.SDR):
                a=apply_adjustments(reference,grade,lane,include_grain=False)
                b=apply_adjustments(measured,grade,lane,include_grain=False)
                result={"lane":lane.value,"amount":amount,**compare(a,b,lane.value)}
                row["differences"].append(result)
                if lane==PreviewKind.HDR:
                    from hdr_finisher.color import acescg_to_linear_bt2020
                    from hdr_finisher.color_context import scene_linear_to_nits
                    peak=float(np.max(scene_linear_to_nits(acescg_to_linear_bt2020(b),203)))
                    assert peak<=1000,(item["name"],peak)
        results.append(row)
        print(json.dumps(row),flush=True)
    (root/"result.json").write_text(json.dumps(results,indent=2))
    assert all(d["passed"] for r in results for d in r["differences"]),"GPU noise measurement changed the finished Denoise look beyond tolerance"
