"""Rebuild the pilot trial's compact review and auditable Markdown tables."""
import json

import numpy as np
from PIL import Image

from tools.denoise_eval.candidates.pilot_wiener_measure import OUTPUT
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
        native_rows.extend(json.loads(path.read_text())['review_rows'])
    if (OUTPUT/'inspection.json').exists():
        native_rows.extend(json.loads((OUTPUT/'inspection.json').read_text()))
    review_page(rows+native_rows, folder, results)
    for path in folder.glob('crop-*.png'):
        with Image.open(path) as image:
            image.thumbnail((96, 96), Image.Resampling.LANCZOS)
            image.save(path)
    page = folder/'index.html'
    note = '<p>Full-set thumbnails are 96 px; native photo crops are 256 px. All measurements use the original arrays, not these thumbnails. Both-Wiener attenuates only source coefficients; direct-pilot chroma is an explicit exception.</p>'
    page.write_text(page.read_text().replace('<h1>', note+'<h1>', 1))
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
