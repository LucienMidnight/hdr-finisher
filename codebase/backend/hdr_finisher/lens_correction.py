"""Byte-exact Lensfun 0.3.4 correction with bounded native coordinate strips."""

from contextlib import contextmanager
import ctypes as C
from functools import lru_cache
from glob import glob
from pathlib import Path
import sys
from threading import Event

import numpy as np

from .config import BIN_DIR
from .cpu_budget import CpuExecutor, logical_cpus


COORDINATE_ROWS = 64
_RETRY_ROWS = 16
_FLOAT32_PIXEL_FORMAT = 3  # LF_PF_F32
_NO_DATABASE = 2  # LF_NO_DATABASE
_SEARCH_LOOSE = 1  # LF_SEARCH_LOOSE


class LensStripError(RuntimeError):
    """A worker could not obtain exact coordinates from Lensfun."""


_reported = set()


def _report_lens_issue(reason, **fields):
    # One always-on decision line per reason and process (log contract).
    if reason in _reported:
        return
    _reported.add(reason)
    try:
        from .library_diagnostics import log
        log("lens_coordinate_strips_unavailable", area="raw", level="warn", route=fields.pop("route", "cpu"),
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
                                  pointer, integer, pointer, C.c_size_t)
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
        if lensfunpy.lensfun_version != (0, 3, 4, 0):
            _report_lens_issue("lensfun_abi_unsupported")
            return None
        root = Path(lensfunpy.__file__).parent
        if sys.platform == "darwin":
            patterns = [(root / ".dylibs", "liblensfun.0.3.4.dylib")]
        elif sys.platform == "win32":
            patterns = [(folder, "*lensfun*.dll") for folder in (root, root.parent / "lensfunpy.libs")]
        else:
            patterns = [(root.parent / "lensfunpy.libs", "liblensfun-*.so.0.3.4")]
        candidates = sorted({path for folder, pattern in patterns for path in folder.glob(pattern)})
        if len(candidates) != 1:
            _report_lens_issue("lensfun_library_not_found", candidates=len(candidates))
            return None
        native = _Lensfun(candidates[0])
    except ImportError:
        return None
    except (OSError, AttributeError) as exc:
        _report_lens_issue("lensfun_library_unusable", error=type(exc).__name__)
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
    except (OSError, TypeError) as exc:
        _report_lens_issue("lensfun_database_unusable", error=type(exc).__name__)
        return None


class _Rows(C.Structure):
    _fields_ = [("values", C.c_void_p), ("height", C.c_int), ("row", C.c_int)]


@lru_cache(maxsize=1)
def _library():
    suffix = ".dll" if sys.platform == "win32" else ".dylib" if sys.platform == "darwin" else ".so"
    library = C.CDLL(str(BIN_DIR / ("lens_correction" + suffix)))
    pointer, integer = C.c_void_p, C.c_int
    rows = C.POINTER(_Rows)
    _bind(library, "lens_capture_rows", integer, pointer, pointer, pointer, rows, integer, pointer)
    _bind(library, "lens_replay_rows", None, pointer, pointer, rows)
    _bind(library, "lens_coordinates", integer, pointer, pointer, rows, integer, integer, integer, pointer)
    _bind(library, "lens_remap", integer, pointer, integer, integer, integer, integer,
          integer, integer, pointer, integer, C.c_size_t, pointer)
    return library


@contextmanager
def _initialized_modifier(reference, flags, target_geometry):
    lens = reference.lens
    native = lens.native
    handle = native.modifier_new(lens.native_address, reference.crop, reference.width, reference.height)
    if not handle:
        raise LensStripError("Lensfun could not create its worker modifier")
    try:
        active = native.initialize(
            handle, lens.native_address, _FLOAT32_PIXEL_FORMAT, reference.focal_length,
            reference.aperture, reference.distance, reference.scale, target_geometry, flags, 0,
        )
        if not active:
            raise LensStripError("Lensfun worker modifier was inactive")
        yield handle
    finally:
        native.modifier_destroy(handle)


def _capture_rows(library, modifier, flags, target_geometry, apply, layout):
    values = np.empty(modifier.height, dtype=np.float32)
    width = min(4, modifier.width)
    probe = np.empty((modifier.height, width, layout), dtype=np.float32)
    state = _Rows(values.ctypes.data, len(values), 0)
    with _initialized_modifier(modifier, flags, target_geometry) as handle:
        if not library.lens_capture_rows(
            handle, modifier.lens.native.add_callback, apply, state, width, probe.ctypes.data,
        ):
            raise LensStripError("Lensfun could not capture the whole-frame row seeds")
    return values


def _generate(library, handle, apply, state, top, count, coordinates):
    if not library.lens_coordinates(
        handle, apply, state, top, count, coordinates.shape[1], coordinates.ctypes.data,
    ):
        raise LensStripError(f"Lensfun could not generate rows {top} through {top + count - 1}")


