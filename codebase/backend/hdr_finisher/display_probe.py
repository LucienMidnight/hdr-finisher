from __future__ import annotations

import ctypes
from ctypes import wintypes
import math
import platform
from typing import Any
import uuid


def probe_displays() -> dict[str, Any]:
    """Return read-only native display telemetry used by delivery proofing."""
    if platform.system() != "Windows":
        return {
            "platform": platform.platform(),
            "source": "unavailable",
            "displays": [],
            "detail": "Native SDR-white telemetry is currently available on Windows only.",
        }
    try:
        displays = _query_windows_displays()
        return {
            "platform": platform.platform(),
            "source": "Windows QueryDisplayConfig + DXGI 1.6",
            "displays": displays,
            "detail": "Nominal headroom is log2(DXGI MaxLuminance / Windows SDR white).",
        }
    except (OSError, ValueError, ctypes.ArgumentError) as exc:
        return {
            "platform": platform.platform(),
            "source": "unavailable",
            "displays": [],
            "detail": f"Windows display telemetry could not be read: {exc}",
        }


class LUID(ctypes.Structure):
    _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]


class DISPLAYCONFIG_RATIONAL(ctypes.Structure):
    _fields_ = [("Numerator", wintypes.UINT), ("Denominator", wintypes.UINT)]


class DISPLAYCONFIG_2DREGION(ctypes.Structure):
    _fields_ = [("cx", wintypes.UINT), ("cy", wintypes.UINT)]


class DISPLAYCONFIG_VIDEO_SIGNAL_INFO(ctypes.Structure):
    _fields_ = [
        ("pixelRate", ctypes.c_uint64),
        ("hSyncFreq", DISPLAYCONFIG_RATIONAL),
        ("vSyncFreq", DISPLAYCONFIG_RATIONAL),
        ("activeSize", DISPLAYCONFIG_2DREGION),
        ("totalSize", DISPLAYCONFIG_2DREGION),
        ("videoStandard", wintypes.UINT),
        ("scanLineOrdering", wintypes.UINT),
    ]


class DISPLAYCONFIG_TARGET_MODE(ctypes.Structure):
    _fields_ = [("targetVideoSignalInfo", DISPLAYCONFIG_VIDEO_SIGNAL_INFO)]


class DISPLAYCONFIG_SOURCE_MODE(ctypes.Structure):
    _fields_ = [
        ("width", wintypes.UINT),
        ("height", wintypes.UINT),
        ("pixelFormat", wintypes.UINT),
        ("position", wintypes.POINT),
    ]


class DISPLAYCONFIG_DESKTOP_IMAGE_INFO(ctypes.Structure):
    _fields_ = [
        ("PathSourceSize", wintypes.POINT),
        ("DesktopImageRegion", wintypes.RECT),
        ("DesktopImageClip", wintypes.RECT),
    ]


class DISPLAYCONFIG_MODE_UNION(ctypes.Union):
    _fields_ = [
        ("targetMode", DISPLAYCONFIG_TARGET_MODE),
        ("sourceMode", DISPLAYCONFIG_SOURCE_MODE),
        ("desktopImageInfo", DISPLAYCONFIG_DESKTOP_IMAGE_INFO),
    ]


class DISPLAYCONFIG_MODE_INFO(ctypes.Structure):
    _anonymous_ = ("mode",)
    _fields_ = [
        ("infoType", wintypes.UINT),
        ("id", wintypes.UINT),
        ("adapterId", LUID),
        ("mode", DISPLAYCONFIG_MODE_UNION),
    ]


class DISPLAYCONFIG_PATH_SOURCE_INFO(ctypes.Structure):
    _fields_ = [
        ("adapterId", LUID),
        ("id", wintypes.UINT),
        ("modeInfoIdx", wintypes.UINT),
        ("statusFlags", wintypes.UINT),
    ]


class DISPLAYCONFIG_PATH_TARGET_INFO(ctypes.Structure):
    _fields_ = [
        ("adapterId", LUID),
        ("id", wintypes.UINT),
        ("modeInfoIdx", wintypes.UINT),
        ("outputTechnology", wintypes.UINT),
        ("rotation", wintypes.UINT),
        ("scaling", wintypes.UINT),
        ("refreshRate", DISPLAYCONFIG_RATIONAL),
        ("scanLineOrdering", wintypes.UINT),
        ("targetAvailable", wintypes.BOOL),
        ("statusFlags", wintypes.UINT),
    ]


class DISPLAYCONFIG_PATH_INFO(ctypes.Structure):
    _fields_ = [("sourceInfo", DISPLAYCONFIG_PATH_SOURCE_INFO), ("targetInfo", DISPLAYCONFIG_PATH_TARGET_INFO), ("flags", wintypes.UINT)]


