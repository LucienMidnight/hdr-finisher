"""Library-only camera transport. Grade continues to use its full-quality loader."""
from __future__ import annotations

from io import BytesIO
import os
from pathlib import Path
import time
from multiprocessing.shared_memory import SharedMemory


def decode(path, raw_name, size):
    import numpy as np
    import rawpy
    from . import raw_import
    from .library_pictures import default_look, map_negative_acescg

    started = time.perf_counter()
    memory = SharedMemory(name=raw_name)
    try:
        source = BytesIO(memory.buf[:size])
    finally:
        memory.close()
    with rawpy.imread(source) as raw:
        raw.raw_image_visible  # Force LibRaw's lazy unpack before timing it.
        unpack = (time.perf_counter() - started) * 1000
        try:
            camera = raw_import._camera_linear_metadata_from_libraw(raw)
        except raw_import._CameraLinearUnsupported:
            camera = None
        pixels = raw.postprocess(half_size=True,
            demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR,
            **({"user_wb": [1.] * 4, "no_auto_scale": True} if camera else {"use_camera_wb": True}),
            no_auto_bright=True, use_auto_wb=False,
            output_color=rawpy.ColorSpace.raw if camera else rawpy.ColorSpace.sRGB,
            gamma=(1., 1.), output_bps=16, highlight_mode=rawpy.HighlightMode.Clip)
        if camera:
            matrix = camera.camera_to_acescg * (camera.as_shot_wb * 65535 /
                (camera.white_level - camera.black_level))[None, :]
            threshold = (camera.white_level - camera.black_level) / 65535 * .999
        else:
            from .color import _LINEAR_SRGB_TO_ACESCG
            matrix = _LINEAR_SRGB_TO_ACESCG.T
            threshold = np.full(3, .999)
        h, w = pixels.shape[:2]
        sample = pixels[::max(1, h // 128), ::max(1, w // 128)].astype(np.float32) / 65535
        clipped = np.any(sample >= threshold, axis=2)
        sample = map_negative_acescg(np.einsum("...j,ij->...i", sample, matrix.astype(np.float32), optimize=False))
        sample[clipped] = np.max(sample[clipped], axis=1)[:, None]
        grade = default_look(sample, None, True, Path(path).suffix.lower()).model_dump(mode="json")
        output = SharedMemory(create=True, size=(pixels.nbytes + 3) // 4 * 4)
        # Direct ndarray -> shared memory; no pickled picture crosses processes.
        np.ndarray(pixels.shape, dtype=np.uint16, buffer=output.buf)[:] = pixels
        return output, {"route": "camera-raw-gpu", "raw_width": w, "raw_height": h,
            "source_width": w * 2, "source_height": h * 2, "matrix": matrix.tolist(),
            "threshold": threshold.tolist(), "adjustments": grade, "white": 203,
            "has_reference": False, "unpack_ms": unpack,
            "decode_ms": (time.perf_counter() - started) * 1000, "transport_bytes": pixels.nbytes}


def worker_main(connection, foreground):
    # Environment changes are confined to these processes, never Grade's process.
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[name] = "1"
    from .library_worker import _lower_priority
    _lower_priority()
    # Warm imports before reporting ready, not inside the first viewed decode.
    import rawpy
    from .library_pictures import default_look
    connection.send({"ready": True, "pid": os.getpid()})
    try:
        while True:
            job = connection.recv()
            if job is None:
                return
            output = None
            try:
                output, meta = decode(job["path"], job["raw_name"], job["size"])
                connection.send({"meta": meta, "name": output.name})
                # Parent opens the output before we release the Windows mapping.
                connection.recv()
            except Exception as error:
                connection.send({"error": str(error)})
            finally:
                if output is not None:
                    output.close()
    except (EOFError, OSError):
        pass
    finally:
        connection.close()
