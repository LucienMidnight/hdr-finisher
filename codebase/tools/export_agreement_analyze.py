"""Analyze retained native preview, pre-encode, unfiltered and finished pixels.
Uses existing mean <1 / p99.9 <=3 limits without changing product code.
"""
from pathlib import Path
import json,sys,hashlib
import numpy as np
import colour
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tests/performance')]
from hdr_finisher.loader import load_image
from hdr_finisher.color import linear_bt2020_to_acescg, acescg_to_linear_bt2020
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.preview import encode_processed_preview_bytes
from hdr_finisher.models import PreviewKind
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
from preview_export_compare import srgb_decode
from export_parity_check import SHADER_BT2020_TO_P3
OUT=ROOT/'output/export-agreement'

def decode_unfiltered(path):
    # Intermediate maps below SDR white carry a 1/1 display capacity range
    # rejected by the CLI decoder. Remux unchanged JPEG streams using exactly
    # the product's existing 1.00001 metadata repair, without filtering pixels.
    from hdr_finisher.exporters import _split_ultrahdr_jpegs, _ultrahdr_metadata_config, _run_command
    from hdr_finisher.capabilities import resolve_binary
    app=resolve_binary('ultrahdr_app')
    fixed=path.with_name(path.stem+'-decodable.jpg')
    work=OUT/(path.stem+'-remux');work.mkdir(exist_ok=True)
    primary,gain=_split_ultrahdr_jpegs(path.read_bytes())
    (work/'primary.jpg').write_bytes(primary);(work/'gain.jpg').write_bytes(gain)
    probe=_run_command([str(app),'-m','1','-j',str(path),'-P'])
    (work/'metadata.cfg').write_text(_ultrahdr_metadata_config(probe.stdout+'\n'+probe.stderr))
    _run_command([str(app),'-m','0','-i',str(work/'primary.jpg'),'-g',str(work/'gain.jpg'),'-f',str(work/'metadata.cfg'),'-z',str(fixed)])
    return load_image(fixed)

def preview(stem,variant,lane):
    meta=json.loads((OUT/f'{stem}-{variant}-{lane}-preview.json').read_text())
    assert (meta['rect']['width'],meta['rect']['height'])==(576,576)
    assert meta['accepted']['exact'] and meta['accepted']['processedLongEdge']==576
    values=np.fromfile(OUT/f'{stem}-{variant}-{lane}-preview.f32',np.float32).reshape(576,576,4)[...,:3]
    linear=srgb_decode(values)
    if lane=='hdr':
        assert meta['format']=='rgba16float'
        return linear_bt2020_to_acescg(linear @ np.linalg.inv(SHADER_BT2020_TO_P3).T * .18)
    return linear

def delta(a,b,lane):
    if lane=='hdr':
        cv=[colour.RGB_to_ICtCp(np.maximum(acescg_to_linear_bt2020(x)*203/.18,0),method='ITU-R BT.2100-2 PQ') for x in (a,b)]
        return colour.difference.delta_E_ITP(*cv)
    cv=[colour.XYZ_to_Lab(colour.RGB_to_XYZ(np.clip(x,0,1),colour.RGB_COLOURSPACES['sRGB'])) for x in (a,b)]
    return colour.difference.delta_E_CIE2000(*cv)

def metric(a,b,lane):
    m=compare_finished_pixels(a,b,lane)
    return dict(mean=m.mean,p999=m.p999,passed=m.passed)

def artifact(name,image,lane):
    kind=PreviewKind(lane)
    data,_=encode_processed_preview_bytes(image,kind,hdr_display=lane=='hdr')
    ext='avif' if lane=='hdr' else 'png';(OUT/f'{name}.{ext}').write_bytes(data)
    if lane=='hdr':
        data,_=encode_processed_preview_bytes(image,kind,hdr_display=False)
        (OUT/f'{name}.png').write_bytes(data)
    return f'{name}.{ext}'

