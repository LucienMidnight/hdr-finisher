"""Exact finished surfaces in the existing disposable thumbnail allowance.

No retained RAM index: current identities come from the local Library database.
Source-drive reconciliation remains FolderChecks' batched background work.
"""
from hashlib import sha256
import json
import zlib
import os
from pathlib import Path
import sqlite3
from .library_cache import LibraryCache
from .library_copies import source
from .library_documents import identity as grade_identity
from .library_pictures import PICTURE_VERSION

VERSION = "finished-thumbnail-v3:" + PICTURE_VERSION


class FinishedThumbnails:
    def __init__(self, live):
        self.live = live
        self.cache = LibraryCache(live.root)

    def current(self, path, lane, format):
        return self.current_many([path], lane, format).get(os.path.abspath(path))

    def current_many(self, paths, lane, format):
        paths = list(dict.fromkeys(os.path.abspath(path) for path in paths))
        if not paths or not self.live.marks.database.is_file():
            return {}
        physical = list(dict.fromkeys(source(path) for path in paths))
        db = sqlite3.connect(self.live.marks.database.as_uri() + "?mode=ro", uri=True)
        try:
            db.execute("BEGIN")
            files = dict((p,(size,mtime)) for p,size,mtime in db.execute(
                "SELECT path,bytes,mtime_ns FROM files WHERE path IN ("+",".join("?" for _ in physical)+")",physical))
            states = dict(db.execute("SELECT path,state FROM photo_grades WHERE path IN ("+",".join("?" for _ in paths)+")",paths))
        finally:
            db.close()
        result = {}
        for path in paths:
            row = files.get(source(path))
            if row is None:
                continue
            state = json.loads(states[path]) if path in states else {}
            grade = state.get("desired") if state.get("pending") else state.get("indexed_grade", state.get("baseline"))
            value = dict(version=VERSION, path=path, lane=lane, format=format,
                         bytes=row[0], mtime_ns=row[1], grade=grade_identity(grade))
            key = sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
            result[path] = dict(value, key=key), grade
        return result

    def file(self, key):
        return self.cache.directory("library-thumbnails") / (key + ".surface")

    def read(self, path, lane, format, *, known=None, directory=None, packed=False):
        current = known if known is not None else self.current(path, lane, format)
        if current is None or (known is None and not self.cache.preferences()["enabled"]):
            return None
        value, _ = current
        try:
            with ((directory / (value["key"]+".surface")) if directory is not None else self.file(value["key"])).open("rb") as handle:
                meta = json.loads(handle.readline())
                body = handle.read()
            if not packed:
                body = zlib.decompress(body+b"\x03\x00", -zlib.MAX_WBITS)
            if meta["identity"] != value or (not packed and len(body) != meta["stride"] * meta["height"]):
                return None
            if known is None:
                latest = self.current(path, lane, format)
                if latest is None or latest[0] != value:
                    return None
            return meta, body
        except (OSError, ValueError, KeyError, TypeError, EOFError, zlib.error):
            return None

    def write(self, path, lane, format, meta, body, width, height, stride):
        current = self.current(path, lane, format)
        if current is None or not self.cache.preferences()["enabled"]:
            return False
        value, document = current
        # Publication must match the source and finishing grade that was drawn.
        from .library_live import quality
        from .library_grades import grade_key
        physical = source(value["path"])
        source_key = sha256(f"{PICTURE_VERSION}:{physical}:{value['mtime_ns']}:{value['bytes']}:640:{quality(document)}".encode()).hexdigest()
        if document is not None:
            from .models import EditDocument
            from .projects import validate_saved
            document = validate_saved(EditDocument, document).model_dump(mode="json")
        document = document or {}
        from .models import AdjustmentState
        from .projects import validate_saved
        adjustments = validate_saved(AdjustmentState, meta["adjustments"]).model_dump(mode="json")
        finishing = dict(global_adjustments=document.get("global_adjustments") or adjustments,
            local_adjustments=document.get("local_adjustments", []), denoise=document.get("denoise", {}),
            framing=document.get("framing"), hdr_reference_white_nits=document.get("hdr_reference_white_nits", 203))
        finishing_key = sha256(json.dumps(grade_key(finishing), sort_keys=True).encode()).hexdigest()
        if meta.get("source_key") != source_key or meta.get("grade_identity") != finishing_key:
            from .library_diagnostics import log
            log("finished_thumbnail_rejected",path=path,source_match=meta.get("source_key")==source_key,grade_match=meta.get("grade_identity")==finishing_key)
            return False
        self.cache.prepare()
        destination = self.file(value["key"])
        destination.parent.mkdir(exist_ok=True)
        from tempfile import NamedTemporaryFile
        temporary = None
        try:
            with NamedTemporaryFile(dir=destination.parent, suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                info = dict(identity=value, width=width, height=height, stride=stride, key=meta["key"], adler=zlib.adler32(body))
                handle.write(json.dumps(info).encode() + b"\n")
                compressor = zlib.compressobj(1, wbits=-zlib.MAX_WBITS)
                handle.write(compressor.compress(body)+compressor.flush(zlib.Z_FULL_FLUSH))
            latest = self.current(path, lane, format)
            if latest is None or latest[0] != value:
                return False
            os.replace(temporary, destination)
            self.cache.record(destination)
            self.cache.trim(allowance="thumbnail")
            return True
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)


