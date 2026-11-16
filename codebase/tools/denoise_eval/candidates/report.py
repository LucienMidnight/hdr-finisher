"""Rebuild the classical comparison from retained harness/guard JSON, not logs."""
from pathlib import Path
import html
import json
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT/'codebase/output/denoise-v1'
NAMES = {'off':'Off', 'denoise_v2':'Current default',
         'denoise_v2_tuned:factory':'Current tuned PSNR', 'denoise_v2_tuned:sharp':'Current tuned sharp',
         'darktable_profiled:half':'DT 0.50', 'darktable_profiled:three_quarters':'DT 0.75',
         'darktable_profiled:factory':'DT 1.00', 'galosh:half':'GALOSH cal 0.50',
         'galosh:three_quarters':'GALOSH cal 0.75', 'galosh:factory':'GALOSH cal 1.00',
         'galosh:blind_half':'GALOSH blind 0.50', 'galosh:blind_three_quarters':'GALOSH blind 0.75',
         'galosh:blind':'GALOSH blind 1.00'}


def name(value):
    return NAMES.get(value.removeprefix('tools.denoise_eval.candidates.'), value)


def number(value, places=3):
    return 'N/A' if value is None else f'{value:.{places}f}'


def values(rows, *path):
    result = []
    for row in rows:
        item = row
        for key in path:
            item = item.get(key) if isinstance(item, dict) else None
        if isinstance(item, (int, float)) and np.isfinite(item):
            result.append(item)
    return result


def mean(rows, *path):
    available = values(rows, *path)
    return float(np.mean(available)) if available else None


def table(headers, rows):
    return '| '+' | '.join(headers)+' |\n| '+' | '.join(['---']*len(headers))+' |\n'+''.join('| '+' | '.join(map(str, row))+' |\n' for row in rows)+'\n'


def data():
    return json.loads((OUTPUT/'results-full.json').read_text())


def metric_tables(result):
    sections = []
    for iso in (1600, 6400, 25600):
        fidelity, detail = [], []
        for adapter in result['adapters']:
            rows = [case['adapters'][adapter] for case in result['cases'] if case['clean'] and case['metadata'].get('iso') == iso]
            display_row = [name(adapter)]
            for lane in ('sdr', 'hdr'):
                display_row.extend(number(mean(rows, lane, key), places) for key, places in [('psnr_db', 2), ('ssim', 3)])
                display_row.append('/'.join(number(mean(rows, lane, 'colour_difference', key)) for key in ('mean', 'p99')))
            fidelity.append(display_row)
            energies = [row['texture']['energy_ratio'] for row in rows if row.get('texture')]
            ranges = []
            for index in range(4):
                available = [item[index] for item in energies if item[index] is not None]
                ranges.append(f'{min(available):.2f}–{max(available):.2f}' if available else 'N/A')
            detail.append([name(adapter), '/'.join(number(mean(rows, 'flat_residual_sdr', key)) for key in ('luma_std', 'chroma_std')),
                           '/'.join(number(mean(rows, 'flat_residual_sdr', key)) for key in ('luma_ratio', 'chroma_ratio')),
                           ' / '.join(ranges), number(mean(rows, 'edge', 'mtf50_ratio')),
                           number(mean(rows, 'edge', 'halo_extra_fraction'), 4),
                           '/'.join(number(mean(rows, 'colour_bleed', key)) for key in ('mean', 'p99'))])
        sections.append(f'### ISO {iso}\n\n'+table(['Method', 'SDR dB', 'SDR SSIM', 'ΔE00 mean/p99', 'HDR dB', 'HDR SSIM', 'ΔE ITP mean/p99'], fidelity)
                        +table(['Method', 'Flat σ Y/C', 'Flat Y/C ratio', 'Texture min–max per band (.5–1 / 1–2 / 2–4 / 4–8)', 'MTF50 ratio', 'Extra halo', 'Bleed mean/p99'], detail))
    return '\n'.join(sections)


