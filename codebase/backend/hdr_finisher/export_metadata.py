"""Descriptive metadata only: encoders own pixels, colour and HDR signalling."""
from __future__ import annotations
import atexit
import hashlib
import json
import logging
import os
from pathlib import Path
import queue
import re
import struct
import subprocess
import tempfile
import threading
from time import perf_counter
from .binaries import bundled_binary_dir, runtime_binary_dir

log = logging.getLogger(__name__)
XMP = b"http://ns.adobe.com/xap/1.0/\0"
CODEC_NAMESPACES = (b"http://ns.adobe.com/hdr-gain-map/", b"http://ns.google.com/photos/1.0/container/")
DESCRIPTIONS = re.compile(rb"<rdf:Description\b[^>]*(?:/>|>.*?</rdf:Description>)", re.S)


def command():
    for directory in (bundled_binary_dir(), runtime_binary_dir()):
        tool = directory / "exiftool-runtime" / "bin" / ("exiftool.exe" if os.name == "nt" else "exiftool")
        if tool.is_file():
            perl = next((p for p in (Path("/app/bin/perl"), Path("/usr/bin/perl")) if p.is_file()), None)
            if os.name != "nt" and perl is None:
                raise ValueError("Export metadata needs Perl. Install the HDR Finisher package dependency perl.")
            return [str(tool)] if os.name == "nt" else [str(perl), str(tool)]
    raise ValueError("Bundled ExifTool is missing. Repair HDR Finisher or run tools/fetch_exiftool.py; metadata was not exported.")


