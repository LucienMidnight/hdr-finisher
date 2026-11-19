from __future__ import annotations

import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

from setuptools._distutils.ccompiler import new_compiler
from setuptools._distutils.sysconfig import customize_compiler


def build_library(name, *, ordered_float=False):
    root = Path(__file__).resolve().parents[1]
    source = root / "backend/hdr_finisher" / (name + ".c")
    suffix = ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    destination = root / "bin" / (name + suffix)
    if destination.exists() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
        return destination
    compiler = new_compiler()
    customize_compiler(compiler)
    with TemporaryDirectory(prefix=f"hdr-{name}-") as directory:
        scratch = Path(directory)
        copied = scratch / source.name
        copied.write_bytes(source.read_bytes())
        flags = ["/O2"] if compiler.compiler_type == "msvc" else ["-O3", "-std=c11", "-ffp-contract=off"]
        if ordered_float:
            flags += ["/fp:strict"] if compiler.compiler_type == "msvc" else ["-fno-fast-math"]
        objects = compiler.compile([str(copied)], output_dir=str(scratch), extra_postargs=flags)
        binary = scratch / destination.name
        compiler.link_shared_object(objects, str(binary), libraries=[] if os.name == "nt" else ["m"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(binary.read_bytes())
        temporary.replace(destination)
    return destination


def build():
    return build_library("signed_ahd")


if __name__ == "__main__":
    print(build())
    print(build_library("denoise_filters", ordered_float=True))
