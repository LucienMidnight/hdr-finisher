"""Build the local 100% comparison page after sharpen_review.py compare."""
from pathlib import Path
import json

out = Path(__file__).resolve().parents[1] / 'output/sharpen-review'
recipe = json.loads((out / 'recipe.json').read_text())
body = []
for source in recipe['sources']:
    stem = Path(source).stem
    for lane in ('sdr', 'hdr'):
        body.append(f'<h2>{stem} — {lane.upper()} — 100%</h2><div class="crops">')
        for variant, values in recipe['variants'].items():
            ext = 'avif' if lane == 'hdr' else 'png'
            caption = f'{variant.title()}: Amount {values[0]}, Radius {values[1]}, Threshold {values[2]}'
            body.append(f'<figure><figcaption>{caption}</figcaption><img width="512" height="512" src="{stem}-{lane}-{variant}.{ext}" alt="{caption}"></figure>')
        body.append('</div>')
rows = []
for result in json.loads((out / 'export-agreement.json').read_text()):
    for lane in ('hdr', 'sdr'):
        metric = result[lane]
        rows.append(f"<tr><td>{result['source']}</td><td>{result['variant']}</td><td>{lane}</td><td>{metric['mean']:.3f}</td><td>{metric['p999']:.3f}</td><td>{'Pass' if metric['passed'] else 'Outside tolerance'}</td></tr>")
html = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Sharpen review — October 27, 2026</title><style>
body{margin:28px;background:#202124;color:#eee;font:16px/1.5 system-ui}p{max-width:1100px}a{color:#9cc9ff}.crops{display:flex;gap:16px;overflow:auto;padding-bottom:16px}figure{margin:0;flex:0 0 512px}figcaption{height:52px}img{display:block;width:512px;height:512px;max-width:none}table{border-collapse:collapse}td,th{border:1px solid #777;padding:6px;text-align:left}button{font:inherit;padding:8px}h2{margin-top:36px}</style>
<h1>Sharpen at 100%</h1><p>Two of Steve’s badminton RAWs, opened read-only with the loader’s default RAW development, without saved grades or Denoise. Each crop is 512 original pixels; use browser zoom 100%. No resizing. Identical crop coordinates and developed source in every column. A 32-pixel margin is processed before cropping to prevent filter boundary artifacts.</p>
<p>Off and Default are deliberately identical: the app defaults to Amount 0, Radius 0.8, Threshold 10. Working adds Amount 80. Strong uses Amount 200, Radius 3, Threshold 0. Texture and Clarity are zero. HDR highlight compression is enabled with a 1000-nit target. These are CPU reference renders, not screen captures of GPU preview.</p>
<p>HDR rows use PQ AVIF (BT.2020, 203-nit reference white); view on an HDR-capable display/browser. SDR rows use sRGB PNG. On an SDR display use the button for an explicitly tone-mapped HDR comparison; that fallback is not the HDR output.</p><button id="fallback">Show tone-mapped HDR PNG fallback</button>
<p>Observed: stronger edges and shirt detail at 100%, but strong settings amplify skin noise. This method increases local contrast; it does not recover missing focus or motion detail. Small-radius Sharpen can disappear at Fit because its scaled blur radius falls below the filter’s cutoff. Review at 100% using a detail preview.</p>
''' + ''.join(body) + '''
<h2>Agreement and limitations</h2><p>The existing Detail CPU/GPU reference check passed all 80 global/local HDR/SDR cases (existing relative-luminance limits: 99th percentile 2%, maximum 5%). Production GPU and forced-CPU Ultra HDR exports of the padded real-photo crops were decoded and compared using the existing finished-pixel limits: mean below 1, 99.9th percentile at most 3 (HDR ΔE ITP, SDR ΔE 2000). These exports exceed those limits even with Sharpen off. This is an open delivery discrepancy, not a passing export check or an isolated Sharpen fault. No tolerance or pixel code was changed.</p><table><tr><th>Photo</th><th>Setting</th><th>Lane</th><th>Mean</th><th>99.9%</th><th>Result</th></tr>
''' + ''.join(rows) + r'''</table>
<p>All twelve decoded exports remained below the 1000-nit target; the maximum was 184.824 nits. These two crops do not stress a bright specular edge near 1000 nits, so they do not establish safety for every HDR edge. The filter bounds halo excursions to 12% of the local log-luminance range, capped at 0.25 EV; visible light/dark edging and noise can remain. Final highlight compression runs after Sharpen. SDR also clips to its 0–1 range.</p>
<h2>What other editors do</h2><p><a href="https://docs.darktable.org/usermanual/4.2/en/module-reference/processing-modules/sharpen/">darktable’s older Sharpen</a> uses unsharp mask; its <a href="https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/diffuse/">diffuse or sharpen</a> can reverse modeled blur using iterative, edge-oriented processing, with substantially greater computational cost. <a href="https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html">Lightroom</a> provides Amount, Radius, Detail and a separate edge Masking control, and recommends judging at 100%. Adobe’s documentation does not specify its underlying filter here. HDR Finisher’s threshold is a contrast gate, not an edge/noise classification mask.</p>
<h2>Recommendation for Steve</h2><p>Keep the present sharpening method for v1, judged at 100%, pending Steve’s view of these crops. It is fast and the isolated CPU/GPU implementation agrees; its trade-off is limited blur recovery, poor visibility at Fit and noise amplification without a dedicated edge mask. Do not replace it with deconvolution in this batch. Keep the delivery discrepancy open separately; export agreement has not been established.</p>
<p>Reproduce from codebase using the app’s .venv Python: tools/sharpen_review.py; node tests/run-in-electron.js tools/sharpen-review.cjs; tools/sharpen_review.py compare; tools/sharpen_review_page.py. Artifacts: recipe.json, detail-control-reference.json, export-agreement.json and GPU/CPU .jpg exports beside this page.</p>
<script>let fallback=false;document.querySelector('#fallback').onclick=()=>{fallback=!fallback;document.querySelectorAll('img[src*="-hdr-"]').forEach(img=>img.src=img.src.replace(/\.(avif|png)$/,fallback?'.png':'.avif'));document.querySelector('#fallback').textContent=fallback?'Show true HDR AVIF':'Show tone-mapped HDR PNG fallback'};</script></html>'''
(out / 'index.html').write_text(html, encoding='utf-8')
