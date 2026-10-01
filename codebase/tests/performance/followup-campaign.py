"""Sequential GPU campaign with frozen source and read-only fixture hashes."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import os
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/performance/review/followup-2026-10-01-attempt-3'
PROJECT = Path(r'D:\Photos\Play_Raw\Fantastic light over village - AdamFromCanada\DSC00950.hdrfinisher')
RAW = PROJECT.with_suffix('.ARW')
PYTHON = str(ROOT / '.venv/Scripts/python.exe')
OUT.mkdir(parents=True, exist_ok=True)


def manifest():
    paths = [*sorted((ROOT / 'frontend').glob('*')),
             *sorted((ROOT / 'backend/hdr_finisher').glob('*.py')),
             *sorted((ROOT / 'desktop').glob('*.js')),
             ROOT / 'tests/run-in-electron.js',
             *sorted((ROOT / 'tests/performance').glob('heavy-project*.js')),
             Path(__file__), ROOT / 'tests/performance/native-mask-followup.py',
             ROOT / 'tests/tiled-direct-parity.js', PROJECT, RAW]
    return {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'at': datetime.now(timezone.utc).isoformat(),
            'sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}}


def run(label, command, extra_env=None):
    print(f'Start {label}', flush=True)
    env = {**os.environ, 'HDR_FINISHER_ELECTRON_WINDOW_SIZE': '2560x1440', **(extra_env or {})}
    with (OUT / f'{label}.log').open('w', encoding='utf-8') as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    print(f'Finished {label}: {result.returncode}', flush=True)
    if result.returncode:
        raise RuntimeError(f'{label} failed; retained {OUT / (label + ".log")}')


def electron(label, test, args=(), extra_env=None):
    run(label, ['node', 'tests/run-in-electron.js', test, *args], extra_env)


def main():
    before = manifest()
    (OUT / 'manifest-before.json').write_text(json.dumps(before, indent=2), encoding='utf-8')
    try:
        cpu_python = ['tests/test_mask_blur_strips.py', 'tests/test_mask_work.py', 'tests/test_local_adjustments.py',
                      'tests/test_render_cache.py', 'tests/test_sdr_match_inputs.py', 'tests/test_sdr_match_materialization.py',
                      'tests/test_sdr_match_state.py', 'tests/test_frontend_render_pipeline_contract.py']
        cpu_node = ['tests/tiled-cancellation-cleanup.test.js', 'tests/tiled-render-lifetime.test.js',
                    'tests/tiled-local-state.test.js', 'tests/exact-peak-singleflight.test.js',
                    'tests/native-anchor-scheduling.test.js', 'tests/highlight-anchor.test.js',
                    'tests/zoom-scope-recovery.test.js', 'tests/match-preview-recovery.test.js',
                    'tests/cpu-preview-singleflight.test.js', 'tests/mask-request-coordinator.test.js',
                    'tests/direct-mask-coordination.test.js', 'tests/mask-loader.test.js',
                    'tests/webgpu-allocation-agreement.test.js', 'tests/webgpu-memory-diagnostics.test.js']
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(run, 'cpu-python', [PYTHON, '-m', 'pytest', *cpu_python, '-q']),
                       pool.submit(run, 'cpu-node', ['node', '--test', *cpu_node])]
            for future in futures:
                future.result()
        # Isolated processes alternate old/new; no competing campaign workload.
        for index, mode in enumerate(['prior', 'current', 'current', 'prior', 'prior', 'current']):
            run(f'native-{index}-{mode}', [PYTHON, 'tests/performance/native-mask-followup.py', '--mode', mode,
                '--project', str(PROJECT), '--output', str(OUT / f'native-{index}-{mode}.json')])
        for index in range(2):
            electron(f'parity-{index}', 'tests/tiled-direct-parity.js', ['--tile-sizes', '256,512,512'],
                     {'HDR_FINISHER_DUMP_PARITY': str(OUT / f'parity-{index}')})
        electron('exact-peak', 'tests/scope-exact-peak.js')
        electron('match', 'tests/sdr-match-gpu-interaction.js')
        electron('anchor-denoise', 'tests/performance/highlight-anchor-stability.js',
                 ['--output', str(OUT / 'anchor-denoise.json')])
        electron('short-fresh', 'tests/performance/heavy-project-long-session.js',
                 ['--project', str(PROJECT), '--fresh-work', '--minutes', '.01', '--idle-minutes', '0',
                  '--output', str(OUT / 'short-fresh.json')])
        electron('endurance', 'tests/performance/heavy-project-long-session.js',
                 ['--project', str(PROJECT), '--fresh-work', '--minutes', '30', '--idle-minutes', '2',
                  '--output', str(OUT / 'endurance.json')])
    finally:
        after = manifest()
        (OUT / 'manifest-after.json').write_text(json.dumps(after, indent=2), encoding='utf-8')
        changed = [path for path, digest in before['sha256'].items() if after['sha256'].get(path) != digest]
        (OUT / 'hash-verification.json').write_text(json.dumps({'changed': changed}, indent=2), encoding='utf-8')
        if changed:
            raise RuntimeError(f'Frozen inputs changed: {changed}')


if __name__ == '__main__':
    main()
