"""Disposable library speed trial. No shipped pipeline, format or cache changes.

Run with .venv Python: profile --threads one|normal, opens, or serve.
The loopback service feeds the existing GPU diagnostic renderer in the Electron
driver. Only copied originals and outputs inside output/library-speed-trial are
opened/written. Runtime patches are confined to this instrument process.
"""
from __future__ import annotations
import argparse
import contextlib
import cProfile
import gc
import json
import ctypes
import os
from pathlib import Path
import pstats
import shutil
import sys
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/library-speed-trial"
sys.path.insert(0, str(ROOT / "backend"))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("mode", choices=["profile", "opens", "serve"])
parser.add_argument("--threads", choices=["one", "normal"], default="normal")
parser.add_argument("--port", type=int, default=8799)
parser.add_argument("--repeats", type=int, default=2)
ARGS = parser.parse_args()
if ARGS.threads == "one":
    for key in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"]:
        os.environ[key] = "1"
os.environ["HDR_FINISHER_APP_DATA_DIR"] = str(OUT / "app-data")
os.environ["HDR_FINISHER_SOURCE_CACHE_DISABLE"] = "1"
import numpy as np
from PIL import Image
from hdr_finisher import exporters as ex, loader, raw_import, sessions
from hdr_finisher.models import CapabilityInfo, CapabilityStatus, ExportSettings, RawImportSettings
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.preview import downsample_image
from types import SimpleNamespace

def timed(call):
    start = time.perf_counter()
    result = call()
    return result, (time.perf_counter() - start) * 1000

def write(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2), encoding="utf-8")

def thread_report():
    library = next((Path(np.__file__).parent.parent / "numpy.libs").glob("*openblas*.dll"))
    numeric = ctypes.CDLL(str(library)).scipy_openblas_get_num_threads64_()
    import rawpy
    return {"openblas_threads":numeric, "libraw_openmp":rawpy.flags.get("OPENMP"),
        "environment":{key:os.environ.get(key) for key in
        ["OMP_NUM_THREADS","OPENBLAS_NUM_THREADS","MKL_NUM_THREADS","NUMEXPR_NUM_THREADS"]}}

def originals():
    # Preserve the exact selection and ordering from the previous instrument.
    import importlib.util
    spec = importlib.util.spec_from_file_location("baseline", Path(__file__).with_name("photo-library-remaining.py"))
    module = importlib.util.module_from_spec(spec)
    # Do not import it: its module-level environment forces one thread.
    text = Path(spec.origin).read_text(encoding="utf-8")
    selected = text[text.index("def selected():"):text.index("def session(path):")]
    scope = {"ROOT": ROOT, "Path": Path, "json": json}
    exec(selected, scope)
    ten = scope["selected"]()
    corpus = json.loads((ROOT / "output/library-measurements/corpus.json").read_text())
    extra = [Path(row["path"]) for row in corpus["rows"] if row.get("sensor_size")
        and not row.get("error") and not row.get("excluded") and Path(row["path"]) not in ten]
    result = ten + extra[:20]
    assert len(set(result)) == 30
    return result

def copies():
    result = []
    for i, source in enumerate(originals()):
        folder = OUT / "copies" / str(i)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / source.name
        if not target.exists():
            shutil.copy2(source, target)
        result.append(target)
    return result

@contextlib.contextmanager
def measured(module, names, totals):
    saved = {}
    for name in names:
        original = getattr(module, name)
        saved[name] = original
        def wrapper(*args, _name=name, _original=original, **kwargs):
            start = time.perf_counter()
            try:
                return _original(*args, **kwargs)
            finally:
                totals[_name] += (time.perf_counter() - start) * 1000
        setattr(module, name, wrapper)
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(module, name, value)

