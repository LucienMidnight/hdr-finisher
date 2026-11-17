#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#ifdef _WIN32
#define API __declspec(dllexport)
#else
#define API
#endif

static int phase(const int *cfa, int row, int column) {
    return cfa[(row & 1) * 2 + (column & 1)];
}

static float bounded(float value, float first, float second) {
    return fminf(fmaxf(value, fminf(first, second)), fmaxf(first, second));
}

static float transport(float value) {
    return fminf(value, 65535.0f);
}

static float lab_curve(float value) {
    return value > 0.008856f ? powf(value, 1.0f / 3.0f) : 7.787f * value + 16.0f / 116.0f;
}

API int signed_ahd(const float *sensor, int height, int width, const int *cfa,
                   const float *matrix, float *output) {
    if (height < 2 || width < 2 || !sensor || !cfa || !matrix || !output) return 2;
    size_t count = (size_t)height * width;
    float *values = calloc(count, sizeof(float));
    float *green = calloc(count * 2, sizeof(float));
    float *rgb = calloc(count * 6, sizeof(float));
    int32_t *lab = calloc(count * 6, sizeof(int32_t));
    uint8_t *homogeneity = calloc(count * 2, sizeof(uint8_t));
    if (!values || !green || !rgb || !lab || !homogeneity) {
        free(values); free(green); free(rgb); free(lab); free(homogeneity);
        return 1;
    }
    for (size_t index = 0; index < count; index++) values[index] = transport(sensor[index]);
    for (int row = 2; row < height - 2; row++) {
        for (int column = 2; column < width - 2; column++) {
            size_t index = (size_t)row * width + column;
            if (phase(cfa, row, column) == 1) {
                green[index] = green[count + index] = values[index];
            } else {
                float center = values[index];
                float left = values[index - 1], right = values[index + 1];
                float up = values[index - width], down = values[index + width];
                float horizontal = floorf(((left + center + right) * 2 - values[index - 2] - values[index + 2]) / 4);
                float vertical = floorf(((up + center + down) * 2 - values[index - 2 * width] - values[index + 2 * width]) / 4);
                green[index] = bounded(horizontal, left, right);
                green[count + index] = bounded(vertical, up, down);
            }
        }
    }
    for (int direction = 0; direction < 2; direction++) {
        float *plane = green + direction * count;
        float *colors = rgb + direction * count * 3;
        int32_t *perceptual = lab + direction * count * 3;
        for (int row = 3; row < height - 3; row++) {
            for (int column = 3; column < width - 3; column++) {
                size_t index = (size_t)row * width + column;
                int channel = phase(cfa, row, column);
                float *pixel = colors + index * 3;
                pixel[channel] = values[index];
                if (channel == 1) {
                    int vertical = phase(cfa, row + 1, column), horizontal = 2 - vertical;
                    pixel[horizontal] = transport(values[index] + floorf((values[index - 1] + values[index + 1] - plane[index - 1] - plane[index + 1]) / 2));
                    pixel[vertical] = transport(values[index] + floorf((values[index - width] + values[index + width] - plane[index - width] - plane[index + width]) / 2));
                } else {
                    float difference = values[index - width - 1] + values[index - width + 1] + values[index + width - 1] + values[index + width + 1]
                                     - plane[index - width - 1] - plane[index - width + 1] - plane[index + width - 1] - plane[index + width + 1];
                    pixel[1] = plane[index];
                    pixel[2 - channel] = transport(plane[index] + floorf((difference + 1) / 4));
                }
                float xyz[3];
                for (int component = 0; component < 3; component++) {
                    float coordinate = 0.5f;
                    for (int color = 0; color < 3; color++) coordinate += matrix[component * 3 + color] * pixel[color];
                    coordinate = truncf(transport(coordinate));
                    xyz[component] = lab_curve(coordinate / 65535.0f);
                }
                perceptual[index * 3] = (int32_t)(64 * (116 * xyz[1] - 16));
                perceptual[index * 3 + 1] = (int32_t)(64 * 500 * (xyz[0] - xyz[1]));
                perceptual[index * 3 + 2] = (int32_t)(64 * 200 * (xyz[1] - xyz[2]));
            }
        }
    }
    int offsets[4] = {-1, 1, -width, width};
    for (int row = 4; row < height - 4; row++) {
        for (int column = 4; column < width - 4; column++) {
            size_t index = (size_t)row * width + column;
            int64_t luminance[2][4], chroma[2][4];
            for (int direction = 0; direction < 2; direction++) {
                int32_t *center = lab + (direction * count + index) * 3;
                for (int neighbor = 0; neighbor < 4; neighbor++) {
                    int32_t *next = center + offsets[neighbor] * 3;
                    int64_t first = (int64_t)center[1] - next[1], second = (int64_t)center[2] - next[2];
                    luminance[direction][neighbor] = llabs((int64_t)center[0] - next[0]);
                    chroma[direction][neighbor] = first * first + second * second;
                }
            }
            int64_t luminance_limit = fmin(fmax(luminance[0][0], luminance[0][1]), fmax(luminance[1][2], luminance[1][3]));
            int64_t chroma_limit = fmin(fmax(chroma[0][0], chroma[0][1]), fmax(chroma[1][2], chroma[1][3]));
            for (int direction = 0; direction < 2; direction++) {
                for (int neighbor = 0; neighbor < 4; neighbor++) {
                    homogeneity[direction * count + index] += luminance[direction][neighbor] <= luminance_limit && chroma[direction][neighbor] <= chroma_limit;
                }
            }
        }
    }
    for (int row = 0; row < height; row++) {
        for (int column = 0; column < width; column++) {
            size_t index = (size_t)row * width + column;
            if (row < 5 || column < 5 || row >= height - 5 || column >= width - 5) {
                for (int channel = 0; channel < 3; channel++) {
                    float total = 0; int samples = 0;
                    for (int vertical = -1; vertical <= 1; vertical++) {
                        for (int horizontal = -1; horizontal <= 1; horizontal++) {
                            int next_row = row + vertical, next_column = column + horizontal;
                            if (next_row >= 0 && next_row < height && next_column >= 0 && next_column < width && phase(cfa, next_row, next_column) == channel) {
                                total += values[(size_t)next_row * width + next_column]; samples++;
                            }
                        }
                    }
                    output[index * 3 + channel] = (phase(cfa, row, column) == channel ? values[index] : truncf(total / samples));
                }
            } else {
                int totals[2] = {0, 0};
                for (int direction = 0; direction < 2; direction++) {
                    for (int vertical = -1; vertical <= 1; vertical++) {
                        for (int horizontal = -1; horizontal <= 1; horizontal++) totals[direction] += homogeneity[direction * count + index + vertical * width + horizontal];
                    }
                }
                for (int channel = 0; channel < 3; channel++) {
                    float first = rgb[index * 3 + channel], second = rgb[(count + index) * 3 + channel];
                    float value = totals[0] == totals[1] ? floorf((first + second) / 2) : (totals[0] > totals[1] ? first : second);
                    output[index * 3 + channel] = value;
                }
            }
        }
    }
    free(values); free(green); free(rgb); free(lab); free(homogeneity);
    return 0;
}
