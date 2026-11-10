import asyncio
import struct
import numpy as np
import pytest
import tifffile
from hdr_finisher.library_exposure_admission import sensor_size, RATE
from hdr_finisher import library_estimates as estimates


def sony(path, pattern=True, dtype=np.uint16):
    tags = [(33421, 'H', 2, (2, 2), False), (33422, 'B', 4, (0, 1, 1, 2), False)] if pattern else []
    tifffile.imwrite(path, np.zeros((48, 64), dtype), photometric=32803, extratags=tags)


def canon(path, channels=4, sampling=0x11, truncated=False):
    width, height = 16, 48
    frame = bytes([14]) + struct.pack('>HHB', height, width, channels)
    frame += b''.join(bytes([i+1, sampling, 0]) for i in range(channels))
    jpeg = b'\xff\xd8\xff\xc3' + struct.pack('>H', len(frame)+2) + frame + b'\xff\xda'
    if truncated:
        jpeg = jpeg[:8]
    offset = 16 + 2 + 9*12 + 4
    entries = [(256,4,width),(257,4,height),(258,3,16),(259,3,6),(262,3,0),
               (273,4,offset),(277,3,channels),(278,4,height),(279,4,len(jpeg))]
    data = b'II*\x00' + struct.pack('<I',16) + b'CR\x02\x00' + struct.pack('<I',16)
    data += struct.pack('<H',len(entries))
    for tag, kind, value in sorted(entries):
        data += struct.pack('<HHII',tag,kind,1,value)
    path.write_bytes(data + struct.pack('<I',0) + jpeg)


@pytest.mark.parametrize('suffix,channels', [('.arw',1),('.cr2',2),('.cr2',4)])
def test_header_eligibility_never_constructs_raw_decoder_or_loads_pixels(tmp_path, monkeypatch, suffix, channels):
    import rawpy
    path = tmp_path / ('photo'+suffix)
    if suffix == '.arw':sony(path)
    else:canon(path,channels)
    monkeypatch.setattr(rawpy, 'RawPy', lambda: pytest.fail('admission decoded RAW'))
    monkeypatch.setattr(tifffile.TiffPage, 'asarray', lambda *a, **kw: pytest.fail('admission decoded TIFF'))
    assert sensor_size(path) == ((64,48) if suffix == '.arw' else (16*channels,48))


@pytest.mark.parametrize('channels,sampling,truncated', [(3,0x11,False),(4,0x22,False),(2,0x21,False),(4,0x11,True)])
def test_reduced_colour_or_damaged_canon_retains_conservative_route(tmp_path, channels, sampling, truncated):
    path = tmp_path/'reduced.cr2'
    canon(path,channels,sampling,truncated)
    assert sensor_size(path) is None


def test_unknown_sony_and_other_formats_cannot_take_small_route(tmp_path):
    path = tmp_path/'unknown.arw'
    sony(path,False)
    assert sensor_size(path) is None
    assert sensor_size(tmp_path/'other.nef') is None
    sony(path, dtype=np.float16)
    assert sensor_size(path) is None
    path.write_bytes(b'broken')
    assert sensor_size(path) is None


def test_approved_rate_minimum_and_cpu_fallback(monkeypatch):
    from hdr_finisher import library_exposure_admission as admission
    assert RATE == 12
    monkeypatch.setattr(admission,'sensor_size',lambda p:(8000,5320))
    assert estimates.exposure_reservation('a.arw') == ('exposure',12*8000*5320,'')
    assert estimates.estimate_details('a.arw','exposure') == (12*8000*5320,'')
    monkeypatch.setattr(admission,'sensor_size',lambda p:(8,8))
    assert estimates.exposure_reservation('a.arw')[1] == 64_000_000
    monkeypatch.setattr(admission,'sensor_size',lambda p:None)
    monkeypatch.setattr(estimates,'dimensions',lambda p:(8000,5320))
    assert estimates.exposure_reservation('other.nef') == ('cpu',25*8000*5320,'')


@pytest.mark.parametrize('kind', ['exposure','cpu'])
def test_backend_grant_uses_resolved_kind_and_releases_reservation(monkeypatch, kind):
    from hdr_finisher import library_grants
    from hdr_finisher.library_scheduler import Scheduler
    scheduler = Scheduler()
    scheduler.update(available=30_000_000_000,ram=64_000_000_000)
    monkeypatch.setattr(library_grants,'scheduler',scheduler)
    monkeypatch.setattr(library_grants,'exposure_reservation',lambda *a:(kind,300_000_000,''))
    async def run():
        async with library_grants.backend_grant('a.arw','exposure',priority=30) as token:
            job = scheduler.jobs[token]
            assert job.kind == kind and job.estimate == 300_000_000
            assert job.development == (kind == 'cpu')
        assert not scheduler.jobs
    asyncio.run(run())


def test_diagnostic_work_is_memory_gated_without_spending_development_slots():
    from hdr_finisher.library_scheduler import Scheduler
    s = Scheduler(4_000_000_000)
    s.update(available=30_000_000_000,ram=64_000_000_000)
    for i in range(3):
        assert s.ask(str(i),'backend','a.arw','exposure',500_000_000,'now').granted is not None
    blocked = s.ask('large','backend','a.arw','exposure',2_000_000_000,'eventually')
    assert blocked.granted is None
