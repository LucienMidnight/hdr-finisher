#include <jxl/decode.h>
#include <iostream>
#include <iterator>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

static void profile(JxlDecoder* decoder, JxlColorProfileTarget target) {
  JxlColorEncoding c{};
  if (JxlDecoderGetColorAsEncodedProfile(decoder, target, &c) != JXL_DEC_SUCCESS) {
    std::cout << "null"; return;
  }
  std::cout << "{\"color_space\":" << c.color_space
    << ",\"white_point\":" << c.white_point
    << ",\"primaries\":" << c.primaries
    << ",\"transfer_function\":" << c.transfer_function
    << ",\"gamma\":" << c.gamma << "}";
}

int main() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
#endif
  std::vector<unsigned char> input((std::istreambuf_iterator<char>(std::cin)), {});
  JxlDecoder* d = JxlDecoderCreate(nullptr);
  if (!d) return 1;
  JxlBasicInfo b{};
  bool basic = false, color = false;
  if (JxlDecoderSubscribeEvents(d, JXL_DEC_BASIC_INFO | JXL_DEC_COLOR_ENCODING) == JXL_DEC_SUCCESS &&
      JxlDecoderSetInput(d, input.data(), input.size()) == JXL_DEC_SUCCESS) {
    JxlDecoderCloseInput(d);
    for (;;) {
      const auto status = JxlDecoderProcessInput(d);
      if (status == JXL_DEC_BASIC_INFO) {
        basic = JxlDecoderGetBasicInfo(d, &b) == JXL_DEC_SUCCESS;
      } else if (status == JXL_DEC_COLOR_ENCODING && basic) {
        std::cout << "{\"schema_version\":1,\"libjxl_version\":" << JxlDecoderVersion()
          << ",\"width\":" << b.xsize << ",\"height\":" << b.ysize
          << ",\"bits_per_sample\":" << b.bits_per_sample
          << ",\"exponent_bits_per_sample\":" << b.exponent_bits_per_sample
          << ",\"intensity_target\":" << b.intensity_target
          << ",\"uses_original_profile\":" << (b.uses_original_profile ? "true" : "false")
          << ",\"data_color_encoding\":";
        profile(d, JXL_COLOR_PROFILE_TARGET_DATA);
        std::cout << ",\"original_color_encoding\":";
        profile(d, JXL_COLOR_PROFILE_TARGET_ORIGINAL);
        std::cout << "}\n";
        color = true; break;
      } else { break; }
    }
  }
  JxlDecoderDestroy(d);
  return color ? 0 : 1;
}
