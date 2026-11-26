#include <stddef.h>

#ifdef _WIN32
#define API __declspec(dllexport)
#else
#define API
#endif

/* Match NumPy's float32 prefix order, edge padding, subtraction and division.
 * Keep one ring of horizontal prefixes and only store vertical prefixes.
 * Compile with contraction and fast math disabled.
 */
API void box5(const float *source, float *prefix, float *output, int height, int width) {
    enum { radius = 2, window = 5, count = 6 };
    for (int x = 0; x < width; ++x) prefix[x] = 0.0f;
    for (int row = 0; row < height + 2 * radius; ++row) {
        const int y = row < radius ? 0 : row >= height + radius ? height - 1 : row - radius;
        const float *line = source + (size_t)y * width;
        const float *previous = prefix + (size_t)row * width;
        float *next = prefix + (size_t)(row + 1) * width;
        float ring[count] = {0};
        float sum = line[0];
        int slot = 1;
        ring[slot] = sum;
        for (int x = 1; x < width + 2 * radius; ++x) {
            const int index = x < radius ? 0 : x >= width + radius ? width - 1 : x - radius;
            sum += line[index];
            const int next_slot = slot + 1 == count ? 0 : slot + 1;
            if (x + 1 >= window) {
                const int column = x + 1 - window;
                const int lower_slot = next_slot + 1 == count ? 0 : next_slot + 1;
                const float horizontal = (sum - ring[lower_slot]) / (float)window;
                next[column] = row == 0 ? horizontal : previous[column] + horizontal;
            }
            ring[next_slot] = sum;
            slot = next_slot;
        }
        if (row + 1 >= window) {
            const float *lower = prefix + (size_t)(row + 1 - window) * width;
            float *out = output + (size_t)(row + 1 - window) * width;
            for (int x = 0; x < width; ++x) out[x] = (next[x] - lower[x]) / (float)window;
        }
    }
}
