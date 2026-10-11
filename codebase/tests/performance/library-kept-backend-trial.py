"""Read-only corrected-source / reduced export-rendition timing trial."""
import os
for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[name] = "1"
import sys, json
from pathlib import Path
from time import perf_counter
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher.sessions import SessionStore
from hdr_finisher.library_pictures import reduce_picture
from hdr_finisher import exporters, loader
from hdr_finisher.models import ExportSettings, PreviewKind
source=Path(sys.argv[1])
root=Path(__file__).resolve().parents[2] / "output" / "library-kept-trial"
root.mkdir(parents=True,exist_ok=True)
t=perf_counter()
s=SessionStore().prepare_session(source,owns_source_path=False)
load_ms=(perf_counter()-t)*1000
s.adjustments.hdr.exposure += .5
s.adjustments.sdr.exposure += .2
s.adjustments.shared.geometry.rotation=90
s.adjustments.shared.geometry.crop.x=.08
s.adjustments.shared.geometry.crop.width=.82
s.denoise.hdr.enabled=True
s.denoise.sdr.enabled=True
s.denoise.hdr.controls.amount=40
s.denoise.sdr.controls.amount=40
settings=ExportSettings(quality=75,jpeg_gain_map_quality=75,jpeg_gain_map_scale="half",avif_bit_depth=8,avif_gain_map_quality=75,avif_gain_map_scale="half",dithering="off")
print(json.dumps({"source":str(source),"shape":list(s.image.shape),"load_ms":load_ms,"lens":s.metadata.get("lens_correction")}),flush=True)
for edge in (512,1024,1920):
    t=perf_counter()
    frame=SimpleNamespace(image=reduce_picture(s.image,edge),sdr_reference_image=reduce_picture(s.sdr_reference_image,edge) if s.sdr_reference_image is not None else None,adjustments=s.adjustments,local_adjustments=s.local_adjustments,denoise=s.denoise,color_context=s.color_context,hdr_reference_white_nits=s.hdr_reference_white_nits)
    adjustments=exporters._finishing_adjustments_for_export(frame)
    hdr=exporters._render_export_branch(frame,settings,PreviewKind.HDR,adjustments)
    sdr=exporters._render_export_branch(frame,settings,PreviewKind.SDR,adjustments)
    render_ms=(perf_counter()-t)*1000
    for format,writer,decode in (("jpeg",exporters.write_jpeg_gainmap_renditions,loader.decode_ultrahdr_jpeg),("avif",exporters.write_avif_gainmap_renditions,loader.decode_avif)):
        dest=root / (str(edge)+(".jpg" if format=="jpeg" else ".avif"))
        t=perf_counter();writer(dest,hdr,sdr,settings,s.hdr_reference_white_nits); encode_ms=(perf_counter()-t)*1000
        t=perf_counter(); decode(dest); decode_ms=(perf_counter()-t)*1000
        print(json.dumps({"edge":edge,"format":format,"bytes":dest.stat().st_size,"render_ms":render_ms,"encode_ms":encode_ms,"decode_ms":decode_ms,"total_ms":load_ms+render_ms+encode_ms}),flush=True)
