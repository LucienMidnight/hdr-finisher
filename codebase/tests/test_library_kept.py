from pathlib import Path
from copy import deepcopy
import json
import numpy as np
import pytest
from test_library_grades import setup, saved, edit
from hdr_finisher.library_kept import produce, identity, preferences, KeptPictures, atomic_json
from hdr_finisher.library_pictures import LibraryPictureCache
from hdr_finisher import exporters
from hdr_finisher.models import ExportSettings, PreviewKind

class Worker:
    def status(self): return {"paused":False}

def test_corrected_producer_uses_same_export_renditions_and_never_changes_open_grade(setup,monkeypatch,tmp_path):
    photo,store,session,marks,grades=setup
    grade=saved(setup); captured={}
    def encode(path,hdr,sdr,settings,white):
        captured.update(hdr=hdr.copy(),sdr=sdr.copy(),white=white);Path(path).write_bytes(b"test")
    monkeypatch.setattr(exporters,"write_jpeg_gainmap_renditions",encode)
    previous=session.edit_document().model_dump(mode="json")
    result=produce(tmp_path,photo,grade,512)
    settings=ExportSettings(quality=75,jpeg_gain_map_quality=75,jpeg_gain_map_scale="half",dithering="off")
    adjustments=exporters._finishing_adjustments_for_export(session);adjustments.shared.overlay_mode="off"
    np.testing.assert_array_equal(captured["hdr"],exporters._render_export_branch(session,settings,PreviewKind.HDR,adjustments))
    np.testing.assert_array_equal(captured["sdr"],exporters._render_export_branch(session,settings,PreviewKind.SDR,adjustments))
    assert session.edit_document().model_dump(mode="json")==previous
    assert result["width"]==76 and result["height"]==52
    Path(result["temporary"]).unlink()

def test_picture_preferences_preserve_unknown_and_reject_unreadable(tmp_path):
    assert preferences(tmp_path)=={"edited_edge":1024,"limit_bytes":2*1024**3}
    path=tmp_path/"library-picture-preferences.json"
    path.write_text('{"future":17}')
    preferences(tmp_path,{"edited_edge":512})
    assert json.loads(path.read_text())["future"]==17
    with pytest.raises(ValueError, match="1 GB"):
        preferences(tmp_path,{"limit_bytes":1024**3-1})
    assert preferences(tmp_path,{"limit_bytes":1024**3})["limit_bytes"]==1024**3
    path.write_text('broken')
    with pytest.raises(ValueError): preferences(tmp_path,{"edited_edge":1920})
    assert path.read_text()=='broken'

def test_picture_matching_and_missing_fallback(setup,tmp_path):
    photo,store,session,marks,grades=setup
    grade=saved(setup);kept=KeptPictures(tmp_path,marks,Worker())
    assert kept.request(photo)["edited"]
    assert kept.cached(photo) is None
    key=kept.key(str(photo),identity(grade));kept.cache.root.mkdir(parents=True)
    (kept.cache.root/(key+".jpg")).write_bytes(b"jpeg")
    atomic_json(kept.cache.root/(key+".json"),{"extension":"jpg","grade_identity":identity(grade),"source_stat":kept.source_stat(photo)})
    assert kept.cached(photo)["kept"]
    document=json.loads(Path(str(photo)+".hdrf").read_text());document["grade"]["global_adjustments"]["hdr"]["exposure"]=3
    Path(str(photo)+".hdrf").write_text(json.dumps(document))
    assert kept.cached(photo) is None

def test_single_budget_removes_quick_pictures_first(tmp_path):
    cache=LibraryPictureCache(tmp_path,limit=100)
    cache.root.mkdir();(cache.root/"a.npz").write_bytes(b"x"*80);(cache.root/"b.jpg").write_bytes(b"x"*50)
    cache.trim();assert not (cache.root/"a.npz").exists();assert (cache.root/"b.jpg").exists()

def test_publication_request_not_tied_to_open_grade(setup,tmp_path):
    photo,store,session,marks,grades=setup
    saved(setup);store.clear()
    assert KeptPictures(tmp_path,marks,Worker()).request(photo)["edited"]


def test_library_jpeg_file_reader_matches_sdr_and_reconstructs_hdr(tmp_path):
    from hdr_finisher.library_kept import jpeg_renditions
    from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg
    from hdr_finisher.color import linear_srgb_to_acescg
    x = np.linspace(.03, .8, 96, dtype=np.float32)
    sdr = np.broadcast_to(np.stack((x, x*.7, x*.4), axis=1), (64,96,3)).copy()
    hdr = linear_srgb_to_acescg(sdr * .18 * 2)
    path = tmp_path / "kept.jpg"
    exporters.write_jpeg_gainmap_renditions(path, hdr, sdr, ExportSettings(quality=75, jpeg_gain_map_quality=75, jpeg_gain_map_scale="half", dithering="off"))
    reference, base, _ = decode_ultrahdr_jpeg(path)
    np.testing.assert_allclose(jpeg_renditions(path), base, atol=1e-6)
    assert np.mean(np.abs(jpeg_renditions(path, True)-reference)) / np.mean(reference) < .01