class ExifTool:
    """One serialized, persistent helper: no process startup for each batch photo."""
    def __init__(self):
        self.lock = threading.Lock()
        self.lines = queue.Queue()
        self.process = subprocess.Popen(command() + ["-stay_open", "True", "-@", "-"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env={**os.environ, "PERL_BADLANG": "0"}, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        threading.Thread(target=self._read, daemon=True).start()
        atexit.register(self.close)

    def _read(self):
        for line in self.process.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def execute(self, *arguments):
        if any("\n" in str(arg) or "\r" in str(arg) for arg in arguments):
            raise ValueError("Metadata paths cannot contain line breaks.")
        with self.lock:
            try:
                self.process.stdin.write(("\n".join(["-charset", "filename=UTF8", *map(str, arguments), "-execute"]) + "\n").encode("utf-8"))
                self.process.stdin.flush()
                result = []
                while True:
                    line = self.lines.get(timeout=60)
                    if line is None:
                        raise ValueError("Bundled ExifTool stopped before saving export metadata.")
                    if line.strip() == b"{ready}":
                        break
                    result.append(line)
                text = b"".join(result).decode("utf-8", errors="replace")
                if re.search(r"^Error:|files weren't updated due to errors", text, re.M):
                    raise ValueError("Export metadata failed: " + text.strip())
                if "-j" in arguments:
                    start, end = text.find("[{"), text.rfind("}]")
                    if start < 0 or end < start:
                        raise ValueError("Bundled ExifTool did not return readable source metadata.")
                    return text[start:end+2]
                return text
            except (OSError, queue.Empty) as exc:
                self.close()
                raise ValueError("Bundled ExifTool did not finish saving metadata.") from exc

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()


_helper = None
_helper_lock = threading.Lock()
def helper():
    global _helper
    with _helper_lock:
        if _helper is None or _helper.process.poll() is not None:
            _helper = ExifTool()
        return _helper


def jpeg_parts(data):
    if data[:2] != b"\xff\xd8":
        raise ValueError("Invalid metadata JPEG.")
    parts, pos = [], 2
    while pos < len(data):
        if data[pos] != 255:
            raise ValueError("Invalid metadata JPEG marker.")
        size = int.from_bytes(data[pos+2:pos+4], "big")
        if size < 2 or pos+size+2 > len(data):
            raise ValueError("Invalid metadata JPEG segment.")
        if data[pos+1] == 0xda:
            return parts, data[pos:]
        parts.append(data[pos:pos+size+2])
        pos += size+2
    raise ValueError("Metadata JPEG has no image stream.")


def codec_descriptions(parts):
    return tuple(m.group() for part in parts if part[4:].startswith(XMP)
        for m in DESCRIPTIONS.finditer(part[4+len(XMP):])
        if any(namespace in m.group() for namespace in CODEC_NAMESPACES))


def restore_jpeg_codec(data, original_descriptions):
    parts, tail = jpeg_parts(data)
    if original_descriptions:
        restored = False
        for i, part in enumerate(parts):
            if not part[4:].startswith(XMP):
                continue
            xml = part[4+len(XMP):]
            xml = DESCRIPTIONS.sub(lambda m: b"" if any(n in m.group() for n in CODEC_NAMESPACES) else m.group(), xml)
            if not restored:
                xml = xml.replace(b"</rdf:RDF>", b"\n".join(original_descriptions) + b"</rdf:RDF>", 1)
                restored = True
            payload = XMP + xml
            if len(payload)+2 > 65535:
                raise ValueError("Export metadata exceeds the JPEG metadata segment limit.")
            parts[i] = b"\xff\xe1" + struct.pack(">H", len(payload)+2) + payload
        if not restored:
            raise ValueError("Metadata writer removed required Ultra HDR signalling.")
    # Restoring the codec XML changes header length. Update only the MPF size and
    # secondary image offset, which are file-layout pointers, not gain-map data.
    primary_size = 2 + sum(map(len, parts)) + tail.index(b"\xff\xd9") + 2
    absolute = 2
    for i, part in enumerate(parts):
        if part[4:8] == b"MPF\0":
            value = bytearray(part)
            endian = "<" if part[8:10] == b"II" else ">"
            offset = 8 + struct.unpack_from(endian+"I", part, 12)[0]
            count = struct.unpack_from(endian+"H", part, offset)[0]
            for j in range(count):
                entry = offset+2+12*j
                if struct.unpack_from(endian+"H", part, entry)[0] == 0xb002:
                    records = 8 + struct.unpack_from(endian+"I", part, entry+8)[0]
                    struct.pack_into(endian+"I", value, records+4, primary_size)
                    struct.pack_into(endian+"I", value, records+24, primary_size-(absolute+8))
            parts[i] = bytes(value)
        absolute += len(part)
    return b"\xff\xd8" + b"".join(parts) + tail


def shield_jpeg_codec(data):
    parts, tail = jpeg_parts(data)
    for i, part in enumerate(parts):
        if not part[4:].startswith(XMP):
            continue
        xml = DESCRIPTIONS.sub(lambda m: b"" if any(n in m.group() for n in CODEC_NAMESPACES) else m.group(), part[4+len(XMP):])
        payload = XMP + xml
        parts[i] = b"\xff\xe1" + struct.pack(">H", len(payload)+2) + payload
    return restore_jpeg_codec(b"\xff\xd8" + b"".join(parts) + tail, ())


def boxes(data, start=0, end=None):
    end = len(data) if end is None else end
    while start < end:
        size, kind = struct.unpack_from(">I4s", data, start)
        header = 8
        if size == 1:
            size = struct.unpack_from(">Q", data, start+8)[0]; header = 16
        if size == 0:
            size = end-start
        if size < header or start+size > end:
            raise ValueError("Invalid export container while checking metadata.")
        yield kind, start+header, start+size
        start += size


def avif_content(data):
    # iloc maps item IDs to encoded payloads. ExifTool may relocate items when
    # adding EXIF/XMP, so compare their contents rather than file offsets.
    meta = next((s,e) for k,s,e in boxes(data) if k == b"meta")
    children = {k:(s,e) for k,s,e in boxes(data,meta[0]+4,meta[1])}
    s,e = children[b"iinf"]; version=data[s]; items={}
    for k,a,b in boxes(data,s+(8 if version else 6),e):
        if k == b"infe":
            v=data[a]; ident=int.from_bytes(data[a+4:a+(8 if v==3 else 6)],"big")
            items[ident]=data[a+(10 if v==3 else 8):a+(14 if v==3 else 12)]
    s,e=children[b"iloc"]; version=data[s]; pos=s+4
    offsets,lengths=data[pos]>>4,data[pos]&15; bases,indices=data[pos+1]>>4,data[pos+1]&15;pos+=2
    def number(size):
        nonlocal pos
        value=int.from_bytes(data[pos:pos+size],"big");pos+=size;return value
    count=number(4 if version==2 else 2); result=[]
    for _ in range(count):
        ident=number(4 if version==2 else 2); method=number(2)&15 if version in (1,2) else 0
        reference=number(2);base=number(bases);n=number(2);payload=[]
        for _ in range(n):
            if version in (1,2) and indices: number(indices)
            offset=number(offsets);length=number(lengths)
            origin=children[b"idat"][0] if method==1 else 0
            if method not in (0,1) or reference:
                raise ValueError("Cannot verify externally referenced AVIF metadata.")
            payload.append(data[origin+base+offset:origin+base+offset+length])
        if items.get(ident) not in (b"Exif",b"mime"):
            result.append((ident,items.get(ident),b"".join(payload)))
    # iprp contains codec configuration, colour properties and gain-map links.
    s,e=children[b"iprp"]
    result.append((0,b"iprp",data[s:e]))
    return repr(sorted(result)).encode()


def delivery_fingerprint(data, format):
    if format in ("jpeg_ultrahdr","sdr_jpeg"):
        parts,tail=jpeg_parts(data)
        retained=[p for p in parts if not (p[1] in (0xe1,0xed) or p[4:8]==b"MPF\0")]
        return hashlib.sha256(b"".join(retained)+tail+b"".join(codec_descriptions(parts))).digest()
    if format == "sdr_png":
        pos=8;retained=[]
        while pos<len(data):
            size=int.from_bytes(data[pos:pos+4],"big");kind=data[pos+4:pos+8]
            if kind not in (b"eXIf",b"iTXt",b"tEXt",b"zTXt",b"tIME"):
                retained.append(data[pos:pos+size+12])
            pos+=size+12
        return hashlib.sha256(b"".join(retained)).digest()
    if format in ("jpegxl_hdr","sdr_jpegxl"):
        if data[:2]==b"\xff\x0a":
            return hashlib.sha256(data).digest()
        return hashlib.sha256(b"".join(data[s:e] if k==b"jxlc" else data[s+4:e] for k,s,e in boxes(data) if k in (b"jxlc",b"jxlp"))).digest()
    if format=="avif_gain_map":
        return hashlib.sha256(avif_content(data)).digest()
    raise ValueError("Cannot verify metadata preservation for this export format.")


def write_metadata(path, session, settings):
    template=settings.metadata_template
    if settings.metadata_policy=="none" and not any(template.values()):
        return
    tool=helper(); started=perf_counter(); source=Path(getattr(session,"source_path", ""))
    if not source.is_file():
        raise ValueError("Export metadata source file is unavailable.")
    before=path.read_bytes(); fingerprint=delivery_fingerprint(before, settings.format)
    if settings.format in ("jpeg_ultrahdr", "sdr_jpeg"):
        # Keep codec XMP out of ExifTool's XML merge, including encoders which
        # emitted more than one packet. Restore its exact description bytes later.
        path.write_bytes(shield_jpeg_codec(before))
    args=["-overwrite_original", "-P", "-charset", "exif=UTF8", "-charset", "iptc=UTF8"]
    if settings.metadata_policy!="none":
        args += ["-TagsFromFile", str(source.resolve())]
        if settings.metadata_policy=="copyright":
            args += ["-EXIF:Artist","-EXIF:Copyright","-IPTC:By-line","-IPTC:CopyrightNotice","-XMP-dc:Creator","-XMP-dc:Rights"]
        else:
            args += ["-EXIF:all","-IPTC:all", *[f"-XMP-{group}:all" for group in ("dc","photoshop","iptcCore","iptcExt","exif","tiff","xmp","aux","exifEX")]]
            # Delivery-owned interpretation, dimensions and embedded previews never
            # come from the source. Maker notes may contain private opaque data.
            args += ["--"+tag for tag in ("Orientation","ImageWidth","ImageHeight","ExifImageWidth","ExifImageHeight","ColorSpace","Gamma","WhitePoint","PrimaryChromaticities","TransferFunction","YCbCrCoefficients","ReferenceBlackWhite","ThumbnailImage","PreviewImage","JpgFromRaw","OtherImage","ICC_Profile")]
    strip_location=settings.metadata_strip_location or settings.metadata_policy in ("none","copyright","all_except_location")
    if strip_location:
        args += ["-Location:all=","-GPS:all=","-XMP-dc:Coverage=","-XMP-exif:GPS*=","-XMP-iptcCore:Location=","-XMP-iptcExt:Location*=","-IPTC:City=","-IPTC:Sub-location=","-IPTC:Province-State=","-IPTC:Country-PrimaryLocationName=","-IPTC:Country-PrimaryLocationCode=","-XMP-photoshop:City=","-XMP-photoshop:State=","-XMP-photoshop:Country=","-XMP-photoshop:Location="]
    if settings.metadata_strip_serials or strip_location:
        # Opaque maker notes can retain serials or GPS even after named tags are
        # deleted. Remove them whenever either privacy filter is active.
        args += ["-MakerNotes:all="]
    if settings.metadata_strip_serials:
        args += ["-all:SerialNumber=","-all:InternalSerialNumber=","-all:CameraSerialNumber=","-all:LensSerialNumber=","-all:BodySerialNumber=","-all:OwnerName=","-all:CameraOwnerName=","-XMP-aux:SerialNumber=","-XMP-aux:LensSerialNumber=","-XMP-exifEX:CameraOwnerName=","-XMP-exifEX:BodySerialNumber=","-XMP-exifEX:LensSerialNumber="]
    date=""
    if any("{capture_date}" in value for value in template.values()):
        records=json.loads(tool.execute("-j","-DateTimeOriginal","-CreateDate","-d","%Y-%m-%d",str(source.resolve())))
        date=records[0].get("DateTimeOriginal",records[0].get("CreateDate",""))
    tokens={"filename":source.stem,"capture_date":date,"sequence":str(settings.metadata_sequence),"seq":str(settings.metadata_sequence)}
    with tempfile.TemporaryDirectory(prefix="hdr-metadata-") as temporary:
        fields={"title":("XMP-dc:Title","EXIF:XPTitle","IPTC:ObjectName"),"caption":("XMP-dc:Description","EXIF:ImageDescription","EXIF:XPComment","IPTC:Caption-Abstract"),"creator":("XMP-dc:Creator","EXIF:Artist","IPTC:By-line"),"copyright":("XMP-dc:Rights","EXIF:Copyright","IPTC:CopyrightNotice")}
        for field, value in template.items():
            if not value: continue
            value=re.sub(r"\{(filename|capture_date|sequence|seq)\}",lambda m:tokens[m[1]],value)
            text=Path(temporary)/(field+".txt");text.write_text(value,encoding="utf-8")
            args += [f"-{tag}<={text}" for tag in fields[field]]
        tool.execute(*args,str(path.resolve()))
    after=path.read_bytes()
    if settings.format in ("jpeg_ultrahdr","sdr_jpeg"):
        after=restore_jpeg_codec(after,codec_descriptions(jpeg_parts(before)[0]))
        path.write_bytes(after)
    if delivery_fingerprint(after, settings.format)!=fingerprint:
        raise ValueError("Metadata write changed protected image, colour or HDR data. Export was not published.")
    log.info("export_metadata_written format=%s policy=%s strip_location=%s strip_serials=%s elapsed_ms=%.1f",settings.format,settings.metadata_policy,strip_location,settings.metadata_strip_serials,(perf_counter()-started)*1000)
