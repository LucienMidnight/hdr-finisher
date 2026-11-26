"""Rebuild the pilot trial's compact review and auditable Markdown tables."""
import json

import numpy as np
from PIL import Image

from tools.denoise_eval.candidates.pilot_wiener_measure import OUTPUT
from tools.denoise_eval.datasets.summarize import summarize
from tools.denoise_eval.run import review_page


def short(name):
    if name == 'off':
        return 'Off'
    if name == 'denoise_v2':
        return 'Current default'
    module, factory = name.split(':')
    if module.endswith('denoise_v2_tuned'):
        return 'Current tuned' if factory == 'factory' else 'Current sharp'
    if module.endswith('rawnind'):
        return 'RawNIND Bayer'
    return factory.replace('_', ' ')


def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join(['---']*len(headers)) + ' |',
                       *['| ' + ' | '.join(map(str, row)) + ' |' for row in rows]]) + '\n'


def mean(rows, *path):
    values = []
    for row in rows:
        value = row
        for key in path:
            if value is None:
                break
            value = value[key]
        if value is not None:
            values.append(value)
    return float(np.mean(values))


def pair_tables():
    source = OUTPUT/'pairs/results-pairs.json'
    if not source.exists():
        return
    results = json.loads(source.read_text())
    summary = summarize(results)
    (OUTPUT/'pairs/summary.json').write_text(json.dumps(summary, indent=2, allow_nan=False)+'\n')
    chunks = []
    for population in ('held-out', 'seen by RawNIND'):
        rows = [row for row in summary['rows'] if row['population'] == population and row['iso_band'] == 'all ISOs']
        fidelity, half, detail = [], [], []
        for row in rows:
            def value(field, digits=3):
                measured = row['metrics'].get(field)
                return f"{measured['mean']:.{digits}f}" if measured else '—'
            full_row = [short(row['adapter']), f"{row['scenes']}/{row['captures']}/{row['crops']}"]
            half_row = [short(row['adapter'])]
            for lane in ('sdr', 'hdr'):
                full_row.extend([value(lane+'.psnr_db', 2), value(lane+'.ssim'),
                                 value(lane+'.colour_difference.mean')+'/'+value(lane+'.colour_difference.p99')])
                half_row.extend([value('half_resolution.'+lane+'.psnr_db', 2),
                                 value('half_resolution.'+lane+'.colour_difference.mean')+'/'+value('half_resolution.'+lane+'.colour_difference.p99')])
            fidelity.append(full_row)
            half.append(half_row)
            detail.append([short(row['adapter']),
                           value('flat_residual_sdr.luma_std')+'/'+value('flat_residual_sdr.chroma_std'),
                           value('flat_residual_sdr.luma_ratio')+'/'+value('flat_residual_sdr.chroma_ratio'),
                           '; '.join(value(f'texture.energy_ratio.{index}') for index in range(4)),
                           value('edge.local_gradient_energy_ratio'),
                           value('colour_bleed.mean')+'/'+value('colour_bleed.p99'),
                           value('method_noise_edge_correlation')])
        chunks.extend([f'### Public pairs, {population}: full resolution\n',
                       table(['Method', 'Scenes/captures/crops', 'SDR dB', 'SSIM', 'ΔE00 mean/p99', 'HDR dB', 'SSIM', 'ΔE ITP mean/p99'], fidelity),
                       f'### Public pairs, {population}: half resolution\n',
                       table(['Method', 'SDR dB', 'ΔE00 mean/p99', 'HDR dB', 'ΔE ITP mean/p99'], half),
                       f'### Public pairs, {population}: noise and structure proxies\n',
                       table(['Method', 'Flat σ Y/C', 'Flat ratio Y/C', 'Texture ratio per band', 'Local edge energy/clean', 'Bleed mean/p99', 'Removed-edge correlation'], detail)])
        intervals = []
        for row in summary['rows']:
            if row['population'] != population or row['iso_band'] == 'all ISOs':
                continue
            numbers = [row['metrics'][key]['mean'] for key in ('sdr.psnr_db', 'half_resolution.sdr.psnr_db', 'hdr.psnr_db', 'half_resolution.hdr.psnr_db')]
            intervals.append([row['iso_band'], short(row['adapter']), f"{row['scenes']}/{row['captures']}/{row['crops']}", *[f'{number:.2f}' for number in numbers]])
        chunks.extend([f'### Public pairs, {population}: ISO bands\n',
                       table(['ISO band', 'Method', 'Scenes/captures/crops', 'SDR full dB', 'SDR half dB', 'HDR full dB', 'HDR half dB'], intervals)])
    (OUTPUT/'pairs/tables.md').write_text('\n'.join(chunks))
    review_rows = []
    for index, case in enumerate(results['cases']):
        metadata = case['metadata']
        population = 'HELD-OUT' if metadata['held_out'] else 'SEEN BY RAWNIND'
        labels = ['Noisy', 'Clean truth']+[short(name) for name in results['adapters']]
        review_rows.append(dict(name=case['name'], metadata=f"{population}; scene {metadata['scene_id']}; ISO {metadata['iso']}",
                                images=[(label, f'crop-{index:03d}-{column}.png') for column, label in enumerate(labels)]))
    review_page(review_rows, OUTPUT/'pairs/review', results)
    page = OUTPUT/'pairs/review/index.html'
    page.write_text(page.read_text().replace('<h1>', '<p><a href="../../review/index.html">Synthetic and native-photo review</a>. Scenes explicitly marked seen were used to train RawNIND, not independent validation.</p><h1>', 1))
    if any(not (page.parent/file).is_file() for row in review_rows for _, file in row['images']):
        raise ValueError('Missing public-pair review image')
    if sum(path.stat().st_size for path in page.parent.iterdir() if path.is_file()) > 20_000_000:
        raise ValueError('Public-pair review exceeds budget')