results=[];crops=[];proofs=[]
for stem in ['DSC07147','DSC07178']:
 for variant in ['off','working','strong']:
    decoded={r:load_image(OUT/f'{stem}-{variant}-{r}.jpg') for r in ['gpu','cpu']}
    unfiltered={r:decode_unfiltered(OUT/f'{stem}-{variant}-{r}-unfiltered.jpg') for r in ['gpu','cpu']}
    for lane,index in [('hdr',0),('sdr',4)]:
        view=preview(stem,variant,lane)
        pre={r:np.load(OUT/f'{stem}-{variant}-{r}-{lane}-preencode.npy')[...,:3] for r in ['gpu','cpu']}
        final={r:decoded[r][index] for r in ['gpu','cpu']}
        raw={r:unfiltered[r][index] for r in ['gpu','cpu']}
        entry=dict(photo=stem,variant=variant,lane=lane,stages={})
        pairs={'gpu_cpu_preencode':(pre['gpu'],pre['cpu']),'gpu_cpu_final':(final['gpu'],final['cpu'])}
        for r in ['gpu','cpu']:
            pairs.update({f'preview_{r}_preencode':(view,pre[r]),f'preview_{r}_final':(view,final[r]),
                f'{r}_preencode_unfiltered':(pre[r],raw[r]),f'{r}_preencode_final':(pre[r],final[r]),
                f'{r}_unfiltered_final':(raw[r],final[r])})
        for name,(a,b) in pairs.items():entry['stages'][name]=metric(a,b,lane)
        if lane=='sdr':
            # Isolate 8-bit transfer rounding from JPEG loss.
            from hdr_finisher.exporters import _linear_to_srgb8
            rounded={r:srgb_decode(_linear_to_srgb8(pre[r],dither='off')/255) for r in ['gpu','cpu']}
            for r in ['gpu','cpu']:entry['stages'][f'{r}_preencode_8bit']=metric(pre[r],rounded[r],lane)
        for r in ['gpu','cpu']:
            errors=delta(view,final[r],lane)
            luma=view @ (np.array([.2722287,.6740818,.0536895]) if lane=='hdr' else np.array([.2126,.7152,.0722]))
            q=np.quantile(luma,[.25,.75]);edge=np.hypot(*np.gradient(luma));edge_cut=np.quantile(edge,.9)
            entry.setdefault('regions',{})[r]={name:float(np.mean(errors[mask])) for name,mask in {
                'darker_quarter':luma<=q[0],'brighter_quarter':luma>=q[1],'strongest_edges':edge>=edge_cut,'flatter_areas':edge<np.quantile(edge,.5)}.items()}
            # Find the worst 128x128 average-error region, retaining a 32px processing border.
            summed=np.pad(errors,((1,0),(1,0))).cumsum(0).cumsum(1)
            scored=(summed[128:,128:]-summed[:-128,128:]-summed[128:,:-128]+summed[:-128,:-128])/(128*128)
            inside=scored[32:-32,32:-32]
            y,x=np.unravel_index(np.argmax(inside),inside.shape);y+=32;x+=32
            box=(int(x),int(y),int(x+128),int(y+128))
            names=[]
            for label,image in [('preview',view),('export',final[r])]:
                crop=image[box[1]:box[3],box[0]:box[2]]
                names.append(artifact(f'{stem}-{variant}-{lane}-{r}-{label}',crop,lane))
            crops.append(dict(photo=stem,variant=variant,lane=lane,renderer=r,box=box,images=names,
                              metric=entry['stages'][f'preview_{r}_final']))
        results.append(entry)
        print(stem,variant,lane,json.dumps(entry['stages']),flush=True)
 for r in ['gpu','cpu']:
    a=OUT/f'{stem}-off-{r}.jpg';b=OUT/f'{stem}-{r}-proof.jpg'
    proofs.append(dict(photo=stem,renderer=r,byte_identical=hashlib.sha256(a.read_bytes()).digest()==hashlib.sha256(b.read_bytes()).digest(),
        hdr=metric(load_image(a)[0],load_image(b)[0],'hdr'),sdr=metric(load_image(a)[4],load_image(b)[4],'sdr'),
        peak_nits=check_decoded_hdr_ceiling(a,'jpeg_ultrahdr',1000)))