def open_session(path, shortcut="full"):
    require_size = shortcut == "best"
    if require_size:
        shortcut = "half" if path.suffix.lower() in raw_import.RAW_EXTENSIONS and path.suffix.lower() != ".dng" else "early"
    half_used = {"value":shortcut == "half"}
    totals = defaultdict(float)
    with contextlib.ExitStack() as stack:
        stack.enter_context(measured(raw_import, ["_inspect_raw", "_execute_raw_decode",
            "_apply_raw_highlight_reconstruction", "_develop_libraw_camera_rgb",
            "_apply_raw_corrections", "apply_lens_correction"], totals))
        stack.enter_context(measured(loader, ["_recommended_raw_exposure_ev", "classify_hdr",
            "normalize_to_acescg_bounded", "transform_float32_bounded"], totals))
        if shortcut != "full":
            # Reduce after mandatory decode/corrections but before full-frame
            # negative-gamut mapping, auto exposure and HDR analysis.
            for name in ["decode_raw", "decode_linear_dng", "_load_with_pillow", "_load_tiff", "_load_heif"]:
                original = getattr(loader, name)
                def reduced(*args, _original=original, **kwargs):
                    image, metadata = _original(*args, **kwargs)
                    image = downsample_image(image, 2560)
                    if "sdr_reference_image" in metadata:
                        metadata["sdr_reference_image"] = downsample_image(metadata["sdr_reference_image"], 2560)
                    return image, metadata
                setattr(loader, name, reduced)
                stack.callback(setattr, loader, name, original)
        if shortcut == "half" and path.suffix.lower() in raw_import.RAW_EXTENSIONS and path.suffix.lower() != ".dng":
            # Preserve full-mosaic highlight reconstruction and as-shot WB;
            # only LibRaw's demosaic output uses its established half-size mode.
            import rawpy
            original = rawpy.imread
            class HalfRaw:
                def __init__(self, raw):
                    object.__setattr__(self, "raw", raw)
                def __getattr__(self, key):
                    return getattr(self.raw, key)
                def __enter__(self):
                    return self
                def __exit__(self, *args):
                    self.raw.close()
                def postprocess(self, **kwargs):
                    half = not require_size or max(self.raw.sizes.iwidth,self.raw.sizes.iheight)//2 >= 2560
                    half_used["value"] = half
                    return self.raw.postprocess(**{**kwargs, "half_size": half})
            rawpy.imread = lambda *a, **k: HalfRaw(original(*a, **k))
            stack.callback(setattr, rawpy, "imread", original)
            # Camera normalization is linear. Reduce immediately afterwards,
            # before camera color conversion and Lensfun. Keep CFA highlight
            # reconstruction at native size: averaging a mosaic destroys the
            # channel identity required by the existing opposed-color method.
            normalize = raw_import._normalize_camera_rgb_float32
            def preview_camera(*a, **k):
                camera = normalize(*a, **k)
                if not half_used["value"]:
                    return camera
                reduced, duration = timed(lambda: downsample_image(camera, 2560))
                totals["early_reduction"] += duration
                return reduced
            raw_import._normalize_camera_rgb_float32 = preview_camera
            stack.callback(setattr, raw_import, "_normalize_camera_rgb_float32", normalize)
        session, total = timed(lambda: sessions.SessionStore().prepare_session(path, owns_source_path=False))
        session.render_cache.mip_store = None
        pair, reduction = timed(lambda: session.render_cache.source_pair(2560))
    return session, pair, {"total_ms": total + reduction, "open_ms": total,
        "route":"half" if half_used["value"] else "early" if shortcut != "full" else "full",
        "reduction_ms": reduction, "stages_ms": dict(totals), "import_ms": session.metadata.get("import_timings_ms")}

ENCODE_STEPS = ["_render_export_branch", "_prepare_hdr_linear_rgba_f16", "_linear_to_srgb8",
    "_floor_ultrahdr_base", "_write_sdr_rgba8888_pixels", "_write_sdr_jpeg_pixels", "_run_command",
    "_denoised_ultrahdr_gain_map_jpeg", "_guided_filter_gain_map_region", "_denoise_ultrahdr_gain_map", "_validate_ultrahdr_output", "_fsync_path"]

