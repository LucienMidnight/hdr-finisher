"""Install pinned ExifTool, including its redistribution notices, into bin.
Windows includes the upstream Perl runtime. Unix uses /usr/bin/perl (a package dependency).
"""
import base64
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request

VERSION = "13.59.3"
PAYLOADS = {
    "exe": "F5hpk1yVGZSDHjSKsyumyniY56IM3zawKOejOqtyT2r476fvWrUxpBmWT7Ena104TGPt/2+448Q/vrVt+yOzwQ==",
    "pl": "QmYq2JKCXRK9Uo3E3nHb0gQ6Xce2HK7wPtrHF5r+IYWyiM5WkOhiT3BesLI9lvJvPAbzjqFxQlrjXv+/cuSX/Q==",
}

def install():
    kind = "exe" if os.name == "nt" else "pl"
    root = Path(__file__).resolve().parents[1] / "bin" / "exiftool-runtime"
    executable = root / "bin" / ("exiftool.exe" if kind == "exe" else "exiftool")
    if not executable.exists():
        url = f"https://registry.npmjs.org/exiftool-vendored.{kind}/-/exiftool-vendored.{kind}-{VERSION}.tgz"
        data = urllib.request.urlopen(url, timeout=120).read()
        if base64.b64encode(hashlib.sha512(data).digest()).decode() != PAYLOADS[kind]:
            raise RuntimeError("ExifTool download failed its pinned integrity check.")
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                relative = Path(member.name).relative_to("package")
                if ".." in relative.parts:
                    raise RuntimeError("Unsafe ExifTool archive path.")
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
        executable.chmod(0o755)
    command = [str(executable)] if kind == "exe" else ["/usr/bin/perl", str(executable)]
    actual = subprocess.check_output(command + ["-ver"], text=True).strip()
    if actual != "13.59":
        raise RuntimeError(f"Expected bundled ExifTool 13.59, got {actual}")
    print(f"Bundled ExifTool {actual}: {executable}")

if __name__ == "__main__":
    install()