class DISPLAYCONFIG_DEVICE_INFO_HEADER(ctypes.Structure):
    _fields_ = [("type", wintypes.UINT), ("size", wintypes.UINT), ("adapterId", LUID), ("id", wintypes.UINT)]


class DISPLAYCONFIG_SDR_WHITE_LEVEL(ctypes.Structure):
    _fields_ = [("header", DISPLAYCONFIG_DEVICE_INFO_HEADER), ("SDRWhiteLevel", wintypes.ULONG)]


class DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO(ctypes.Structure):
    _fields_ = [
        ("header", DISPLAYCONFIG_DEVICE_INFO_HEADER),
        ("value", wintypes.UINT),
        ("colorEncoding", wintypes.UINT),
        ("bitsPerColorChannel", wintypes.UINT),
    ]


class DISPLAYCONFIG_TARGET_DEVICE_NAME(ctypes.Structure):
    _fields_ = [
        ("header", DISPLAYCONFIG_DEVICE_INFO_HEADER),
        ("flags", wintypes.UINT),
        ("outputTechnology", wintypes.UINT),
        ("edidManufactureId", wintypes.USHORT),
        ("edidProductCodeId", wintypes.USHORT),
        ("connectorInstance", wintypes.UINT),
        ("monitorFriendlyDeviceName", wintypes.WCHAR * 64),
        ("monitorDevicePath", wintypes.WCHAR * 128),
    ]


class DISPLAYCONFIG_SOURCE_DEVICE_NAME(ctypes.Structure):
    _fields_ = [("header", DISPLAYCONFIG_DEVICE_INFO_HEADER), ("viewGdiDeviceName", wintypes.WCHAR * 32)]


class GUID(ctypes.Structure):
    _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD), ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    @classmethod
    def from_string(cls, value: str) -> "GUID":
        raw = uuid.UUID(value).bytes_le
        return cls.from_buffer_copy(raw)


class DXGI_OUTPUT_DESC1(ctypes.Structure):
    _fields_ = [
        ("DeviceName", wintypes.WCHAR * 32),
        ("DesktopCoordinates", wintypes.RECT),
        ("AttachedToDesktop", wintypes.BOOL),
        ("Rotation", wintypes.UINT),
        ("Monitor", wintypes.HANDLE),
        ("BitsPerColor", wintypes.UINT),
        ("ColorSpace", wintypes.UINT),
        ("RedPrimary", ctypes.c_float * 2),
        ("GreenPrimary", ctypes.c_float * 2),
        ("BluePrimary", ctypes.c_float * 2),
        ("WhitePoint", ctypes.c_float * 2),
        ("MinLuminance", ctypes.c_float),
        ("MaxLuminance", ctypes.c_float),
        ("MaxFullFrameLuminance", ctypes.c_float),
    ]


def _query_windows_displays() -> list[dict[str, Any]]:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    get_sizes = user32.GetDisplayConfigBufferSizes
    get_sizes.argtypes = [wintypes.UINT, ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT)]
    query = user32.QueryDisplayConfig
    query.argtypes = [
        wintypes.UINT,
        ctypes.POINTER(wintypes.UINT),
        ctypes.POINTER(DISPLAYCONFIG_PATH_INFO),
        ctypes.POINTER(wintypes.UINT),
        ctypes.POINTER(DISPLAYCONFIG_MODE_INFO),
        ctypes.c_void_p,
    ]
    get_info = user32.DisplayConfigGetDeviceInfo
    get_info.argtypes = [ctypes.POINTER(DISPLAYCONFIG_DEVICE_INFO_HEADER)]

    path_count = wintypes.UINT()
    mode_count = wintypes.UINT()
    flags = 0x00000002
    result = get_sizes(flags, ctypes.byref(path_count), ctypes.byref(mode_count))
    if result != 0:
        raise OSError(result, "GetDisplayConfigBufferSizes failed")
    paths = (DISPLAYCONFIG_PATH_INFO * path_count.value)()
    modes = (DISPLAYCONFIG_MODE_INFO * mode_count.value)()
    result = query(flags, ctypes.byref(path_count), paths, ctypes.byref(mode_count), modes, None)
    if result != 0:
        raise OSError(result, "QueryDisplayConfig failed")

    dxgi = _query_dxgi_outputs()
    output: list[dict[str, Any]] = []
    for path in list(paths)[: path_count.value]:
        target = path.targetInfo
        header_values = (target.adapterId, target.id)
        sdr = DISPLAYCONFIG_SDR_WHITE_LEVEL()
        sdr.header = DISPLAYCONFIG_DEVICE_INFO_HEADER(11, ctypes.sizeof(sdr), *header_values)
        sdr_result = get_info(ctypes.byref(sdr.header))
        sdr_nits = (float(sdr.SDRWhiteLevel) / 1000.0 * 80.0) if sdr_result == 0 else None

        color = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO()
        color.header = DISPLAYCONFIG_DEVICE_INFO_HEADER(9, ctypes.sizeof(color), *header_values)
        color_result = get_info(ctypes.byref(color.header))
        hdr_supported = bool(color.value & 0x1) if color_result == 0 else None
        hdr_enabled = bool(color.value & 0x2) if color_result == 0 else None

        target_name = DISPLAYCONFIG_TARGET_DEVICE_NAME()
        target_name.header = DISPLAYCONFIG_DEVICE_INFO_HEADER(2, ctypes.sizeof(target_name), *header_values)
        get_info(ctypes.byref(target_name.header))

        source_name = DISPLAYCONFIG_SOURCE_DEVICE_NAME()
        source_name.header = DISPLAYCONFIG_DEVICE_INFO_HEADER(
            1,
            ctypes.sizeof(source_name),
            path.sourceInfo.adapterId,
            path.sourceInfo.id,
        )
        get_info(ctypes.byref(source_name.header))
        gdi_name = str(source_name.viewGdiDeviceName)
        dxgi_info = dxgi.get(gdi_name, {})
        max_nits = dxgi_info.get("max_luminance_nits")
        nominal = None
        if max_nits and sdr_nits and max_nits > 0 and sdr_nits > 0:
            nominal = math.log2(max_nits / sdr_nits)
        output.append(
            {
                "id": f"{target.adapterId.HighPart:x}:{target.adapterId.LowPart:x}:{target.id}",
                "name": str(target_name.monitorFriendlyDeviceName) or gdi_name or f"Display {target.id}",
                "device_name": gdi_name,
                "hdr_supported": hdr_supported,
                "hdr_enabled": hdr_enabled,
                "bits_per_channel": int(color.bitsPerColorChannel) if color_result == 0 else None,
                "sdr_white_nits": round(sdr_nits, 2) if sdr_nits is not None else None,
                "max_luminance_nits": round(max_nits, 2) if max_nits else None,
                "max_full_frame_luminance_nits": dxgi_info.get("max_full_frame_luminance_nits"),
                "nominal_headroom": round(nominal, 3) if nominal is not None else None,
                "primary": bool(dxgi_info.get("primary", False)),
            }
        )
    return output