def diagnostics_table(result):
    rows = []
    for adapter, diagnostic in result['diagnostics'].items():
        tile = diagnostic['tile_grid']
        exposure = diagnostic['exposure']
        rows.append([name(adapter), '/'.join(number(tile['shifted_sdr'][key], 6) for key in ('mean', 'p99')),
                     '/'.join(number(tile['shifted_hdr'][key], 6) for key in ('mean', 'p99')),
                     '/'.join(number(max(row['sdr'][key] for row in exposure)) for key in ('mean', 'p99')),
                     '/'.join(number(max(row['hdr'][key] for row in exposure)) for key in ('mean', 'p99')),
                     diagnostic['safety']['status']])
    return table(['Method', 'Shift ΔE00 mean/p99', 'Shift ΔE ITP mean/p99', 'Worst exposure ΔE00 mean/p99', 'Worst exposure ΔE ITP mean/p99', 'RGB sentinel'], rows)


def real_table(result):
    rows = []
    sources = sorted({case['metadata']['source'] for case in result['cases'] if not case['clean']})
    for source in sources:
        for adapter in result['adapters']:
            samples = [case['adapters'][adapter] for case in result['cases'] if not case['clean'] and case['metadata']['source'] == source]
            rows.append([source, name(adapter), '/'.join(number(mean(samples, 'flat_residual_sdr', key)) for key in ('luma_std', 'chroma_std')),
                         '/'.join(number(mean(samples, 'flat_residual_sdr', key)) for key in ('luma_ratio', 'chroma_ratio')),
                         number(mean(samples, 'method_noise_edge_correlation'))])
    return table(['Real RAW (four crops)', 'Method', 'Flat σ Y/C', 'Flat Y/C ratio', 'Removed-noise edge correlation'], rows)


def frame_table():
    rows = []
    for path in sorted(OUTPUT.glob('full-*.json')):
        if path.name.endswith('-guard.json'):
            continue
        frame = json.loads(path.read_text())
        guard = json.loads(path.with_name(path.stem+'-guard.json').read_text())
        rows.append([frame['method'], frame['photo'], f"{np.prod(frame['shape'])/1e6:.2f}",
                     *[number(frame[key], 2) for key in ('prep_seconds', 'denoise_seconds', 'development_seconds', 'total_seconds')],
                     number(max(guard['peak_tree_rss_bytes'], frame['peak_parent_rss_bytes'])/1e9, 3)])
    return table(['Method', 'RAW', 'MP', 'Prep s', 'Denoise s', 'Develop s', 'Wall s incl inventory', 'Peak RSS GB¹'], rows)


def append_review():
    result = data()
    folder = OUTPUT/'review'
    rows = []
    for photo in ('IMG_0790', '2025_0730_1331_3'):
        for role in ('flat', 'texture', 'edge', 'shadow'):
            figures = []
            for method in ('off', 'darktable', 'galosh'):
                filename = f'frame-{photo}-{role}-{method}.png'
                if (folder/filename).exists():
                    figures.append(f'<figure><img loading="lazy" src="{filename}"><figcaption>{method}</figcaption></figure>')
            rows.append(f'<h2>{photo} · {role} · native 256px crop</h2><div class="row">'+''.join(figures)+'</div>')
    chart = tradeoff(result)
    page = folder/'index.html'
    content = page.read_text()
    content = content.replace('Images fit within 256 px;', 'Synthetic/comparison thumbnails fit within 128 px; native full-frame review crops below are 256 px;')
    marker = '<section id="classical-native-review">'
    if marker in content:
        content = content[:content.index(marker)]+'</body></html>'
    content = content.replace('</body>', marker+'<h1>Classical trade-offs and full-native crops</h1>'+chart+''.join(rows)+'</section></body>')
    page.write_text(content)