def encode(session, edge, pixels=None, label="preview"):
    source, reference = session.render_cache.source_pair(edge)
    proxy = SimpleNamespace(image=source, sdr_reference_image=reference, adjustments=session.adjustments,
        local_adjustments=session.local_adjustments, denoise=session.denoise,
        hdr_reference_white_nits=session.hdr_reference_white_nits, color_context=session.color_context)
    totals = defaultdict(float)
    target = OUT / f"{label}.jpg"
    backend = ex.JPEGUltraHDRExportBackend(CapabilityInfo(name="trial", status=CapabilityStatus.AVAILABLE, detail="trial"))
    with contextlib.ExitStack() as stack:
        stack.enter_context(measured(ex, ENCODE_STEPS, totals))
        command = ex._run_command
        def command_timing(args, *a, **k):
            category = "codec_gain_and_jpeg" if "-p" in args else "codec_repack" if "-g" in args else "codec_probe_decode"
            value, duration = timed(lambda: command(args,*a,**k))
            totals[category] += duration
            return value
        ex._run_command = command_timing
        stack.callback(setattr, ex, "_run_command", command)
        original_write = Path.write_bytes
        def write_timing(path, data):
            value, duration = timed(lambda: original_write(path,data))
            totals["python_file_writes"] += duration
            return value
        Path.write_bytes = write_timing
        stack.callback(setattr, Path, "write_bytes", original_write)
        original_save = Image.Image.save
        def save_timing(image, *a, **k):
            value, duration = timed(lambda: original_save(image,*a,**k))
            totals["pillow_jpeg_encode_write"] += duration
            return value
        Image.Image.save = save_timing
        stack.callback(setattr, Image.Image, "save", original_save)
        if pixels is not None:
            original = ex._render_export_branch
            # Substitute only inside this disposable process; exporter source,
            # encoding policy and validation are left untouched.
            ex._render_export_branch = lambda s, settings, kind, adjustments: pixels[0 if kind.value == "hdr" else 1]
            stack.callback(setattr, ex, "_render_export_branch", original)
        result, total = timed(lambda: backend.export(proxy, ExportSettings(output_path=str(target), overwrite=True)))
        if not result.accepted:
            raise RuntimeError(result.message)
    return {"encode_write_ms": total, "steps_ms": dict(totals), "bytes": target.stat().st_size,
        "dimensions": [int(source.shape[1]), int(source.shape[0])]}

def profile():
    rows = []
    for i, path in enumerate(copies()[:10]):
        for repeat in range(ARGS.repeats):
            profiler = cProfile.Profile() if i == 0 else None
            if profiler:
                profiler.enable()
            session, pair, opening = open_session(path)
            if ARGS.threads == "normal" and repeat == 0:
                np.save(OUT / f"full-source-{i}.npy",pair[0])
                if pair[1] is not None:
                    np.save(OUT / f"full-reference-{i}.npy",pair[1])
                write(f"full-grade-{i}.json",session.adjustments.model_dump(mode="json"))
            if profiler:
                profiler.disable()
                profiler.dump_stats(str(OUT / f"dji-{ARGS.threads}-{repeat}.prof"))
                with (OUT / f"dji-{ARGS.threads}-{repeat}.txt").open("w") as stream:
                    pstats.Stats(profiler, stream=stream).sort_stats("cumulative").print_stats(35)
            for sample in range(2):
                encoding = encode(session, 2560)
                rows.append({"index": i, "path": str(path), "repeat": repeat, "sample": sample,
                    "opening": opening, **encoding})
                write(f"profile-{ARGS.threads}.json", {"rows": rows, "complete": False})
            print(f"{ARGS.threads} {path.name} open {opening['total_ms']/1000:.2f}s encode {encoding['encode_write_ms']/1000:.2f}s", flush=True)
            del session, pair
            gc.collect()
    write(f"profile-{ARGS.threads}.json", {"rows": rows, "complete": True,
        "thread_report":thread_report()})

def difference(a, b):
    # Exposure-independent source metric plus the real default SDR rendering.
    scale = max(float(np.mean(np.abs(a))), 1e-6)
    delta = np.abs(a-b)
    return {"relative_mae": float(np.mean(delta)/scale), "p99_absolute": float(np.quantile(delta, .99)),
        "max_absolute": float(delta.max())}

