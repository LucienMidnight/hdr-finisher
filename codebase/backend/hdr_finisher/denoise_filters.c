#ifdef _WIN32
#define API __declspec(dllexport)
#define RESTRICT __restrict
#else
#define API
#define RESTRICT restrict
#endif

static int boundary(int position, int length, int reflect_low, int reflect_high) {
    if (position < 0) return reflect_low ? -position : 0;
    if (position >= length) return reflect_high ? 2 * length - 2 - position : length - 1;
    return position;
}

static float spline(float first, float second, float centre, float fourth, float fifth) {
    float value = 0.0f;
    value += first * 0.0625f;
    value += second * 0.25f;
    value += centre * 0.375f;
    value += fourth * 0.25f;
    value += fifth * 0.0625f;
    return value;
}

API void atrous(const float *RESTRICT input, float *RESTRICT vertical, float *RESTRICT output,
                int height, int width, int channels, int step,
                int top, int bottom, int left, int right) {
    int stride = width * channels;
    int reach = 2 * step;
    for (int row = 0; row < height; row++) {
        const float *first = input + boundary(row - reach, height, top, bottom) * stride;
        const float *second = input + boundary(row - step, height, top, bottom) * stride;
        const float *centre = input + row * stride;
        const float *fourth = input + boundary(row + step, height, top, bottom) * stride;
        const float *fifth = input + boundary(row + reach, height, top, bottom) * stride;
        float *target = vertical + row * stride;
        for (int index = 0; index < stride; index++)
            target[index] = spline(first[index], second[index], centre[index], fourth[index], fifth[index]);
    }
    int offset = step * channels;
    for (int row = 0; row < height; row++) {
        const float *source = vertical + row * stride;
        float *target = output + row * stride;
        for (int column = 0; column < width;) {
            if (column == reach && column < width - reach) {
                for (int index = column * channels; index < stride - 2 * offset; index++)
                    target[index] = spline(source[index - 2 * offset], source[index - offset], source[index],
                                           source[index + offset], source[index + 2 * offset]);
                column = width - reach;
                continue;
            }
            int first = boundary(column - reach, width, left, right) * channels;
            int second = boundary(column - step, width, left, right) * channels;
            int fourth = boundary(column + step, width, left, right) * channels;
            int fifth = boundary(column + reach, width, left, right) * channels;
            for (int channel = 0; channel < channels; channel++) {
                int index = column * channels + channel;
                target[index] = spline(source[first + channel], source[second + channel], source[index],
                                       source[fourth + channel], source[fifth + channel]);
            }
            column++;
        }
    }
}

static float mean7(float first, float second, float third, float centre,
                   float fifth, float sixth, float seventh) {
    float value = 0.0f;
    value += first;
    value += second;
    value += third;
    value += centre;
    value += fifth;
    value += sixth;
    value += seventh;
    return value / 7.0f;
}

API void box7(const float *RESTRICT input, float *RESTRICT vertical, float *RESTRICT output,
              int height, int width, int channels) {
    int stride = width * channels;
    for (int row = 0; row < height; row++) {
        const float *first = input + boundary(row - 3, height, 0, 0) * stride;
        const float *second = input + boundary(row - 2, height, 0, 0) * stride;
        const float *third = input + boundary(row - 1, height, 0, 0) * stride;
        const float *centre = input + row * stride;
        const float *fifth = input + boundary(row + 1, height, 0, 0) * stride;
        const float *sixth = input + boundary(row + 2, height, 0, 0) * stride;
        const float *seventh = input + boundary(row + 3, height, 0, 0) * stride;
        float *target = vertical + row * stride;
        for (int index = 0; index < stride; index++)
            target[index] = mean7(first[index], second[index], third[index], centre[index],
                                  fifth[index], sixth[index], seventh[index]);
    }
    for (int row = 0; row < height; row++) {
        const float *source = vertical + row * stride;
        float *target = output + row * stride;
        for (int column = 0; column < width;) {
            if (column == 3 && column < width - 3) {
                for (int index = column * channels; index < stride - 3 * channels; index++)
                    target[index] = mean7(source[index - 3 * channels], source[index - 2 * channels],
                                          source[index - channels], source[index], source[index + channels],
                                          source[index + 2 * channels], source[index + 3 * channels]);
                column = width - 3;
                continue;
            }
            int first = boundary(column - 3, width, 0, 0) * channels;
            int second = boundary(column - 2, width, 0, 0) * channels;
            int third = boundary(column - 1, width, 0, 0) * channels;
            int fifth = boundary(column + 1, width, 0, 0) * channels;
            int sixth = boundary(column + 2, width, 0, 0) * channels;
            int seventh = boundary(column + 3, width, 0, 0) * channels;
            for (int channel = 0; channel < channels; channel++) {
                int index = column * channels + channel;
                target[index] = mean7(source[first + channel], source[second + channel], source[third + channel],
                                      source[index], source[fifth + channel], source[sixth + channel],
                                      source[seventh + channel]);
            }
            column++;
        }
    }
}