def correct_frame(image, modifier, *, chromatic, flags, target_geometry, check, allocate_output, start_remap):
    """Run the full-frame correction. The serial retry uses smaller native strips."""
    generate_reference = (modifier.apply_subpixel_geometry_distortion if chromatic
                          else modifier.apply_geometry_distortion)
    # This also detects when the requested coordinate corrections were inactive.
    prefix = generate_reference(height=min(18, modifier.height))
    if prefix is None:
        return image
    library = _library()
    output = np.empty_like(image) if allocate_output is None else allocate_output(image.shape)
    if (output.shape != image.shape or output.dtype != np.float32 or not output.flags.c_contiguous
            or not output.flags.aligned or not output.flags.writeable or np.shares_memory(image, output)):
        raise ValueError("Lensfun output needs a separate contiguous writable float32 RGB frame")
    start_remap()
    try:
        _correct_strips(image, output, modifier, prefix, flags, target_geometry, check, library,
                        rows=COORDINATE_ROWS, parallel=True)
    except LensStripError as error:
        check()
        _report_lens_issue("lensfun_strip_failed", route="serial_strips", error=str(error))
        # Discard any partial writes by recomputing from the original source.
        # A fresh probe and modifier also recover from worker setup failures.
        _correct_strips(image, output, modifier, prefix, flags, target_geometry, check, library,
                        rows=_RETRY_ROWS, parallel=False)
    check()
    return output


def _correct_strips(image, output, modifier, prefix, flags, target_geometry, check, library, *, rows, parallel):
    from .app_memory import WORKING

    height, width = image.shape[:2]
    layout = 6 if prefix.ndim == 4 else 2
    native = modifier.lens.native
    apply = native.subpixel if layout == 6 else native.geometry
    check()
    row_values = _capture_rows(library, modifier, flags, target_geometry, apply, layout)
    base = image.ctypes.data
    destination = output.ctypes.data
    row_bytes = width * 3 * image.itemsize
    starts = range(0, height, rows)
    scratch_bytes = min(rows, height) * width * layout * image.itemsize
    workers = min(logical_cpus(), len(starts), max(1, WORKING // scratch_bytes)) if parallel else 1
    failed = Event()

    def worker(index):
        check()
        try:
            with _initialized_modifier(modifier, flags, target_geometry) as handle:
                state = _Rows(row_values.ctypes.data, height, 0)
                library.lens_replay_rows(handle, native.add_callback, state)
                coordinates = np.empty((min(rows, height), width, layout), dtype=np.float32)
                if index == 0:
                    # Check replay away from the top row against the wheel's
                    # ordinary zero-origin request. Starting at an even row
                    # preserves the whole-frame SIMD alignment for odd widths.
                    top = min(16, len(prefix) - 1) & ~1
                    count = min(len(prefix) - top, len(coordinates))
                    _generate(library, handle, apply, state, top, count, coordinates)
                    if not np.array_equal(
                        coordinates[:count].view(np.uint32).ravel(),
                        prefix[top:top + count].view(np.uint32).ravel(),
                    ):
                        raise LensStripError("Lensfun row replay differs from the zero-origin request")
                for top in starts[index::workers]:
                    if failed.is_set():
                        return
                    check()
                    count = min(rows, height - top)
                    _generate(library, handle, apply, state, top, count, coordinates)
                    if not library.lens_remap(
                        base, width, height, 0, 0, width, height, coordinates.ctypes.data,
                        layout, count * width, destination + top * row_bytes,
                    ):
                        raise ValueError("Lensfun generated invalid source coordinates")
        except Exception:
            failed.set()
            raise

    if workers == 1:
        worker(0)
    else:
        with CpuExecutor() as pool:
            for _ in pool.map(worker, range(workers)):
                pass


def remap_region(image, coordinates, *, frame_shape, origin, check):
    """Sample a source tile with coordinates expressed in the original frame."""
    source = np.ascontiguousarray(image, dtype=np.float32)
    coordinates = np.ascontiguousarray(coordinates, dtype=np.float32)
    # The C sampler assumes packed RGB and either one XY or three XY pairs
    # per output pixel. A different layout can overrun both native buffers.
    if source.ndim != 3 or source.shape[2] != 3 or min(source.shape[:2]) <= 0:
        raise ValueError("Lensfun source needs a non-empty RGB tile")
    if not ((coordinates.ndim == 3 and coordinates.shape[2:] == (2,))
            or (coordinates.ndim == 4 and coordinates.shape[2:] == (3, 2))):
        raise ValueError("Lensfun coordinate layout must be HxWx2 or HxWx3x2")
    output = np.empty((*coordinates.shape[:2], 3), dtype=np.float32)
    library = _library()
    height, width = source.shape[:2]
    frame_height, frame_width = frame_shape
    layout = 6 if coordinates.ndim == 4 else 2
    for top in range(0, len(output), COORDINATE_ROWS):
        check()
        xy = coordinates[top:top + COORDINATE_ROWS]
        if not library.lens_remap(
            source.ctypes.data, width, height, *origin, frame_width, frame_height,
            xy.ctypes.data, layout, xy.size // layout, output[top:].ctypes.data,
        ):
            raise ValueError("Lensfun mapped pixels outside their source tile")
    check()
    return output