def _query_dxgi_outputs() -> dict[str, dict[str, Any]]:
    dxgi = ctypes.WinDLL("dxgi", use_last_error=True)
    create_factory = dxgi.CreateDXGIFactory1
    create_factory.argtypes = [ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    factory_iid = GUID.from_string("770AAE78-F26F-4DBA-A829-253C83D1B387")
    output6_iid = GUID.from_string("068346e8-aaec-4b84-add7-137f513f77a1")
    factory = ctypes.c_void_p()
    if create_factory(ctypes.byref(factory_iid), ctypes.byref(factory)) != 0:
        return {}
    found: dict[str, dict[str, Any]] = {}
    try:
        adapter_index = 0
        while True:
            adapter = ctypes.c_void_p()
            hr = _com_call(factory, 12, ctypes.c_long, [wintypes.UINT, ctypes.POINTER(ctypes.c_void_p)], adapter_index, ctypes.byref(adapter))
            if hr != 0:
                break
            try:
                output_index = 0
                while True:
                    base_output = ctypes.c_void_p()
                    hr = _com_call(adapter, 7, ctypes.c_long, [wintypes.UINT, ctypes.POINTER(ctypes.c_void_p)], output_index, ctypes.byref(base_output))
                    if hr != 0:
                        break
                    output6 = ctypes.c_void_p()
                    try:
                        hr = _com_call(base_output, 0, ctypes.c_long, [ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)], ctypes.byref(output6_iid), ctypes.byref(output6))
                        if hr == 0 and output6.value:
                            desc = DXGI_OUTPUT_DESC1()
                            if _com_call(output6, 27, ctypes.c_long, [ctypes.POINTER(DXGI_OUTPUT_DESC1)], ctypes.byref(desc)) == 0:
                                found[str(desc.DeviceName)] = {
                                    "max_luminance_nits": float(desc.MaxLuminance),
                                    "max_full_frame_luminance_nits": round(float(desc.MaxFullFrameLuminance), 2),
                                    "primary": desc.DesktopCoordinates.left == 0 and desc.DesktopCoordinates.top == 0,
                                }
                    finally:
                        if output6.value:
                            _com_call(output6, 2, wintypes.ULONG, [])
                        _com_call(base_output, 2, wintypes.ULONG, [])
                    output_index += 1
            finally:
                _com_call(adapter, 2, wintypes.ULONG, [])
            adapter_index += 1
    finally:
        _com_call(factory, 2, wintypes.ULONG, [])
    return found


def _com_call(pointer: ctypes.c_void_p, index: int, restype: Any, argtypes: list[Any], *args: Any) -> Any:
    vtable = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    prototype = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
    function = prototype(vtable[index])
    return function(pointer, *args)
