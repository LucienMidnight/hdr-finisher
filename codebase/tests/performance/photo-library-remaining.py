"""External M2/M3/M6/T1 instrument, not an adopted library pipeline or schema.

Run with the codebase .venv Python. Outputs and copied photos stay under output.
CPU proxy rendering uses real SessionStore defaults, source_pair and the existing
Ultra HDR exporter unchanged. Cold means new session/cache, not flushed OS disk.
The uncached screen batch uses 30 distinct originals. Cached edit batches
cycle ten reduced sources, not 500 distinct source photos.
"""
from __future__ import annotations
import argparse
import atexit
from collections import Counter
import ctypes
import gc
import json
import os
from pathlib import Path
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/library-measurements/remaining"
sys.path.insert(0, str(ROOT / "backend"))
for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[key] = "1"
os.environ["HDR_FINISHER_APP_DATA_DIR"] = str(OUT / "app-data")
os.environ["HDR_FINISHER_SOURCE_CACHE_DISABLE"] = "1"

def timed(call):
    start = time.perf_counter()
    value = call()
    return value, (time.perf_counter() - start) * 1000

def memory():
    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ("peak", "working", "quota_peak_paged", "quota_paged",
                "quota_peak_nonpaged", "quota_nonpaged", "pagefile", "peak_pagefile")]
    c = Counters()
    c.cb = ctypes.sizeof(c)
    kernel = ctypes.WinDLL("kernel32")
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi = ctypes.WinDLL("psapi")
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(c), c.cb):
        raise ctypes.WinError()
    return {"working": c.working, "private": c.pagefile, "peak_working": c.peak}

def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2), encoding="utf-8")

def selected():
    corpus = json.loads((ROOT / "output/library-measurements/corpus.json").read_text())
    names = ("DJI_0071-2.DNG", "DSC02767.ARW", "DSC06615.ARW",
        "DSC00264_DxO-optical-corr-only.dng", "2L1B8631.CR2",
        "Fujifilm_X-E2S_DSCF6495.RAF", "Nikon_D7500_DSC_3931.NEF")
    paths = [Path(next(row["path"] for row in corpus["rows"] if Path(row["path"]).name == name))
        for name in names]
    paths += [Path(corpus["source"]) / "DJI Samples/DJI_0071.JPG",
        Path(corpus["source"]) / "Test Suite Images/iphone_16_pro_IMG_3324.HEIC",
        Path(corpus["source"]) / "DSC04375_DxO_clipped_target.tif"]
    return paths

def session(path):
    from hdr_finisher.sessions import SessionStore
    store = SessionStore()
    # Disable persistent mip reuse on the instrument's session only. Nothing
    # changes the shipped policy; no stale on-disk mip can masquerade as cold.
    start = time.perf_counter()
    s = store.prepare_session(path, owns_source_path=False,
        progress=lambda stage, message: print(f"{path.name}: {stage} at {time.perf_counter()-start:.2f}s", flush=True))
    s.render_cache.mip_store = None
    return s

def preview(s, edge, name):
    from hdr_finisher.exporters import JPEGUltraHDRExportBackend
    from hdr_finisher.models import CapabilityInfo, CapabilityStatus, ExportSettings
    source, reference = s.render_cache.source_pair(edge)
    proxy = SimpleNamespace(session_id="measurement", image=source,
        sdr_reference_image=reference, adjustments=s.adjustments,
        local_adjustments=s.local_adjustments, denoise=s.denoise,
        hdr_reference_white_nits=s.hdr_reference_white_nits, color_context=s.color_context)
    backend = JPEGUltraHDRExportBackend(CapabilityInfo(
        name="measurement", status=CapabilityStatus.AVAILABLE, detail="External probe"))
    target = OUT / (name + ".jpg")
    result = backend.export(proxy, ExportSettings(output_path=str(target), overwrite=True))
    if not result.accepted:
        raise RuntimeError(result.message)
    size = target.stat().st_size
    target.unlink()
    return {"bytes": size, "dimensions": [source.shape[1], source.shape[0]]}

