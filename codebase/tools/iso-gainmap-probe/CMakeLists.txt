cmake_minimum_required(VERSION 3.24)
project(iso_gainmap_probe LANGUAGES CXX)
# Diagnostic only. Link a separately built, pinned libavif 1.4.1.
add_executable(iso-gainmap-probe probe.cpp)
target_compile_features(iso-gainmap-probe PRIVATE cxx_std_17)
target_include_directories(iso-gainmap-probe PRIVATE "${AVIF_SOURCE}/include")
target_link_libraries(iso-gainmap-probe PRIVATE "${AVIF_IMPORT_LIBRARY}")
