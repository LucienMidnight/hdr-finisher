# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all, collect_submodules


block_cipher = None

datas = [
    ("frontend", "frontend"),
    ("samples", "samples"),
    ("backend/hdr_finisher/film_stocks", "hdr_finisher/film_stocks"),
    ("bin", "bin"),
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

imagecodecs_datas, imagecodecs_binaries, imagecodecs_hiddenimports = collect_all("imagecodecs")
datas += imagecodecs_datas
rawpy_datas, rawpy_binaries, rawpy_hiddenimports = collect_all("rawpy")
lensfun_datas, lensfun_binaries, lensfun_hiddenimports = collect_all("lensfunpy")
# Native hue selection uses OpenCV filtering. collect_all retains the wheel's
# full LICENSE.txt and LICENSE-3RD-PARTY.txt as well as its native libraries.
cv2_datas, cv2_binaries, cv2_hiddenimports = collect_all("cv2")
vips_datas, vips_binaries, vips_hiddenimports = collect_all("pyvips")
# The binary wheel installs a top-level extension/DLL, not a pyvips_binary
# import package. Resolve its installed files rather than collecting a name
# which does not exist (and would silently omit the native decoder).
from importlib.metadata import distribution
vips_distribution = distribution("pyvips-binary")
vips_native_binaries = [(str(vips_distribution.locate_file(file)), ".")
    for file in vips_distribution.files if str(file).endswith((".dll", ".pyd", ".so", ".dylib"))]
datas += vips_datas
cv2_binaries += vips_binaries + vips_native_binaries
cv2_hiddenimports += vips_hiddenimports + ["_libvips"]
datas += cv2_datas
datas += rawpy_datas + lensfun_datas

hiddenimports = ["tkinter", "tkinter.filedialog"]
hiddenimports += collect_submodules("uvicorn") + collect_submodules("websockets")
hiddenimports += imagecodecs_hiddenimports
hiddenimports += rawpy_hiddenimports + lensfun_hiddenimports

a = Analysis(
    ["run_app.py"],
    pathex=["backend"],
    binaries=imagecodecs_binaries + rawpy_binaries + lensfun_binaries + cv2_binaries,
    datas=datas,
    hiddenimports=hiddenimports + cv2_hiddenimports,
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
    name="HDR Finisher",
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
    name="HDR Finisher",
)
