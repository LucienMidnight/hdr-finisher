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