def one(args):
    from hdr_finisher.library_worker import _lower_priority
    priority = _lower_priority()
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.exporters import JPEGUltraHDRExportBackend
    path = Path(args.path)
    from hdr_finisher.render_cache import SessionRenderCache
    results = []
    for repeat in range(args.repeats):
        gc.collect()
        s, load_ms = timed(lambda: session(path))
        original_grade = s.adjustments.model_copy(deep=True)
        for edge in args.edges:
            # Full default decode is independent of requested proxy edge.
            # Reuse its measured cost, but create a fresh proxy cache for each
            # size. Report cold as the explicit sum of measured components.
            s.adjustments = original_grade.model_copy(deep=True)
            s.render_cache = SessionRenderCache(s.image, s.sdr_reference_image,
                color_context=s.color_context, mip_store=None)
            encoded, build_ms = timed(lambda: preview(s, edge, "single"))
            cold_ms = load_ms + build_ms
            warm, warm_ms = timed(lambda: preview(s, edge, "single"))
            s.adjustments.hdr.exposure += 0.25
            s.adjustments.sdr.exposure += 0.25
            edited, edited_ms = timed(lambda: preview(s, edge, "single"))
            results.append(dict(edge=edge, repeat=repeat, load_ms=load_ms,
                cold_ms=cold_ms, cold_components=True, first_build_ms=build_ms, warm_ms=warm_ms,
                edited_ms=edited_ms, **encoded, edited_bytes=edited["bytes"]))
            write(args.result, dict(path=str(path), priority=priority, gpu_used=False, rows=results, complete=False))
            print(f"{path.name} {edge} sample {repeat+1}: cold {cold_ms/1000:.2f}s, warm {warm_ms/1000:.2f}s", flush=True)
        del s
    data = dict(path=str(path), priority=priority, gpu_used=False, rows=results, memory=memory(), complete=True)
    write(args.result, data)
    print(json.dumps(data), flush=True)

def bulk(args):
    from hdr_finisher.library_worker import _lower_priority
    priority = _lower_priority()
    paths = selected()
    if args.count == 30 and not args.cached:
        corpus = json.loads((ROOT / "output/library-measurements/corpus.json").read_text())
        extra = [Path(row["path"]) for row in corpus["rows"] if row.get("sensor_size")
            and not row.get("error") and not row.get("excluded") and Path(row["path"]) not in paths]
        paths += extra[:20]
        assert len(paths) == len(set(paths)) == 30, "Screen trial requires 30 distinct originals"
    cached = {}
    preparation_ms = 0
    if args.cached:
        from hdr_finisher.render_cache import SessionRenderCache
        start_prepare = time.perf_counter()
        for path in paths:
            full = session(path)
            source, reference = full.render_cache.source_pair(2560)
            cached[path] = SimpleNamespace(
                render_cache=SessionRenderCache(source, reference, mip_store=None),
                adjustments=full.adjustments.model_copy(deep=True), local_adjustments=full.local_adjustments,
                denoise=full.denoise, hdr_reference_white_nits=full.hdr_reference_white_nits,
                color_context=full.color_context)
            del full
            gc.collect()
        preparation_ms = (time.perf_counter()-start_prepare)*1000
        print(f"cached sources ready: {preparation_ms/1000:.1f}s", flush=True)
    rows = []
    start = time.perf_counter()
    for i in range(args.count):
        path = paths[i % len(paths)]
        t = time.perf_counter()
        try:
            s = SimpleNamespace(**vars(cached[path])) if args.cached else session(path)
            if args.cached:
                s.adjustments = s.adjustments.model_copy(deep=True)
            if args.edited:
                s.adjustments.hdr.exposure += 0.25
                s.adjustments.sdr.exposure += 0.25
            encoded = preview(s, 2560, "bulk")
            rows.append(dict(index=i, path=str(path), ms=(time.perf_counter()-t)*1000, **encoded))
            del s
        except Exception as exc:
            rows.append(dict(index=i, path=str(path), error=str(exc)))
        if (i+1) % 10 == 0:
            write(args.result, dict(count=args.count, completed=i+1, rows=rows,
                elapsed_ms=(time.perf_counter()-start)*1000, priority=priority))
            print(f"bulk {i+1}/{args.count}: {(time.perf_counter()-start):.1f}s", flush=True)
        gc.collect()
    write(args.result, dict(count=args.count, completed=args.count, rows=rows,
        elapsed_ms=(time.perf_counter()-start)*1000, priority=priority, memory=memory(),
        cached_sources=args.cached, preparation_ms=preparation_ms,
        unique_sources=len(set(paths)), successful=sum("error" not in row for row in rows)))
    if any("error" in row for row in rows):
        raise RuntimeError("Preview jobs failed; see raw rows")

