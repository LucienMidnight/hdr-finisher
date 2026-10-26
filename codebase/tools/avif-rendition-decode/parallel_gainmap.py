"""Apply the narrow HDRF row-parallel patch to a pinned libavif v1.4.1 tree.

Usage: python parallel_gainmap.py path/to/libavif
Build that tree with CMAKE_C_FLAGS=/openmp on MSVC (or -fopenmp elsewhere).
Pixels retain exactly the upstream arithmetic. CLLI requests remain serial.
"""
from pathlib import Path
import sys


def patch(root):
    path = Path(root) / "src/gainmap.c"
    data = path.read_bytes()
    ending = "\r\n" if b"\r\n" in data else "\n"
    text = data.decode().replace("\r\n", "\n")
    if "HDRF independent reconstruction rows" in text:
        return
    old = """    for (uint32_t j = 0; j < height; ++j) {
        for (uint32_t i = 0; i < width; ++i) {
            float basePixelRGBA[4];"""
    # The other matching loop is the weight-zero conversion: patch only the
    # reconstruction loop following alternateOffset, never map resampling.
    offset = text.index("const float alternateOffset[3]")
    prefix, body = text[:offset], text[offset:]
    assert body.count(old) == 1
    body = body.replace(old, """    // HDRF independent reconstruction rows; metadata reductions stay serial.
#ifdef _OPENMP
#pragma omp parallel for if(clli == NULL && height >= 512)
#endif
    for (int64_t row = 0; row < (int64_t)height; ++row) {
        const uint32_t j = (uint32_t)row;
        for (uint32_t i = 0; i < width; ++i) {
            float basePixelRGBA[4];""", 1)
    assert "if (toneMappedLinear > rgbMaxLinear)" in body
    body = body.replace("if (toneMappedLinear > rgbMaxLinear)", "if (clli != NULL && toneMappedLinear > rgbMaxLinear)", 1)
    body = body.replace("rgbSumLinear += pixelRgbMaxLinear;", "if (clli != NULL) rgbSumLinear += pixelRgbMaxLinear;", 1)
    path.write_bytes((prefix + body).replace("\n", ending).encode())


if __name__ == "__main__":
    patch(sys.argv[1])