def main():
    results = json.loads((OUTPUT/'results-full.json').read_text())
    names = list(results['adapters'])
    chunks = []
    for iso in (1600, 6400, 25600):
        cases = [case for case in results['cases'] if case['clean'] and case['metadata'].get('iso') == iso]
        fidelity, half, detail = [], [], []
        for name in names:
            rows = [case['adapters'][name] for case in cases]
            row = [short(name)]
            half_row = [short(name)]
            for lane in ('sdr', 'hdr'):
                row.extend([f"{mean(rows, lane, 'psnr_db'):.2f}", f"{mean(rows, lane, 'ssim'):.3f}",
                            f"{mean(rows, lane, 'colour_difference', 'mean'):.3f}/{mean(rows, lane, 'colour_difference', 'p99'):.3f}"])
                half_row.extend([f"{mean(rows, 'half_resolution', lane, 'psnr_db'):.2f}",
                                 f"{mean(rows, 'half_resolution', lane, 'colour_difference', 'mean'):.3f}/{mean(rows, 'half_resolution', lane, 'colour_difference', 'p99'):.3f}"])
            fidelity.append(row)
            half.append(half_row)
            edge = next(value['edge'] for value in rows if 'edge' in value)
            textures = np.asarray([value['texture']['energy_ratio'] for value in rows if value.get('texture')])
            flats = [value['flat_residual_sdr'] for value in rows]
            detail.append([short(name),
                           '/'.join(f'{np.median([value[key] for value in flats]):.3f}' for key in ('luma_std', 'chroma_std')),
                           '/'.join(f'{np.median([value[key] for value in flats]):.3f}' for key in ('luma_ratio', 'chroma_ratio')),
                           '; '.join(f'{column.min():.3f}–{column.max():.3f}' for column in textures.T),
                           f"{edge['mtf50_ratio']:.3f}", f"{100*edge['halo_extra_fraction']:.2f}%",
                           f"{mean(rows, 'colour_bleed', 'mean'):.3f}/{mean(rows, 'colour_bleed', 'p99'):.3f}"])
        chunks.extend([f'### ISO {iso}: full resolution\n',
                       table(['Method', 'SDR dB', 'SSIM', 'ΔE00 mean/p99', 'HDR dB', 'SSIM', 'ΔE ITP mean/p99'], fidelity),
                       f'### ISO {iso}: half resolution (2×2 area)\n',
                       table(['Method', 'SDR dB', 'ΔE00 mean/p99', 'HDR dB', 'ΔE ITP mean/p99'], half),
                       f'### ISO {iso}: noise, structure and edges\n',
                       table(['Method', 'Flat σ Y/C', 'Flat ratio Y/C', 'Texture min–max per band', 'MTF50/clean', 'Extra halo', 'Bleed mean/p99'], detail)])
    real_rows = []
    for case in results['cases']:
        if case['clean']:
            continue
        for name in names:
            value = case['adapters'][name]
            flat = value['flat_residual_sdr']
            real_rows.append([case['name'], short(name), f"{flat['luma_ratio']:.3f}/{flat['chroma_ratio']:.3f}",
                              f"{value['method_noise_edge_correlation']:.3f}"])
    chunks.extend(['## Real-crop diagnostics\n', table(['Case', 'Method', 'Flat ratio Y/C', 'Removed-edge correlation'], real_rows)])
    if (OUTPUT/'controls.json').exists():
        controls = json.loads((OUTPUT/'controls.json').read_text())
        rows = []
        for iso in (1600, 6400, 25600):
            for pilot in ('self', 'tuned', 'bayer'):
                for direct in (False, True):
                    for control in ('amount', 'color_noise'):
                        for setting in (0., .5, 1.):
                            selected = [value for value in controls if value['iso'] == iso and value['pilot'] == pilot
                                        and value['direct_chroma'] == direct and value['control'] == control and value['value'] == setting]
                            fabric = next(value for value in selected if 'fabric' in value['case'])
                            edge = next(value for value in selected if 'slanted-edge' in value['case'])
                            flat = fabric['metrics']['flat_residual_sdr']
                            edge_flat = edge['metrics']['flat_residual_sdr']
                            rows.append([iso, pilot+(' luma' if direct else ' both'), control, setting,
                                         f"{fabric['metrics']['sdr']['psnr_db']:.2f}",
                                         f"{flat['luma_ratio']:.3f}/{flat['chroma_ratio']:.3f}",
                                         f"{edge_flat['luma_ratio']:.3f}/{edge_flat['chroma_ratio']:.3f}",
                                         f"{edge['metrics']['edge']['mtf50_ratio']:.3f}",
                                         f"{1000*float(np.mean([value['resolve_seconds'] for value in selected])):.1f}"])
        chunks.extend(['## Control sweep: fabric fidelity and edge sharpness\n',
                       table(['ISO', 'Variant', 'Control', 'Value', 'Fabric SDR dB', 'Fabric residual Y/C', 'Edge-flat Y/C', 'MTF50', 'Resolve ms'], rows)])
    (OUTPUT/'tables.md').write_text('\n'.join(chunks))
    folder = OUTPUT/'review'
    rows = []
    for index, case in enumerate(results['cases']):
        labels = ['Noisy', 'Clean truth'] if case['clean'] else ['Noisy']
        labels += [short(name) for name in names]
        rows.append(dict(name=case['name'], metadata=f"ISO {case['metadata'].get('iso')}; {case['shape']}",
                         images=[(label, f'crop-{index:03d}-{column}.png') for column, label in enumerate(labels)]))
    native_rows = []
    for path in sorted(OUTPUT.glob('native-*.json')):
        native_rows.extend(json.loads(path.read_text()).get('review_rows', []))
    if (OUTPUT/'inspection.json').exists():
        native_rows.extend(json.loads((OUTPUT/'inspection.json').read_text()))
    review_page(rows+native_rows, folder, results)
    for path in folder.glob('crop-*.png'):
        with Image.open(path) as image:
            image.thumbnail((80, 80), Image.Resampling.LANCZOS)
            image.save(path)
    page = folder/'index.html'
    note = '<p>Full-set thumbnails are 80 px; native photo crops are 256 px. All measurements use the original arrays, not these thumbnails. Both-Wiener attenuates only source coefficients; direct-pilot chroma is an explicit exception.</p>'
    page.write_text(page.read_text().replace('<h1>', note+'<h1>', 1))
    if (OUTPUT/'pairs/review/index.html').exists():
        page.write_text(page.read_text().replace('<h1>', '<p><a href="../pairs/review/index.html">Public noisy/clean pairs: held-out and seen-by-RawNIND crops</a></p><h1>', 1))
    pair_tables()
    links = [file for row in rows+native_rows for _, file in row['images']]
    missing = [file for file in links if not (folder/file).is_file()]
    if missing:
        raise ValueError(f'Missing review assets: {missing}')
    size = sum(path.stat().st_size for path in folder.iterdir() if path.is_file())
    if size > 20_000_000:
        raise ValueError(f'Review exceeds budget: {size}')
    print(json.dumps(dict(review_bytes=size, linked_images=len(links), tables=str(OUTPUT/'tables.md'))))


if __name__ == '__main__':
    main()