def add_finished_thumbnail_routes(router, live, slots):
    from fastapi import Request, HTTPException
    from fastapi.responses import Response
    from starlette.concurrency import run_in_threadpool
    cache = FinishedThumbnails(live)

    def validate(lane, format):
        if lane not in ("hdr", "sdr") or format not in ("rgba16float", "rgba8unorm", "bgra8unorm"):
            raise HTTPException(400, "Invalid thumbnail surface")

    @router.post("/finished-thumbnails")
    async def read_many(request: Request, lane: str, format: str):
        validate(lane, format)
        from .library_api import MetadataRequest
        command = MetadataRequest.model_validate(await request.json())
        import asyncio
        import struct
        from time import perf_counter
        started = perf_counter()
        paths = list(dict.fromkeys(os.path.abspath(p) for p in command.paths))
        known = await run_in_threadpool(cache.current_many, paths, lane, format)
        identified = perf_counter()
        def directory_if_enabled():
            return cache.cache.directory("library-thumbnails") if cache.cache.preferences()["enabled"] else None
        directory = await run_in_threadpool(directory_if_enabled)
        # Independent local file reads share the existing API worker pool.
        # No source/development slot or new worker limit is introduced.
        reads = await asyncio.gather(*(run_in_threadpool(cache.read, path, lane, format,
            known=known[path], directory=directory, packed=True) for path in paths if path in known)) if directory else []
        read_at = perf_counter()
        latest = await run_in_threadpool(cache.current_many, paths, lane, format)
        parts, records, offset = [], [], 0
        if directory and known == latest:
            for path, result in zip((p for p in paths if p in known), reads):
                if result:
                    meta, body = result
                    records.append(dict(path=path, meta=meta, offset=offset, length=meta["stride"] * meta["height"]))
                    parts.append(body)
                    offset += meta["stride"] * meta["height"]
        from .library_diagnostics import log
        log("finished_thumbnail_batch",count=len(records),bytes=offset,duration_ms=(perf_counter()-started)*1000,
            identity_ms=(identified-started)*1000,read_ms=(read_at-identified)*1000)
        header = json.dumps(records).encode()
        prefix = struct.pack("<I",len(header))+header
        compressor = zlib.compressobj(1, wbits=-zlib.MAX_WBITS)
        packed_prefix = compressor.compress(prefix)+compressor.flush(zlib.Z_FULL_FLUSH)
        # FULL_FLUSH blocks reset the dictionary and have no final marker.
        # Join them into one standard zlib stream, so the browser inflates
        # during transfer without per-cell JS buffers or decompression tasks.
        checksum = zlib.adler32(prefix)
        for record in records:
            following = record["meta"]["adler"]
            low = checksum & 65535
            high = ((checksum >> 16)+(following >> 16)+record["length"]*(low-1)) % 65521
            checksum = (high << 16) | ((low+(following & 65535)-1) % 65521)
        return Response(b"".join([b"\x78\x01",packed_prefix,*parts,b"\x03\x00",struct.pack(">I",checksum)]),
            media_type="application/octet-stream",headers={"Cache-Control":"no-store","Content-Encoding":"deflate"})

    @router.post("/finished-thumbnail")
    async def write(request: Request, path: str, lane: str, format: str, width: int, height: int, stride: int):
        validate(lane, format)
        if not 1 <= width <= 640 or not 1 <= height <= 640 or stride != ((width*(8 if format == "rgba16float" else 4)+255)//256)*256:
            raise HTTPException(400, "Invalid thumbnail dimensions")
        if not slots.acquire(blocking=False):
            return Response(status_code=202)
        try:
            if int(request.headers.get("content-length", 0)) != stride*height:
                raise HTTPException(400, "Invalid thumbnail size")
            body = await request.body()
            if len(body) != stride*height:
                raise HTTPException(400, "Invalid thumbnail size")
            meta = json.loads(request.headers.get("X-Thumbnail-Scene", "{}"))
            saved = await run_in_threadpool(cache.write, path, lane, format, meta, body, width, height, stride)
            return Response(status_code=200 if saved else 409)
        finally:
            slots.release()
