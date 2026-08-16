# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all, collect_submodules


block_cipher = None

datas = [
    ("frontend", "frontend"),
    ("samples", "samples"),
    ("bin", "bin"),
    ("../README.md", "."),
    ("../LICENSE", "."),
    ("../THIRD_PARTY_NOTICES.md", "."),
]

imagecodecs_datas, imagecodecs_binaries, imagecodecs_hiddenimports = collect_all("imagecodecs")
datas += imagecodecs_datas

hiddenimports = collect_submodules("uvicorn") + imagecodecs_hiddenimports

a = Analysis(
    ["run_app.py"],
    pathex=["backend"],
    binaries=imagecodecs_binaries,
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
