// Raw transport for the bundled libavif gain-map reconstruction.
// Preserve tonemap's 10-bit YUV round trip and 16-bit RGB samples, without
// compressing and decoding a full-resolution PNG. No colour math is replaced.
#include <avif/avif.h>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <chrono>
#ifdef _OPENMP
#include <omp.h>
#endif
static void check(avifResult r) {
    if(r!=AVIF_RESULT_OK)throw std::runtime_error(avifResultToString(r));
}
static void writeRGB(const std::filesystem::path& path,const avifRGBImage& rgb) {
    std::ofstream out(path,std::ios::binary);
    if(!out.write(reinterpret_cast<const char*>(rgb.pixels),size_t(rgb.rowBytes)*rgb.height))
        throw std::runtime_error("Could not write reconstructed pixels");
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
int main(int argc,char** argv) try {
    if(argc!=4 && argc!=5)throw std::runtime_error("Usage: hdrf-avif-decode input.avif output.rgb16 headroom [threads]");
    avifDecoder* decoder=avifDecoderCreate();
    const int cores = std::max(1u,std::thread::hardware_concurrency());
    const int threads = argc == 5 ? std::max(1,std::min(cores,std::stoi(argv[4]))) : cores;
    decoder->maxThreads=threads;
#ifdef _OPENMP
    omp_set_num_threads(threads);
#endif
    const auto start=std::chrono::steady_clock::now();
    decoder->imageContentToDecode=AVIF_IMAGE_CONTENT_ALL;
    check(avifDecoderSetIOFile(decoder,argv[1]));
    check(avifDecoderParse(decoder));
    check(avifDecoderNextImage(decoder));
    const avifImage* base=decoder->image;
    if(!base->gainMap || !base->gainMap->image || base->icc.size || base->gainMap->altICC.size ||
       base->transformFlags || base->alphaPlane)
        throw std::runtime_error("This AVIF retains the ordinary rendition decoder");
    const auto decoded=std::chrono::steady_clock::now();
    compatibleHDR(argv[2],base,std::stof(argv[3]));
    const auto finished=std::chrono::steady_clock::now();
    std::cerr<<"HDRF AVIF rows threads="<<threads<<" decode_ms="
      <<std::chrono::duration<double,std::milli>(decoded-start).count()
      <<" reconstruction_ms="<<std::chrono::duration<double,std::milli>(finished-decoded).count()<<'\n';
    std::cout<<"{\"width\":"<<base->width<<",\"height\":"<<base->height<<"}";
    avifDecoderDestroy(decoder);
    return 0;
} catch(const std::exception& e) {
    std::cerr<<e.what()<<'\n';return 1;
}
