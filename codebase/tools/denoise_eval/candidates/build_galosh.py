"""Offline serial FP32 build. Pinned originals and Apache notices stay untouched.

Only the build copy gains frame-global dark-anchor injection; its original
IRLS mathematics also builds the global fit entrypoint. No system packages.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess

SOURCE = Path(__file__).parent/'vendor/galosh'
BUILD = Path(__file__).resolve().parents[3]/'output/denoise-v1/galosh-build'
BINARY = BUILD/('galosh-serial.exe' if os.name == 'nt' else 'galosh-serial')
PIN = '11de0593cc8091933ad76d1d6d873f7dee537f15'


def build():
    BUILD.mkdir(parents=True, exist_ok=True)
    source = (SOURCE/'galosh_raw_cpu.c').read_text()
    for name in ('wht_decompose_8x8', 'wht_reconstruct_8x8'):
        if source.count(name+'(') != 1:
            raise ValueError('Expected unused SSE helper changed')
        start = source.index('static inline void '+name+'(')
        opening = source.index('{', start)
        depth, end = 1, opening+1
        while depth:
            depth += (source[end] == '{') - (source[end] == '}')
            end += 1
        source = source[:start]+source[end:]
    marker = 'ch_dark_ref[0], ch_dark_ref[1], ch_dark_ref[2], ch_dark_ref[3]);'
    if source.count(marker) != 2:
        raise ValueError('Pinned dark-anchor injection sites changed')
    source = source.replace(marker, marker+'\n    if(eval_hold_dark) memcpy(ch_dark_ref, eval_dark_ref, sizeof(ch_dark_ref));')
    (BUILD/'reference.c').write_text(source)
    shutil.copyfile(SOURCE/'galosh_cpu.h', BUILD/'galosh_cpu.h')
    (BUILD/'omp.h').write_text('#include <time.h>\nstatic int omp_get_max_threads(void){return 1;}\n'
                             'static int omp_get_thread_num(void){return 0;}\n'
                             'static double omp_get_wtime(void){struct timespec t; timespec_get(&t,TIME_UTC); return t.tv_sec+t.tv_nsec*1e-9;}\n')
    for name in ('xmmintrin.h', 'emmintrin.h', 'pmmintrin.h'):
        (BUILD/name).write_text('')
    original = (SOURCE/'galosh_raw_cpu.c').read_text()
    core = original[original.index('  /* ============== [LATEST: GALOSH_RAW_O] Phase 2'):]
    irls = core[core.index('    const double s_init'):core.index('    if(g_verbose)')]
    program = '''#include <stdio.h>
static int eval_hold_dark=0;
static float eval_dark_ref[4];
#define main reference_main
#include "reference.c"
#undef main
int main(int argc, char **argv) {
  if(argc == 7 && strcmp(argv[1], "fit") == 0) {
    const int width=atoi(argv[3]), height=atoi(argv[4]);
    if(width<=0 || height<=0 || (width&1) || (height&1)) return 2;
    const size_t npixels=(size_t)width*height;
    float *in=dt_alloc_align_float(npixels), *in_gat=dt_alloc_align_float(npixels);
    if(!in || !in_gat) return 3;
    FILE *file=fopen(argv[2],"rb");
    if(!file || fread(in,sizeof(float),npixels,file)!=npixels) return 4;
    fclose(file);
    g_galosh_alpha_override=atof(argv[5]); g_galosh_sigma_sq_override=atof(argv[6]);
    const galosh_noise_params_t np=galosh_estimate_noise(in,width,height);
    for(size_t index=0;index<npixels;index++) in_gat[index]=gat_forward(in[index],np.alpha,np.sigma_sq);
    const float unified_sigma=1.0f;
    float ch_dark_ref[4]={0,0,0,0};
''' + irls + '''
    printf("%.9g %.9g %.9g %.9g %.9g %.9g %.9g\\n", np.alpha,np.sigma_sq,unified_sigma,ch_dark_ref[0],ch_dark_ref[1],ch_dark_ref[2],ch_dark_ref[3]);
    dt_free_align(in);dt_free_align(in_gat);return 0;
  }
  const char *dark=getenv("GALOSH_EVAL_DARK");
  if(dark) { if(sscanf(dark,"%f,%f,%f,%f", &eval_dark_ref[0],&eval_dark_ref[1],&eval_dark_ref[2],&eval_dark_ref[3])!=4) return 5; eval_hold_dark=1; }
  return reference_main(argc,argv);
}
'''
    (BUILD/'driver.c').write_text(program)
    command = ['clang', '-O3', '-std=gnu11', '-Wno-unknown-pragmas', '-I', str(BUILD),
               str(BUILD/'driver.c'), *([] if os.name == 'nt' else ['-lm']), '-o', str(BINARY)]
    subprocess.run(command, check=True)
    receipt = dict(commit=PIN, command=command, serial=True, fp32=True,
                   modifications=['local OpenMP serial shim', 'empty unused SSE includes',
                                  'unused SSE helper definitions omitted from build copy',
                                  'global native IRLS anchor held across tiles', 'unified sigma fixed to 1 for both modes'],
                   sha256={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in SOURCE.iterdir()})
    (BUILD/'build.json').write_text(json.dumps(receipt, indent=2))
    print(BINARY)


if __name__ == '__main__':
    build()
