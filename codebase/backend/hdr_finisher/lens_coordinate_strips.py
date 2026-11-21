"""Bounded, byte-exact coordinate generation for the Lensfun 0.3.4 wheels."""

from contextlib import contextmanager
import ctypes as C
from glob import glob
from pathlib import Path
import sys

import numpy as np


COORDINATE_ROWS = 128
_ROW_CALLBACK = C.CFUNCTYPE(None, C.c_void_p, C.POINTER(C.c_float), C.c_int)
_FLOAT32_PIXEL_FORMAT = 3  # LF_PF_F32
_NO_DATABASE = 2  # LF_NO_DATABASE
_SEARCH_LOOSE = 1  # LF_SEARCH_LOOSE


class LensStripUnavailable(RuntimeError):
    """The native strip reader failed; callers use whole-frame coordinates."""


_reported = set()


def _unavailable(reason, **fields):
    # One always-on decision line per reason and process (log contract).
    if reason in _reported:
        return
    _reported.add(reason)
    try:
        from .library_diagnostics import log
        log("lens_coordinate_strips_unavailable", area="raw", level="warn", route="whole_frame",
            reason=reason, **fields)
    except Exception:
        pass


def _bind(library, name, result, *arguments):
    function = getattr(library, name)
    function.argtypes = arguments
    function.restype = result
    return function


class _Lensfun:
    def __init__(self, wheel):
        # Like lensfunpy, keep the GIL during native calls. Lensfun's searches
        # update scores on the shared profile records.
        library = C.PyDLL(str(wheel))
        pointer, string, integer, real = C.c_void_p, C.c_char_p, C.c_int, C.c_float
        result_list = C.POINTER(pointer)
        self.db_new = _bind(library, "lf_db_new", pointer)
        self.db_destroy = _bind(library, "lf_db_destroy", None, pointer)
        self.db_load_file = _bind(library, "lf_db_load_file", integer, pointer, string)
        self.db_load = _bind(library, "lf_db_load", integer, pointer)
        self.get_cameras = _bind(library, "lf_db_get_cameras", result_list, pointer)
        self.get_lenses = _bind(library, "lf_db_get_lenses", result_list, pointer)
        self.find_cameras = _bind(library, "lf_db_find_cameras", result_list, pointer, string, string)
        self.find_cameras_ext = _bind(library, "lf_db_find_cameras_ext", result_list,
                                      pointer, string, string, integer)
        self.find_lenses = _bind(library, "lf_db_find_lenses_hd", result_list,
                                 pointer, pointer, string, string, integer)
        self.free = _bind(library, "lf_free", None, pointer)
        self.modifier_new = _bind(library, "lf_modifier_new", pointer, pointer, real, integer, integer)
        self.modifier_destroy = _bind(library, "lf_modifier_destroy", None, pointer)
        self.initialize = _bind(library, "lf_modifier_initialize", integer, pointer, pointer, integer,
                                real, real, real, real, integer, integer, integer)
        self.add_callback = _bind(library, "lf_modifier_add_coord_callback", None, pointer,
                                  _ROW_CALLBACK, integer, pointer, C.c_size_t)
        coordinate_args = pointer, real, real, integer, integer, pointer
        self.geometry = _bind(library, "lf_modifier_apply_geometry_distortion", integer, *coordinate_args)
        self.subpixel = _bind(library, "lf_modifier_apply_subpixel_geometry_distortion", integer, *coordinate_args)

    def profiles(self, result, profile_type, database, *, owned):
        try:
            records = []
            while result and result[len(records)]:
                records.append(profile_type(result[len(records)], database))
            return records
        finally:
            if owned and result:
                self.free(result)


def _utf8(value):
    return value.encode("utf-8") if value is not None else None


def native_lens_database():
    """Use the same Lensfun searches, with addresses owned by this database."""
    try:
        import lensfunpy
        if lensfunpy.__version__ != "1.18.0" or lensfunpy.lensfun_version != (0, 3, 4, 0):
            return None
        root = Path(lensfunpy.__file__).parent
        if sys.platform == "darwin":
            patterns = [(root / ".dylibs", "liblensfun.0.3.4.dylib")]
        elif sys.platform == "win32":
            patterns = [(root, "lensfun*.dll"), (root.parent / "lensfunpy.libs", "lensfun*.dll")]
        else:
            patterns = [(root.parent / "lensfunpy.libs", "liblensfun-*.so.0.3.4")]
        candidates = sorted({path for folder, pattern in patterns for path in folder.glob(pattern)})
        if len(candidates) != 1:
            _unavailable("lensfun_library_not_found", candidates=len(candidates))
            return None
        native = _Lensfun(candidates[0])
    except ImportError:
        return None
    except (OSError, AttributeError) as exc:
        _unavailable("lensfun_library_unusable", error=type(exc).__name__)
        return None

    # lensfunpy's Camera/Lens constructors take a native profile address and
    # a Database to keep it alive. Construct those views with our C database's
    # results, without inspecting a Python object's private memory.
    class Camera(lensfunpy.Camera):
        def __init__(self, address, database):
            self.native_address = address

    class Lens(lensfunpy.Lens):
        def __init__(self, address, database):
            self.native_address = address
            self.native = native

    class Database(lensfunpy.Database):
        def __init__(self):
            self.handle = native.db_new()
            if not self.handle:
                raise OSError("Lensfun could not create its database")
            # Mirror Database() in lensfunpy, including later common entries
            # overriding bundled entries. The base object owns an empty DB.
            for file in sorted(glob(str(root / "db_files" / "*.xml"))):
                if native.db_load_file(self.handle, _utf8(file)):
                    raise OSError("Lensfun could not load its bundled profile")
            if native.db_load(self.handle) not in (0, _NO_DATABASE):
                raise OSError("Lensfun could not load its common profiles")

        def __del__(self):
            handle, self.handle = getattr(self, "handle", None), None
            if handle:
                native.db_destroy(handle)

        # The lensfunpy base database is empty here. Mount views over it would
        # point at nothing, so refuse them instead of returning invalid objects.
        @property
        def mounts(self):
            raise NotImplementedError("Lens mounts are not available from the strip-capable database")

        def find_mount(self, name):
            raise NotImplementedError("Lens mounts are not available from the strip-capable database")

        @property
        def cameras(self):
            return native.profiles(native.get_cameras(self.handle), Camera, self, owned=False)

        @property
        def lenses(self):
            return native.profiles(native.get_lenses(self.handle), Lens, self, owned=False)

        def find_cameras(self, maker=None, model=None, loose_search=False):
            if loose_search:
                result = native.find_cameras_ext(self.handle, _utf8(maker), _utf8(model), _SEARCH_LOOSE)
            else:
                result = native.find_cameras(self.handle, _utf8(maker), _utf8(model))
            return native.profiles(result, Camera, self, owned=True)

        def find_lenses(self, camera, maker=None, lens=None, loose_search=False):
            result = native.find_lenses(self.handle, camera.native_address, _utf8(maker), _utf8(lens),
                                        _SEARCH_LOOSE if loose_search else 0)
            return native.profiles(result, Lens, self, owned=True)

    try:
        return Database()
    except (OSError, TypeError):
        return None


