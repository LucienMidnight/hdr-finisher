"""Compare real corrected-source routes exactly on a disposable source copy."""
from pathlib import Path
import shutil
import sys
import tempfile
import time
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from hdr_finisher.sessions import SessionStore
from hdr_finisher.library_kept import produce, capture_source
from hdr_finisher import exporters

folder = Path(tempfile.mkdtemp(prefix="parity-", dir=ROOT / "output/library-round1"))
photo = folder / Path(sys.argv[1]).name
shutil.copyfile(sys.argv[1], photo)
session = SessionStore().prepare_session(photo, owns_source_path=False)
grade = session.edit_document().model_dump(mode="json")
grade["global_adjustments"]["hdr"]["exposure"] = .75
grade["global_adjustments"]["sdr"]["exposure"] = -.25
captured = []
original = exporters.write_jpeg_gainmap_renditions
def writer(path, hdr, sdr, *args):
    captured.append((hdr.copy(), sdr.copy()))
    original(path, hdr, sdr, *args)
exporters.write_jpeg_gainmap_renditions = writer
before = produce(folder, photo, grade)
snapshot = capture_source(session)
after = produce(folder, photo, grade, source=snapshot)
assert not snapshot, "The queue must release its full-size source references"
for lane in range(2):
    np.testing.assert_array_equal(captured[0][lane], captured[1][lane])
assert Path(before["temporary"]).read_bytes() == Path(after["temporary"]).read_bytes()
print({"exact_hdr_sdr_and_jpeg": True,
       "reopened_ms": before["make_ms"], "open_ms": after["make_ms"],
       "source_ms": after["source_ms"], "render_ms": after["render_ms"], "encode_ms": after["encode_ms"]})
for result in (before, after):
    Path(result["temporary"]).unlink()
