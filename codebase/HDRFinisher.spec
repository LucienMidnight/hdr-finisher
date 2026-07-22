# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules


block_cipher = None

datas = [
    ("frontend", "frontend"),
    ("samples", "samples"),
    ("bin", "bin"),
    ("../README.md", "."),
    ("../LICENSE", "."),
    ("../THIRD_PARTY_NOTICES.md", "."),
    ("../md/Alpha_Manual_QA_Checklist.md", "docs"),
]

hiddenimports = ["tkinter", "tkinter.filedialog"]
hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["run_app.py"],
    pathex=["backend"],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="HDRFinisher",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="HDRFinisher",
)
