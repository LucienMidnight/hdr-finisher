cmake_minimum_required(VERSION 3.24)
project(hdrf_avif_decode LANGUAGES CXX)
# Build against the pinned libavif 1.4.1 used by the bundled AVIF utilities.
add_executable(hdrf-avif-decode decode.cpp)
target_compile_features(hdrf-avif-decode PRIVATE cxx_std_17)
target_include_directories(hdrf-avif-decode PRIVATE "${AVIF_SOURCE}/include")
target_link_libraries(hdrf-avif-decode PRIVATE "${AVIF_IMPORT_LIBRARY}")

find_package(OpenMP REQUIRED)
target_link_libraries(hdrf-avif-decode PRIVATE OpenMP::OpenMP_CXX)
