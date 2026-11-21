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
            candidates = [root / ".dylibs" / "liblensfun.0.3.4.dylib"]
        elif sys.platform == "win32":
            candidates = [root / "lensfun.dll"]
        else:
            candidates = list((root.parent / "lensfunpy.libs").glob("liblensfun-*.so.0.3.4"))
        if len(candidates) != 1:
            return None
        native = _Lensfun(candidates[0])
    except (ImportError, OSError, AttributeError):
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
            for file in glob(str(root / "db_files" / "*.xml")):
                if native.db_load_file(self.handle, _utf8(file)):
                    raise OSError("Lensfun could not load its bundled profile")
            if native.db_load(self.handle) not in (0, _NO_DATABASE):
                raise OSError("Lensfun could not load its common profiles")

        def __del__(self):
            if self.handle:
                native.db_destroy(self.handle)

        @property
        def cameras(self):
            return native.profiles(native.get_cameras(self.handle), Camera, self, owned=False)

        @property
        def lenses(self):
            return native.profiles(native.get_lenses(self.handle), Lens, self, owned=False)

        def find_cameras(self, maker, model):
            result = native.find_cameras(self.handle, _utf8(maker), _utf8(model))
            return native.profiles(result, Camera, self, owned=True)

        def find_lenses(self, camera, maker=None, lens=None):
            result = native.find_lenses(self.handle, camera.native_address, _utf8(maker), _utf8(lens), 0)
            return native.profiles(result, Lens, self, owned=True)

    try:
        return Database()
    except (OSError, TypeError):
        return None


@contextmanager
def exact_lens_coordinate_strips(modifier, chromatic, flags, target_geometry):
    """Yield a full-width band reader, or None to use the existing whole map."""
    lens = getattr(modifier, "lens", None)
    native = getattr(lens, "native", None)
    if native is None or modifier.height <= COORDINATE_ROWS:
        yield None
        return
    handle = native.modifier_new(lens.native_address, modifier.crop, modifier.width, modifier.height)
    if not handle:
        yield None
        return
    try:
        active = native.initialize(
            handle, lens.native_address, _FLOAT32_PIXEL_FORMAT, modifier.focal_length,
            modifier.aperture, modifier.distance, modifier.scale, target_geometry, flags, 0,
        )
        if not active:
            yield None
            return

        width, height = modifier.width, modifier.height
        shape = (3, 2) if chromatic else (2,)
        apply = native.subpixel if chromatic else native.geometry
        reference = modifier.apply_subpixel_geometry_distortion if chromatic else modifier.apply_geometry_distortion
        row_y = np.empty(height, dtype=np.float32)
        row = 0
        capturing = True

        @_ROW_CALLBACK
        def use_whole_row(_data, coordinates, count):
            nonlocal row
            if capturing:
                row_y[row] = coordinates[1]
            else:
                np.ctypeslib.as_array(coordinates, shape=(count * 2,))[1::2] = row_y[row]
            row += 1

        # Lensfun advances y once per row, independently of the request
        # width. Capture its uncorrected y with only four columns, using the
        # exact same native entry point for capture and replay. Priority -1
        # runs before auto-scale and all distortion callbacks. Register it
        # after Initialize, which uses those callbacks to calculate auto-scale.
        native.add_callback(handle, use_whole_row, -1, None, 0)
        probe = np.empty((height, 4, *shape), dtype=np.float32)
        captured = apply(handle, 0, 0, 4, height, probe.ctypes.data) and row == height
        del probe
        if not captured:
            yield None
            return
        capturing = False

        buffer = np.empty((COORDINATE_ROWS, width, *shape), dtype=np.float32)

        def coordinates(top, bottom):
            nonlocal row
            row = top
            # Keep x at zero and use the full frame width, preserving x
            # accumulation, callback layout, and per-row SIMD alignment.
            if not apply(handle, 0, 0, width, bottom - top, buffer.ctypes.data) or row != bottom:
                raise RuntimeError("Lensfun did not generate every coordinate row")
            return buffer[:bottom - top]

        # Check the binding's layout, initialization and the row callback
        # against an ordinary zero-origin request before using strip output.
        prefix = reference(0, 0, width, 17)
        if prefix is None or prefix[16:].tobytes() != coordinates(16, 17).tobytes():
            del buffer, prefix
            yield None
            return
        del prefix
        yield coordinates
    finally:
        native.modifier_destroy(handle)