def opens():
    rows = []
    baseline = json.loads((OUT / "profile-normal.json").read_text())
    assert baseline["complete"], "Complete the normal profile first"
    from hdr_finisher.models import AdjustmentState, DenoiseDocumentSettings
    from hdr_finisher.color_context import RenderColorContext
    for i, path in enumerate(copies()[:10]):
        base = np.load(OUT / f"full-source-{i}.npy")
        reference_path = OUT / f"full-reference-{i}.npy"
        reference = np.load(reference_path) if reference_path.exists() else None
        base_grade = AdjustmentState.model_validate_json((OUT / f"full-grade-{i}.json").read_text())
        full = SimpleNamespace(image=base,sdr_reference_image=reference,adjustments=base_grade,
            local_adjustments=[],denoise=DenoiseDocumentSettings(),hdr_reference_white_nits=203,color_context=RenderColorContext(203))
        full_sdr = ex._render_export_branch(full,ExportSettings(),ex.PreviewKind.SDR,base_grade)
        full_hdr = ex._render_export_branch(full,ExportSettings(),ex.PreviewKind.HDR,base_grade)
        for repeat in range(ARGS.repeats):
            full_time = next(row["opening"] for row in baseline["rows"] if row["index"] == i and row["repeat"] == repeat)
            shortcuts = ["early","half"] if path.suffix.lower() in raw_import.RAW_EXTENSIONS and path.suffix.lower() != ".dng" else ["early"]
            for shortcut in shortcuts:
                candidate, (image, reference), timing = open_session(path, shortcut)
                comparison_base = base
                comparison_sdr, comparison_hdr = full_sdr, full_hdr
                if image.shape != base.shape:
                    # Half-size Fuji is 2448, below the requested 2560. Reduce
                    # a full native decode directly to 2448 for a fair reference.
                    native, _, _ = open_session(path)
                    comparison_base, comparison_reference = native.render_cache.source_pair(max(image.shape[:2]))
                    assert comparison_base.shape == image.shape, (path.name,image.shape,comparison_base.shape)
                    comparison_full = SimpleNamespace(**{**vars(full),"image":comparison_base,
                        "sdr_reference_image":comparison_reference})
                    comparison_sdr = ex._render_export_branch(comparison_full,ExportSettings(),ex.PreviewKind.SDR,base_grade)
                    comparison_hdr = ex._render_export_branch(comparison_full,ExportSettings(),ex.PreviewKind.HDR,base_grade)
                    del native
                proxy = SimpleNamespace(**{**vars(candidate), "image": image, "sdr_reference_image": reference})
                sdr = ex._render_export_branch(proxy, ExportSettings(), ex.PreviewKind.SDR, candidate.adjustments)
                hdr = ex._render_export_branch(proxy, ExportSettings(), ex.PreviewKind.HDR, candidate.adjustments)
                srgb_base = ex._linear_to_srgb8(comparison_sdr)
                srgb = ex._linear_to_srgb8(sdr)
                row = {"index":i, "path":str(path), "repeat":repeat, "shortcut":shortcut,
                    "full":full_time, "timing":timing, "comparison_dimensions":[image.shape[1],image.shape[0]],
                    "source_difference":difference(comparison_base, image),
                    "hdr_difference":difference(comparison_hdr, hdr),
                    "sdr_code_mae":float(np.abs(srgb.astype(float)-srgb_base).mean()),
                    "sdr_code_p99":float(np.quantile(np.abs(srgb.astype(float)-srgb_base), .99)),
                    "exposure_ev_difference":candidate.adjustments.hdr.exposure-base_grade.hdr.exposure}
                rows.append(row)
                if repeat == 0:
                    # Actual default grade, downscaled only for review contact sheets.
                    left = Image.fromarray(srgb_base); right = Image.fromarray(srgb)
                    left.thumbnail((800,600)); right.thumbnail((800,600))
                    sheet = Image.new("RGB", (left.width+right.width, max(left.height,right.height)))
                    sheet.paste(left, (0,0)); sheet.paste(right, (left.width,0))
                    sheet.save(OUT / f"compare-{i}-{shortcut}.jpg", quality=95)
                write("opens.json", {"rows":rows, "complete":False})
                print(f"{path.name} {shortcut}: {timing['total_ms']/1000:.2f}s code MAE {row['sdr_code_mae']:.3f}", flush=True)
                del candidate, image, proxy, sdr, hdr
                gc.collect()
        del full, base, full_sdr, full_hdr, reference
        gc.collect()
    write("opens.json", {"rows":rows, "complete":True})
    # A timing probe, never an input to a preview: decimate complete CFA cells
    # so channel identity survives. This is not quality qualification for a
    # reduced-mosaic highlight/demosaic pipeline.
    import rawpy
    probes = []
    for index,path in enumerate(copies()[:10]):
        if path.suffix.lower() not in raw_import.RAW_EXTENSIONS or path.suffix.lower() == ".dng":
            continue
        with rawpy.imread(str(path)) as raw:
            metadata = raw_import._camera_linear_metadata_from_libraw(raw)
            mosaic = raw.raw_image_visible
            ph,pw = metadata.raw_pattern.shape
            h,w = mosaic.shape[0]//ph*ph,mosaic.shape[1]//pw*pw
            stride = max(1,int(np.ceil(max(h,w)/2560)))
            cells = mosaic[:h,:w].reshape(h//ph,ph,w//pw,pw)[::stride,:,::stride,:].copy()
            reduced = cells.reshape(cells.shape[0]*ph,cells.shape[2]*pw)
            samples = []
            for repeat in range(2):
                proxy = SimpleNamespace(raw_image_visible=reduced.copy())
                _,duration = timed(lambda:raw_import._apply_raw_highlight_reconstruction(proxy,metadata,RawImportSettings()))
                samples.append(duration)
            probes.append({"index":index,"dimensions":[reduced.shape[1],reduced.shape[0]],"samples_ms":samples,
                "quality_qualified":False,"method":"cell-aligned decimation; timing only"})
    write("preview-highlight-probe.json",{"rows":probes})

CURRENT = None
PREPARED = {}
METADATA = {}
PIXELS = bytearray()
POOL = None
FUTURES = {}

def prepare_worker(index, shortcut):
    """Fixed corpus experiment only; no helper job type or app queue."""
    path = copies()[index]
    started = time.perf_counter()
    session, pair, timing = open_session(path, shortcut)
    np.save(OUT / f"parallel-source-{index}.npy", pair[0])
    if pair[1] is not None:
        np.save(OUT / f"parallel-reference-{index}.npy", pair[1])
    return {"opening":timing,"has_reference":pair[1] is not None,
        "adjustments":session.adjustments.model_dump(mode="json"),
        "white":session.hdr_reference_white_nits,
        "worker_wall_ms":(time.perf_counter()-started)*1000}

def prepared_worker_session(index, result):
    from hdr_finisher.models import AdjustmentState, DenoiseDocumentSettings
    from hdr_finisher.color_context import RenderColorContext
    image = np.load(OUT / f"parallel-source-{index}.npy")
    reference = np.load(OUT / f"parallel-reference-{index}.npy") if result["has_reference"] else None
    context = RenderColorContext(result["white"])
    session = SimpleNamespace(image=image,sdr_reference_image=reference,
        adjustments=AdjustmentState.model_validate(result["adjustments"]),local_adjustments=[],
        denoise=DenoiseDocumentSettings(),hdr_reference_white_nits=result["white"],color_context=context)
    session.render_cache = SessionRenderCache(image,reference,color_context=context,mip_store=None)
    return session,(image,reference),result["opening"]

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *args):
        pass
    def respond(self, data, headers=None):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream" if isinstance(data, bytes) else "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "*")
        for key,value in (headers or {}).items():
            self.send_header(key,str(value))
        self.end_headers()
        self.wfile.write(body)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length","0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
    def do_GET(self):
        try:
            url = urlparse(self.path)
            if url.path == "/health":
                return self.respond({"ready":True})
            if url.path == "/paths":
                return self.respond([str(p) for p in copies()])
            query = parse_qs(url.query)
            if url.path == "/meta":
                return self.respond(METADATA[query["key"][0]])
            edge = int(query.get("long_edge", [2560])[0])
            session = PREPARED[query.get("trial_key", ["current"])[0]]
            lane = url.path.rsplit("/",1)[-1]
            source, reference = session.render_cache.source_pair(edge)
            image = reference if lane == "sdr" and reference is not None else source
            from hdr_finisher.render_cache import encode_rgba_proxy_rows
            body,stride = encode_rgba_proxy_rows(image,0,image.shape[0],prefer_half=True,pixel_format="rgba16float")
            self.respond(body, {"X-Image-Width":image.shape[1], "X-Image-Height":image.shape[0],
                "X-Bytes-Per-Row":stride,"X-Pixel-Format":"rgba16float", "X-Working-Space":"linear-srgb" if lane == "sdr" and reference is not None else "acescg",
                "X-Geometry-Signature":query.get("geometry_signature",["{}"]) [0], "X-Edit-Revision":0})
        except Exception as exc:
            self.send_error(500, str(exc))
    def do_POST(self):
        global PIXELS, POOL, FUTURES
        try:
            url = urlparse(self.path)
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if url.path == "/parallel":
                from concurrent.futures import ProcessPoolExecutor
                request = json.loads(body)
                assert POOL is None
                POOL = ProcessPoolExecutor(max_workers=int(request["workers"]))
                FUTURES = {i:POOL.submit(prepare_worker,i,request["shortcut"]) for i in range(30)}
                self.respond({"started":30})
            elif url.path == "/begin":
                PIXELS = bytearray(int(json.loads(body)["bytes"]))
                self.respond({"ready":True})
            elif url.path == "/upload":
                offset = int(parse_qs(url.query)["offset"][0])
                assert 0 <= offset <= len(PIXELS)-len(body)
                PIXELS[offset:offset+len(body)] = body
                self.respond({"bytes":len(body)})
            elif url.path == "/prepare":
                request = json.loads(body)
                index = int(request["index"])
                path = copies()[index]
                key = request.get("key", "current")
                if key == "current" or key.startswith("photo"):
                    for old in list(PREPARED):
                        if old == "current" or old.startswith("photo"):
                            PREPARED.pop(old)
                    gc.collect()
                if index in FUTURES:
                    session,pair,timing = prepared_worker_session(index,FUTURES.pop(index).result())
                else:
                    session, pair, timing = open_session(path,request.get("shortcut","full"))
                if int(request.get("edge",2560)) > 2560:
                    pair = session.render_cache.source_pair(int(request["edge"]))
                # Store reduced sources only for this trial; no app cache changes.
                session.image, session.sdr_reference_image = pair
                session.render_cache = SessionRenderCache(*pair, color_context=session.color_context, mip_store=None)
                PREPARED[key] = session
                METADATA[key] = {"key":key, "index":index,"path":str(path),"opening":timing,
                    "adjustments":session.adjustments.model_dump(mode="json"),"white":session.hdr_reference_white_nits,
                    "width":pair[0].shape[1],"height":pair[0].shape[0]}
                self.respond(METADATA[key])
            elif url.path in {"/encode", "/compare"}:
                query = parse_qs(url.query)
                width,height = int(query["width"][0]),int(query["height"][0])
                assert len(PIXELS) == 2*height*width*3*2
                pixels = np.frombuffer(PIXELS,dtype="<f2").astype(np.float32).reshape((2,height,width,3))
                if not np.isfinite(pixels).all():
                    raise ValueError("Non-finite GPU pixels")
                session = PREPARED[query.get("key",["current"])[0]]
                edge = int(query["edge"][0])
                if url.path == "/encode":
                    self.respond(encode(session,edge,pixels))
                else:
                    source, reference = session.render_cache.source_pair(edge)
                    proxy = SimpleNamespace(**{**vars(session),"image":source,"sdr_reference_image":reference})
                    grade = session.adjustments.model_copy(deep=True)
                    if query.get("edited",["false"])[0] == "true":
                        grade.hdr.exposure += .25
                        grade.sdr.exposure += .25
                    cpu = [ex._render_export_branch(proxy,ExportSettings(),kind,grade) for kind in [ex.PreviewKind.HDR,ex.PreviewKind.SDR]]
                    code_cpu = ex._linear_to_srgb8(cpu[1]).astype(float)
                    code_gpu = ex._linear_to_srgb8(pixels[1]).astype(float)
                    self.respond({"hdr":difference(cpu[0],pixels[0]),"sdr_code_mae":float(np.abs(code_cpu-code_gpu).mean()),
                        "sdr_code_p99":float(np.quantile(np.abs(code_cpu-code_gpu),.99))})
            else:
                raise ValueError("Unknown trial operation")
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self.send_error(500,str(exc))

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if ARGS.mode == "serve":
        copies()
        print("trial service ready", flush=True)
        ThreadingHTTPServer(("127.0.0.1",ARGS.port),Handler).serve_forever()
    else:
        {"profile":profile, "opens":opens}[ARGS.mode]()
