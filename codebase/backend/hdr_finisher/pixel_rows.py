import numpy as np


PIXEL_ROWS = 128


def row_slices(height):
    """Keep the tail with its preceding band to avoid tiny BLAS calls."""
    stop = height - height % PIXEL_ROWS
    for top in range(0, height, PIXEL_ROWS):
        bottom = top + PIXEL_ROWS
        if bottom >= stop:
            yield slice(top, height)
            return
        yield slice(top, bottom)


def render_rows(image, render, *, preserve_order=False):
    """Render independent rows without full-frame temporary pixel arrays."""
    if image.ndim < 3 or len(image) < 2 * PIXEL_ROWS:
        return render(image, slice(None))
    output = None
    for rows in row_slices(len(image)):
        pixels = render(image[rows], rows)
        if output is None:
            shape = (len(image), *pixels.shape[1:])
            output = (np.empty_like(pixels, shape=shape, subok=False) if preserve_order
                      else np.empty(shape, dtype=pixels.dtype))
        output[rows] = pixels
    return output
