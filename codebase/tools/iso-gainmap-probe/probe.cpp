// Investigation tool, never used by Library/Grade/export/Proof.
// Public libavif API only; retain native integer precision and exact fractions.
#include <avif/avif.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

using Clock = std::chrono::steady_clock;
static void check(avifResult r) {
    if (r != AVIF_RESULT_OK) throw std::runtime_error(avifResultToString(r));
}
static double ms(Clock::time_point t) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}
template<class F> static void fraction(std::ostream& o, F f) {
    o << '[' << f.n << ',' << f.d << ']';
}
template<class F> static void triple(std::ostream& o, const char* key, const F* f) {
    o << ",\"" << key << "\":[";
    for (int c = 0; c < 3; ++c) { if (c) o << ','; fraction(o, f[c]); }
    o << ']';
}
static void imageInfo(std::ostream& o, const avifImage* i) {
    o << "{\"width\":" << i->width << ",\"height\":" << i->height
      << ",\"depth\":" << i->depth << ",\"yuv_format\":" << i->yuvFormat
      << ",\"range\":" << i->yuvRange << ",\"cicp\":[" << i->colorPrimaries
      << ',' << i->transferCharacteristics << ',' << i->matrixCoefficients
      << "],\"icc_bytes\":" << i->icc.size << ",\"transform_flags\":" << i->transformFlags
      << ",\"irot\":" << int(i->irot.angle) << ",\"imir\":" << int(i->imir.axis) << '}';
}
static void writeRGB(const std::filesystem::path& path, const avifRGBImage& rgb) {
    std::ofstream out(path, std::ios::binary);
    if (!out.write(reinterpret_cast<const char*>(rgb.pixels), size_t(rgb.rowBytes) * rgb.height))
        throw std::runtime_error("Could not write probe pixels");
}
static void extract(const std::filesystem::path& path, const avifImage* image) {
    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, image); // Same RGBA/native depth as gainmap.c.
    check(avifRGBImageAllocatePixels(&rgb));
    check(avifImageYUVToRGB(image, &rgb));
    writeRGB(path, rgb);
    avifRGBImageFreePixels(&rgb);
}
// Match tonemap -> output YUV -> PNG's 16-bit RGB, without PNG encoding.
static void compatibleHDR(const std::filesystem::path& path, const avifImage* base, float headroom) {
    const avifGainMap* g = base->gainMap;
    avifPixelFormat alt = g->altPlaneCount == 1 ? AVIF_PIXEL_FORMAT_YUV400
        : std::min(base->yuvFormat, g->image->yuvFormat);
    const float b = float(g->baseHdrHeadroom.n) / g->baseHdrHeadroom.d;
    const float a = float(g->alternateHdrHeadroom.n) / g->alternateHdrHeadroom.d;
    const bool toBase = (headroom <= b && b <= a) || (headroom >= b && b >= a);
    const bool toAlt = (headroom <= a && a <= b) || (headroom >= a && a >= b);
    avifPixelFormat format = toBase ? base->yuvFormat : toAlt ? alt
        : std::min(std::min(base->yuvFormat, g->image->yuvFormat), alt);
    avifImage* target = avifImageCreate(base->width, base->height, 10, format);
    target->colorPrimaries = AVIF_COLOR_PRIMARIES_BT2020;
    target->transferCharacteristics = AVIF_TRANSFER_CHARACTERISTICS_SMPTE2084;
    target->matrixCoefficients = AVIF_MATRIX_COEFFICIENTS_BT2020_NCL;
    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, target);
    avifDiagnostics diag;
    check(avifImageApplyGainMap(base, g, headroom, target->colorPrimaries,
        target->transferCharacteristics, &rgb, nullptr, &diag));
    check(avifImageRGBToYUV(target, &rgb));
    avifRGBImageFreePixels(&rgb);
    avifRGBImageSetDefaults(&rgb, target);
    rgb.depth = 16;
    rgb.format = AVIF_RGB_FORMAT_RGB;
    check(avifRGBImageAllocatePixels(&rgb));
    check(avifImageYUVToRGB(target, &rgb));
    writeRGB(path, rgb);
    avifRGBImageFreePixels(&rgb);
    avifImageDestroy(target);
}
int main(int argc, char** argv) try {
    if (argc != 4) throw std::runtime_error("Usage: iso-gainmap-probe source.avif output-folder hdr-headroom");
    const auto start = Clock::now();
    const std::filesystem::path output(argv[2]);
    std::filesystem::create_directories(output);
    avifDecoder* decoder = avifDecoderCreate();
    decoder->imageContentToDecode = AVIF_IMAGE_CONTENT_ALL;
    check(avifDecoderSetIOFile(decoder, argv[1]));
    check(avifDecoderParse(decoder));
    check(avifDecoderNextImage(decoder));
    const double decodeMS = ms(start);
    avifImage* base = decoder->image;
    avifGainMap* g = base->gainMap;
    if (!g || !g->image) throw std::runtime_error("No decoded auxiliary gain map");
    std::ofstream info(output / "metadata.json");
    info << "{\"libavif\":\"" << avifVersion() << "\",\"base\":";
    imageInfo(info, base);
    info << ",\"map\":"; imageInfo(info, g->image);
    info << ",\"base_headroom\":"; fraction(info, g->baseHdrHeadroom);
    info << ",\"alternate_headroom\":"; fraction(info, g->alternateHdrHeadroom);
    triple(info, "gain_map_min", g->gainMapMin);
    triple(info, "gain_map_max", g->gainMapMax);
    triple(info, "gain_map_gamma", g->gainMapGamma);
    triple(info, "base_offset", g->baseOffset);
    triple(info, "alternate_offset", g->alternateOffset);
    info << ",\"use_base_color_space\":" << (g->useBaseColorSpace ? "true" : "false")
         << ",\"alternate_cicp\":[" << g->altColorPrimaries << ',' << g->altTransferCharacteristics
         << ',' << g->altMatrixCoefficients << "],\"alternate_icc_bytes\":" << g->altICC.size
         << ",\"alternate_depth\":" << g->altDepth << ",\"alternate_planes\":" << g->altPlaneCount
         << ",\"alternate_range\":" << g->altYUVRange
         << ",\"orientation_applied\":false,\"gain_map_applied_to_samples\":false"
         << ",\"layout\":\"RGBA, native uint8 or little-endian uint16\"";
    auto phase = Clock::now();
    extract(output / "base.rgba", base);
    extract(output / "map-native.rgba", g->image);
    avifImage* scaled = avifImageCreateEmpty();
    avifCropRect rect = {0, 0, g->image->width, g->image->height};
    check(avifImageSetViewRect(scaled, g->image, &rect));
    avifDiagnostics diag;
    if (scaled->width != base->width || scaled->height != base->height)
        check(avifImageScale(scaled, base->width, base->height, &diag));
    extract(output / "map-full.rgba", scaled);
    avifImageDestroy(scaled);
    const double extractMS = ms(phase);
    phase = Clock::now();
    // Caller supplies inspect's two-decimal display, as the current CPU route does.
    const float headroom = std::stof(argv[3]);
    compatibleHDR(output / "hdr.rgb16", base, headroom);
    info << ",\"decode_ms\":" << decodeMS << ",\"extract_write_ms\":" << extractMS
         << ",\"hdr_reconstruct_convert_write_ms\":" << ms(phase)
         << ",\"total_ms\":" << ms(start) << '}';
    avifDecoderDestroy(decoder);
    return 0;
} catch (const std::exception& e) {
    std::cerr << e.what() << '\n';
    return 1;
}