INDEX_READER = None

class PersistentExifTool:
    """Temporary measuring reader; not bundled or selected for the app."""
    def __init__(self, exe):
        self.exe = exe
        self.sequence = 0
        self.log = (OUT / "exiftool-reader.log").open("w", encoding="utf-8")
        self.process = subprocess.Popen([str(exe), "-stay_open", "True", "-@", "-"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
            text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW,
            env={**os.environ, "LC_ALL":"C", "LC_CTYPE":"C", "LANG":"C"})
        self.closed = False
        atexit.register(self.close)
    def read(self, path):
        self.sequence += 1
        fields = ("-Make", "-Model", "-Lens*", "-FocalLength", "-ISO",
            "-ExposureTime", "-FNumber", "-DateTimeOriginal", "-ImageWidth", "-ImageHeight", "-Orientation")
        request = ["-charset", "filename=UTF8", "-j", "-G1", "-s", *fields,
            str(path), f"-execute{self.sequence}"]
        self.process.stdin.write("\n".join(request)+"\n")
        self.process.stdin.flush()
        lines = []
        marker = f"{{ready{self.sequence}}}"
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError("ExifTool reader closed before ready marker")
            if line.strip() == marker:
                break
            lines.append(line)
        data = json.loads("".join(lines))[0]
        errors = [value for key,value in data.items() if key == "Error" or key.endswith(":Error")]
        if errors:
            raise ValueError(str(errors))
        return {key:value for key,value in data.items() if key != "SourceFile"}
    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.process.stdin.write("-stay_open\nFalse\n")
            self.process.stdin.flush()
            self.process.wait(timeout=10)
        finally:
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            self.process.stdin.close()
            self.process.stdout.close()
            self.log.close()

def read_index(path):
    import exifread
    st = path.stat()
    if INDEX_READER:
        metadata = INDEX_READER.read(path)
        camera = metadata.get("IFD0:Model", "Unknown")
        capture = metadata.get("ExifIFD:DateTimeOriginal", "")
    else:
        if path.suffix.lower() == ".heic":
            raise ValueError("HEIC metadata is not supported by the quick ExifRead instrument")
        with path.open("rb") as handle:
            tags = exifread.process_file(handle, details=False, extract_thumbnail=False)
        metadata = {key:str(value) for key,value in tags.items() if not key.startswith("JPEGThumbnail")}
        camera = metadata.get("Image Model", "Unknown")
        capture = metadata.get("EXIF DateTimeOriginal", "")
    project = Path(str(path) + ".hdrfinisher")
    settings = None
    if project.is_file():
        with zipfile.ZipFile(project) as archive:
            from hdr_finisher.projects import _validate_ignoring_unknown_fields
            settings = _validate_ignoring_unknown_fields(json.loads(archive.read("edit-state.json"))).model_dump(mode="json")
    return {"path": str(path), "size": st.st_size, "mtime": st.st_mtime_ns,
        "camera": camera, "capture": capture,
        "metadata": metadata, "settings": settings}

def index(args):
    from hdr_finisher.models import EditDocument
    import exifread  # Keep one-time reader startup outside the per-file timer.
    global INDEX_READER
    startup_ms = 0
    reader_info = {"name":"quick ExifRead", "maker_notes":False}
    if not args.quick_reader:
        exe = Path(args.exiftool) if args.exiftool else next((ROOT / "output/library-measurements/tools").rglob("exiftool.exe"), None)
        if exe is None:
            raise RuntimeError("Supply --exiftool <temporary exe> or explicitly choose --quick-reader")
        INDEX_READER, launch_ms = timed(lambda: PersistentExifTool(exe))
        _, startup_ms = timed(lambda: INDEX_READER.read(selected()[-3]))
        startup_ms += launch_ms
        reader_info = {"name":"persistent ExifTool", "exe":str(exe),
            "version":subprocess.check_output([str(exe), "-ver"], text=True,
                env={**os.environ, "LC_ALL":"C", "LC_CTYPE":"C", "LANG":"C"}).strip()}
    corpus = json.loads((ROOT / "output/library-measurements/corpus.json").read_text())
    paths = [Path(r["path"]) for r in corpus["rows"] if not r.get("excluded")]
    paths += selected()[-3:]
    reads = []
    templates = []
    for path in paths:
        try:
            facts, first = timed(lambda: read_index(path))
            timings = [timed(lambda: read_index(path))[1] for _ in range(5)]
            reads.append(dict(path=str(path), first_ms=first, warm_ms=statistics.median(timings),
                settings_exists=facts["settings"] is not None, camera=facts["camera"], capture=facts["capture"]))
            templates.append(facts)
        except Exception as exc:
            reads.append(dict(path=str(path), error=str(exc)))
    # Timing reading existing documents uses today's ZIP payload on temp copies.
    with tempfile.TemporaryDirectory(dir=OUT, prefix="index-settings-") as folder:
        copy = Path(folder) / "sample.jpg"
        shutil.copy2(selected()[-3], copy)
        bare_settings_ms = [timed(lambda: read_index(copy))[1] for _ in range(9)]
        from hdr_finisher.projects import _validate_ignoring_unknown_fields
        doc = EditDocument.model_validate({"hdr_reference_white_nits": 203, "source": {"filename": "sample.jpg", "luminance": {"luminance_semantics": "scene_relative", "transfer_function": "linear"}}})
        with zipfile.ZipFile(str(copy)+".hdrfinisher", "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("edit-state.json", doc.model_dump_json())
        settings_ms = [timed(lambda: read_index(copy))[1] for _ in range(9)]
    if INDEX_READER:
        INDEX_READER.close()
        INDEX_READER = None
    schemas = """
    CREATE TABLE photos(id INTEGER PRIMARY KEY, path TEXT UNIQUE, size INTEGER,
        mtime INTEGER, camera TEXT, capture TEXT, rating INTEGER, metadata TEXT, settings TEXT);
    CREATE TABLE tags(photo INTEGER, tag TEXT, PRIMARY KEY(tag,photo));
    CREATE INDEX rating_idx ON photos(rating,id);
    CREATE INDEX camera_idx ON photos(camera,id);
    CREATE INDEX capture_idx ON photos(capture,id);
    """
    camera = Counter(f["camera"] for f in templates).most_common(1)[0][0]
    scales = []
    for count in (10000, 50000, 200000):
        db = OUT / f"index-{count}-{time.time_ns()}.sqlite"
        c = sqlite3.connect(db)
        c.execute("PRAGMA cache_size=-8192")
        c.executescript(schemas)
        before = memory()
        start = time.perf_counter()
        document = EditDocument.model_validate({"hdr_reference_white_nits": 203, "source": {"filename": "sample.jpg", "luminance": {"luminance_semantics": "scene_relative", "transfer_function": "linear"}}}).model_dump_json()
        for begin in range(0, count, 1000):
            rows, tags = [], []
            for i in range(begin, min(begin+1000, count)):
                f = templates[i % len(templates)]
                # 25% edited, exact project-document payload; metadata is source-backed.
                rows.append((i, f"{f['path']}#synthetic-{i:06d}", f["size"], f["mtime"],
                    f["camera"], f"2026:09:{1+i%28:02d} {i%24:02d}:00:00", i%6,
                    json.dumps(f["metadata"]), document if i%4 == 0 else None))
                tags.extend((i, tag) for tag in (f"tag-{i%100}", f"tag-{(i+13)%100}"))
            c.executemany("INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?)", rows)
            c.executemany("INSERT INTO tags VALUES(?,?)", tags)
        c.commit()
        insert_ms = (time.perf_counter()-start)*1000
        c.close()
        c = sqlite3.connect(db)
        c.execute("PRAGMA cache_size=-8192")
        open_memory = memory()
        queries = {
            "rating": ("SELECT id FROM photos WHERE rating>=4 ORDER BY rating,id LIMIT 100", ()),
            "tag": ("SELECT photo FROM tags WHERE tag=? ORDER BY photo LIMIT 100", ("tag-42",)),
            "camera": ("SELECT id FROM photos WHERE camera=? ORDER BY id LIMIT 100", (camera,)),
            "sort_capture": ("SELECT id FROM photos ORDER BY capture,id LIMIT 100", ()),
            "sort_filename": ("SELECT id FROM photos ORDER BY path,id LIMIT 100", ()),
            "combined_sort": ("SELECT p.id FROM photos p JOIN tags t ON t.photo=p.id WHERE p.rating>=4 AND t.tag=? ORDER BY p.capture,p.id LIMIT 100", ("tag-42",)),
            "rating_count": ("SELECT count(*) FROM photos WHERE rating>=4", ()),
            "tag_count": ("SELECT count(*) FROM tags WHERE tag=?", ("tag-42",)),
            "camera_count": ("SELECT count(*) FROM photos WHERE camera=?", (camera,)),
            "page_details": ("SELECT id,path,size,camera,capture,rating,metadata FROM photos WHERE id IN (SELECT id FROM photos ORDER BY capture,id LIMIT 100)", ()),
        }
        timings = {}
        for name, (sql, params) in queries.items():
            result, first_ms = timed(lambda: c.execute(sql, params).fetchall())
            samples = [timed(lambda: c.execute(sql, params).fetchall())[1] for _ in range(11)]
            timings[name] = dict(first_ms=first_ms, median_ms=statistics.median(samples),
                returned=len(result), plan=c.execute("EXPLAIN QUERY PLAN "+sql, params).fetchall())
        scales.append(dict(count=count, insert_ms=insert_ms, db_bytes=db.stat().st_size,
            before_memory=before, open_memory=open_memory, query_memory=memory(), queries=timings))
        c.close()
        gc.collect()
    write("m3.json", dict(reads=reads, reader=reader_info, reader_startup_ms=startup_ms, settings_read_median_ms=statistics.median(settings_ms),
        bare_settings_read_median_ms=statistics.median(bare_settings_ms),
        templates=len(templates), camera_filter=camera, scales=scales, document_bytes=len(document.encode())))
    print("M3 complete", flush=True)

def trial(args):
    from hdr_finisher.sessions import SessionStore
    from hdr_finisher.projects import save_project, open_project, ProjectSourceRelinkRequired
    trials = []
    for path in (selected()[4], selected()[5], selected()[-3]):
        with tempfile.TemporaryDirectory(dir=OUT, prefix="t1-") as folder:
            base = Path(folder)
            original = base / "original"
            original.mkdir()
            photo = original / path.name
            shutil.copy2(path, photo)
            s = session(photo)
            project = original / (photo.name + ".hdrfinisher")
            saved, initial_ms = timed(lambda: save_project(s, project, source_path=photo))
            store = SessionStore()
            reopened = open_project(store, project)
            assert reopened.source_path == photo.resolve()
            store.clear()
            del s, reopened
            moved = base / "moved"
            assert original.resolve().is_relative_to(OUT.resolve())
            assert moved.resolve().is_relative_to(OUT.resolve())
            original.rename(moved)
            project = moved / project.name
            try:
                open_project(store, project)
                requires_relink = False
            except ProjectSourceRelinkRequired:
                requires_relink = True
            # Trial-only beside-first resolver. Existing production opener is unchanged.
            reopened = open_project(store, project, source_path=moved / path.name)
            saves, observed = [], []
            event = threading.Event()
            def save():
                _, ms = timed(lambda: save_project(reopened, project))
                saves.append(ms)
                observed.append(time.perf_counter())
                event.set()
            pending = None
            for exposure in (0.25, 0.5, 0.75):
                if pending:
                    pending.cancel()
                    pending.join()
                reopened.adjustments.hdr.exposure = exposure
                reopened.dirty = True
                pending = threading.Timer(0.5, save)
                pending.start()
                time.sleep(0.05)
            last_change = time.perf_counter()-0.05
            assert event.wait(10)
            pending.join()
            assert len(saves) == 1
            settle_ms = (observed[0]-last_change)*1000
            store.clear()
            reopened = open_project(store, project, source_path=moved / path.name)
            assert reopened.adjustments.hdr.exposure == 0.75
            reopened.adjustments.hdr.exposure = 1.0
            reopened.dirty = True
            pending = threading.Timer(0.5, save)
            pending.start()
            pending.cancel()
            pending.join()
            save()  # Leaving flushes immediately, without waiting for debounce.
            time.sleep(0.55)
            assert len(saves) == 2, "Leaving must cancel the pending save"
            store.clear()
            reopened = open_project(store, project, source_path=moved / path.name)
            assert reopened.adjustments.hdr.exposure == 1.0
            for _ in range(7):
                save()
            trials.append(dict(path=str(path), initial_save_ms=initial_ms, save_median_ms=statistics.median(saves),
                project_bytes=project.stat().st_size, requires_relink_after_move=requires_relink,
                debounce_elapsed_ms=settle_ms, debounce_saves=1, leaving_reopen_verified=True))
            store.clear()
            del reopened
    write("t1.json", trials)
    print(json.dumps(trials), flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("mode", choices=("one", "bulk", "index", "trial", "matrix"))
    p.add_argument("--path")
    p.add_argument("--edges", type=int, nargs="+", default=[1920,2560,3840])
    p.add_argument("--repeats", type=int, default=2)
    p.add_argument("--result", default="pilot.json")
    p.add_argument("--count", type=int, default=30)
    p.add_argument("--edited", action="store_true")
    p.add_argument("--cached", action="store_true")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--exiftool")
    p.add_argument("--quick-reader", action="store_true")
    args = p.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.mode == "matrix":
        failures = 0
        for i, path in enumerate(selected()):
            destination = OUT / f"m2-{i}.json"
            if args.resume and destination.exists():
                previous = json.loads(destination.read_text())
                if previous.get("complete") and len(previous["rows"]) == len(args.edges)*args.repeats:
                    print(f"M2 {i+1}/10: reused complete rows", flush=True)
                    continue
            with (OUT / f"m2-{i}.log").open("w", encoding="utf-8") as log:
                try:
                    result = subprocess.run([sys.executable, __file__, "one", "--path", str(path),
                        "--result", f"m2-{i}.json", "--repeats", str(args.repeats),
                        "--edges", *map(str,args.edges)],
                        timeout=1200, stdout=log, stderr=subprocess.STDOUT)
                    if result.returncode:
                        failures += 1
                        write(f"m2-{i}.json", dict(path=str(path), error=f"Probe exit {result.returncode}; see m2-{i}.log"))
                    print(f"M2 {i+1}/10: {'OK' if result.returncode == 0 else 'FAILED; see log'}", flush=True)
                except subprocess.TimeoutExpired:
                    failures += 1
                    partial = json.loads(destination.read_text()) if destination.exists() else {"path":str(path)}
                    partial.update(error="1200 second measurement timeout", complete=False)
                    write(f"m2-{i}.json", partial)
                    print(f"M2 {i+1}/10: timeout; partial rows retained", flush=True)
        if failures:
            raise RuntimeError(f"{failures} M2 cases failed; see raw rows")
    else:
        {"one":one, "bulk":bulk, "index":index, "trial":trial}[args.mode](args)

if __name__ == "__main__":
    main()