/* NumPy rounds the ramp span from the original scalar bounds before division. */
static float ramp(float value, float low, float span) {
    float t = (value - low) / span;
    return t < 0.0f ? 0.0f : t > 1.0f ? 1.0f : t;
}

static float maximum(float a, float b) {
    return a > b || a != a ? a : b;
}

static float minimum(float a, float b) {
    return a < b || a != a ? a : b;
}

API void colour_pair(const float *first, const float *second,
                     const float *core, float *first_x, float *first_y, float *second_x,
                     float *second_y, float *total, float *low, float *high,
                     int height, int width, int stride) {
    for (int row = 0; row < height; row++) {
        for (int x = 0; x < width; x++) {
            int i = row * width + x;
            int sample = row * stride + 2 * x;
            first_x[i] = core[2 * i] - first[sample];
            first_y[i] = core[2 * i + 1] - first[sample + 1];
            second_x[i] = core[2 * i] - second[sample];
            second_y[i] = core[2 * i + 1] - second[sample + 1];
            for (int channel = 0; channel < 2; channel++) {
                int j = 2 * i + channel;
                float pair = (first[sample + channel] + second[sample + channel]) * 0.5f;
                total[j] += pair;
                low[j] = minimum(low[j], pair);
                high[j] = maximum(high[j], pair);
            }
        }
    }
}

API void colour_deltas(const float *core, const float *chroma, const float *total,
                       const float *low, const float *high, float *delta, float *pixel_delta,
                       int count) {
    for (int i = 0; i < count; i++) {
        float surrounding = ((total[i] - low[i]) - high[i]) * 0.5f;
        delta[i] = core[i] - surrounding;
        pixel_delta[i] = chroma[i] - surrounding;
    }
}

API void colour_repair(const float *core, const float *chroma, const float *closest,
                       const float *signal, const float *relative, const float *pixel_relative,
                       const float *limit, const float *dark, const float *peak,
                       const float *delta, const float *pixel_delta, float *output, int count) {
    for (int i = 0; i < count; i++) {
        float rel = relative[i], pixel = pixel_relative[i];
        float isolated = ramp(closest[i] / maximum(signal[i], 1e-7f), .1f, .55f);
        float protection = 1.0f - (1.0f - isolated) * ramp(rel, 5.0f, 7.0f);
        float strength = maximum(ramp(rel, 1.5f, 3.5f),
                                 ramp(pixel, 2.5f, 2.5f) * ramp(rel, .65f, 1.85f));
        float weight = (strength * protection) * limit[i];
        float fine = .8f * ramp(pixel, 1.0f, 3.0f);
        float compact = (dark[i] * ramp(pixel / maximum(peak[i], 1e-6f), .55f, .4f))
                        * ramp(pixel, 1.8f, 2.2f);
        for (int channel = 0; channel < 2; channel++) {
            int j = 2 * i + channel;
            float moderate = (delta[j] + fine * (chroma[j] - core[j])) * weight;
            output[j] = moderate + compact * (pixel_delta[j] * limit[i] - moderate);
        }
    }
}

API void colour_guides(const float *local, const float *luma_noise, const float *peak,
                       const float *background, const float *texture, const float *sharp,
                       const float *fringe, const float *noise,
                       float *limit, float *dark, float *edge_weight, int count) {
    for (int i = 0; i < count; i++) {
        float highlight = ramp(peak[i], .065f, .06f);
        float light = maximum(local[i], 0.0f);
        float texture_relative = texture[i] / maximum(background[i] + 3.0f * luma_noise[i], 1e-6f);
        float sharp_relative = sharp[i] / maximum(light + 4.0f * luma_noise[i], 1e-6f);
        limit[i] = (1.0f - .97f * highlight) *
                   (1.0f - ramp(texture_relative, .045f, .105f) * ramp(background[i], .004f, .011f));
        dark[i] = 1.0f - ramp(light, .006f, .008f);
        edge_weight[i] = (.45f * highlight) * ramp(sharp_relative, .06f, .18f) *
                         ramp(fringe[i] / noise[i], 3.0f, 5.0f);
    }
}
