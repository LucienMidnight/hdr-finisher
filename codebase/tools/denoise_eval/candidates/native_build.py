"""Build non-shipping research libraries with the platform development toolchain."""
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory


def build_shared(source, destination, *, cpp=False):
    if os.name != "nt":
        # Keep the existing macOS/Linux research compiler and numerical flags.
        command = ["clang++" if cpp else "clang", "-O3", "-std=c++17" if cpp else "-std=c11"]
        if cpp:
            command.append("-ffp-contract=off")
        command += ["-shared", str(source), "-o", str(destination), "-fPIC"]
        if not cpp:
            command.append("-lm")
        subprocess.run(command, check=True)
        return

    from setuptools._distutils.ccompiler import new_compiler
    from setuptools._distutils.sysconfig import customize_compiler

    # Like the production helper builder, discover Visual C++ without requiring
    # the developer shell or an additional LLVM installation on PATH.
    compiler = new_compiler()
    customize_compiler(compiler)
    flags = ["/O2", "/fp:strict"] + (["/std:c++17", "/EHsc"] if cpp else ["/std:c11"])
    with TemporaryDirectory(prefix="hdr-denoise-research-") as directory:
        scratch = Path(directory)
        # MSVC recognizes .cpp, not the upstream .cc suffix.
        unit = scratch / ("research.cpp" if cpp else "research.c")
        unit.write_bytes(Path(source).read_bytes())
        objects = compiler.compile([str(unit)], output_dir=str(scratch), extra_postargs=flags)
        binary = scratch / Path(destination).name
        compiler.link_shared_object(objects, str(binary), target_lang="c++" if cpp else "c")
        Path(destination).write_bytes(binary.read_bytes())
