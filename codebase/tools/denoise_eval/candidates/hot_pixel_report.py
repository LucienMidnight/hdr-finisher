"""Regenerate the small local hot-pixel decision gallery from measured receipts."""
import html
import json
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output/denoise-v1/hot-pixel'
LABELS = (('off', 'Off'), ('current_denoise', 'Current Denoise'),
          ('hot_pixel', 'Hot pixel filter'), ('hot_pixel_denoise', 'Filter + Denoise'))


def read(name):
    return json.loads((OUTPUT / (name+'.json')).read_text())


def gallery(title, folder, detail):
    folder = Path(folder)
    images = ''.join(f'<figure><figcaption>{html.escape(label)}</figcaption>'
                     f'<a href="{html.escape(str((folder/(key+".png")).relative_to(OUTPUT)))}">'
                     f'<img loading="lazy" src="{html.escape(str((folder/(key+".png")).relative_to(OUTPUT)))}" '
                     f'alt="{html.escape(title+": "+label)}"></a></figure>' for key, label in LABELS)
    return f'<section><h3>{html.escape(title)}</h3><p>{html.escape(detail)}</p><div class="crops">{images}</div></section>'


def main():
    generated, decisions, corpus = read('generated'), read('point-decisions'), read('corpus')
    sections = ['<h1>Single-photo hot pixel filter — research only</h1>',
                '<p>November 17, 2026 · MacBook Neo · No app or default changes</p>',
                '<h2>Decision: leave off by default</h2>',
                '<p>Two reviewed airborne Canon sparks survive unchanged, but sufficiently sharp/faint real light '
                'can look isolated above sensor noise. The filter changes 41 unconfirmed sites in 15 supported '
                'corpus RAWs. These are not 41 proven physical defects.</p>',
                '<h2>Known real point sources changed</h2>',
                '<p>Independent generated point cases, not a real-world prevalence estimate. '
                'Each row has 216 trials: 3 brightnesses × 9 subpixel offsets × 4 CFA phases × clean/noisy.</p>',
                '<table><thead><tr><th>Optical spread</th><th>White</th><th>Warm spark</th><th>Narrow red</th><th>Narrow blue</th></tr></thead><tbody>']
    for kind, width in (('gaussian', .8), ('airy', 1.2), ('airy', .65), ('airy', .35)):
        cells = []
        for colour in ('white', 'warm_spark', 'narrow_red', 'narrow_blue'):
            cases = [item for item in generated['points'] if item['psf'] == kind and item['width'] == width and item['colour'] == colour]
            count = sum(item['any_point_changed'] for item in cases)
            cells.append(f'<td>{count} / {len(cases)}</td>')
        sections.append(f'<tr><th>{kind} {width} px</th>{"".join(cells)}</tr>')
    sections.extend(['</tbody></table>', '<p>Gaussian width is sigma; Airy width is first-zero radius. '
                     'The 0.35 px Airy case is an unusually sharp, near-diffraction-limited f/2-class lens, '
                     'with a full-area pixel aperture and no anti-aliasing filter.</p>',
                     '<h2>Effect on public pairs</h2>',
                     '<p>Fresh Off and shipping-default Denoise; unweighted means of per-crop SDR PSNR / mean ΔE2000. '
                     'Held-out and seen remain separate. Runtime filter never reads clean truth.</p>',
                     '<table><thead><tr><th>Split</th>' + ''.join(f'<th>{label}</th>' for _, label in LABELS) + '</tr></thead><tbody>'])
    for phase in ('heldout', 'seen'):
        cases = read(phase)['cases']
        cells = []
        for label, _ in LABELS:
            values = [item['adapters'][label]['sdr'] for item in cases]
            cells.append(f'<td>{statistics.mean(item["psnr_db"] for item in values):.2f} / '
                         f'{statistics.mean(item["colour_difference"]["mean"] for item in values):.3f}</td>')
        sections.append(f'<tr><th>{phase} ({len(cases)})</th>{"".join(cells)}</tr>')
    sections.extend(['</tbody></table>', '<h2>Real light and fine scene detail</h2>'])
    for item in decisions['real']:
        sections.append(gallery(item['case'], item['path'],
                                f'{item["photo"]}, sensor xywh {item["crop_xywh"]}, '
                                f'+{item["exposure_stops"]:g} stops; {item["repairs"]["repaired"]} changed sensor samples. '
                                'Scene-detail examples are not labelled physical sensor defects.'))
    sections.append('<h2>Three unconfirmed Canon hot-like sites</h2>')
    canon = next(item for item in corpus['photos'] if item['photo'] == 'IMG_0790.CR2')
    for item in canon['crops']:
        if item['kind'] == 'changed':
            sections.append(gallery(f'Canon x{item["site"]["x"]}, y{item["site"]["y"]}', item['path'],
                                    'Single-exposure candidate only; no persistent-defect truth. Fixed +4-stop display.'))
    sections.append('<h2>Known generated defects</h2>')
    for item in generated['positive_controls']:
        sections.append(gallery(f'Background {item["background"]}', OUTPUT/'injected'/str(item['background']),
                                f'{item["detected"]} / {item["expected"]} injected hot sites found; '
                                f'{item["false_positives"]} other sites changed. Noise can veto a genuine defect.'))
    sections.append('<h2>Generated light, including false positives</h2>')
    for item in decisions['synthetic']:
        source = item['source_case']
        sections.append(gallery(item['case'], item['path'],
                                f'Peak {source["amplitude"]}, phase {source["phase"]}, offset {source["offset_yx"]}, '
                                f'noise {source["noise"]}; {item["repairs"]["repaired"]} changed sensor sites. Known light, not defects.'))
    sections.append('<h2>Whole corpus candidates</h2><table><thead><tr><th>Photo</th><th>Changed</th><th>Light veto</th><th>Clip veto</th></tr></thead><tbody>')
    for item in corpus['photos']:
        values = item.get('repairs')
        cells = ''.join(f'<td>{values[key]}</td>' for key in ('repaired', 'light_veto', 'clipping_veto')) if values else '<td colspan="3">Unsupported CFA / colour bridge</td>'
        sections.append(f'<tr><th>{html.escape(item["photo"])}</th>{cells}</tr>')
    sections.append('</tbody></table><p>No verified star-field RAW is in the approved corpus. '
                    'Night bulb/sign, fire sparks, sunset glints and tree sky holes are shown above; '
                    'synthetic stars cover controlled optics, not camera/lens qualification.</p>')
    stylesheet = '''body{font-family:var(--font-body);font-size:var(--font-size-lg);line-height:var(--line-height-normal);color:var(--text);background:var(--app);margin:var(--font-size-xl)}
    h1{font-size:var(--font-size-3xl)}h2{font-size:var(--font-size-2xl)}h3{font-size:var(--font-size-xl)}h1,h2,h3{font-weight:var(--font-weight-medium)}
    section{margin-block:var(--font-size-3xl)}p{max-width:80ch;color:var(--body)}a{color:var(--accent)}
    .crops{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--font-size-sm);max-width:1100px}figure{margin:0}img{max-width:100%;image-rendering:pixelated}figcaption{font-size:var(--font-size-md)}
    table{border-collapse:collapse;max-width:100%}td,th{text-align:left;padding:var(--font-size-xs);border-bottom:1px solid var(--border);overflow-wrap:anywhere}th{font-weight:var(--font-weight-medium)}
    @media(max-width:650px){.crops{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:var(--font-size-sm)}td,th{padding:calc(var(--font-size-xs)/2)}}'''
    (OUTPUT/'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                                    '<title>Hot pixel research review</title><link rel="stylesheet" href="../../../frontend/visual-tokens.css">'
                                    '<style>'+stylesheet+'</style><main>'+''.join(sections)+'</main></html>')
    print(OUTPUT/'index.html')


if __name__ == '__main__':
    main()