def tradeoff(result):
    sections = []
    groups = [('darktable_profiled', 'DT'), ('galosh', 'GALOSH calibrated'), ('galosh-blind', 'GALOSH blind')]
    for iso in ('1600', '6400', '25600'):
        points = []
        for adapter in result['adapters']:
            if 'darktable_profiled' not in adapter and 'galosh:' not in adapter:
                continue
            rows = [case['adapters'][adapter] for case in result['cases'] if case['clean'] and str(case['metadata'].get('iso')) == iso]
            points.append((adapter, mean(rows, 'sdr', 'psnr_db'), mean(rows, 'edge', 'mtf50_ratio')))
        if not points:
            continue
        references = []
        for adapter in result['adapters']:
            if adapter not in ('denoise_v2', 'tools.denoise_eval.candidates.denoise_v2_tuned:factory', 'tools.denoise_eval.candidates.denoise_v2_tuned:sharp'):
                continue
            rows = [case['adapters'][adapter] for case in result['cases'] if case['clean'] and str(case['metadata'].get('iso')) == iso]
            references.append((adapter, mean(rows, 'sdr', 'psnr_db'), mean(rows, 'edge', 'mtf50_ratio')))
        combined = points+references
        low = min(point[1] for point in combined)-1
        high = max(point[1] for point in combined)+1
        right = max(1.2, max(point[2] for point in combined))
        horizontal_scale = 570/right
        graphics = []
        for index, (group, label) in enumerate(groups):
            selected = [point for point in points if (('darktable_profiled' in point[0]) if group == 'darktable_profiled' else (('galosh:' in point[0]) and (('blind' in point[0]) == (group == 'galosh-blind'))))]
            coords = [(40+point[2]*horizontal_scale, 210-(point[1]-low)/(high-low)*175, point) for point in selected]
            graphics.append(f'<polyline class="series series-{index}" points="'+ ' '.join(f'{horizontal:.1f},{vertical:.1f}' for horizontal, vertical, point in coords)+'"/>')
            for horizontal, vertical, point in coords:
                graphics.append(f'<circle class="point series-{index}" tabindex="0" cx="{horizontal:.1f}" cy="{vertical:.1f}" r="5"><title>{html.escape(name(point[0]))}: {point[1]:.2f} dB, MTF {point[2]:.3f}</title></circle>')
        for index, point in enumerate(references):
            horizontal = 40+point[2]*horizontal_scale
            vertical = 210-(point[1]-low)/(high-low)*175
            graphics.append(f'<text class="reference" tabindex="0" x="{horizontal:.1f}" y="{vertical:.1f}">{("D", "P", "S")[index]}<title>{html.escape(name(point[0]))}: {point[1]:.2f} dB, MTF {point[2]:.3f}</title></text>')
        threshold = 40+.9*horizontal_scale
        ticks = ''.join(f'<text x="{40+tick*horizontal_scale:.1f}" y="230">{tick:.1f}</text>' for tick in (0., .3, .6, .9, right))
        sections.append(f'<h2>ISO {iso}: sharpness versus SDR PSNR</h2><svg class="tradeoff" viewBox="0 0 680 270" role="img" aria-label="Strength trade-off, higher and farther right are better"><path class="axis" d="M40 25V210H620"/><path class="target" d="M{threshold:.1f} 25V210"/><text x="40" y="258">MTF50 ratio; dotted threshold 0.90</text><text x="45" y="25">{high:.1f} dB</text><text x="45" y="205">{low:.1f} dB</text>'+ticks+''.join(graphics)+'</svg>')
    return '<p>Connected dots: DT (accent), GALOSH calibrated (text), GALOSH blind (muted); strengths 0.50 → 0.75 → 1.00. Hover/focus a mark for exact values. D = current default, P = tuned PSNR, S = tuned sharp.</p><style>.tradeoff{width:100%}.tradeoff text{fill:var(--text);font-size:var(--font-size-xs)}.tradeoff .axis{stroke:var(--text);fill:none}.tradeoff .target{stroke:var(--text);stroke-dasharray:4 4}.tradeoff .series{fill:none}.tradeoff .series-0{stroke:var(--accent);color:var(--accent)}.tradeoff .series-1{stroke:var(--text);color:var(--text)}.tradeoff .series-2{stroke:var(--muted);color:var(--muted)}.tradeoff .point{fill:currentColor}</style>'+''.join(sections)


if __name__ == '__main__':
    append_review()
