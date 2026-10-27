"""Metadata changes must leave delivery-owned bytes and privacy intact."""
from pathlib import Path
from types import SimpleNamespace
import json
import shutil
import numpy as np
import pytest
from PIL import Image
from hdr_finisher import export_metadata as metadata
from hdr_finisher.exporters import _PreparedExport, _execute_export
from hdr_finisher.export_presets import ExportPresets, ExportPreset, ExportVersion
from hdr_finisher.library_thumbnail_codec import encode
from hdr_finisher.models import ExportSettings

@pytest.fixture
def source(tmp_path):
    try:
        metadata.command()
    except ValueError:
        pytest.skip("Run tools/fetch_exiftool.py to install the pinned metadata helper.")
    path=tmp_path/"source.jpg"
    Image.new("RGB",(32,24)).save(path)
    metadata.helper().execute("-overwrite_original","-Artist=Original","-Copyright=Original rights",
        "-DateTimeOriginal=2020:01:02 03:04:05","-GPSLatitude=12","-GPSLatitudeRef=N",
        "-GPSLongitude=45","-GPSLongitudeRef=E","-EXIF:SerialNumber=camera-private",
        "-EXIF:LensSerialNumber=lens-private","-EXIF:OwnerName=owner-private",
        "-XMP-dc:Title=Source title","-XMP-photoshop:City=Private city",str(path))
    return path

@pytest.mark.parametrize("format",["jpeg_ultrahdr","sdr_png"])
@pytest.mark.parametrize("policy",["none","copyright","all_except_location","all_including_location"])
def test_policies_templates_and_delivery_bytes(source,tmp_path,format,policy):
    baseline=tmp_path/("baseline.jpg" if format=="jpeg_ultrahdr" else "baseline.png")
    if format=="jpeg_ultrahdr":
        baseline.write_bytes(encode(np.full((24,32,3),.72,dtype=np.float32),np.full((24,32,3),.2,dtype=np.float32)))
    else:
        Image.new("RGB",(32,24),(20,60,120)).save(baseline)
    output=tmp_path/("out"+baseline.suffix)
    settings=ExportSettings(format=format,output_path=str(output),metadata_policy=policy,
        metadata_template={"title":"Photo {filename} {sequence}","caption":"Captured {capture_date}","creator":"Steve","copyright":"Mine"},metadata_sequence=7)
    result=_execute_export(SimpleNamespace(name="metadata fixture"),SimpleNamespace(source_path=source),settings,
        suffix=baseline.suffix,prepare=lambda:_PreparedExport(baseline.suffix,lambda p:shutil.copyfile(baseline,p),lambda p:None),
        success_message=lambda *_:"saved",failure_prefix=None)
    assert result.accepted,result.message
    assert metadata.delivery_fingerprint(output.read_bytes(),format)==metadata.delivery_fingerprint(baseline.read_bytes(),format)
    tags=json.loads(metadata.helper().execute("-j","-Title","-Description","-Artist","-Copyright","-GPSLatitude","-LensSerialNumber",str(output)))[0]
    assert tags["Title"]=="Photo source 7"
    assert tags["Description"]=="Captured 2020-01-02"
    assert tags["Artist"]=="Steve" and tags["Copyright"]=="Mine"
    assert ("GPSLatitude" in tags)==(policy=="all_including_location")
    assert ("LensSerialNumber" in tags)==policy.startswith("all_")
    # Explicit privacy overrides the otherwise most permissive policy.
    settings.metadata_policy="all_including_location";settings.metadata_strip_location=True;settings.metadata_strip_serials=True
    metadata.write_metadata(output,SimpleNamespace(source_path=source),settings)
    tags=json.loads(metadata.helper().execute("-j","-GPS:all","-SerialNumber","-LensSerialNumber","-OwnerName","-City",str(output)))[0]
    assert set(tags)=={"SourceFile"}


def test_template_privacy_preset_roundtrip(tmp_path):
    settings=ExportSettings(metadata_policy="all_including_location",metadata_template={"title":"{filename} {sequence}","caption":"{capture_date}"},metadata_strip_location=True,metadata_strip_serials=True)
    presets=ExportPresets(tmp_path);preset=ExportPreset(name="Metadata",versions=[ExportVersion(settings=settings)])
    presets.save(preset)
    assert presets.list()[0].versions[0].settings==settings


def test_missing_helper_fails_without_publishing(monkeypatch,tmp_path):
    monkeypatch.setattr(metadata,"bundled_binary_dir",lambda:tmp_path)
    monkeypatch.setattr(metadata,"runtime_binary_dir",lambda:tmp_path)
    with pytest.raises(ValueError,match="Bundled ExifTool is missing"):
        metadata.command()
