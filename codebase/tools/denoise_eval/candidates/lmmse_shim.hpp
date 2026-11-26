#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <vector>

#ifdef __SSE2__
#undef __SSE2__
#endif

#define SQR(value) ((value) * (value))
#define LIM(value, low, high) domain_limit((value), (low), (high))
#define CLIP(value) domain_limit((value), 0.0f, 65535.0f)
#define M(value) (value)

namespace Glib {
struct ustring {
    static const char* compose(const char* first, const char*) { return first; }
};
}

namespace rtengine {

template<typename Value> class array2D {
    std::vector<Value> storage;
    Value* data;
    int width;
public:
    array2D(int height, int columns): storage(size_t(height) * columns), data(storage.data()), width(columns) {}
    array2D(Value* pointer, int columns): data(pointer), width(columns) {}
    Value* operator[](int row) const { return data + size_t(row) * width; }
    operator Value*() const { return data; }
};

inline float xdiv2f(float value) { return value * 0.5f; }
inline float median(float first, float second, float third) {
    return std::max(std::min(first, second), std::min(std::max(first, second), third));
}
template<size_t Count> float median(std::array<float, Count> values) {
    std::nth_element(values.begin(), values.begin() + Count / 2, values.end());
    return values[Count / 2];
}

struct Progress {
    void setProgress(float) {}
    void setProgressStr(const char*) {}
};

constexpr int LUT_CLIP_BELOW = 1;
class LUTf {
    std::vector<float> values;
    int curve;
public:
    bool signed_domain = false;
    LUTf(int size, int): values(size), curve(0) {}
    explicit LUTf(int direction): values(65536), curve(direction) {
        for (int index = 0; index < 65536; ++index) {
            double value = index / 65535.0;
            values[index] = direction == 1
                ? (value <= 0.001867 ? value * 17.0 : 1.044445 * std::exp(std::log(value) / 2.4) - 0.044445)
                : 65535.0 * (value <= 0.031746 ? value / 17.0
                    : std::exp(std::log((value + 0.044445) / 1.044445) * 2.4));
        }
    }
    void makeIdentity(float divisor = 1.f) {
        for (size_t index = 0; index < values.size(); ++index) { values[index] = index / divisor; }
    }
    float operator[](float index) const {
        if (signed_domain && curve != 0 && index > 65535.0f) {
            double value = index / 65535.0;
            return curve == 1 ? 1.044445 * std::exp(std::log(value) / 2.4) - 0.044445
                : 65535.0 * std::exp(std::log((value + 0.044445) / 1.044445) * 2.4);
        }
        if (curve == 1 && !signed_domain) {
            if (index > 65534.0f) { return values.back(); }
            index = std::max(index, 0.0f);
        }
        if (curve == 0 && !signed_domain) { index = std::max(index, 0.0f); }
        int lower = std::clamp(static_cast<int>(index), 0, 65534);
        return values[lower] + (values[lower + 1] - values[lower]) * (index - lower);
    }
};

struct Color {
    static thread_local LUTf gammatab_24_17a;
    static thread_local LUTf igammatab_24_17;
};
thread_local LUTf Color::gammatab_24_17a(1);
thread_local LUTf Color::igammatab_24_17(-1);

class RawImageSource {
public:
    int W, H;
    array2D<float> red, green, blue;
    Progress* plistener = nullptr;
    bool signed_domain;
    std::array<int, 4> pattern;
    RawImageSource(int height, int width, const int* cfa, bool is_signed)
        : W(width), H(height), red(height, width), green(height, width), blue(height, width),
          signed_domain(is_signed), pattern{cfa[0], cfa[1], cfa[2], cfa[3]} {
        Color::gammatab_24_17a.signed_domain = is_signed;
        Color::igammatab_24_17.signed_domain = is_signed;
    }
    int FC(int row, int column) const { return pattern[(row & 1) * 2 + (column & 1)]; }
    float domain_limit(float value, float lower, float upper) const {
        return signed_domain ? value : std::clamp(value, lower, upper);
    }
    float output_floor(float value) const { return signed_domain ? value : std::max(0.0f, value); }
    void igv_interpolate(int, int) { throw std::bad_alloc(); }
    void lmmse_interpolate_omp(int, int, const array2D<float>&, array2D<float>&,
                               array2D<float>&, array2D<float>&, int);
    void refinement(int);
};
}
