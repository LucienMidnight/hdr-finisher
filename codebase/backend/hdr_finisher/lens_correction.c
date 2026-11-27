#include <math.h>
#include <stddef.h>

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif

/* Lensfun 0.3.4 C ABI. Use the entry points from the same wheel that owns
   the profile, without building against a second copy of Lensfun. */
typedef void (*CoordCallback)(void *, float *, int);
typedef void (*AddCallback)(void *, CoordCallback, int, void *, size_t);
typedef int (*ApplyCoordinates)(void *, float, float, int, int, float *);

typedef struct {
    float *values;
    int height;
    int row;
} LensRows;

static void capture_y(void *data, float *coordinates, int count)
{
    LensRows *rows = data;
    if (count > 0 && rows->row < rows->height)
        rows->values[rows->row] = coordinates[1];
    ++rows->row;
}

static void replay_y(void *data, float *coordinates, int count)
{
    LensRows *rows = data;
    if (rows->row < rows->height) {
        float y = rows->values[rows->row];
        for (int i = 0; i < count; ++i)
            coordinates[2 * i + 1] = y;
    }
    ++rows->row;
}

EXPORT int lens_capture_rows(void *modifier, AddCallback add, ApplyCoordinates apply,
                             LensRows *rows, int width, float *probe)
{
    /* Priority -1 precedes scale and distortion. Capture on a separate
       modifier because registration persists for its entire lifetime. */
    rows->row = 0;
    add(modifier, capture_y, -1, rows, 0);
    return apply(modifier, 0, 0, width, rows->height, probe) && rows->row == rows->height;
}

EXPORT void lens_replay_rows(void *modifier, AddCallback add, LensRows *rows)
{
    add(modifier, replay_y, -1, rows, 0);
}

EXPORT int lens_coordinates(void *modifier, ApplyCoordinates apply, LensRows *rows,
                            int top, int count, int width, float *coordinates)
{
    rows->row = top;
    /* Keep the original x origin and row width for Lensfun's accumulation
       and SIMD tail. The callback supplies the whole-frame y for each row. */
    return apply(modifier, 0, 0, width, count, coordinates) && rows->row == top + count;
}

EXPORT int lens_remap(const float *source, int source_width, int source_height,
                      int origin_x, int origin_y, int frame_width, int frame_height,
                      const float *coordinates, int layout, size_t pixels, float *output)
{
    int max_x = frame_width - 1;
    int max_y = frame_height - 1;
    int channel_step = layout == 6 ? 2 : 0;
    for (size_t i = 0; i < pixels; ++i, coordinates += layout, output += 3) {
        for (int channel = 0; channel < 3; ++channel) {
            double x = coordinates[channel * channel_step];
            double y = coordinates[channel * channel_step + 1];
            if (x < 0.0)
                x = 0.0;
            else if (x > max_x)
                x = max_x;
            if (y < 0.0)
                y = 0.0;
            else if (y > max_y)
                y = max_y;
            if (isnan(x) || isnan(y))
                return 0;

            /* Clipped coordinates are nonnegative. Compute weights before
               subtracting a tile origin, just as float32 minus int32 in
               NumPy produced float64. Preserve the two sums and the cast. */
            int x0 = (int)x;
            int y0 = (int)y;
            double wx = x - x0;
            double wy = y - y0;
            int x1 = (x0 < max_x ? x0 + 1 : max_x) - origin_x;
            int y1 = (y0 < max_y ? y0 + 1 : max_y) - origin_y;
            x0 -= origin_x;
            y0 -= origin_y;
            if (x0 < 0 || x1 >= source_width || y0 < 0 || y1 >= source_height)
                return 0;
            const float *row0 = source + (size_t)y0 * source_width * 3 + channel;
            const float *row1 = source + (size_t)y1 * source_width * 3 + channel;
            double top = row0[(size_t)x0 * 3] * (1.0 - wx) + row0[(size_t)x1 * 3] * wx;
            double bottom = row1[(size_t)x0 * 3] * (1.0 - wx) + row1[(size_t)x1 * 3] * wx;
            output[channel] = (float)(top * (1.0 - wy) + bottom * wy);
        }
    }
    return 1;
}

/* Library planar bands: same ordered four-term NumPy interpolation, with
   double weights and a single float cast. No full-image working arrays. */
EXPORT void lens_sample_plane(const float *source, int width, int height,
                              const float *xs, const float *ys, size_t count, float *output)
{
    for (size_t i = 0; i < count; ++i) {
        double x = fmin(fmax(xs[i], 0), width - 1);
        double y = fmin(fmax(ys[i], 0), height - 1);
        int x0 = (int)x, y0 = (int)y;
        int x1 = x0 < width - 1 ? x0 + 1 : x0;
        int y1 = y0 < height - 1 ? y0 + 1 : y0;
        double fx = x - x0, fy = y - y0;
        output[i] = (float)(source[(size_t)y0*width+x0]*(1-fx)*(1-fy)
                         + source[(size_t)y0*width+x1]*fx*(1-fy)
                         + source[(size_t)y1*width+x0]*(1-fx)*fy
                         + source[(size_t)y1*width+x1]*fx*fy);
    }
}