(OUT/'analysis.json').write_text(json.dumps(dict(scope='576x576 padded real-photo crops, native presentation; metrics on whole frame, no pixels excluded',results=results,proofs=proofs,crops=crops),indent=2),encoding='utf-8')
body=[]
for c in crops:
    body.append(f"<h2>{c['photo']} {c['variant']} {c['lane'].upper()} {c['renderer'].upper()} — crop {c['box']}</h2><p>Whole-frame mean {c['metric']['mean']:.3f}; p99.9 {c['metric']['p999']:.3f}. Limits: mean &lt;1; p99.9 ≤3.</p><div class='pair'>")
    for label,src in zip(['Native GPU preview','Decoded finished export'],c['images']):
        body.append(f"<figure><figcaption>{label}</figcaption><img width='128' height='128' src='{src}' alt='{label}'></figure>")
    body.append('</div>')
html="""<!doctype html><html lang='en'><meta charset='utf-8'><title>Export agreement — matched worst regions</title>
<style>body{background:#202124;color:#eee;font:16px/1.5 system-ui;margin:28px}p{max-width:1100px}.pair{display:flex;gap:24px}figure{margin:0}img{display:block;width:128px;height:128px}button{font:inherit;padding:8px}a{color:#9cf}</style>
<h1>Preview versus finished export at 100%</h1><p>DSC07147.ARW and DSC07178.ARW: the same padded 576px crops as the Sharpen review, uploaded from local EXR copies. Read-only originals. Actual native GPU presentation target captured after the accepted exact frame; its display transfer and P3 matrix are inverted for common-space comparison. HDR uses PQ AVIF, SDR uses sRGB PNG. Each matched pair shows the worst 128px average-error region, chosen from the inner picture to avoid processing boundaries. Images remain 128 original pixels at browser zoom 100%. Whole-frame metrics include all pixels and use unchanged perceptual limits.</p>
<p>The off / working / strong settings are 0/.8/10, 80/.8/10 and 200/3/0. Export is Ultra HDR JPEG quality 100, 4:4:4, full-size quality-100 gain map, with dithering, resizing and output sharpening off. Both renderers are verified in capture.log. Proof and export checks are in analysis.json.</p>
<p><strong>Finding:</strong> GPU and CPU agree with the native preview before encoding. The JPEG/gain-map round trip misses the finished limits, and gain-map smoothing adds HDR texture differences. SDR differences arise in the JPEG base; 8-bit rounding alone passes. Worst HDR differences favour noisy shadows and flat areas. These crops do not qualify bright highlights.</p><p><strong>Open choice:</strong> retain current limits and investigate encoding quality; consider less smoothing only after judging texture versus chroma patching. No product pixels or tolerances changed. The separately failing full-size RAW Proof is recorded in the Export and Proof PRD.</p>
<button id='toggle'>Show tone-mapped HDR fallback</button>
"""+''.join(body)+"""<p><a href='analysis.json'>Stage metrics and region statistics</a> · <a href='capture.log'>Production capture log</a></p>
<script>let fallback=false;document.querySelector('#toggle').onclick=()=>{fallback=!fallback;document.querySelectorAll('img[src*="-hdr-"]').forEach(img=>img.src=img.src.replace(/\\.(avif|png)$/,fallback?'.png':'.avif'));document.querySelector('#toggle').textContent=fallback?'Show HDR AVIF':'Show tone-mapped HDR fallback'};</script></html>"""
(OUT/'index.html').write_text(html,encoding='utf-8')
