"""Live output pixels compared against the same Grade scene and adjustments."""
import base64,json,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"backend"))
from hdr_finisher.adjustments import apply_adjustments,apply_hdr_output_highlight_compression,apply_sdr_output_highlight_compression
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.models import AdjustmentState,PreviewKind

data=json.loads(Path(sys.argv[1]).read_text());root=Path(data["location"]);results=[]
for row in data["rows"]:
    meta=row["meta"];file=next(root.glob("library-*/"+meta["source_key"]+".npz"))
    with np.load(file) as source:
        image=source["pixels"].astype(np.float32)
        reference=source["reference"].astype(np.float32) if "reference" in source else None
    grade=AdjustmentState.model_validate(meta["adjustments"]);grade.hdr.highlight_compression_target_nits=1000
    context=RenderColorContext(meta["white"]);checks=[]
    for lane in ("hdr","sdr"):
        expected=apply_adjustments(image,grade,PreviewKind(lane),sdr_reference_image=reference,
            include_grain=True,include_output_highlight_compression=False,color_context=context)
        expected=apply_hdr_output_highlight_compression(expected,grade,color_context=context) if lane=="hdr" else apply_sdr_output_highlight_compression(expected,grade)
        actual=np.frombuffer(base64.b64decode(row["lanes"][lane]),dtype="<f2").reshape(meta["height"],meta["width"],3).astype(np.float32)
        metric=compare_finished_pixels(expected,actual,lane)
        checks.append(dict(lane=lane,mean=metric.mean,p999=metric.p999,passed=metric.passed))
    results.append(dict(photo=Path(row["photo"]).name,checks=checks))
print(json.dumps(results))