@contextmanager
def exact_lens_coordinate_strips(modifier, chromatic, flags, target_geometry):
    """Yield a full-width band reader, or None to use the existing whole map.

    The reader raises LensStripUnavailable if Lensfun fails mid-image; the
    caller then recomputes with whole-frame coordinates.
    """
    lens = getattr(modifier, "lens", None)
    native = getattr(lens, "native", None)
    if native is None or modifier.height <= COORDINATE_ROWS:
        yield None
        return
    handle = None
    try:
        try:
            handle = native.modifier_new(lens.native_address, modifier.crop, modifier.width, modifier.height)
            reader = _strip_reader(native, handle, modifier, chromatic, flags, target_geometry) if handle else None
        except (OSError, C.ArgumentError, AttributeError, TypeError, ValueError, LensStripUnavailable) as exc:
            _unavailable("lensfun_strip_setup_failed", error=type(exc).__name__)
            reader = None
        yield reader
    finally:
        if handle:
            native.modifier_destroy(handle)


def _strip_reader(native, handle, modifier, chromatic, flags, target_geometry):
    active = native.initialize(
        handle, modifier.lens.native_address, _FLOAT32_PIXEL_FORMAT, modifier.focal_length,
        modifier.aperture, modifier.distance, modifier.scale, target_geometry, flags, 0,
    )
    if not active:
        _unavailable("lensfun_strip_initialize_inactive")
        return None

    width, height = modifier.width, modifier.height
    shape = (3, 2) if chromatic else (2,)
    apply = native.subpixel if chromatic else native.geometry
    reference = modifier.apply_subpixel_geometry_distortion if chromatic else modifier.apply_geometry_distortion
    row_y = np.empty(height, dtype=np.float32)
    state = {"row": 0, "capturing": True}

    @_ROW_CALLBACK
    def use_whole_row(_data, coordinates, count):
        row = state["row"]
        if row < height:
            if state["capturing"]:
                row_y[row] = coordinates[1]
            else:
                np.ctypeslib.as_array(coordinates, shape=(count * 2,))[1::2] = row_y[row]
        state["row"] = row + 1

    # Lensfun advances y once per row, independently of the request
    # width. Capture its uncorrected y with only four columns, using the
    # exact same native entry point for capture and replay. Priority -1
    # runs before auto-scale and all distortion callbacks. Register it
    # after Initialize, which uses those callbacks to calculate auto-scale.
    native.add_callback(handle, use_whole_row, -1, None, 0)
    probe = np.empty((height, 4, *shape), dtype=np.float32)
    captured = apply(handle, 0, 0, 4, height, probe.ctypes.data) and state["row"] == height
    del probe
    if not captured:
        _unavailable("lensfun_strip_capture_failed")
        return None
    state["capturing"] = False

    buffer = np.empty((COORDINATE_ROWS, width, *shape), dtype=np.float32)

    def coordinates(top, bottom):
        if not 0 <= top < bottom <= height or bottom - top > COORDINATE_ROWS:
            raise ValueError(f"Lens coordinate strip {top}:{bottom} is outside 0:{height} or too tall")
        state["row"] = top
        # Keep x at zero and use the full frame width, preserving x
        # accumulation, callback layout, and per-row SIMD alignment.
        try:
            done = apply(handle, 0, 0, width, bottom - top, buffer.ctypes.data)
        except (OSError, C.ArgumentError) as exc:
            raise LensStripUnavailable(f"Lensfun strip call failed: {exc}") from exc
        if not done or state["row"] != bottom:
            raise LensStripUnavailable("Lensfun did not generate every coordinate row")
        return buffer[:bottom - top]

    # Check the binding's layout, initialization and multi-row replay of the
    # row callback against an ordinary zero-origin request before using strip
    # output.
    prefix = reference(0, 0, width, 18)
    if prefix is None or prefix[15:].tobytes() != coordinates(15, 18).tobytes():
        _unavailable("lensfun_strip_self_check_failed")
        return None
    # Keep the callback alive as long as the reader.
    coordinates.callback = use_whole_row
    return coordinates
