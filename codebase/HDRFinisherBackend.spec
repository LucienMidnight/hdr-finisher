# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules


block_cipher = None

datas = [
    ("frontend", "frontend"),
    ("samples", "samples"),
    ("../README.md", "."),
    ("../LICENSE", "."),
    ("../THIRD_PARTY_NOTICES.md", "."),
    ("../docs/getting-started", "docs/getting-started"),
    ("../docs/setup", "docs/setup"),
    ("../docs/user-guide", "docs/user-guide"),
    ("../docs/concepts", "docs/concepts"),
    ("../docs/workflows", "docs/workflows"),
    ("../docs/troubleshooting.md", "docs"),
    ("../docs/known-limitations.md", "docs"),
    ("../docs/glossary.md", "docs"),
]

# Native tools are built per target. Keep licenses and documentation on every
# platform, while including only the executable form for the current OS.
native_tool_names = {"avifenc", "avifdec", "avifgainmaputil", "ultrahdr_app"}
datas += [
    (str(source), str(source.parent))
    for source in Path("bin").rglob("*")
    if source.is_file()
    and (
        source.stem not in native_tool_names
        or (sys.platform == "win32" and source.suffix.lower() == ".exe")
        or (sys.platform != "win32" and source.name in native_tool_names)
    )
]

imagecodecs_datas, imagecodecs_binaries, imagecodecs_hiddenimports = collect_all("imagecodecs")
datas += imagecodecs_datas
rawpy_datas, rawpy_binaries, rawpy_hiddenimports = collect_all("rawpy")
lensfun_datas, lensfun_binaries, lensfun_hiddenimports = collect_all("lensfunpy")
datas += rawpy_datas + lensfun_datas

hiddenimports = collect_submodules("uvicorn") + imagecodecs_hiddenimports + rawpy_hiddenimports + lensfun_hiddenimports

a = Analysis(
    ["run_app.py"],
    pathex=["backend"],
    binaries=imagecodecs_binaries + rawpy_binaries + lensfun_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="HDR Finisher Backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="HDR Finisher Backend",
)
